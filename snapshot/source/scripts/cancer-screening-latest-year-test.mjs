import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const app = readFileSync(new URL('../public/cancer-screening/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/cancer-screening/index.html', import.meta.url), 'utf8');
const productionApp = readFileSync(new URL('../../cancer-screening/app.js', import.meta.url), 'utf8');
const productionHtml = readFileSync(new URL('../../cancer-screening/index.html', import.meta.url), 'utf8');
const encoded = readFileSync(new URL('../public/cancer-screening/data/screening.json.gz.b64', import.meta.url), 'utf8').trim();
const raw = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));

assert.ok(html.includes('<script src="app.js?v=20261009-map" defer></script>'), 'The app script must use the current cache-busting version.');
assert.equal(productionApp, app, 'The production cancer-screening app must match the reconstructed source.');
assert.equal(productionHtml, html, 'The production cancer-screening HTML must match the reconstructed source.');

assert.match(
  app,
  /state=\{cancer:'stomach',metric:'stomach_50_69_2y',sex:'男女計',pref:'秋田県',year:null,/,
  'The initial year must be unset so syncControls selects the newest available year.'
);
assert.match(
  app,
  /if\(!years\.includes\(state\.year\)\)state\.year=years\[0\]/,
  'syncControls must select the first year after sorting years newest-first.'
);
assert.match(
  app,
  /\.sort\(\(a,b\)=>b-a\)/,
  'Available years must be sorted newest-first.'
);

const rows = raw.rows.map(values => Object.fromEntries(raw.columns.map((key, index) => [key, values[index]])));
const years = [...new Set(
  rows
    .filter(row => row.sex === '男女計' && Number.isFinite(row.stomach_50_69_2y))
    .map(row => row.year)
)].sort((a, b) => b - a);

assert.ok(years.length > 0, 'Default cancer-screening metric must have at least one available year.');
assert.equal(years[0], 2025, 'The newest available year for the default metric should currently be 2025.');

console.log(`Cancer-screening latest-year regression passed: default year = ${years[0]}`);
