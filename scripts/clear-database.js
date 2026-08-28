#!/usr/bin/env node
// Maintenance tool: deletes stale (or all) games from the Realtime Database.
// Uses the Firebase Admin SDK, which bypasses firebase.rules.json entirely — run
// this only from a trusted machine with a service account key. See SETUP.md →
// "Clearing stale game data".
const admin = require('firebase-admin');
const readline = require('readline');

function parseArgs(argv) {
  const args = {
    olderThanDays: 3, dryRun: false, all: false, yes: false, help: false,
  };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--all') args.all = true;
    else if (a === '--yes') args.yes = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a.startsWith('--older-than-days=')) args.olderThanDays = Number(a.split('=')[1]);
    else {
      console.error(`Unknown option: ${a}`);
      args.help = true;
    }
  }
  return args;
}

function printUsage() {
  console.log(`
Usage: node scripts/clear-database.js [options]

Options:
  --older-than-days=N   Delete games created more than N days ago (default: 3)
  --all                 Delete ALL games, regardless of age (ignores --older-than-days)
  --dry-run             List what would be deleted, without deleting anything
  --yes                 Skip the interactive confirmation prompt
  --help                Show this help

Requires environment variables:
  GOOGLE_APPLICATION_CREDENTIALS   Path to a Firebase service account JSON key
  FIREBASE_DATABASE_URL            Your Realtime Database URL
`);
}

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (type "yes" to continue): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printUsage(); return; }

  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    console.error('Set FIREBASE_DATABASE_URL to your Realtime Database URL.');
    process.exitCode = 1;
    return;
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service account JSON key.');
    process.exitCode = 1;
    return;
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL,
  });

  const db = admin.database();
  const snap = await db.ref('games').once('value');
  const games = snap.val() || {};
  const cutoff = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;

  const candidates = Object.entries(games)
    .filter(([, g]) => args.all || (g.meta?.createdAt || 0) < cutoff)
    .map(([code, g]) => ({
      code,
      createdAt: g.meta?.createdAt ? new Date(g.meta.createdAt).toISOString() : 'unknown',
      phase: g.meta?.phase || 'unknown',
      players: Object.keys(g.players || {}).length,
    }));

  if (!candidates.length) {
    console.log('No games match the deletion criteria. Nothing to do.');
    return;
  }

  console.log(`\nGames to delete (${candidates.length}):`);
  console.table(candidates);

  if (args.dryRun) {
    console.log('\nDry run — no changes made.');
    return;
  }

  if (!args.yes) {
    const ok = await confirm(`\nPermanently delete ${candidates.length} game(s) from the database?`);
    if (!ok) {
      console.log('Aborted.');
      process.exitCode = 1;
      return;
    }
  }

  const updates = {};
  for (const { code } of candidates) updates[code] = null;
  await db.ref('games').update(updates);
  console.log(`Deleted ${candidates.length} game(s).`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exitCode = 1;
});
