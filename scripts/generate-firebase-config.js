#!/usr/bin/env node
// Generates js/firebase-config.js from js/firebase-config.template.js using
// environment variables. Used by the GitHub Actions deploy workflow (secrets are
// exposed to the workflow step as env vars) and can be run locally the same way.
const fs = require('fs');
const path = require('path');

const REQUIRED = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_DATABASE_URL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID',
];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const templatePath = path.join(__dirname, '..', 'js', 'firebase-config.template.js');
const outPath = path.join(__dirname, '..', 'js', 'firebase-config.js');

let content = fs.readFileSync(templatePath, 'utf8');
for (const key of REQUIRED) {
  content = content.split(`__${key}__`).join(process.env[key]);
}
fs.writeFileSync(outPath, content);
console.log(`Wrote ${outPath}`);
