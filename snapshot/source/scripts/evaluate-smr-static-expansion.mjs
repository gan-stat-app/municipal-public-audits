// Offline capacity/contract evaluation only. Never writes published JSON or configuration.
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, symlink, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import worker from '../../smr-json-worker.mjs';
import { buildStaticSmrFiles, staticSmrPath, sha256 } from './build-smr-static-results.mjs';
import { applyMethodAcceptance } from '../src/lib/dataClient.js';
import { calculateArbitraryPeriodCase } from '../src/lib/parity.js';
import { buildSmrExport } from '../src/lib/smrExport.js';
import { displayAreaName, designatedCityByCode } from '../src/catalogs/designatedCities.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const pilot = await readJson('source/smr-static-results/config.json');
const originalConfig = await readFile(resolve(root, 'source/smr-static-results/config.json'));
const select = change => ({ ...pilot.selections[0], ...change });
const dataset = async s => JSON.parse(gunzipSync(await readFile(resolve(root,
  `data/selected-cause-rebuild-v1/${s.basis}-${s.datasetCode}-2024-boundary.json.gz`))));
const suicide = await dataset(select({ datasetCode: 'Se34' }));
const catalog = await readJson('data/area-catalog.json');
const codes = new Set(catalog.map(([code]) => code));
const zero = suicide.rows.find(row => row[3] === 0 && row[4] > 0 && row[7] === 'AVAILABLE'
  && codes.has(row[1]) && !row[1].endsWith('000') && !designatedCityByCode(row[1]));
assert(zero, 'A released zero-death condition is required');
const selections = [select({}), select({ sex: '女' }), select({ sex: '男女計' }),
  select({ basis: 'census' }), select({ areaCode: '05203' }),
  select({ datasetCode: 'Se34', sex: '女' }), select({ datasetCode: 'Se02' }),
  select({ areaCode: '19201', startYear: 2006, endYear: 2006 }),
  select({ areaCode: '14131' }), select({ datasetCode: 'Se34', areaCode: zero[1],
    sex: zero[2] === 'M' ? '男' : '女', startYear: zero[0], endYear: zero[0] })];

async function build(selected) {
  const temp = await mkdtemp(resolve(tmpdir(), 'smr-static-evaluation-'));
  try {
    await mkdir(resolve(temp, 'source/smr-static-results'), { recursive: true });
    for (const path of ['data', 'source/src', 'source/scripts'])
      await symlink(resolve(root, path), resolve(temp, path), 'dir');
    await writeFile(resolve(temp, 'source/smr-static-results/config.json'),
      JSON.stringify({ ...pilot, selections: selected }, null, 2) + '\n');
    return await buildStaticSmrFiles(temp);
  } finally { await rm(temp, { recursive: true, force: true }); }
}

