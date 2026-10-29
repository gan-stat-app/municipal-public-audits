import { arbitraryCauses } from '../catalogs/causes.js';
import { prefectureName } from './areaCatalog.js';
import { designatedCityByCode } from '../catalogs/designatedCities.js';
import { causeDataPath } from './dataClient.js';
import { queryToSearch } from './urlState.js';

export const SMR_EXPORT_ORIGIN = 'https://municipal-smr.jp';
const numericFields = ['observed', 'expected', 'smr', 'ci95Low', 'ci95High'];
const sexes = { 男: '男性', 女: '女性', 男女計: '男女計' };
const bases = { juki: '住民基本台帳人口', census: '国勢調査基準人口' };

export function smrSelectionKey(query) {
  return `${queryToSearch(query)}|${query.dataRevision ?? 'original'}`;
}

export function canExportSmr({ query, settledQuery, datasetQuery, dataset, result, status }) {
  return query?.mode === 'arbitrary' && status === 'ready' && !!dataset && !!datasetQuery
    && !!settledQuery && smrSelectionKey(query) === smrSelectionKey(settledQuery)
    && smrSelectionKey(query) === smrSelectionKey(datasetQuery)
    && result?.complete === true && result.years === query.endYear - query.startYear + 1
    && numericFields.every(field => Number.isFinite(result[field]))
    && result.observed >= 0 && result.expected > 0;
}

export function smrExportLink(query, format = 'json') {
  if (query.mode !== 'arbitrary' || !['csv', 'json'].includes(format)) throw new Error('Unsupported export');
  const url = new URL(`/${queryToSearch(query)}`, SMR_EXPORT_ORIGIN);
  url.hash = 'standardized-mortality';
  url.searchParams.set('export', format);
  return url.href;
}

// An incomplete or invalid acquisition URL must never silently export defaults.
export function readSmrExportRequest(search, initialQuery) {
  const params = new URLSearchParams(search);
  if (!params.has('export')) return null;
  const format = params.get('export');
  const keys = ['mode', 'area', 'cause', 'sex', 'unit', 'basis', 'start', 'end'];
  if (initialQuery.regionUnit === 'medical-area') keys.push('medical_area');
  const canonical = new URLSearchParams(queryToSearch(initialQuery));
  const valid = ['csv', 'json'].includes(format) && params.getAll('export').length === 1
    && initialQuery.mode === 'arbitrary' && initialQuery.dataRevision === 'rebuilt'
    && keys.every(key => params.getAll(key).length === 1 && params.get(key) === canonical.get(key))
    && arbitraryCauses.some(([code]) => code === initialQuery.datasetCode);
  return { format, valid, key: smrSelectionKey(initialQuery) };
}

export function buildSmrExport(args) {
  const { query, result, dataset } = args;
  if (!canExportSmr({ query, settledQuery: query, datasetQuery: query, dataset, result, status: 'ready' })) {
    throw new Error('Complete selected result is required');
  }
  return buildSmrRecord(args);
}

export function buildSmrUnavailableExport(args) {
  if (!args.reason) throw new Error('An unavailable result needs a reason');
  return buildSmrRecord({ ...args, result: null, dataset: args.dataset ?? {} });
}

