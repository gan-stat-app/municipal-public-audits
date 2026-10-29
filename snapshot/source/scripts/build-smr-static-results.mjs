// Build-time only: never import this module into the browser or a request handler.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { arbitraryCauses } from '../src/catalogs/causes.js';
import { designatedCityByCode, displayAreaName } from '../src/catalogs/designatedCities.js';
import { applyMethodAcceptance } from '../src/lib/dataClient.js';
import { buildSmrBatchExport } from '../src/lib/smrBatchExport.js';
import { smrExportJson, SMR_EXPORT_ORIGIN } from '../src/lib/smrExport.js';

export const STATIC_SMR_PREFIX = '/smr-json/v1';
export const STATIC_SMR_LIMIT = 10;
const defaultRoot = fileURLToPath(new URL('../../', import.meta.url));
const configPath = 'source/smr-static-results/config.json';
const sexPaths = { 男: 'male', 女: 'female', 男女計: 'total' };
const selectionFields = ['areaCode', 'basis', 'datasetCode', 'endYear', 'sex', 'startYear'];
const codePaths = [
  'source/scripts/build-smr-static-results.mjs',
  'source/src/catalogs/causes.js', 'source/src/catalogs/designatedCities.js',
  'source/src/lib/areaAggregation.js', 'source/src/lib/areaCatalog.js',
  'source/src/lib/dataClient.js', 'source/src/lib/medicalAreas.js',
  'source/src/lib/parity.js', 'source/src/lib/smr.js',
  'source/src/lib/smrBatchExport.js', 'source/src/lib/smrExport.js',
  'source/src/lib/urlState.js',
];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function staticSmrPath(selection) {
  const s = selection;
  assert.deepEqual(Object.keys(s).sort(), selectionFields, 'Explicit selection fields required');
  assert(['juki', 'census'].includes(s.basis) && Object.hasOwn(sexPaths, s.sex), 'Invalid basis or sex');
  assert(arbitraryCauses.some(([code]) => code === s.datasetCode), 'Invalid cause');
  assert(typeof s.areaCode === 'string' && /^\d{5}$/.test(s.areaCode)
    && !s.areaCode.endsWith('000') && !designatedCityByCode(s.areaCode),
  'The pilot supports individual municipalities and wards only');
  assert(Number.isInteger(s.startYear) && Number.isInteger(s.endYear)
    && s.startYear >= 1999 && s.endYear <= 2024 && s.startYear <= s.endYear,
  'Invalid calendar-year period');
  return `${STATIC_SMR_PREFIX}/${s.basis}/${s.datasetCode}/${sexPaths[s.sex]}/${s.startYear}-${s.endYear}/${s.areaCode}.json`;
}

export async function createStaticSmrRecord({ selection, dataset, policy, areaCatalog, now }) {
  const path = staticSmrPath(selection);
  assert(dataset?.revision === 'selected-cause-rebuild-v1' && dataset.boundary === '2024'
    && dataset.strict_missing === true && dataset.basis === selection.basis
    && dataset.cause === selection.datasetCode, 'Verified display dataset identity required');
  const accepted = applyMethodAcceptance(dataset, policy);
  const query = { ...selection, mode: 'arbitrary', dataRevision: 'rebuilt', regionUnit: 'municipality' };
  const batch = await buildSmrBatchExport({
    query, unit: 'municipality', regionCodes: [selection.areaCode],
    causeCodes: [selection.datasetCode], sexes: [selection.sex], areaCatalog,
    currentDataset: accepted, currentDatasetQuery: query,
  }, { now, loadDataset: async () => { throw new Error('No network fallback in static generation'); } });
  return { ...batch.records[0], delivery: {
    type: 'static-json-pilot', url: `${SMR_EXPORT_ORIGIN}${path}`,
    catalog_url: `${SMR_EXPORT_ORIGIN}${STATIC_SMR_PREFIX}/index.json`,
    supports_query_parameters: false,
  } };
}

