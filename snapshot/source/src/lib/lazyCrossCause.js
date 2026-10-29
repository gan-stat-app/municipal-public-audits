import { arbitraryCauses, causeAvailability } from '../catalogs/causes.js';
import { calculateArbitraryPeriodCase } from './parity.js';
import { loadCrossCauseData } from './crossCauseData.js';
import { loadCauseData } from './dataClient.js';
import { aggregateMedicalArea } from './medicalAreas.js';

export function crossCauseChoices(options) {
  return arbitraryCauses.filter(([datasetCode]) => !causeAvailability({ ...options, mode: 'arbitrary', datasetCode }));
}

// Called after the primary result is ready and the panel approaches the viewport.
// Rebuilt data needs one
// prefecture slice rather than a nationwide download for each selected cause.
// Reuse the exact selected-cause calculation, including incomplete-year checks.
export async function calculateCrossCauseProfile({ basis, areaCode, regionUnit, medicalArea, sex, startYear, endYear, dataRevision, signal, onProgress, dataOrigin }) {
  const medical = regionUnit === 'medical-area';
  if (medical && (!/^\d{4}$/.test(medicalArea?.code || '') || !medicalArea.municipalities?.length)) throw new Error('Invalid medical-area cross-cause selection');
  // Municipality selection can remain in another prefecture when the unit changes.
  // Choose the regional pack from the selected medical area itself.
  const options = { basis, areaCode: medical ? `${medicalArea.code.slice(0, 2)}000` : areaCode, sex, startYear, endYear, dataRevision };
  const causes = crossCauseChoices(options);
  const results = [];
  const assertActive = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
  assertActive();
  onProgress?.({ completed: 0, total: causes.length });
  const datasets = dataRevision === 'rebuilt' ? await loadCrossCauseData(options, { signal, origin: dataOrigin }) : null;
  for (let index = 0; index < causes.length; index += 1) {
    assertActive();
    const [datasetCode, causeName] = causes[index];
    if (datasets && !datasets[datasetCode]) throw new Error(`Missing cross-cause dataset: ${datasetCode}`);
    try {
      const value = medical
        ? aggregateMedicalArea(datasets?.[datasetCode] ?? await loadCauseData({ ...options, datasetCode }, { signal, origin: dataOrigin }), medicalArea, sex, startYear, endYear)
        : await calculateArbitraryPeriodCase({ ...options, datasetCode, signal, dataOrigin, dataset: datasets?.[datasetCode] });
      assertActive();
      if (value?.complete) results.push({ datasetCode, causeName, ...value });
    } catch (error) {
      if (error?.name === 'AbortError' || datasets) throw error;
      // Legacy data retains its existing per-cause unavailable-file handling.
    }
    onProgress?.({ completed: index + 1, total: causes.length });
  }
  assertActive();
  return results.sort((a, b) => b.smr - a.smr);
}

export function observeForDeferredLoad(element, callback, { rootMargin = '600px 0px' } = {}) {
  if (!element || typeof IntersectionObserver !== 'function') {
    callback();
    return () => {};
  }
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      callback();
    }
  }, { rootMargin });
  observer.observe(element);
  return () => observer.disconnect();
}
