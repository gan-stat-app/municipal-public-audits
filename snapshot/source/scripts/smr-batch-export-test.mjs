import assert from 'node:assert/strict';
import { batchRegionChoices, buildSmrBatchExport, SMR_BATCH_LIMIT, smrBatchExportCsv, smrBatchSelectionKey } from '../src/lib/smrBatchExport.js';
import { calculateArbitraryPeriodCase } from '../src/lib/parity.js';
import { normalizeMedicalAreas, aggregateMedicalArea } from '../src/lib/medicalAreas.js';
import { smrExportJson } from '../src/lib/smrExport.js';

const query = { mode: 'arbitrary', dataRevision: 'rebuilt', basis: 'juki', regionUnit: 'municipality',
  areaCode: '05201', medicalAreaCode: '0504', datasetCode: 'Se00', sex: '男', startYear: 2020, endYear: 2021 };
const areaCatalog = [{ code: '05201', name: '秋田市' }, { code: '05203', name: '横手市' },
  { code: '22138', name: '浜松市中央区' }, { code: '11100', name: 'さいたま市' }, { code: '11101', name: '西区' }, { code: '11102', name: '北区' }];
const medicalAreas = normalizeMedicalAreas([{ code: '0504', name: '秋田', municipalities: [['05201', '秋田市'], ['05203', '横手市']] }]);
const rows = [];
for (const year of [2020, 2021]) for (const [code, observed, expected] of [['05201', 10, 12.123456789], ['05203', 0, 2], ['11100', 12, 14], ['11101', 5, 6], ['11102', 7, 8]]) {
  for (const [sex, multiplier] of [['M', 1], ['F', 2]]) rows.push([year, code, sex, observed * multiplier, expected * multiplier, null, null, 'SOURCE_VERIFIED']);
}
const dataset = { rows, strict_missing: true, source_version: 'fixture', method_revision: 'fixture-method' };
const options = { query, unit: 'municipality', regionCodes: ['05201', '05203', '05201'],
  causeCodes: ['Se00', 'Se01', 'Se01'], sexes: ['男', '女'], areaCatalog, medicalAreas };
const calls = [], loadDataset = async (q, request) => { calls.push([q.datasetCode, request.cache]); return dataset; };
const now = new Date('2026-10-11T00:00:00Z');
const payload = await buildSmrBatchExport(options, { loadDataset, now });
assert.deepEqual(payload.counts, { requested: 8, complete: 8, unavailable: 0 });
assert.deepEqual(calls, [['Se00', false], ['Se01', false]]);
assert.deepEqual(JSON.parse(smrExportJson(payload)), payload);
for (const record of payload.records) {
  const s = record.selection, result = await calculateArbitraryPeriodCase({ ...query, datasetCode: s.cause_code, sex: s.sex, areaCode: s.region.code, dataset });
  for (const [out, field] of Object.entries({ observed_deaths: 'observed', expected_deaths: 'expected', standardized_mortality_ratio: 'smr', ci95_lower: 'ci95Low', ci95_upper: 'ci95High' })) assert.equal(record.result[out], result[field]);
  assert.equal(record.generated_at, now.toISOString());
  assert.equal(new URL(record.site.result_url).searchParams.get('area'), s.region.code);
}
const zero = payload.records.find(record => record.selection.region.code === '05203');
assert.equal(zero.result.observed_deaths, 0); assert.equal(zero.result.standardized_mortality_ratio, 0);
assert(zero.result.ci95_upper > 0);
const csv = smrBatchExportCsv(payload);
assert(csv.startsWith('\uFEFF')); assert.equal(csv.split('\r\n').length, 10);
assert(csv.includes('"24.246913578"')); assert(csv.includes('"秋田県秋田市"'));

const missing = await buildSmrBatchExport({ ...options, regionCodes: ['05201', '22138'], causeCodes: ['Se12'] }, { loadDataset });
assert.deepEqual(missing.counts, { requested: 4, complete: 1, unavailable: 3 });
for (const record of missing.records.filter(record => record.result.status === 'unavailable')) {
  assert(record.result.reason);
  for (const field of ['observed_deaths', 'expected_deaths', 'standardized_mortality_ratio', 'ci95_lower', 'ci95_upper']) assert.equal(record.result[field], null);
  assert.equal(record.selection.period.included_years, null);
}
assert(smrBatchExportCsv(missing).includes('"算定不可"'));
assert(smrBatchExportCsv(missing).includes('"","","","",""'));

for (const [unit, regionCodes] of [['prefecture', ['05000']], ['municipality', ['11100']], ['medical-area', ['0504']]]) {
  const p = await buildSmrBatchExport({ ...options, unit, regionCodes, causeCodes: ['Se00'], sexes: ['男女計'] }, { loadDataset });
  const expected = unit === 'medical-area' ? aggregateMedicalArea(dataset, medicalAreas[0], '男女計', 2020, 2021)
    : await calculateArbitraryPeriodCase({ ...query, dataset, sex: '男女計', areaCode: regionCodes[0] });
  assert.equal(p.records[0].result.observed_deaths, expected.observed);
  assert.equal(p.records[0].result.expected_deaths, expected.expected);
  assert.equal(p.records[0].result.ci95_lower, expected.ci95Low);
  if (unit === 'medical-area') assert.equal(p.records[0].provenance.constituent_municipalities.length, 2);
}
assert.equal(batchRegionChoices('prefecture').length, 47);
const reusedCalls = [];
await buildSmrBatchExport({ ...options, currentDataset: dataset, currentDatasetQuery: query }, { loadDataset: async q => { reusedCalls.push(q.datasetCode); return dataset; } });
assert.deepEqual(reusedCalls, ['Se01']);
const controller = new AbortController(); controller.abort();
await assert.rejects(buildSmrBatchExport(options, { signal: controller.signal, loadDataset }), { name: 'AbortError' });
await assert.rejects(buildSmrBatchExport(options, { loadDataset: async () => { throw new Error('network failed'); } }), /network failed/);
const during = new AbortController();
await assert.rejects(buildSmrBatchExport(options, { signal: during.signal, loadDataset: async () => { during.abort(); return dataset; } }), { name: 'AbortError' });
for (const change of [{ regionCodes: [] }, { causeCodes: ['unknown'] }, { regionCodes: ['99999'] }, { sexes: ['unknown'] }, { query: { ...query, mode: 'official' } }, { query: { ...query, startYear: 2025 } }]) await assert.rejects(buildSmrBatchExport({ ...options, ...change }, { loadDataset }));
const largeCatalog = Array.from({ length: SMR_BATCH_LIMIT + 1 }, (_, i) => ({ code: `x${i}`, name: `地域${i}` }));
await assert.rejects(buildSmrBatchExport({ ...options, areaCatalog: largeCatalog, regionCodes: largeCatalog.map(area => area.code), causeCodes: ['Se00'], sexes: ['男'] }, { loadDataset }));
const key = smrBatchSelectionKey(options);
assert.equal(key, smrBatchSelectionKey({ ...options, regionCodes: [...options.regionCodes].reverse() }));
for (const change of [{ sexes: ['女'] }, { causeCodes: ['Se00'] }, { regionCodes: ['05201'] }, { query: { ...query, basis: 'census' } }, { query: { ...query, endYear: 2024 } }]) assert.notEqual(key, smrBatchSelectionKey({ ...options, ...change }));
console.log('PASS: batch combinations, exact existing calculation parity, zero/missing distinction, multi-row CSV/JSON, region units, deduplication, data reuse, bounded uncached loads, abort/error handling and stale-selection keys');