export async function buildStaticSmrFiles(root = defaultRoot) {
  const inputs = new Map();
  async function input(path) {
    const bytes = await readFile(resolve(root, path));
    inputs.set(path, { path, bytes: bytes.length, sha256: sha256(bytes) });
    return bytes;
  }
  const jsonInput = async path => JSON.parse((await input(path)).toString('utf8'));
  const config = await jsonInput(configPath), now = new Date(config.generated_at);
  assert(config.schema_version === 1 && now.toISOString() === config.generated_at, 'Explicit UTC generation time required');
  assert(Array.isArray(config.selections) && config.selections.length > 0
    && config.selections.length <= STATIC_SMR_LIMIT, 'Keep the pilot bounded to at most 10 selections');
  const paths = config.selections.map(staticSmrPath);
  assert.equal(new Set(paths).size, paths.length, 'Duplicate static selections');
  const catalog = await jsonInput('data/area-catalog.json');
  const areaCatalog = catalog.map(([code, name]) => ({ code, name: displayAreaName(code, name) }));
  const policy = await jsonInput('data/selected-cause-rebuild-v1/acceptance.json');
  const manifest = await jsonInput('data/selected-cause-rebuild-v1/manifest.json');
  assert(manifest.release_ready === true && manifest.boundary === '2024'
    && manifest.source_version === policy.source_version, 'Current released display manifest required');
  for (const path of codePaths) await input(path);
  const calculationSha = sha256(JSON.stringify(codePaths.map(path => inputs.get(path))));
  const datasets = new Map(), outputs = [], entries = [];
  for (const [i, selection] of config.selections.entries()) {
    const file = `${selection.basis}-${selection.datasetCode}-2024-boundary.json.gz`;
    const sourcePath = `data/selected-cause-rebuild-v1/${file}`;
    if (!datasets.has(sourcePath)) {
      const bytes = await input(sourcePath), release = manifest.files.find(item => item.file === file);
      assert(release && release.sha256 === sha256(bytes) && release.bytes === bytes.length,
        'Display data must match the released SHA-256 and byte count');
      const dataset = JSON.parse(gunzipSync(bytes));
      assert.equal(dataset.source_version, manifest.source_version);
      datasets.set(sourcePath, dataset);
    }
    const record = await createStaticSmrRecord({ selection, dataset: datasets.get(sourcePath), policy, areaCatalog, now });
    record.delivery.source_data_sha256 = inputs.get(sourcePath).sha256;
    record.delivery.method_acceptance_sha256 = inputs.get('data/selected-cause-rebuild-v1/acceptance.json').sha256;
    record.delivery.area_catalog_sha256 = inputs.get('data/area-catalog.json').sha256;
    record.delivery.calculation_sha256 = calculationSha;
    const text = smrExportJson(record), path = paths[i];
    outputs.push({ path, text });
    entries.push({ url: record.delivery.url, selection: record.selection,
      status: record.result.status, bytes: Buffer.byteLength(text), sha256: sha256(text) });
  }
  const index = { schema_version: 1, delivery: 'static-json-pilot', generated_at: config.generated_at,
    scope: 'Only the exact selections listed in results are published; this is not a query API.',
    supports_query_parameters: false,
    method_url: `${SMR_EXPORT_ORIGIN}/transparency/`,
    results: entries, inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
  outputs.push({ path: `${STATIC_SMR_PREFIX}/index.json`, text: smrExportJson(index) });
  return outputs;
}

async function jsonFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []; throw error;
  })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await jsonFiles(path));
    else if (entry.name.endsWith('.json')) paths.push(path);
  }
  return paths;
}

export async function checkStaticSmrFiles(root, outputs) {
  for (const prefix of ['', 'source/public']) {
    const expected = outputs.map(({ path }) => resolve(root, prefix, path.slice(1))).sort();
    assert.deepEqual((await jsonFiles(resolve(root, prefix, STATIC_SMR_PREFIX.slice(1)))).sort(), expected,
      'Static catalog and published JSON file set differ; remove retired outputs explicitly');
    for (const { path, text } of outputs) {
      assert.equal(await readFile(resolve(root, prefix, path.slice(1)), 'utf8'), text,
        `Stale static result or source mirror: ${prefix}${path}`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === '--check'), 'Usage: build-smr-static-results.mjs [--check]');
  const started = performance.now(), outputs = await buildStaticSmrFiles();
  if (!args.length) {
    for (const { path, text } of outputs) for (const prefix of ['', 'source/public']) {
      const target = resolve(defaultRoot, prefix, path.slice(1));
      await mkdir(dirname(target), { recursive: true }); await writeFile(target, text);
    }
  }
  await checkStaticSmrFiles(defaultRoot, outputs);
  console.log(JSON.stringify({ pass: true, mode: args.length ? 'check' : 'build',
    results: outputs.length - 1, bytes: outputs.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0),
    build_ms: performance.now() - started, peak_rss_kib: process.resourceUsage().maxRSS,
    paths: outputs.map(({ path }) => relative(defaultRoot, resolve(defaultRoot, path.slice(1)))) }));
}
