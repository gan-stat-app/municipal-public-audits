import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { arbitraryCauses } from '../src/catalogs/causes.js';
import { calculateArbitraryPeriodCase } from '../src/lib/parity.js';
import { applyMethodAcceptance, clearMemoryDataCache } from '../src/lib/dataClient.js';
import { calculateCrossCauseProfile, crossCauseChoices } from '../src/lib/lazyCrossCause.js';
import { crossCauseDataPath } from '../src/lib/crossCauseData.js';
import { aggregateMedicalArea, normalizeMedicalAreas } from '../src/lib/medicalAreas.js';
import { buildCrossCauseData, splitByPrefecture } from './build-cross-cause-data.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-cross-cause-'));
const dataRoot = path.join(temp, 'input'), outputRoot = path.join(temp, 'output');
fs.mkdirSync(dataRoot);
const policy = { decision: 'accepted', source_version: 'fixture-1', basis: 'census', version: 'fixture-policy', years: [1999, 2024] };
fs.writeFileSync(path.join(dataRoot, 'acceptance.json'), JSON.stringify(policy));
const originals = new Map(), requests = [];
const query = { basis: 'juki', areaCode: '05201', sex: '男', startYear: 2020, endYear: 2024, dataRevision: 'rebuilt' };
const areas = ['05000', '05201', '05202', '08000', '08201', '11100', '14151', '14152', '22130', '22138'];
for (const basis of ['juki', 'census']) {
  for (const [index, [cause]] of arbitraryCauses.entries()) {
    const rows = [];
    for (const year of [1999, 2005, 2020, 2021, 2022, 2023, 2024]) for (const [offset, code] of areas.entries()) for (const sex of ['M', 'F']) {
      const unavailable = (cause === 'Se12' && sex === 'M') || (code === '22138' && year === 2024) || (code === '08201' && year === 2021);
      rows.push([year, code, sex, unavailable ? null : index * 4 + offset + (sex === 'F' ? 2 : 0), unavailable ? null : 100.125 + offset / 3, 1, 1, unavailable ? 'MISSING' : basis === 'census' && year === 2005 ? 'REBUILT_REFERENCE' : 'AVAILABLE']);
    }
    const dataset = { source_version: 'fixture-1', basis, cause, strict_missing: true, reference_years: [2005], rows };
    originals.set(`${basis}-${cause}`, dataset);
    fs.writeFileSync(path.join(dataRoot, `${basis}-${cause}-2024-boundary.json.gz`), gzipSync(JSON.stringify(dataset)));
  }
}
const originalFetch = globalThis.fetch;
try {
  const manifest = buildCrossCauseData({ dataRoot, outputRoot });
  assert.equal(manifest.inputs.length, 74);
  assert.equal(manifest.outputs.length, 94);
  const shard = JSON.parse(gunzipSync(fs.readFileSync(path.join(outputRoot, 'juki-05.json.gz'))));
  assert.equal(Object.keys(shard.datasets).length, 37);
  assert.deepEqual(shard.datasets.Se02.rows, originals.get('juki-Se02').rows.filter(row => row[1].startsWith('05')));
  assert.throws(() => splitByPrefecture({ rows: [[2024, '../05']] }), /Invalid/);
  assert.throws(() => crossCauseDataPath({ ...query, areaCode: '../../05' }), /Invalid/);
  assert.throws(() => crossCauseDataPath({ ...query, basis: 'bad' }), /Unknown basis/);
  assert.equal(crossCauseChoices(query).length, 36);
  assert.equal(crossCauseChoices({ ...query, sex: '女' }).length, 37);
  assert(crossCauseChoices(query).some(([code]) => code === 'Se00'));
  assert(!crossCauseChoices({ ...query, sex: '男女計' }).some(([code]) => code === 'Se12'));
  globalThis.fetch = async (url, { signal } = {}) => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    requests.push(url);
    if (url === '/data/selected-cause-rebuild-v1/acceptance.json') return new Response(JSON.stringify(policy));
    assert(url.startsWith('/data/cross-cause-profile-v1/'), 'must not fetch nationwide per-cause files');
    return new Response(fs.readFileSync(path.join(outputRoot, path.basename(url))));
  };
  const queries = [query, { ...query, sex: '女' }, { ...query, sex: '男女計' }, { ...query, areaCode: '05000' }, { ...query, areaCode: '05202' }, { ...query, basis: 'census', areaCode: '11100', startYear: 2005, endYear: 2005 }, { ...query, areaCode: '14150' }, { ...query, basis: 'census', areaCode: '22138', startYear: 2024, endYear: 2024 }, { ...query, areaCode: '08201' }];
  for (const q of queries) {
    const expected = [];
    for (const [datasetCode, causeName] of crossCauseChoices(q)) {
      const dataset = applyMethodAcceptance(originals.get(`${q.basis}-${datasetCode}`), policy);
      const result = await calculateArbitraryPeriodCase({ ...q, datasetCode, dataset });
      if (result?.complete) expected.push({ datasetCode, causeName, ...result });
    }
    const progress = [];
    const actual = await calculateCrossCauseProfile({ ...q, onProgress: value => progress.push(value) });
    assert.deepEqual(actual, expected.sort((a, b) => b.smr - a.smr));
    assert.deepEqual(progress.at(-1), { completed: crossCauseChoices(q).length, total: crossCauseChoices(q).length });
  }
  const akitaArea = { code: '0504', municipalities: [['05201', '甲'], ['05202', '乙']] };
  const missingArea = { code: '0801', municipalities: [['08201', '丙']] };
  const wholeCityArea = normalizeMedicalAreas([{ code: '2208', municipalities: [['22131', '旧区']] }])[0];
  const splitCityAreas = normalizeMedicalAreas([{ code: '1401', municipalities: [['14151', '区1']] }, { code: '1402', municipalities: [['14152', '区2']] }]);
  const medicalQueries = [
    { ...query, regionUnit: 'medical-area', medicalArea: akitaArea },
    { ...query, regionUnit: 'medical-area', medicalArea: akitaArea, sex: '女' },
    { ...query, regionUnit: 'medical-area', medicalArea: akitaArea, sex: '男女計', basis: 'census' },
    { ...query, regionUnit: 'medical-area', medicalArea: missingArea, startYear: 2020, endYear: 2020 },
    { ...query, regionUnit: 'medical-area', medicalArea: missingArea },
    { ...query, regionUnit: 'medical-area', medicalArea: wholeCityArea, basis: 'census', startYear: 2024, endYear: 2024 },
    ...splitCityAreas.map(medicalArea => ({ ...query, regionUnit: 'medical-area', medicalArea })),
  ];
  for (const q of medicalQueries) {
    const expected = crossCauseChoices(q).flatMap(([datasetCode, causeName]) => {
      const dataset = applyMethodAcceptance(originals.get(`${q.basis}-${datasetCode}`), policy);
      const value = aggregateMedicalArea(dataset, q.medicalArea, q.sex, q.startYear, q.endYear);
      return value?.complete ? [{ datasetCode, causeName, ...value }] : [];
    }).sort((a, b) => b.smr - a.smr);
    assert.deepEqual(await calculateCrossCauseProfile(q), expected, `medical-area parity ${q.medicalArea.code} / ${q.sex}`);
  }
  assert.equal((await calculateCrossCauseProfile(medicalQueries[1])).length, 37);
  assert.deepEqual(await calculateCrossCauseProfile(medicalQueries[4]), [], 'missing member/year must not become zero');
  assert.equal(requests.filter(x => x.endsWith('juki-08.json.gz')).length, 1, 'use medical-area prefecture, ignoring the retained municipality');
  const beforeInvalidArea = requests.length;
  await assert.rejects(calculateCrossCauseProfile({ ...query, regionUnit: 'medical-area' }), /Invalid medical-area/);
  assert.equal(requests.length, beforeInvalidArea);
  assert.equal(requests.filter(x => x.endsWith('juki-05.json.gz')).length, 1, 'reuse region data across area/period/sex and unit changes');
  const aborted = new AbortController(); aborted.abort();
  const beforeAbort = requests.length;
  await assert.rejects(calculateCrossCauseProfile({ ...query, signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(requests.length, beforeAbort);
  clearMemoryDataCache();
  let progressAfterAbort = 0;
  const pending = new AbortController();
  globalThis.fetch = (url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); });
  const cancelled = calculateCrossCauseProfile({ ...query, signal: pending.signal, onProgress: p => { if (p.completed) progressAfterAbort++; } });
  pending.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(progressAfterAbort, 0);
  clearMemoryDataCache();
  globalThis.fetch = async () => new Response(JSON.stringify({ ...shard, basis: 'census' }));
  await assert.rejects(calculateCrossCauseProfile(query), /does not match/);
  clearMemoryDataCache();
  globalThis.fetch = async () => new Response('Not found', { status: 404 });
  await assert.rejects(calculateCrossCauseProfile(query), /404/);
  console.log(JSON.stringify({ pass: true, checks: 'all 37 choices, one optional regional request, exact O/E/SMR/CI parity, zero deaths, missingness, both bases, city/ward/prefecture/medical-area scope, whole/split city and missing medical members, cache, abort, wrong scope and 404' }));
} finally {
  globalThis.fetch = originalFetch;
  clearMemoryDataCache();
  fs.rmSync(temp, { recursive: true, force: true });
}
