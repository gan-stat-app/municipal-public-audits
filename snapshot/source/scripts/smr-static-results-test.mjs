import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { applyMethodAcceptance } from '../src/lib/dataClient.js';
import { calculateArbitraryPeriodCase } from '../src/lib/parity.js';
import { buildSmrExport } from '../src/lib/smrExport.js';
import { displayAreaName } from '../src/catalogs/designatedCities.js';
import { buildStaticSmrFiles, checkStaticSmrFiles, createStaticSmrRecord,
  sha256, staticSmrPath, STATIC_SMR_PREFIX } from './build-smr-static-results.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const config = await json('source/smr-static-results/config.json'), selection = config.selections[0];
assert.equal(config.selections.length, 1, 'The first pilot publishes only the requested Akita case');
assert.deepEqual(selection, { basis: 'juki', datasetCode: 'Se00', areaCode: '05201', sex: '男', startYear: 2020, endYear: 2024 });
const outputs = await buildStaticSmrFiles(root);
await checkStaticSmrFiles(root, outputs);
const record = JSON.parse(outputs[0].text), index = JSON.parse(outputs.at(-1).text);
const { delivery, ...existingExport } = record;
const browserExport = await json('source/smr-static-results/akita-2020-2024-browser-export.json');
assert.deepEqual(existingExport, browserExport, 'All existing fields must match the independently saved production export');
assert.equal(record.selection.region.code, '05201');
assert.equal(record.selection.region.name, '秋田県秋田市');
assert.equal(record.selection.boundary, '2024年市区町村境界');
assert.equal(record.selection.period.included_years, 5);
assert.equal(record.selection.population_scope, '日本人');
assert.equal(record.result.national_reference, 100);
assert.equal(delivery.type, 'static-json-pilot');
assert.equal(delivery.supports_query_parameters, false);
assert.equal(index.results[0].sha256, sha256(outputs[0].text));
assert.equal(index.results[0].bytes, Buffer.byteLength(outputs[0].text));
assert.deepEqual(index.results[0].selection, record.selection);

const raw = JSON.parse(gunzipSync(await readFile(resolve(root, 'data/selected-cause-rebuild-v1/juki-Se00-2024-boundary.json.gz'))));
const policy = await json('data/selected-cause-rebuild-v1/acceptance.json');
const areaCatalog = (await json('data/area-catalog.json')).map(([code, name]) => ({ code, name: displayAreaName(code, name) }));
const accepted = applyMethodAcceptance(raw, policy);
const query = { ...selection, mode: 'arbitrary', dataRevision: 'rebuilt', regionUnit: 'municipality' };
const result = await calculateArbitraryPeriodCase({ ...query, dataset: accepted });
assert.deepEqual(buildSmrExport({ query, result, dataset: accepted, areaCatalog, now: new Date(config.generated_at) }), existingExport);
const annual = raw.rows.filter(row => row[1] === '05201' && row[2] === 'M' && row[0] >= 2020);
assert.deepEqual(annual.map(row => row[0]), [2020, 2021, 2022, 2023, 2024]);
assert(annual.every(row => row[5] === 1 && row[6] === 0 && row[7] === 'AVAILABLE'));
const observed = annual.reduce((sum, row) => sum + row[3], 0);
const expected = annual.reduce((sum, row) => sum + row[4], 0);
assert.equal(observed, record.result.observed_deaths);
assert.equal(expected, record.result.expected_deaths);
assert.equal(observed / expected * 100, record.result.standardized_mortality_ratio);
const wrongMean = annual.reduce((sum, row) => sum + row[3] / row[4] * 100, 0) / annual.length;
assert(Math.abs(wrongMean - record.result.standardized_mortality_ratio) > 0.01, 'Annual ratio averaging must differ from the published period value');

const create = (change = {}, dataset = raw) => createStaticSmrRecord({ selection: { ...selection, ...change }, dataset, policy, areaCatalog, now: new Date(config.generated_at) });
const numeric = ['observed_deaths', 'expected_deaths', 'standardized_mortality_ratio', 'ci95_lower', 'ci95_upper'];
function unavailable(output) {
  assert.equal(output.result.status, 'unavailable');
  assert(output.result.reason);
  assert.equal(output.selection.period.included_years, null);
  for (const field of numeric) assert.equal(output.result[field], null);
}
// Real released missingness, plus a removed year: no partial period totals.
unavailable(await create({ areaCode: '19201', startYear: 2006, endYear: 2006 }));
unavailable(await create({}, { ...raw, rows: raw.rows.filter(row => !(row[1] === '05201' && row[2] === 'M' && row[0] === 2022)) }));
unavailable(await create({ sex: '男女計' }, { ...raw, rows: raw.rows.filter(row => !(row[1] === '05201' && row[2] === 'F' && row[0] === 2022)) }));
const catalogCodes = new Set(areaCatalog.map(area => area.code));
const zeroRow = raw.rows.find(row => row[3] === 0 && row[4] > 0 && row[7] === 'AVAILABLE' && catalogCodes.has(row[1]));
assert(zeroRow, 'Released zero-death municipality required');
const zero = await create({ areaCode: zeroRow[1], sex: zeroRow[2] === 'M' ? '男' : '女', startYear: zeroRow[0], endYear: zeroRow[0] });
assert.equal(zero.result.status, 'complete');
assert.equal(zero.result.observed_deaths, 0);
assert.equal(zero.result.standardized_mortality_ratio, 0);
assert.equal(zero.result.ci95_lower, 0);
assert.equal(zero.result.ci95_upper, 3.688879454 / zeroRow[4] * 100);
for (const mutation of [{ boundary: 'annual' }, { basis: 'census' }, { cause: 'Se34' }, { strict_missing: false }, { source_version: 'old' }]) {
  await assert.rejects(create({}, { ...raw, ...mutation }));
}
const duplicate = { ...raw, rows: [...raw.rows, annual[0]] };
await assert.rejects(create({}, duplicate), /Duplicate/);
for (const mutation of [{ areaCode: 5201 }, { areaCode: '../05201' }, { areaCode: '05000' }, { areaCode: '11100' },
  { startYear: 2025 }, { endYear: 2025 }, { startYear: 2023, endYear: 2020 }, { sex: 'M' }, { sex: 'toString' }, { mode: 'official' }]) {
  assert.throws(() => staticSmrPath({ ...selection, ...mutation }));
}

