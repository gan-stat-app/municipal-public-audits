// Core helpers recovered from the production implementation.

export function byarObservedInterval(observed) {
  if (observed === 0) return [0, 3.688879454];
  const z = 1.959963984540054;
  const low = observed * (1 - 1 / (9 * observed) - z / (3 * Math.sqrt(observed))) ** 3;
  const n = observed + 1;
  const high = n * (1 - 1 / (9 * n) + z / (3 * Math.sqrt(n))) ** 3;
  return [low, high];
}

export function sexMatches(rowSex, selectedSex) {
  return selectedSex === '男女計' || rowSex === (selectedSex === '男' ? 'M' : 'F');
}

export function isCalculableRow(row) {
  return Number.isFinite(row[3]) && row[3] >= 0 && Number.isFinite(row[4]) && row[4] > 0
    && (typeof row[7] !== 'string' || ['AVAILABLE', 'REBUILT_REFERENCE', 'SOURCE_VERIFIED'].includes(row[7]));
}

export function aggregatePeriod(rows, selectedSex, startYear, endYear) {
  if (!rows) return null;
  let observed = 0;
  let expected = 0;
  const years = new Set();

  const coverage = new Map();
  for (const row of rows) {
    const [year, code, sex, rowObserved, rowExpected] = row;
    if (sexMatches(sex, selectedSex) && year >= startYear && year <= endYear) {
      if (!isCalculableRow(row)) return null;
      const key = `${year}|${code}`, sexes = coverage.get(key) ?? new Set();
      if (sexes.has(sex)) throw new Error('Duplicate annual area/sex row');
      sexes.add(sex); coverage.set(key, sexes);
      observed += rowObserved;
      expected += rowExpected;
      years.add(year);
    }
  }

  if (selectedSex === '男女計' && [...coverage.values()].some(sexes => sexes.size !== 2)) return null;

  if (!expected) return null;
  return { observed, expected, smr: observed / expected * 100, years: years.size };
}

export function smrWith95CI(observed, expected) {
  if (observed == null || expected == null || expected <= 0) return null;
  const [lowObserved, highObserved] = byarObservedInterval(observed);
  return {
    observed,
    expected,
    smr: observed / expected * 100,
    ci95Low: lowObserved / expected * 100,
    ci95High: highObserved / expected * 100,
  };
}
