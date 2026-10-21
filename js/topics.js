// Client-side topic grouping for reflection answers (no network, no ML service).
// Stemmed TF-IDF vectors, boosted by a small lexicon of common retro themes, merged
// with average-linkage clustering. The host's client runs this once and writes the
// result to RTDB so every screen shows the same groups (and the host can adjust them).

const STOPWORDS = new Set((
  'a about above after again all also am an and any are as at be because been before being below between both '
  + 'but by can could did do does doing down during each few for from further had has have having he her here '
  + 'hers him his how i if in into is it its itself just me more most my myself no nor not now of off on once '
  + 'only or other our ours out over own same she should so some such than that the their theirs them then there '
  + 'these they this those through to too under until up very was we were what when where which while who whom '
  + 'why will with would you your yours '
  + 'sprint sprints team teams week weeks day days time times work worked working thing things lot lots really '
  + 'good great bad well better best worse worst much many get got getting going gone make made makes need needs '
  + 'needed want wanted like liked think thought feel felt know knew one two three way ways bit little still '
  + 'even every something anything everything nothing someone anyone everyone people person felt seem seemed '
  + 'say said take took taken give gave given use used using able around across since often always never '
  + 'sometimes maybe bits kind sort quite pretty bunch whole new next last first second dont didnt wasnt isnt '
  + 'cant couldnt wouldnt shouldnt arent werent havent hasnt hadnt wont thats theres thats ive weve youve im '
  + 'theyre were youre lets let also however though although'
).split(/\s+/));

const SUFFIXES = ['ations', 'ation', 'ments', 'ment', 'ings', 'ing', 'ers', 'er', 'ed', 'es', 'ly', 's'];

function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) { w = w.slice(0, -suf.length); break; }
  }
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

// theme id -> label + keywords (stemmed the same way as answers, so plurals/-ing forms match).
const THEMES = {
  deploy: {
    label: 'Deployments & releases',
    words: 'deploy deployment release releases ship shipping shipped rollout rollback hotfix prod production merge merging cicd ci cd build builds',
  },
  testing: {
    label: 'Testing & quality',
    words: 'test tests testing tested qa bug bugs defect defects regression flaky coverage quality uat',
  },
  review: {
    label: 'Code reviews',
    words: 'pr prs review reviews reviewed reviewer reviewers pull approve approval approvals',
  },
  meetings: {
    label: 'Meetings & ceremonies',
    words: 'meeting meetings standup standups ceremony ceremonies retro refinement agenda sync syncs call calls',
  },
  planning: {
    label: 'Planning & scope',
    words: 'plan planning planned scope estimate estimates estimation story stories points backlog priority priorities prioritise prioritize deadline deadlines commitment roadmap requirement requirements spec specs ticket tickets jira creep',
  },
  comms: {
    label: 'Communication',
    words: 'communication communicate communicating communicated message messages slack email update updates informed visibility transparent transparency clarity clear unclear miscommunication async',
  },
  collab: {
    label: 'Collaboration & pairing',
    words: 'pair pairing paired collaboration collaborate collaborated together teamwork mentor mentoring swarm swarming help helped helping share sharing shared',
  },
  workload: {
    label: 'Workload & wellbeing',
    words: 'workload capacity overload overloaded burnout stress stressed stressful tired overtime pressure balance holiday holidays leave sick focus interruption interruptions interrupt context switching multitask multitasking morale motivation energy',
  },
  tooling: {
    label: 'Tools & environments',
    words: 'tool tools tooling environment environments env access permission permissions vpn laptop licence license setup config configuration infrastructure infra cloud azure aws gcp databricks snowflake airflow terraform github jenkins',
  },
  data: {
    label: 'Data pipelines & quality',
    words: 'data dataset datasets pipeline pipelines table tables schema dbt model models etl elt sql query queries warehouse lineage freshness dashboard dashboards report reports metric metrics',
  },
  techdebt: {
    label: 'Tech debt & code health',
    words: 'debt refactor refactoring legacy cleanup hack hacks workaround workarounds duplicate duplication hardcoded spaghetti maintain maintainability upgrade upgrades migration migrate deprecated',
  },
  docs: {
    label: 'Documentation & knowledge',
    words: 'doc docs documentation document documented wiki confluence knowledge handover onboarding onboard runbook',
  },
  incidents: {
    label: 'Incidents & support',
    words: 'incident incidents outage outages alert alerts oncall monitoring monitor fail failed failure failures broke broken crash downtime rca postmortem support',
  },
  blockers: {
    label: 'Dependencies & blockers',
    words: 'block blocked blocker blockers blocking dependency dependencies waiting wait waited external upstream downstream vendor stakeholder stakeholders client customer',
  },
};

