import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { calculateArbitraryPeriodCase } from '../src/lib/parity.js';
import { applyMethodAcceptance } from '../src/lib/dataClient.js';
import { displayAreaName } from '../src/catalogs/designatedCities.js';
import { aggregateMedicalArea, normalizeMedicalAreas } from '../src/lib/medicalAreas.js';
import { buildSmrExport, canExportSmr, smrExportJson } from '../src/lib/smrExport.js';
import { buildSmrBatchExport } from '../src/lib/smrBatchExport.js';

const root = new URL('../../', import.meta.url), json = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const policy = json('data/selected-cause-rebuild-v1/acceptance.json');
const catalog = json('source/dist/data/area-catalog.json');
const areaCatalog = catalog.map(([code, name]) => ({ code, name: displayAreaName(code, name) }));
const medicalAreas = normalizeMedicalAreas(json('regional-healthcare-vision/data/medical-area-municipalities.json').areas);
const cache = new Map();
const load = (basis, cause) => {
  const key = `${basis}-${cause}`;
  if (!cache.has(key)) cache.set(key, applyMethodAcceptance(JSON.parse(gunzipSync(readFileSync(new URL(`data/selected-cause-rebuild-v1/${key}-2024-boundary.json.gz`, root)))), policy));
  return cache.get(key);
};
const defaults = { mode: 'arbitrary', dataRevision: 'rebuilt', regionUnit: 'municipality', medicalAreaCode: '0504', basis: 'juki', datasetCode: 'Se00', areaCode: '05201', sex: '男', startYear: 1999, endYear: 2024 };
const cases = [ {}, { basis: 'census', sex: '女', startYear: 2020 }, { areaCode: '05000', sex: '男女計', startYear: 2020 }, { basis: 'census', areaCode: '11100', startYear: 2005, endYear: 2005 }, { datasetCode: 'Se12', sex: '女', startYear: 2015 }, { regionUnit: 'medical-area', startYear: 2020 } ];
for (const change of cases) {
  const query = { ...defaults, ...change }, dataset = load(query.basis, query.datasetCode);
  const result = query.regionUnit === 'medical-area'
    ? aggregateMedicalArea(dataset, medicalAreas.find(x => x.code === query.medicalAreaCode), query.sex, query.startYear, query.endYear)
    : await calculateArbitraryPeriodCase({ ...query, dataset });
  assert(result?.complete, JSON.stringify(query));
  const output = JSON.parse(smrExportJson(buildSmrExport({ query, result, dataset, areaCatalog, medicalAreas })));
  for (const [field, value] of Object.entries({ observed_deaths: result.observed, expected_deaths: result.expected, standardized_mortality_ratio: result.smr, ci95_lower: result.ci95Low, ci95_upper: result.ci95High })) assert.equal(output.result[field], value);
  assert.equal(output.selection.period.included_years, query.endYear - query.startYear + 1);
  assert.equal(output.selection.region.code, query.regionUnit === 'medical-area' ? query.medicalAreaCode : query.areaCode);
  const batch = await buildSmrBatchExport({ query, areaCatalog, medicalAreas,
    unit: query.regionUnit === 'medical-area' ? 'medical-area' : query.areaCode.endsWith('000') ? 'prefecture' : 'municipality',
    regionCodes: [output.selection.region.code], causeCodes: [query.datasetCode], sexes: [query.sex] },
    { loadDataset: async q => load(q.basis, q.datasetCode) });
  assert.deepEqual(batch.records[0].result, output.result);
}
const missingQuery = { ...defaults, basis: 'census', areaCode: '22138', startYear: 2024 }, dataset = load('census', 'Se00');
const missing = await calculateArbitraryPeriodCase({ ...missingQuery, dataset });
assert.equal(canExportSmr({ query: missingQuery, settledQuery: missingQuery, datasetQuery: missingQuery, dataset, result: missing, status: 'missing' }), false);
const multi = await buildSmrBatchExport({ query: { ...defaults, startYear: 2020 }, areaCatalog, medicalAreas, unit: 'municipality',
  regionCodes: ['05201', '05203'], causeCodes: ['Se00', 'Se12'], sexes: ['男', '女', '男女計'] }, { loadDataset: async q => load(q.basis, q.datasetCode) });
assert.deepEqual(multi.counts, { requested: 12, complete: 8, unavailable: 4 });
for (const record of multi.records) {
  if (record.result.status !== 'complete') { assert.equal(record.result.standardized_mortality_ratio, null); continue; }
  const s = record.selection, q = { ...defaults, startYear: 2020, areaCode: s.region.code, datasetCode: s.cause_code, sex: s.sex };
  const expected = await calculateArbitraryPeriodCase({ ...q, dataset: load(q.basis, q.datasetCode) });
  const individual = buildSmrExport({ query: q, result: expected, dataset: load(q.basis, q.datasetCode), areaCatalog });
  assert.deepEqual(record.result, individual.result);
}
const missingBatch = await buildSmrBatchExport({ query: missingQuery, unit: 'municipality', regionCodes: ['22138'],
  causeCodes: ['Se00'], sexes: ['男'], areaCatalog, medicalAreas }, { loadDataset: async q => load(q.basis, q.datasetCode) });
assert.equal(missingBatch.records[0].result.status, 'unavailable');
assert.equal(missingBatch.records[0].result.observed_deaths, null);
console.log('PASS: published datasets match all five raw export metrics for Akita, both population methods, sexes/total, prefecture, designated city and medical area; unallocatable Hamamatsu ward cannot export');

