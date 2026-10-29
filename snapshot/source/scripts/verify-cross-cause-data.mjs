import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { arbitraryCauses } from '../src/catalogs/causes.js';
import { calculateArbitraryPeriodCase } from '../src/lib/parity.js';
import { applyMethodAcceptance, clearMemoryDataCache } from '../src/lib/dataClient.js';
import { calculateCrossCauseProfile, crossCauseChoices } from '../src/lib/lazyCrossCause.js';
import { aggregateMedicalArea, normalizeMedicalAreas } from '../src/lib/medicalAreas.js';

const source = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = path.resolve(source, '../data/selected-cause-rebuild-v1');
const outputIndex = process.argv.indexOf('--output-root');
const outputRoot = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.resolve(source, 'public/data/cross-cause-profile-v1');
const hash = data => createHash('sha256').update(data).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(outputRoot, 'manifest.json')));
const policyBytes = fs.readFileSync(path.join(dataRoot, 'acceptance.json'));
const policy = JSON.parse(policyBytes);
assert.equal(manifest.format, 'cross-cause-profile-v1');
assert.equal(manifest.policySha256, hash(policyBytes));
assert.equal(manifest.inputs.length, arbitraryCauses.length * 2);
assert.equal(manifest.outputs.length, 94);
const prefs = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));
const q = { dataRevision: 'rebuilt', basis: 'juki', areaCode: '05201', sex: '男', startYear: 1999, endYear: 2024 };
const queries = [q, { ...q, sex: '女', startYear: 2020 }, { ...q, sex: '男女計', startYear: 2020 }, { ...q, basis: 'census' }, { ...q, basis: 'census', sex: '女', startYear: 2020 }, { ...q, basis: 'census', sex: '男女計', startYear: 2020 }, { ...q, areaCode: '05000' }, { ...q, basis: 'census', areaCode: '05000', sex: '女', startYear: 2020 }, { ...q, basis: 'census', areaCode: '11100', startYear: 2005, endYear: 2005 }, { ...q, basis: 'census', areaCode: '22130', startYear: 2024, endYear: 2024 }, { ...q, basis: 'census', areaCode: '22138', startYear: 2024, endYear: 2024 }, { ...q, areaCode: '14150', sex: '男女計', startYear: 2020 }];
const medicalAreas = normalizeMedicalAreas(JSON.parse(fs.readFileSync(path.resolve(source, '../regional-healthcare-vision/data/medical-area-municipalities.json'))).areas);
for (const code of ['0504', '0501', '1101', '1301', '2208']) {
  const medicalArea = medicalAreas.find(area => area.code === code);
  assert(medicalArea, `medical-area catalog entry ${code}`);
  for (const basis of ['juki', 'census']) for (const sex of ['男', '女', '男女計']) {
    queries.push({ ...q, regionUnit: 'medical-area', medicalArea, basis, sex, startYear: 2020 });
  }
}
const expectedResults = queries.map(() => []), fingerprints = new Map();
let rowsVerified = 0;
for (const basis of ['juki', 'census']) for (const [datasetCode, causeName] of arbitraryCauses) {
  const filename = `${basis}-${datasetCode}-2024-boundary.json.gz`;
  const bytes = fs.readFileSync(path.join(dataRoot, filename));
  const input = manifest.inputs.find(x => x.path === `data/selected-cause-rebuild-v1/${filename}`);
  assert(input, filename);
  assert.equal(input.sha256, hash(bytes), `stale profile source: ${filename}`);
  const dataset = JSON.parse(gunzipSync(bytes));
  assert.equal(input.rows, dataset.rows.length);
  const { rows, ...metadata } = dataset;
  for (const pref of prefs) {
    const regionalRows = rows.filter(row => row[1].slice(0, 2) === pref);
    fingerprints.set(`${basis}-${pref}-${datasetCode}`, { metadata, sha256: hash(JSON.stringify(regionalRows)), rows: regionalRows.length });
  }
  const accepted = applyMethodAcceptance(dataset, policy);
  for (let index = 0; index < queries.length; index++) {
    const selected = queries[index];
    if (selected.basis !== basis || !crossCauseChoices(selected).some(([code]) => code === datasetCode)) continue;
    const result = selected.regionUnit === 'medical-area'
      ? aggregateMedicalArea(accepted, selected.medicalArea, selected.sex, selected.startYear, selected.endYear)
      : await calculateArbitraryPeriodCase({ ...selected, datasetCode, dataset: accepted });
    if (result?.complete) expectedResults[index].push({ datasetCode, causeName, ...result });
  }
}
for (const output of manifest.outputs) {
  assert(/^(juki|census)-\d{2}\.json\.gz$/.test(output.path));
  const bytes = fs.readFileSync(path.join(outputRoot, output.path));
  assert.equal(output.sha256, hash(bytes));
  const profile = JSON.parse(gunzipSync(bytes));
  assert.equal(profile.format, manifest.format);
  assert.equal(Object.keys(profile.datasets).length, arbitraryCauses.length);
  for (const [code, dataset] of Object.entries(profile.datasets)) {
    const expected = fingerprints.get(`${profile.basis}-${profile.prefCode}-${code}`);
    assert(expected);
    const { rows, ...metadata } = dataset;
    assert.deepEqual(metadata, expected.metadata);
    assert.equal(rows.length, expected.rows);
    assert.equal(hash(JSON.stringify(rows)), expected.sha256, `${output.path}/${code}: changed annual rows`);
    rowsVerified += rows.length;
  }
  const nationwideBytes = manifest.inputs.filter(x => x.path.includes(`/${profile.basis}-`)).reduce((sum, x) => sum + x.bytes, 0);
  assert(bytes.length < nationwideBytes * 0.2, 'regional download must remain much smaller than nationwide cause files');
}
const originalFetch = globalThis.fetch, requests = [];
try {
  globalThis.fetch = async (url, { signal } = {}) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    requests.push(url);
    if (url === '/data/selected-cause-rebuild-v1/acceptance.json') return new Response(policyBytes);
    assert(url.startsWith('/data/cross-cause-profile-v1/'));
    return new Response(fs.readFileSync(path.join(outputRoot, path.basename(url))));
  };
  for (let index = 0; index < queries.length; index++) {
    const actual = await calculateCrossCauseProfile(queries[index]);
    assert.deepEqual(actual, expectedResults[index].sort((a, b) => b.smr - a.smr), `numeric parity case ${index + 1}`);
  }
  assert.equal(requests.filter(x => x.endsWith('juki-05.json.gz')).length, 1);
} finally { globalThis.fetch = originalFetch; clearMemoryDataCache(); }
const oldBytes = manifest.inputs.filter(x => x.path.includes('/juki-') && !x.path.includes('-Se00-') && !x.path.includes('-Se12-')).reduce((sum, x) => sum + x.bytes, 0);
const akitaBytes = manifest.outputs.find(x => x.path === 'juki-05.json.gz').bytes;
console.log(JSON.stringify({ pass: true, regionalFiles: manifest.outputs.length, originalAnnualRowsVerified: rowsVerified, numericCases: queries.length, originalOptionalMaleDownloadBytes: oldBytes, newOptionalAkitaDownloadBytes: akitaBytes, transferReductionPercent: +(100 * (1 - akitaBytes / oldBytes)).toFixed(2) }));
