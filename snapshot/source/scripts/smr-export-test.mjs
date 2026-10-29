import assert from 'node:assert/strict';
import { buildSmrExport, canExportSmr, readSmrExportRequest, smrExportCsv, smrExportFilename, smrExportJson, smrExportLink } from '../src/lib/smrExport.js';
import { smrWith95CI } from '../src/lib/smr.js';
import { queryFromLocation } from '../src/lib/urlState.js';

const query = { mode: 'arbitrary', dataRevision: 'rebuilt', basis: 'juki', regionUnit: 'municipality', areaCode: '05201', medicalAreaCode: '0504', datasetCode: 'Se00', sex: '男', startYear: 2020, endYear: 2024, officialPeriod: '2018-2022' };
const dataset = { source_version: 'test-source', method_revision: 'test-acceptance', method_status: 'SOURCE_VERIFIED' };
const result = { ...smrWith95CI(123, 102.34567890123456), complete: true, years: 5 };
const args = { query, result, dataset, areaCatalog: [{ code: '05201', name: '秋田市' }], now: new Date('2026-10-10T12:00:00Z') };
const state = { query, settledQuery: query, datasetQuery: query, dataset, result, status: 'ready' };
assert(canExportSmr(state));
for (const change of [
  { query: { ...query, sex: '女' } }, { settledQuery: { ...query, startYear: 2021 } },
  { datasetQuery: { ...query, basis: 'census' } }, { status: 'loading' }, { result: null },
  { result: { ...result, complete: false } }, { result: { ...result, expected: NaN } },
  { result: { ...result, years: 4 } }, { query: { ...query, mode: 'official' } },
  { datasetQuery: { ...query, dataRevision: undefined } },
]) assert.equal(canExportSmr({ ...state, ...change }), false);

const payload = buildSmrExport(args), decoded = JSON.parse(smrExportJson(payload));
assert.equal(decoded.selection.region.name, '秋田県秋田市');
assert.equal(decoded.selection.region.code, '05201');
assert.equal(decoded.selection.period.start_year, 2020);
assert.equal(decoded.selection.population_scope, '日本人');
assert.equal(decoded.provenance.source_version, 'test-source');
assert.equal(decoded.generated_at, '2026-10-10T12:00:00.000Z');
for (const [output, field] of Object.entries({ observed_deaths: 'observed', expected_deaths: 'expected', standardized_mortality_ratio: 'smr', ci95_lower: 'ci95Low', ci95_upper: 'ci95High' })) assert.equal(decoded.result[output], result[field]);
const cells = [...smrExportCsv(payload).matchAll(/"((?:[^\"]|\"\")*)"(?:,|\r\n|$)/g)].map(match => match[1].replaceAll('""', '"'));
const half = cells.length / 2, csv = Object.fromEntries(cells.slice(0, half).map((key, i) => [key, cells[i + half]]));
assert(smrExportCsv(payload).startsWith('\uFEFF'));
assert.equal(Number(csv['期待死亡数']), result.expected);
assert.equal(Number(csv['標準化死亡比']), result.smr);
assert.equal(Number(csv['95%信頼区間下限']), result.ci95Low);
assert.equal(Number(csv['95%信頼区間上限']), result.ci95High);
assert.equal(csv['結果確認URL'], decoded.site.result_url);
assert.equal(smrExportFilename(payload, 'csv'), 'standardized-mortality-05201-juki-Se00-male-2020-2024.csv');
const zero = buildSmrExport({ ...args, result: { ...smrWith95CI(0, 2), years: 5, complete: true } });
assert.equal(zero.result.observed_deaths, 0);
assert.equal(zero.result.standardized_mortality_ratio, 0);
assert(zero.result.ci95_upper > 0);
assert.throws(() => buildSmrExport({ ...args, result: { ...result, complete: false } }));
assert.throws(() => buildSmrExport({ ...args, areaCatalog: [] }));
assert.throws(() => smrExportLink({ ...query, mode: 'official' }));
const acquisition = new URL(smrExportLink(query));
assert.equal(acquisition.origin, 'https://municipal-smr.jp');
const restored = queryFromLocation(query, acquisition.search);
assert(readSmrExportRequest(acquisition.search, restored).valid);
for (const search of ['?export=json', acquisition.search.replace('area=05201', 'area=bad'), acquisition.search.replace('start=2020', 'start=2025'), `${acquisition.search}&sex=%E5%A5%B3`, acquisition.search.replace('export=json', 'export=xml')]) {
  assert.equal(readSmrExportRequest(search, queryFromLocation(query, search)).valid, false);
}
const medicalQuery = { ...query, regionUnit: 'medical-area' };
const medical = buildSmrExport({ ...args, query: medicalQuery, medicalAreas: [{ code: '0504', name: '秋田', municipalities: [['05201', '秋田市']] }] });
assert.equal(medical.selection.region.code, '0504');
assert.equal(medical.selection.region.unit, 'medical-area');
assert.deepEqual(medical.provenance.constituent_municipalities, [{ code: '05201', name: '秋田市' }]);
assert(smrExportCsv(medical).includes('構成市区町村コード'));
const pref = buildSmrExport({ ...args, query: { ...query, areaCode: '05000' } });
assert.equal(pref.selection.region.unit, 'prefecture');
assert.equal(pref.selection.region.name, '秋田県全体');
const quoted = buildSmrExport({ ...args, areaCatalog: [{ code: '05201', name: '秋田市, "引用"\n改行' }] });
assert(smrExportCsv(quoted).includes('秋田県秋田市, ""引用""\n改行'));
console.log('PASS: exact numeric precision, selected conditions and sources, zero deaths, missing/stale guards, CSV encoding/escaping, municipal/prefecture/medical-area metadata, and acquisition URL validation');
