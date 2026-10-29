import { arbitraryCauses, causeAvailability } from '../catalogs/causes.js';
import { designatedCityByCode } from '../catalogs/designatedCities.js';
import { prefectures } from './areaCatalog.js';
import { loadCauseData } from './dataClient.js';
import { aggregateMedicalArea } from './medicalAreas.js';
import { calculateArbitraryPeriodCase } from './parity.js';
import { buildSmrExport, buildSmrUnavailableExport, canExportSmr, csvCell, downloadSmrFile, smrExportColumns, smrExportJson } from './smrExport.js';

export const SMR_BATCH_LIMIT = 10000;
const sexOptions = ['男', '女', '男女計'];
const unique = values => [...new Set(values)].sort();
export function batchRegionChoices(unit, areaCatalog = [], medicalAreas = []) {
  if (unit === 'prefecture') return prefectures.map(([code, name]) => ({ code: `${code}000`, name: `${name}全体` }));
  if (unit === 'medical-area') return medicalAreas;
  return areaCatalog.filter(area => !area.code.endsWith('000'));
}
export function smrBatchSelectionKey({ query, unit, regionCodes, causeCodes, sexes }) {
  return JSON.stringify([query.mode, query.dataRevision, query.basis, query.startYear, query.endYear,
    unit, unique(regionCodes), unique(causeCodes), unique(sexes)]);
}
function validateSelection(options) {
  const { query, unit, areaCatalog, medicalAreas } = options;
  if (query.mode !== 'arbitrary' || !['juki', 'census'].includes(query.basis)
    || !['municipality', 'prefecture', 'medical-area'].includes(unit)
    || !Number.isInteger(query.startYear) || !Number.isInteger(query.endYear)
    || query.startYear < 1999 || query.endYear > 2024 || query.startYear > query.endYear
    || query.dataRevision !== 'rebuilt') throw new Error('一括保存の条件を確認してください。');
  const regionCodes = unique(options.regionCodes), causeCodes = unique(options.causeCodes);
  const sexes = sexOptions.filter(sex => options.sexes.includes(sex));
  const count = regionCodes.length * causeCodes.length * sexes.length;
  const choices = new Set(batchRegionChoices(unit, areaCatalog, medicalAreas).map(area => area.code));
  if (!count || count > SMR_BATCH_LIMIT || options.sexes.some(sex => !sexOptions.includes(sex))
    || regionCodes.some(code => !choices.has(code))
    || causeCodes.some(code => !arbitraryCauses.some(([cause]) => cause === code))) {
    throw new Error(`地域・死因・性別を選んでください。1回の保存は${SMR_BATCH_LIMIT.toLocaleString('ja-JP')}件までです。`);
  }
  return { regionCodes, causeCodes, sexes, count };
}
function ensureActive(signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

// Keep original row order and all prefecture/city aggregation rules. Indexing avoids
// scanning a nationwide dataset again for every municipality and sex.
function regionDatasets(dataset) {
  const byArea = new Map(), byPrefecture = new Map();
  for (const row of dataset.rows) {
    const code = row[1], pref = code.slice(0, 2);
    if (!byArea.has(code)) byArea.set(code, []);
    if (!byPrefecture.has(pref)) byPrefecture.set(pref, []);
    byArea.get(code).push(row); byPrefecture.get(pref).push(row);
  }
  return code => ({ ...dataset, rows: (code.endsWith('000') || designatedCityByCode(code)
    ? byPrefecture.get(code.slice(0, 2)) : byArea.get(code)) ?? [] });
}

export async function buildSmrBatchExport(options, { signal, onProgress = () => {}, loadDataset = loadCauseData, now = new Date() } = {}) {
  const selected = validateSelection(options);
  const { query, unit, areaCatalog = [], medicalAreas = [], currentDataset, currentDatasetQuery } = options;
  const records = [], medicalIndex = new Map(medicalAreas.map(area => [area.code, area]));
  let completed = 0;
  ensureActive(signal);
  onProgress({ completed, total: selected.count });
  for (const datasetCode of selected.causeCodes) {
    ensureActive(signal);
    const base = { ...query, datasetCode, regionUnit: unit === 'medical-area' ? 'medical-area' : 'municipality' };
    const needsData = selected.sexes.some(sex => !causeAvailability({ ...base, sex }));
    const reuse = currentDataset && currentDatasetQuery?.basis === base.basis
      && currentDatasetQuery?.dataRevision === base.dataRevision && currentDatasetQuery?.datasetCode === datasetCode;
    // Fetch only explicitly requested causes, one at a time. Do not retain all
    // nationwide raw datasets in the normal screen's shared memory cache.
    const dataset = needsData ? reuse ? currentDataset : await loadDataset(base, { signal, cache: false }) : null;
    ensureActive(signal);
    const forRegion = dataset && unit !== 'medical-area' ? regionDatasets(dataset) : null;
    for (const code of selected.regionCodes) {
      const slice = forRegion?.(code);
      for (const sex of selected.sexes) {
        ensureActive(signal);
        const selection = { ...base, sex, ...(unit === 'medical-area' ? { medicalAreaCode: code } : { areaCode: code }) };
        let reason = causeAvailability(selection), result = null;
        if (!reason) {
          result = unit === 'medical-area'
            ? aggregateMedicalArea(dataset, medicalIndex.get(code), sex, query.startYear, query.endYear)
            : await calculateArbitraryPeriodCase({ ...selection, dataset: slice });
          if (!canExportSmr({ query: selection, settledQuery: selection, datasetQuery: selection, dataset, result, status: 'ready' })) {
            reason = '選択期間に算定できない年があります。区域・人口・期待死亡数の欠測は補完していません。';
          }
        }
        const args = { query: selection, result, dataset, areaCatalog, medicalAreas, now };
        records.push(reason ? buildSmrUnavailableExport({ ...args, reason }) : buildSmrExport(args));
        completed++;
        if (completed % 25 === 0) {
          onProgress({ completed, total: selected.count });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }
    onProgress({ completed, total: selected.count });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  ensureActive(signal);
  const complete = records.filter(record => record.result.status === 'complete').length;
  return {
    schema_version: 1, export_type: 'batch', generated_at: now.toISOString(),
    selection: { region_unit: unit, region_codes: selected.regionCodes, cause_codes: selected.causeCodes,
      sexes: selected.sexes, period: { start_year: query.startYear, end_year: query.endYear, unit: '暦年' },
      population_basis: query.basis, data_revision: query.dataRevision },
    counts: { requested: selected.count, complete, unavailable: records.length - complete }, records,
  };
}

export function smrBatchExportCsv(payload) {
  const rows = payload.records.map(record => [...smrExportColumns(record),
    ['算定状態', record.result.status === 'complete' ? '算定済み' : '算定不可'], ['欠測理由', record.result.reason ?? '']]);
  const labels = [...new Set(rows.flatMap(columns => columns.map(([label]) => label)))];
  return `\uFEFF${labels.map(csvCell).join(',')}\r\n${rows.map(columns => {
    const values = new Map(columns);
    return labels.map(label => csvCell(values.get(label))).join(',');
  }).join('\r\n')}\r\n`;
}
export function downloadSmrBatchExport(payload, format) {
  if (!['csv', 'json'].includes(format)) throw new Error('Unsupported export format');
  const s = payload.selection;
  downloadSmrFile(format === 'csv' ? smrBatchExportCsv(payload) : smrExportJson(payload),
    `standardized-mortality-batch-${s.population_basis}-${s.period.start_year}-${s.period.end_year}-${payload.counts.requested}-results.${format}`, format);
}
