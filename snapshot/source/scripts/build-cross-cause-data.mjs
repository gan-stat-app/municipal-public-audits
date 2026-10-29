import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { arbitraryCauses } from '../src/catalogs/causes.js';

export const profileFormat = 'cross-cause-profile-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = fileURLToPath(new URL('../', import.meta.url));

// Keep every original annual row and its order, including missingness and
// boundary metadata. A prefecture slice also contains its cities and wards,
// so the existing prefecture/designated-city aggregation remains unchanged.
export function splitByPrefecture(dataset) {
  const groups = new Map();
  for (const row of dataset.rows) {
    const code = row[1];
    if (typeof code !== 'string' || !/^\d{5}$/.test(code)) throw new Error('Invalid annual area code');
    const pref = code.slice(0, 2);
    if (pref === '00') continue; // The feature selects municipalities/prefectures.
    if (Number(pref) < 1 || Number(pref) > 47) throw new Error('Invalid prefecture');
    if (!groups.has(pref)) groups.set(pref, []);
    groups.get(pref).push(row);
  }
  return groups;
}

export function buildCrossCauseData({ dataRoot = path.resolve(source, '../data/selected-cause-rebuild-v1'), outputRoot = path.resolve(source, 'public/data', profileFormat), bases = ['juki', 'census'], causes = arbitraryCauses } = {}) {
  fs.mkdirSync(outputRoot, { recursive: true });
  const prefs = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));
  const policyBytes = fs.readFileSync(path.join(dataRoot, 'acceptance.json'));
  const policy = JSON.parse(policyBytes);
  const manifest = { format: profileFormat, dataRevision: 'rebuilt', policySha256: hash(policyBytes), inputs: [], outputs: [] };
  for (const basis of bases) {
    for (const prefCode of prefs) {
      fs.writeFileSync(path.join(outputRoot, `${basis}-${prefCode}.json`), JSON.stringify({ format: profileFormat, dataRevision: 'rebuilt', basis, prefCode }).slice(0, -1) + ',"datasets":{');
    }
    for (let index = 0; index < causes.length; index++) {
      const [datasetCode] = causes[index];
      const filename = `${basis}-${datasetCode}-2024-boundary.json.gz`;
      const bytes = fs.readFileSync(path.join(dataRoot, filename));
      const dataset = JSON.parse(gunzipSync(bytes));
      if (dataset.basis !== basis || dataset.cause !== datasetCode || dataset.source_version !== policy.source_version || policy.decision !== 'accepted') throw new Error(`Unverified profile input: ${filename}`);
      const { rows, ...metadata } = dataset;
      const groups = splitByPrefecture(dataset);
      manifest.inputs.push({ path: `data/selected-cause-rebuild-v1/${filename}`, bytes: bytes.length, sha256: hash(bytes), rows: rows.length });
      for (const prefCode of prefs) {
        const slice = { ...metadata, rows: groups.get(prefCode) || [] };
        fs.appendFileSync(path.join(outputRoot, `${basis}-${prefCode}.json`), `${index ? ',' : ''}${JSON.stringify(datasetCode)}:${JSON.stringify(slice)}`);
      }
    }
    for (const prefCode of prefs) {
      const file = path.join(outputRoot, `${basis}-${prefCode}.json`);
      fs.appendFileSync(file, '}}');
      const plain = fs.readFileSync(file);
      const bytes = gzipSync(plain, { level: 9 });
      const filename = `${basis}-${prefCode}.json.gz`;
      fs.writeFileSync(path.join(outputRoot, filename), bytes);
      fs.unlinkSync(file);
      manifest.outputs.push({ path: filename, bytes: bytes.length, decodedBytes: plain.length, sha256: hash(bytes) });
    }
  }
  fs.writeFileSync(path.join(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = buildCrossCauseData();
  console.log(JSON.stringify({ pass: true, format: manifest.format, inputs: manifest.inputs.length, files: manifest.outputs.length, akitaBytes: manifest.outputs.find(x => x.path === 'juki-05.json.gz').bytes }));
}