const args = process.argv.slice(2);
if (args.length) {
  assert(args.length === 2 && args[0] === '--measure' && ['pilot', 'representative'].includes(args[1]));
  const started = performance.now();
  const outputs = await build(args[1] === 'pilot' ? pilot.selections : selections);
  console.log(JSON.stringify({ build_ms: performance.now() - started,
    peak_rss_kib: process.resourceUsage().maxRSS, results: outputs.length - 1,
    bytes: outputs.reduce((n, item) => n + Buffer.byteLength(item.text), 0),
    output_sha256: sha256(outputs.map(item => item.text).join('')) }));
} else {
  const outputs = await build(selections), index = JSON.parse(outputs.at(-1).text);
  const policy = await readJson('data/selected-cause-rebuild-v1/acceptance.json');
  const areaCatalog = catalog.map(([code, name]) => ({ code, name: displayAreaName(code, name) }));
  const numeric = ['observed_deaths', 'expected_deaths', 'standardized_mortality_ratio', 'ci95_lower', 'ci95_upper'];
  const results = [];
  for (const [i, s] of selections.entries()) {
    const raw = await dataset(s), accepted = applyMethodAcceptance(raw, policy);
    const record = JSON.parse(outputs[i].text), { delivery, ...existing } = record;
    const query = { ...s, mode: 'arbitrary', dataRevision: 'rebuilt', regionUnit: 'municipality' };
    const calculated = await calculateArbitraryPeriodCase({ ...query, dataset: accepted });
    assert.equal(record.selection.region.code, s.areaCode);
    assert.equal(record.selection.population_basis, s.basis);
    assert.equal(record.selection.sex, s.sex);
    assert.equal(record.selection.cause_code, s.datasetCode);
    assert.equal(record.selection.boundary, '2024年市区町村境界');
    assert.equal(index.results[i].sha256, sha256(outputs[i].text));
    assert.equal(delivery.source_data_sha256, sha256(await readFile(resolve(root,
      `data/selected-cause-rebuild-v1/${s.basis}-${s.datasetCode}-2024-boundary.json.gz`))));
    if (record.result.status === 'complete') {
      assert.deepEqual(existing, buildSmrExport({ query, result: calculated, dataset: accepted,
        areaCatalog, now: new Date(pilot.generated_at) }), 'Existing single-export fields must match');
      const rows = accepted.rows.filter(r => r[1] === s.areaCode && r[0] >= s.startYear && r[0] <= s.endYear
        && (s.sex === '男女計' || r[2] === (s.sex === '男' ? 'M' : 'F')));
      const expectedRows = (s.endYear - s.startYear + 1) * (s.sex === '男女計' ? 2 : 1);
      assert.equal(rows.length, expectedRows);
      assert.equal(new Set(rows.map(r => `${r[0]}:${r[2]}`)).size, expectedRows);
      const o = rows.reduce((n, r) => n + r[3], 0), e = rows.reduce((n, r) => n + r[4], 0);
      assert.equal(record.result.observed_deaths, o);
      assert.equal(record.result.expected_deaths, e);
      assert.equal(record.result.standardized_mortality_ratio, o / e * 100);
      if (o === 0) assert(record.result.ci95_upper > 0);
    } else {
      assert.equal(record.result.status, 'unavailable');
      assert(record.result.reason);
      assert(calculated === null || calculated.complete === false);
      for (const field of numeric) assert.equal(record.result[field], null);
    }
    results.push({ selection: s, status: record.result.status, reason: record.result.reason ?? null,
      observed_deaths: record.result.observed_deaths, bytes: Buffer.byteLength(outputs[i].text), sha256: index.results[i].sha256 });
  }
  assert.equal(results[7].status, 'unavailable', 'Kofu boundary nonallocation must remain unavailable');
  assert.equal(results[9].observed_deaths, 0, 'Observed zero is not missing');
  const { delivery, ...pilotRecord } = JSON.parse(outputs[0].text);
  assert.deepEqual(pilotRecord, await readJson('source/smr-static-results/akita-2020-2024-browser-export.json'));
  const publishedConfig = await readJson('wrangler.jsonc');
  const publishedCatalog = await readJson('smr-json/v1/index.json');
  assert.equal(publishedCatalog.results.length, 1);
  assert.deepEqual(publishedConfig.assets.run_worker_first,
    ['/smr-json', '/smr-json/*', '!/smr-json/v1/index.json', `!${staticSmrPath(pilot.selections[0])}`]);
  const candidateAssets = new Map(outputs.map(x => [x.path, x.text]));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'), text = candidateAssets.get(url.pathname);
      const response = text !== undefined ? new Response(req.method === 'HEAD' ? null : text,
        { headers: { 'Content-Type': 'application/json' } })
        : await worker.fetch(new Request(url, { method: req.method }),
          { ASSETS: { fetch: async () => new Response('SPA', { headers: { 'Content-Type': 'text/html' } }) } });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let httpChecks = 0;
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const item of outputs) {
      const response = await fetch(origin + item.path);
      assert.equal(response.status, 200); assert(response.headers.get('content-type').startsWith('application/json'));
      assert.equal(await response.text(), item.text); httpChecks++;
      const head = await fetch(origin + item.path, { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(await head.text(), ''); httpChecks++;
    }
    for (const path of ['/smr-json', '/smr-json/v1/not-published.json', '/smr-json/v1/juki/Se00/male/2025-2025/05201.json']) {
      assert(!candidateAssets.has(path));
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(origin + path, { method, headers: { Accept: 'text/html' } });
        assert.equal(response.status, 404); assert(response.headers.get('content-type').startsWith('application/json'));
        if (method === 'HEAD') assert.equal(await response.text(), '');
        else assert.equal((await response.json()).status, 'not_published');
        httpChecks++;
      }
    }
    const response = await fetch(origin + outputs[0].path + '?sex=female');
    assert.equal((await response.json()).selection.sex, '男'); httpChecks++;
    assert.equal((await fetch(origin + '/')).status, 200); httpChecks++;
  } finally { await new Promise(done => server.close(done)); }
  const measurements = {};
  for (const scenario of ['pilot', 'representative']) {
    measurements[scenario] = [];
    for (let i = 0; i < 3; i++) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--measure', scenario],
        { encoding: 'utf8', timeout: 60000 });
      assert.equal(child.status, 0, child.stderr);
      measurements[scenario].push(JSON.parse(child.stdout));
    }
    assert.equal(new Set(measurements[scenario].map(x => x.output_sha256)).size, 1);
  }
  assert.equal(measurements.representative[0].output_sha256, sha256(outputs.map(x => x.text).join('')));
  assert.deepEqual(await readFile(resolve(root, 'source/smr-static-results/config.json')), originalConfig);
  console.log(JSON.stringify({ pass: true, scope: 'offline unpublished representative evaluation; no production expansion',
    generated_at: new Date().toISOString(), source_commit: process.env.GITHUB_SHA ?? null,
    node: process.version, measurements, results,
    raw_bytes: outputs.reduce((n, x) => n + Buffer.byteLength(x.text), 0),
    gzip_bytes_individual_sum: outputs.reduce((n, x) => n + gzipSync(x.text).length, 0),
    input_gzip_bytes: index.inputs.filter(x => x.path.endsWith('.gz')).reduce((n, x) => n + x.bytes, 0),
    http_checks: httpChecks, published_selections: publishedCatalog.results.length,
    limitations: ['local HTTP harness, not Cloudflare headers or routing', 'generation time excludes Node startup and representative discovery',
      'peak RSS includes representative discovery in both cases', 'no traffic, demand, billing or national-scale inference'],
    decision: 'retain one published pilot; add named conditions only after demand and deployment route review' }));
}