const THEME_BY_STEM = new Map();
for (const [id, theme] of Object.entries(THEMES)) {
  for (const w of theme.words.split(/\s+/)) {
    const s = stem(w);
    if (!THEME_BY_STEM.has(s)) THEME_BY_STEM.set(s, new Set());
    THEME_BY_STEM.get(s).add(id);
  }
}

const CONCEPT_WEIGHT = 3;
const MERGE_THRESHOLD = 0.22;
const OTHER_LABEL = 'Other / one-offs';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function titleCase(w) {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function buildVectors(items) {
  const docs = items.map((item) => {
    const tf = new Map();
    const forms = new Map(); // stem -> original word (for labels)
    const concepts = new Map(); // theme id -> hit count
    for (const word of tokenize(item.text)) {
      const s = stem(word);
      tf.set(s, (tf.get(s) || 0) + 1);
      if (!forms.has(s)) forms.set(s, word);
      for (const id of THEME_BY_STEM.get(s) || []) concepts.set(id, (concepts.get(id) || 0) + 1);
    }
    // Only the answer's dominant theme(s) count, so a passing mention doesn't drag it elsewhere.
    const maxHits = Math.max(0, ...concepts.values());
    for (const [id, hits] of concepts) {
      if (hits === maxHits) tf.set(`#${id}`, CONCEPT_WEIGHT);
      else concepts.delete(id);
    }
    return { tf, forms, concepts };
  });

  // Drop terms that appear in most answers — they don't discriminate between topics.
  const df = new Map();
  docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const n = docs.length;
  const tooCommon = (t) => n >= 6 && df.get(t) / n > 0.4;

  const vectors = docs.map((d) => {
    const vec = new Map();
    let norm = 0;
    d.tf.forEach((count, t) => {
      if (tooCommon(t)) return;
      const w = count * Math.log(1 + n / df.get(t));
      vec.set(t, w);
      norm += w * w;
    });
    return { vec, norm: Math.sqrt(norm) };
  });
  return { docs, vectors, df };
}

function cosine(a, b) {
  if (!a.norm || !b.norm) return 0;
  const [small, large] = a.vec.size <= b.vec.size ? [a.vec, b.vec] : [b.vec, a.vec];
  let dot = 0;
  small.forEach((w, t) => { const o = large.get(t); if (o) dot += w * o; });
  return dot / (a.norm * b.norm);
}

function clusterIndices(vectors) {
  const n = vectors.length;
  const sim = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) sim[i][j] = cosine(vectors[i], vectors[j]);
  }
  const s = (i, j) => (i < j ? sim[i][j] : sim[j][i]);

  let clusters = vectors.map((_, i) => [i]);
  for (;;) {
    let best = MERGE_THRESHOLD;
    let bi = -1;
    let bj = -1;
    for (let a = 0; a < clusters.length; a++) {
      for (let b = a + 1; b < clusters.length; b++) {
        let total = 0;
        for (const i of clusters[a]) for (const j of clusters[b]) total += s(i, j);
        const avg = total / (clusters[a].length * clusters[b].length);
        if (avg > best) { best = avg; bi = a; bj = b; }
      }
    }
    if (bi < 0) break;
    clusters[bi] = clusters[bi].concat(clusters[bj]);
    clusters = clusters.filter((_, k) => k !== bj);
  }
  return clusters;
}

function labelFor(indices, docs, vectors) {
  const conceptCounts = new Map();
  indices.forEach((i) => docs[i].concepts.forEach((_, id) => {
    conceptCounts.set(id, (conceptCounts.get(id) || 0) + 1);
  }));
  const [topConcept, topCount] = [...conceptCounts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (topConcept && topCount * 2 >= indices.length) return THEMES[topConcept].label;

  const weights = new Map();
  indices.forEach((i) => vectors[i].vec.forEach((w, t) => {
    if (!t.startsWith('#')) weights.set(t, (weights.get(t) || 0) + w);
  }));
  const top = [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  const words = top.map((t) => {
    const idx = indices.find((i) => docs[i].forms.has(t));
    return titleCase(docs[idx].forms.get(t));
  });
  return words.length ? words.join(' & ') : 'Misc';
}

// items: [{ id, text }] -> [{ label, ids: [id, ...] }], biggest topic first, one-offs last.
export function groupByTopic(items) {
  if (!items.length) return [];
  const { docs, vectors } = buildVectors(items);
  const clusters = clusterIndices(vectors);

  const topics = clusters.filter((c) => c.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((c) => ({ label: labelFor(c, docs, vectors), ids: c.sort((a, b) => a - b).map((i) => items[i].id) }));

  const seen = new Map();
  topics.forEach((t) => {
    const k = (seen.get(t.label) || 0) + 1;
    seen.set(t.label, k);
    if (k > 1) t.label = `${t.label} (${k})`;
  });

  const leftovers = clusters.filter((c) => c.length === 1).map((c) => items[c[0]].id);
  if (leftovers.length) topics.push({ label: OTHER_LABEL, ids: leftovers });
  return topics;
}
