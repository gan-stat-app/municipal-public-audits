import { causeDataPath, loadJson, applyMethodAcceptance } from './dataClient.js';

export function crossCauseDataPath({ basis, areaCode, dataRevision }) {
  causeDataPath({ basis, datasetCode: 'Se00', dataRevision });
  if (dataRevision !== 'rebuilt' || !/^\d{5}$/.test(areaCode || '') || Number(areaCode.slice(0, 2)) < 1 || Number(areaCode.slice(0, 2)) > 47) throw new Error('Invalid cross-cause selection');
  return `/data/cross-cause-profile-v1/${basis}-${areaCode.slice(0, 2)}.json.gz`;
}

export async function loadCrossCauseData(options, { signal, origin } = {}) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const [profile, policy] = await Promise.all([
    loadJson(crossCauseDataPath(options), { signal, origin }),
    loadJson('/data/selected-cause-rebuild-v1/acceptance.json', { signal, origin }),
  ]);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const pref = options.areaCode.slice(0, 2);
  if (profile.format !== 'cross-cause-profile-v1' || profile.dataRevision !== 'rebuilt' || profile.basis !== options.basis || profile.prefCode !== pref || !profile.datasets) throw new Error('Cross-cause data does not match the selection');
  const datasets = {};
  for (const [code, dataset] of Object.entries(profile.datasets)) {
    if (dataset.basis !== options.basis || dataset.cause !== code || !Array.isArray(dataset.rows) || dataset.rows.some(row => !row[1]?.startsWith(pref))) throw new Error('Cross-cause dataset scope mismatch');
    datasets[code] = applyMethodAcceptance(dataset, policy);
  }
  return datasets;
}
