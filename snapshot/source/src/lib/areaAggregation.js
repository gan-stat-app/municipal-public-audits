import { aggregatePeriod, byarObservedInterval } from './smr.js';
import { designatedCityByCode, designatedCityForWard } from '../catalogs/designatedCities.js';

// Annual row contract: [year, areaCode, sex, observed, expected, ..., boundaryAdjusted]

export function rowsForArea(dataset, areaCode) {
  const direct = dataset.rows.filter(row => row[1] === areaCode);
  if (!areaCode.endsWith('000')) return direct;

  const pref = areaCode.slice(0, 2);
  const existing = new Set(direct.map(row => `${row[0]}|${row[2]}`));
  const summed = new Map();
  const wardCoverage = new Set();

  for (const row of dataset.rows) {
    if (!row[1].startsWith(pref) || row[1].endsWith('000')) continue;
    const city=designatedCityForWard(row[1]);
    if(city)wardCoverage.add(`${city.code}|${row[0]}|${row[2]}`);
  }

  for (const row of dataset.rows) {
    if (!row[1].startsWith(pref) || row[1].endsWith('000')) continue;
    const city=designatedCityByCode(row[1]);
    if(city && wardCoverage.has(`${city.code}|${row[0]}|${row[2]}`)) continue;
    const key = `${row[0]}|${row[2]}`;
    const current = summed.get(key) ?? [row[0], areaCode, row[2], 0, 0];
    current[3] = current[3] == null || row[3] == null ? null : current[3] + row[3];
    current[4] = current[4] == null || row[4] == null ? null : current[4] + row[4];
    summed.set(key, current);
  }

  return [
    ...direct,
    ...[...summed].filter(([key]) => !existing.has(key)).map(([, row]) => row),
  ];
}

export function aggregatePrefecture(dataset, areaCode, selectedSex, startYear, endYear) {
  return aggregatePeriod(rowsForArea(dataset, areaCode), selectedSex, startYear, endYear);
}

export function rowsForDesignatedCity(dataset, cityCode) {
  if(dataset.strict_missing) {
    const direct=dataset.rows.filter(row=>row[1]===cityCode);
    if(direct.length)return direct;
  }
  return dataset.rows.filter(row => designatedCityForWard(row[1])?.code === cityCode);
}

export function aggregateDesignatedCity(dataset, cityCode, selectedSex, startYear, endYear) {
  return aggregatePeriod(rowsForDesignatedCity(dataset, cityCode), selectedSex, startYear, endYear);
}

export function completeAggregateWithCI(result, expectedYears) {
  if (!result || result.years !== expectedYears || !result.expected) return null;
  const [lowObserved, highObserved] = byarObservedInterval(result.observed);
  return {
    ...result,
    ci95Low: lowObserved / result.expected * 100,
    ci95High: highObserved / result.expected * 100,
  };
}
