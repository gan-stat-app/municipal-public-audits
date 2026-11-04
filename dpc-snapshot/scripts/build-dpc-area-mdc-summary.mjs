import { readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const years = ["2021", "2022", "2023", "2024"];
const valueKeys = ["published", "suppressed", "surgeryPublished", "surgerySuppressed", "emergencyPublished", "emergencySuppressed", "ambulancePublished", "ambulanceSuppressed", "death24hPublished", "death24hSuppressed"];
const outputSchema = [...valueKeys, "hospitalCount"];

const empty = () => Object.fromEntries(outputSchema.map((key) => [key, 0]));
const readText = (path) => readFile(resolve(repoRoot, path), "utf8");
const readGzipJson = async (path) => JSON.parse(gunzipSync(await readFile(resolve(repoRoot, path))));
const readBase64GzipJson = async (path) => JSON.parse(gunzipSync(Buffer.from((await readText(path)).trim(), "base64")));

function inflateHistoricalHospital(row, definitions, schema) {
  const base = schema === "v2-array" ? 18 : 16;
  const mdc = {};
  definitions.forEach((definition, index) => {
    const values = row[base + index] || [];
    mdc[definition.code] = Object.fromEntries(valueKeys.map((key, valueIndex) => [key, Number(values[valueIndex] || 0)]));
  });
  return {notice: row[0], serial: row[1], area: row[7], mdc};
}

function aggregateHospitals(hospitals, definitions, death24h = null) {
  const areas = {};
  for (const hospital of hospitals) {
    if (!hospital.area) continue;
    for (const definition of definitions) {
      const values = hospital.mdc?.[definition.code];
      if (!values) continue;
      const target = (areas[hospital.area] ||= {})[definition.code] ||= empty();
      const death = death24h ? death24h[`${hospital.notice}:${hospital.serial}`]?.[definition.code] || {} : values;
      for (const key of valueKeys) {
        const source = key.startsWith("death24h") ? death : values;
        target[key] += Number(source[key] || 0);
      }
      if (valueKeys.some((key) => Number((key.startsWith("death24h") ? death : values)[key] || 0) > 0)) target.hospitalCount++;
    }
  }
  return areas;
}

export async function buildAreaMdcSummary(root = "dpc") {
  const output = {meta: {years, schema: outputSchema}, years: {}};
  for (const year of years.slice(0, 3)) {
    const payload = await readBase64GzipJson(`${root}/data/year-${year}.json.gz.b64`);
    const hospitals = payload.hospitals.map((row) => inflateHistoricalHospital(row, payload.summary.mdc, payload.meta.hospitalSchema));
    output.years[year] = aggregateHospitals(hospitals, payload.summary.mdc);
  }
  const summary = JSON.parse(await readText(`${root}/data/summary.json`));
  const death = await readGzipJson(`${root}/data/death24h.json.gz`);
  const hospitals = [];
  for (let pref = 1; pref <= 47; pref++) {
    const code = String(pref).padStart(2, "0");
    hospitals.push(...await readGzipJson(`${root}/data/pref/${code}.json.gz`));
  }
  output.years["2024"] = aggregateHospitals(hospitals, summary.mdc, death.hospitals);
  return output;
}

export async function writeAreaMdcSummary() {
  const output = await buildAreaMdcSummary("dpc");
  const encoded = gzipSync(Buffer.from(JSON.stringify(output)), {level: 9, mtime: 0}).toString("base64");
  await Promise.all([
    writeFile(resolve(repoRoot, "dpc/data/area-mdc-summary.json.gz.b64"), encoded),
    writeFile(resolve(repoRoot, "source/public/dpc/data/area-mdc-summary.json.gz.b64"), encoded),
  ]);
  return {bytes: encoded.length, years: output.meta.years.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await writeAreaMdcSummary()));
}
