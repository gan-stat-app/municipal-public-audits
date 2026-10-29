import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../ndb/checkup/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../../ndb/checkup/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../../ndb/checkup/style.css", import.meta.url), "utf8");
const expanded = JSON.parse(readFileSync(new URL("../../ndb/checkup/data/2023/expanded-manifest.json", import.meta.url), "utf8"));
const historicalCounts = new Map([[2013,22],[2014,22],[2015,28],[2016,28],[2017,29],[2018,33],[2019,33],[2020,33],[2021,33],[2022,33]]);

assert.match(html, /id="year-tabs"/);
assert.match(html, /id="current-year-status"/);
assert.match(html, /年度を選ぶと、このページの地域単位・指標・順位・選択地域・経年表示が連動/);
assert.match(app, /YEARS=\[2023,2022,2021,2020,2019,2018,2017,2016,2015,2014,2013\]/);
assert.match(app, /renderYearTabs/);
assert.match(app, /syncYearUrl/);
assert.match(app, /searchParams\.set\('year',year\)/);
assert.match(app, /constrainLevel\(year\)/);
assert.match(css, /\.year-tabs button\[aria-selected="true"\]/);
assert.match(html, /id="metricCategories"/);
assert.match(html, /id="metricSearch"/);
assert.match(html, /id="commonMetrics"/);
assert.match(html, /診断や一律の治療開始を意味せず、地域住民全体の有病率でもありません/);
assert.match(html, /id="modeHelp"/);
assert.match(html, /この指標の計算方法と掲載状況/);
assert.match(html, /id="coverageBody"/);
assert.match(html, /年齢階級の秘匿等により年齢調整値を算出できないため、実測値を表示/);
assert.match(app, /categoryMatch/);
assert.match(app, /filteredMetrics/);
assert.match(app, /syncModeAvailability/);
assert.match(app, /renderMetricDetails/);
assert.match(app, /historical-guidance/);
assert.match(app, /expanded-manifest\.json/);
assert.match(app, /掲載可能数から除外/);
assert.match(app, /option\.disabled=!adjusted/);
assert.match(app, /COMMON=/);
assert.match(css, /\.metric-categories/);
assert.equal(expanded.metrics.length, 86);
assert.equal(expanded.metrics.filter(metric => metric.group === "保健指導判定値").length, 12);
assert.equal(expanded.metrics.filter(metric => metric.group === "その他の所見・区分").length, 6);
assert.equal(expanded.metrics.filter(metric => metric.group === "BMIの分布").length, 3);
assert.deepEqual(
  expanded.metrics.filter(metric => metric.group === "BMIの分布").map(metric => metric.key),
  ["bmi_under_18_5", "bmi_25_plus", "bmi_30_plus"],
);
assert.deepEqual(
  expanded.metrics.filter(metric => metric.group === "受診勧奨判定値").map(metric => metric.key),
  [
    "ldl_140_plus", "hdl_under_35", "tg_300_plus", "sbp_140_plus",
    "dbp_90_plus", "hba1c_6_5_plus", "fasting_glucose_126_plus",
    "random_glucose_126_plus", "ast_51_plus", "alt_51_plus",
    "ggtp_101_plus", "egfr_under_45",
  ],
);
assert.match(html, /data-category="bmi"/);
assert.match(html, /data-category="guidance"/);
assert.match(html, /data-category="referral"/);
assert.match(html, /その他の所見・区分/);
assert.ok(expanded.metrics.some(metric => metric.key === "hemoglobin_low"));
const ldl140 = expanded.metrics.find(metric => metric.key === "ldl_140_plus");
assert.deepEqual(ldl140.numeratorBins, ["180以上", "160以上180未満", "140以上160未満"]);
assert.match(ldl140.denominator, /全区分/);
for (const [year, count] of historicalCounts) {
  const historical = JSON.parse(readFileSync(new URL(`../../ndb/checkup/data/${year}/expanded-manifest.json`, import.meta.url), "utf8"));
  assert.equal(historical.metrics.length, count);
  assert.ok(historical.metrics.some(metric => metric.key === "ldl_140_plus"));
}
assert.match(html, /2013～2023年度/);
assert.match(html, /LDL\s+120 mg\/dL以上などは保健指導判定値、LDL\s+140\s+mg\/dL以上などは受診勧奨判定値/);
assert.match(html, /「18未満」は原表から分離できないため表示しません/);
assert.deepEqual([...new Set(expanded.metrics.filter(metric => metric.question).map(metric => metric.question))], Array.from({ length: 22 }, (_, index) => index + 1));

console.log(JSON.stringify({
  status: "PASS",
  years: "2013-2023",
  pageWide: true,
  urlState: "year",
  unavailableSecondaryYears: "2013-2017 switch to prefecture",
}));