function buildSmrRecord({ query, result, dataset, areaCatalog = [], medicalAreas = [], now = new Date(), reason }) {
  const cause = arbitraryCauses.find(([code]) => code === query.datasetCode);
  if (!cause || !sexes[query.sex] || !bases[query.basis]) throw new Error('Unknown selection');
  const medical = query.regionUnit === 'medical-area';
  const code = medical ? query.medicalAreaCode : query.areaCode;
  const prefCode = code.slice(0, 2), prefecture = prefectureName(prefCode);
  const area = medical ? medicalAreas.find(item => item.code === code) : areaCatalog.find(item => item.code === code);
  const city = !medical && designatedCityByCode(code);
  const regionName = area?.name ?? city?.name ?? (!medical && code.endsWith('000') ? `${prefecture}全体` : null);
  if (!regionName) throw new Error('Selected region is not in the loaded catalog');
  const fullName = regionName.startsWith(prefecture) ? regionName : `${prefecture}${regionName}`;
  const resultUrl = new URL(`/${queryToSearch(query)}#standardized-mortality`, SMR_EXPORT_ORIGIN).href;
  const path = causeDataPath({ basis: query.basis, datasetCode: query.datasetCode, dataRevision: query.dataRevision });
  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    site: { name: '人口ピラミッド × 地域保健データラボ', result_url: resultUrl },
    selection: {
      mode: 'arbitrary',
      region: { unit: medical ? 'medical-area' : code.endsWith('000') ? 'prefecture' : city ? 'designated-city' : 'municipality', code, name: fullName, prefecture_code: prefCode, prefecture_name: prefecture },
      period: { start_year: query.startYear, end_year: query.endYear, unit: '暦年', included_years: result?.years ?? null },
      sex: query.sex, sex_label: sexes[query.sex],
      cause_code: query.datasetCode, cause_name: cause[1],
      population_basis: query.basis, population_basis_label: bases[query.basis], population_scope: '日本人',
      boundary: medical ? '2022年末の335二次医療圏（市区町村データは2024年境界）' : '2024年市区町村境界',
    },
    result: result ? {
      status: 'complete', observed_deaths: result.observed, expected_deaths: result.expected,
      standardized_mortality_ratio: result.smr,
      ci95_lower: result.ci95Low, ci95_upper: result.ci95High, national_reference: 100,
    } : {
      status: 'unavailable', reason, observed_deaths: null, expected_deaths: null,
      standardized_mortality_ratio: null, ci95_lower: null, ci95_upper: null, national_reference: 100,
    },
    method: {
      status: '公的統計を用いた本サイトの試算値',
      formula: '期間内の観察死亡数の合計 ÷ 期間内の期待死亡数の合計 × 100',
      confidence_interval: '95%信頼区間（Byar近似）',
      precision: '画面表示の丸め前の計算値',
      documentation_url: `${SMR_EXPORT_ORIGIN}/transparency/`,
    },
    provenance: {
      data_revision: query.dataRevision ?? 'original', source_version: dataset.source_version ?? null,
      method_revision: dataset.method_revision ?? null, method_status: dataset.method_status ?? null,
      source_data_url: `${SMR_EXPORT_ORIGIN}${path}`,
      method_acceptance_url: query.dataRevision === 'rebuilt' ? `${SMR_EXPORT_ORIGIN}/data/selected-cause-rebuild-v1/acceptance.json` : null,
      death_source: { name: '厚生労働省「人口動態調査 人口動態統計 確定数 保管統計表 都道府県編」', url: 'https://www.e-stat.go.jp/dbview?sid=0003412081' },
      population_source: query.basis === 'juki'
        ? { name: '総務省「住民基本台帳に基づく人口、人口動態及び世帯数調査」日本人住民', url: 'https://www.e-stat.go.jp/stat-search?toukei=00200241' }
        : { name: '総務省統計局「国勢調査」日本人人口と国勢調査間の推計人口', url: 'https://www.e-stat.go.jp/stat-search?toukei=00200521' },
      ...(medical ? { medical_area_catalog_url: `${SMR_EXPORT_ORIGIN}/regional-healthcare-vision/data/medical-area-municipalities.json`, constituent_municipalities: area.municipalities.map(([memberCode, name]) => ({ code: memberCode, name })) } : {}),
    },
    notes: [
      '欠測や区域を正確に配分できない年は補完しません。',
      '年齢区分は1999～2014年が80歳以上を終末階級、2015～2024年が100歳以上までの5歳階級です。',
      '標準化死亡比や統計学的有意差だけから、地域差の原因を特定できません。',
      '利用時は元の公的統計と本サイトの計算・表示ページを出典として示してください。',
    ],
  };
}

export const smrExportJson = payload => `${JSON.stringify(payload, null, 2)}\n`;

export const csvCell = value => {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function smrExportColumns(payload) {
  const s = payload.selection, r = payload.result, p = payload.provenance;
  return [
    ['地域単位', s.region.unit], ['地域コード', s.region.code], ['地域名', s.region.name],
    ['開始年', s.period.start_year], ['終了年', s.period.end_year], ['期間単位', s.period.unit], ['収録年数', s.period.included_years],
    ['性別', s.sex_label], ['死因コード', s.cause_code], ['死因', s.cause_name],
    ['人口方式', s.population_basis_label], ['人口対象', s.population_scope], ['区域', s.boundary],
    ['観察死亡数', r.observed_deaths], ['期待死亡数', r.expected_deaths], ['標準化死亡比', r.standardized_mortality_ratio],
    ['95%信頼区間下限', r.ci95_lower], ['95%信頼区間上限', r.ci95_upper], ['全国基準', r.national_reference],
    ['値の位置付け', payload.method.status], ['数値精度', payload.method.precision], ['計算方法', payload.method.formula],
    ['信頼区間の算定方法', payload.method.confidence_interval], ['データ版', p.source_version], ['算定方法の検証版', p.method_revision],
    ['出典サイト', payload.site.name], ['結果確認URL', payload.site.result_url], ['元データURL', p.source_data_url],
    ['死亡数の出典', p.death_source.name], ['死亡数の出典URL', p.death_source.url],
    ['人口の出典', p.population_source.name], ['人口の出典URL', p.population_source.url],
    ['計算・利用方法URL', payload.method.documentation_url], ['注意事項', payload.notes.join(' / ')], ['出力日時', payload.generated_at],
    ...(p.medical_area_catalog_url ? [['医療圏対応表URL', p.medical_area_catalog_url], ['構成市区町村コード', p.constituent_municipalities.map(x => x.code).join(' ')]] : []),
  ];
}

export function smrExportCsv(payload) {
  const columns = smrExportColumns(payload);
  return `\uFEFF${columns.map(([label]) => csvCell(label)).join(',')}\r\n${columns.map(([, value]) => csvCell(value)).join(',')}\r\n`;
}

export function smrExportFilename(payload, format) {
  const s = payload.selection, sex = { 男: 'male', 女: 'female', 男女計: 'total' }[s.sex];
  return `standardized-mortality-${s.region.code}-${s.population_basis}-${s.cause_code}-${sex}-${s.period.start_year}-${s.period.end_year}.${format}`;
}

export function downloadSmrExport(payload, format) {
  if (!['csv', 'json'].includes(format)) throw new Error('Unsupported export format');
  const content = format === 'csv' ? smrExportCsv(payload) : smrExportJson(payload);
  downloadSmrFile(content, smrExportFilename(payload, format), format);
}

export function downloadSmrFile(content, filename, format) {
  const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

