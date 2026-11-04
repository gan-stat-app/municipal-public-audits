import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAreaMdcSummary } from "./build-dpc-area-mdc-summary.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const artifactPath = resolve(repoRoot, "dpc/data/area-mdc-summary.json.gz.b64");
const sourceCopyPath = resolve(repoRoot, "source/public/dpc/data/area-mdc-summary.json.gz.b64");
const [publishedText, sourceText, rebuilt] = await Promise.all([
  readFile(artifactPath, "utf8"),
  readFile(sourceCopyPath, "utf8"),
  buildAreaMdcSummary("dpc"),
]);
assert.equal(sourceText.trim(), publishedText.trim(), "source/public と公開用のMDC集計ファイルが一致しません");
const published = JSON.parse(gunzipSync(Buffer.from(publishedText.trim(), "base64")));
assert.deepEqual(published, rebuilt, "病院別MDCから再集計した値と公開用医療圏MDC値が一致しません");

assert.deepEqual(published.meta.years, ["2021", "2022", "2023", "2024"]);
for (const year of published.meta.years) {
  const areas = published.years[year];
  assert.equal(Object.keys(areas).length, 335, `${year}: 二次医療圏数が335ではありません`);
  for (const [areaCode, mdcs] of Object.entries(areas)) {
    assert.equal(Object.keys(mdcs).length, 18, `${year} ${areaCode}: MDC数が18ではありません`);
    for (const [mdc, row] of Object.entries(mdcs)) {
      for (const key of published.meta.schema) {
        assert(Number.isInteger(row[key]) && row[key] >= 0, `${year} ${areaCode} ${mdc} ${key}: 非負整数ではありません`);
      }
    }
  }
}
for (const year of ["2021", "2022", "2023"]) {
  const deathSignals = Object.values(published.years[year]).flatMap((mdcs) => Object.values(mdcs)).reduce((sum, row) => sum + row.death24hPublished + row.death24hSuppressed, 0);
  assert(deathSignals > 0, `${year}: MDC別24時間以内死亡の公表値・秘匿セルがすべて0です`);
}
const sha256 = createHash("sha256").update(publishedText.trim()).digest("hex");
console.log(JSON.stringify({status: "PASS", years: 4, areasPerYear: 335, mdcPerArea: 18, cellsChecked: 4 * 335 * 18 * published.meta.schema.length, sha256}));
