// TikTok Studio per-post analytics capture — local, human-driven, personal data only.
//
// HOW IT WORKS
//   Launches a real Chromium window with a persistent profile (so you log in once).
//   YOU log in and click through your own videos' analytics. This script only LISTENS:
//   it intercepts the JSON the TikTok Studio SPA fetches to fill those panels and saves
//   it. All-human interaction is the lowest bot-detection risk and doesn't depend on
//   TikTok's (obfuscated, ever-changing) DOM.
//
//   Automated navigation was tried and removed: TikTok flags the automated browser
//   session regardless of how human the clicks are, costing IP reputation for no real
//   gain. Manual capture is the supported path — a couple of minutes covers your recent
//   videos, and parse.js merges sessions so history builds up incrementally.
//
// OUTPUT (all under ./output/, gitignored)
//   raw/<timestamp>__<slug>.json   full intercepted payloads (source of truth)
//   endpoints.log                  every JSON endpoint URL seen (for schema recon)
//   captured-<runstamp>.csv        best-effort flattened metrics (union of all keys)
//
// Finish a listen session with Ctrl-C — the CSV is written on exit.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SESSION_DIR = path.join(ROOT, '.session');
const OUT_DIR = path.join(ROOT, 'output');
const RAW_DIR = path.join(OUT_DIR, 'raw');
const ENDPOINTS_LOG = path.join(OUT_DIR, 'endpoints.log');

const START = new Date();
const RUNSTAMP = START.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const CSV_PATH = path.join(OUT_DIR, `captured-${RUNSTAMP}.csv`);

// Broad on purpose: capture anything that smells like per-post analytics, narrow later.
const CAPTURE_HINTS =
  /insight|analytics|item_detail|aweme[\/_]detail|video[\/_]detail|post_detail|creator|studio|data\/(insight|item|post)|metrics|statistic/i;
const IGNORE_EXT = /\.(png|jpe?g|webp|gif|svg|ico|css|woff2?|ttf|otf|mp4|m3u8|ts|mp3)(\?|$)/i;

fs.mkdirSync(RAW_DIR, { recursive: true });

/** @type {Array<Record<string, any>>} flattened records for the CSV */
const records = [];
let jsonSeen = 0;
let captured = 0;

function slugFromUrl(u) {
  try {
    const { pathname } = new URL(u);
    return pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'root';
  } catch {
    return 'url';
  }
}

function logEndpoint(u, note) {
  fs.appendFileSync(ENDPOINTS_LOG, `${new Date().toISOString()}  ${note}  ${u}\n`);
}

// Pull leaf key/value pairs out of nested analytics JSON so the CSV has real columns.
// Keeps arrays of small objects as JSON strings; flattens plain nested objects with dotted keys.
function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) {
      out[key] = '';
    } else if (Array.isArray(v)) {
      out[key] = JSON.stringify(v);
    } else if (typeof v === 'object') {
      flatten(v, key, out);
    } else {
      out[key] = v;
    }
  }
  return out;
}

// Heuristic: does this payload look like it carries per-video analytics?
function looksLikeMetrics(json) {
  const s = JSON.stringify(json).toLowerCase();
  return /watch|play|retention|traffic|source|impression|reach|complet|audience|view|duration|full_video/.test(s);
}

async function saveResponse(url, json) {
  const file = path.join(RAW_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}__${slugFromUrl(url)}.json`);
  fs.writeFileSync(file, JSON.stringify({ url, capturedAt: new Date().toISOString(), body: json }, null, 2));
  captured++;
  if (looksLikeMetrics(json)) {
    records.push(flatten({ _url: url, _capturedAt: new Date().toISOString(), ...json }, '', {}));
  }
  process.stdout.write(`\r  seen ${jsonSeen} JSON · saved ${captured} · metric-like ${records.length}   `);
}

function writeCsv() {
  if (!records.length) {
    console.log('\nNo metric-like payloads captured. Check output/endpoints.log to see what endpoints fired.');
    return;
  }
  const cols = [...records.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set())];
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of records) lines.push(cols.map((c) => esc(r[c])).join(','));
  fs.writeFileSync(CSV_PATH, lines.join('\n'));
  console.log(`\nWrote ${records.length} rows × ${cols.length} cols → ${path.relative(ROOT, CSV_PATH)}`);
  console.log(`Raw payloads → ${path.relative(ROOT, RAW_DIR)}/  ·  endpoints → ${path.relative(ROOT, ENDPOINTS_LOG)}`);
}

(async () => {
  console.log('TikTok analytics capture — LISTEN mode\n');
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  // Intercept every JSON response and save the analytics-looking ones.
  context.on('response', async (res) => {
    const url = res.url();
    if (IGNORE_EXT.test(url)) return;
    const ct = (res.headers()['content-type'] || '').toLowerCase();
    if (!ct.includes('json')) return;
    let json;
    try { json = await res.json(); } catch { return; }
    jsonSeen++;
    const hit = CAPTURE_HINTS.test(url);
    logEndpoint(url, hit ? 'CAPTURE' : 'seen');
    if (hit || looksLikeMetrics(json)) await saveResponse(url, json);
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://www.tiktok.com/tiktokstudio/content', { waitUntil: 'domcontentloaded' }).catch(() => {});

  // Flush + exit cleanly on Ctrl-C.
  const finish = async () => {
    console.log('\n\nFinishing…');
    writeCsv();
    await context.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', finish);

  console.log('\n1. Log into TikTok in the window if prompted.');
  console.log('2. Open each video\'s analytics one at a time, then click its Viewers tab.');
  console.log('   (Everything each page loads is captured automatically as you click.)');
  console.log('3. When done, come back here and press  Ctrl-C  to write the CSV.\n');
  // Keep the process alive; capture happens in the response handler.
  await new Promise(() => {});
})();