// The actual release hash, generated code fingerprint and both mirrors are freshness gates.
const temporary = await mkdtemp(resolve(tmpdir(), 'smr-static-regression-'));
try {
  for (const item of index.inputs) {
    const target = resolve(temporary, item.path); await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(resolve(root, item.path)));
  }
  for (const { path, text } of outputs) for (const prefix of ['', 'source/public']) {
    const target = resolve(temporary, prefix, path.slice(1)); await mkdir(dirname(target), { recursive: true }); await writeFile(target, text);
  }
  await checkStaticSmrFiles(temporary, await buildStaticSmrFiles(temporary));
  const dataPath = resolve(temporary, 'data/selected-cause-rebuild-v1/juki-Se00-2024-boundary.json.gz');
  const original = await readFile(dataPath);
  await writeFile(dataPath, Buffer.concat([original, Buffer.from('tampered')]));
  await assert.rejects(buildStaticSmrFiles(temporary), /released SHA-256/);
  await writeFile(dataPath, original);
  const codePath = resolve(temporary, 'source/src/lib/smr.js');
  await writeFile(codePath, `${await readFile(codePath, 'utf8')}\n// changed method input\n`);
  await assert.rejects(checkStaticSmrFiles(temporary, await buildStaticSmrFiles(temporary)), /Stale/);
  await writeFile(codePath, await readFile(resolve(root, 'source/src/lib/smr.js')));
  const mirrorPath = resolve(temporary, `source/public${outputs[0].path}`);
  await writeFile(mirrorPath, '{}\n');
  await assert.rejects(checkStaticSmrFiles(temporary, outputs), /Stale/);
  await writeFile(mirrorPath, outputs[0].text);
  await writeFile(resolve(temporary, STATIC_SMR_PREFIX.slice(1), 'retired.json'), '{}');
  await assert.rejects(checkStaticSmrFiles(temporary, outputs), /file set differ/);
} finally { await rm(temporary, { recursive: true, force: true }); }

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 2 && args[0] === '--built'), 'Usage: smr-static-results-test.mjs [--built <directory>]');
const servedRoot = args.length ? resolve(args[1]) : root;
const assets = new Map();
for (const { path, text } of outputs) {
  const bytes = await readFile(resolve(servedRoot, path.slice(1)));
  assert.equal(bytes.toString('utf8'), text, 'Built static file must retain the exact verified JSON');
  assets.set(path, bytes);
}
// A file-only HTTP harness, with the existing SPA's HTML fallback for unknown paths.
// This verifies non-browser retrieval; it does not claim to test Cloudflare deployment.
const server = createServer((request, response) => {
  const bytes = assets.get(new URL(request.url, 'http://localhost').pathname);
  response.setHeader('Content-Type', bytes ? 'application/json; charset=utf-8' : 'text/html');
  response.end(bytes ?? '<!doctype html><title>SPA fallback</title>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  const getJson = async path => {
    const response = await fetch(`${origin}${path}`, { headers: { Accept: 'application/json' } });
    assert(response.ok && response.headers.get('content-type').startsWith('application/json'), 'Expected a JSON response, not SPA HTML');
    return response.json();
  };
  assert.deepEqual(await getJson(outputs[0].path), record);
  assert.deepEqual(await getJson(`${STATIC_SMR_PREFIX}/index.json`), index);
  const parameterized = await getJson(`${outputs[0].path}?sex=female`);
  assert.equal(parameterized.selection.sex, '男', 'A query string cannot change a static result; consumers must match selection');
  await assert.rejects(getJson(`${STATIC_SMR_PREFIX}/not-published.json`), /not SPA HTML/);
} finally { await new Promise(resolve => server.close(resolve)); }

console.log(JSON.stringify({ pass: true, input_mode: 'released_display_data_and_production_browser_export',
  served_from: args.length ? 'built_static_assets' : 'repository_static_assets',
  checks: ['all_production_export_fields', 'unrounded_five_metrics', 'calendar_year_coverage',
    'boundary_and_provenance', 'real_missingness', 'missing_year_and_sex', 'released_zero_death_ci',
    'duplicate_and_invalid_selection', 'release_sha256', 'stale_code_and_mirror', 'retired_output',
    'direct_http_json', 'query_string_is_not_an_api', 'html_fallback_rejected'],
  annual_components: annual.map(row => ({ year: row[0], observed: row[3], expected: row[4] })),
  wrong_annual_smr_mean: wrongMean, result: record.result,
  result_bytes: index.results[0].bytes, catalog_bytes: Buffer.byteLength(outputs.at(-1).text),
}));
