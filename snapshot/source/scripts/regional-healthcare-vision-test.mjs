import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const [
  page,
  app,
  areas,
  cancer,
  flowCapacity,
  facilityDetails,
  home,
  sitemap,
  pkg,
] = await Promise.all([
  readFile(
    new URL("../public/regional-healthcare-vision/index.html", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../public/regional-healthcare-vision/app.js", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../public/regional-healthcare-vision/data/medical-area-municipalities.json",
      import.meta.url,
    ),
    "utf8",
  ).then(JSON.parse),
  readFile(
    new URL(
      "../public/regional-healthcare-vision/data/cancer-facilities.json",
      import.meta.url,
    ),
    "utf8",
  ).then(JSON.parse),
  readFile(
    new URL(
      "../public/regional-healthcare-vision/data/official-flow-capacity.json.gz",
      import.meta.url,
    ),
  ).then((x) => JSON.parse(gunzipSync(x))),
  readFile(
    new URL(
      "../public/regional-healthcare-vision/data/facility-details-v3.json.gz",
      import.meta.url,
    ),
  ).then((x) => JSON.parse(gunzipSync(x))),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
]);
for (const id of [
  "vision-prefecture",
  "vision-area",
  "population-cards",
  "demand-index",
  "dpc-facility-search",
  "dpc-facilities",
  "cancer-facilities",
  "beds-cards",
  "flow-cards",
  "flow-partners",
  "capacity-cards",
  "outpatient-summary",
  "capacity-search",
  "capacity-facilities",
  "care-cards",
  "care-composition",
  "ndb-cards",
  "regional-detail-dialog",
])
  assert(page.includes(id), id + " missing");
for (const source of [
  "/dpc/data/summary.json",
  "/dpc/data/pref/",
  "/dpc/data/surgery/mdc",
  "/dpc/data/surgery-definitions.json",
  "/cancer-care/2025-09/data-parts/manifest.json",
  "/ndb/service-volume/data/medical-areas.json.gz",
  "/population/future-0",
  "medical-area-municipalities.json",
  "cancer-facilities-2025-09.json",
  "official-medical-demand.json",
  "official-beds.json",
  "area-care-summary-v3.json",
  "bed-function-facilities-v4.json.gz.0",
  "bed-function-facilities-v4.json.gz.1",
  "official-flow-capacity.json.gz",
  "medical-areas-map.geojson.gz",
  "facility-details-v3.json.gz",
])
  assert(app.includes(source), source + " missing");
for (const label of [
  "介護給付費のサービス構成",
  "2024年度介護保険",
  "選択した医療圏だけの値ではありません",
  "参考：保険者全体の介護給付費構成",
  "医療圏内の各市町村について",
  "非公表セル",
  "2020年＝100",
  "2040年人口",
  "退院患者数の多い順",
  "厚生労働省の構想区域別医療需要推計",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
assert(!page.includes("公表確認分"));
assert(!app.includes("公表確認分"));
assert(!page.includes("少なくとも"));
assert(!app.includes("少なくとも"));
assert.equal(areas.areas.length, 335);
assert.equal(new Set(areas.areas.map((item) => item.code)).size, 335);
assert.equal(cancer.facilities.length, 464); // archived 2023 input
const currentCancer = JSON.parse(await readFile(new URL(
  "../public/regional-healthcare-vision/data/cancer-facilities-2025-09.json", import.meta.url)));
assert.equal(currentCancer.meta.version, "2025-09");
assert.equal(currentCancer.facilities.length, 468);
assert(currentCancer.facilities.every(f => areas.areas.some(a => a.code === f.area)));
assert(cancer.facilities.every((item) => /^\d{4}$/.test(item.area)));
assert(
  page.includes(
    '<script src="/regional-healthcare-vision/app.js?v=33" defer></script>',
  ),
  "diagnosis script missing",
);
assert(
  app.includes("x?.beds?.total") && app.includes("r?.beds?.total"),
  "bed total extraction missing",
);
assert(
  app.includes("defs?.diseases?.[diseaseCode]?.[code]?.title"),
  "specific surgery title lookup missing",
);
assert(/mdcSelect\.value\s*=\s*["']05["']/.test(app), "MDC 05 default missing");
assert.equal(flowCapacity.areas.length, 339);
assert(
  flowCapacity.areas.every(
    (x) => x.inflow && x.outflow && Array.isArray(x.facilities),
  ),
);
assert(
  flowCapacity.areas.some(
    (x) => x.activity.general_anesthesia > 0 && x.doctors_fulltime > 0,
  ),
);
assert.equal(facilityDetails.areas.length, 335);
assert(
  app.includes("facilityDetails.areas.find") &&
    app.includes("(a) => a.code === areaCode") &&
    app.includes("areaDetails?.facilities || []"),
  "outpatient summary must use only the selected area",
);
assert(
  !app.includes("facilityDetails.areas.flatMap"),
  "outpatient summary must not aggregate all areas",
);
assert.equal(
  facilityDetails.areas.reduce((n, x) => n + x.facilities.length, 0),
  11603,
);
assert.deepEqual(
  facilityDetails.areas
    .filter((x) => x.code.startsWith("05"))
    .map((x) => [x.code, x.facilities.length]),
  [
    ["0501", 9],
    ["0502", 2],
    ["0503", 11],
    ["0504", 35],
    ["0505", 10],
    ["0506", 10],
    ["0507", 5],
    ["0508", 6],
  ],
  "Akita outpatient facilities must follow the eight displayed areas",
);
assert(
  facilityDetails.areas.some((x) =>
    x.facilities.some((f) => f.first_visits > 0 && f.staff_nurses_ft > 0),
  ),
);
for (const label of [
  "外来機能報告",
  "ピーク：",
  "2050年度",
  "退院調整部門",
  "未報告、データ不備",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
for (const label of [
  "手術なし",
  "指定手術グループ",
  "shortCancerLabel",
  "2026年予定",
  "全国一括の構想区域別2040年値",
  "scenario-value",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
assert(
  page.includes("2024年度NDB") && app.includes("2024年度NDB"),
  "patient-flow data year missing",
);
for (const label of [
  "高度急性期＋急性期",
  "包括期",
  "慢性期",
  "都道府県内の患者流動",
  "NDBと患者調査は別の統計",
  "この画面で使うデータの時点",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
for (const label of [
  "島しょ部（別枠）",
  "flow-arrowhead-in",
  "主な流入元",
  "都道府県外の相手区域",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
for (const label of [
  "流入・流出",
  "流出のみ",
  "流入のみ",
  "5％未満",
  "20％以上",
  "県外からの主な流入元",
  "県外への主な流出先",
  "labelCodes",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
for (const label of [
  "県外との患者流動",
  "flow-national-map",
  "renderNationalFlowMap",
  "national-arrowhead-out",
  "national-arrowhead-in",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
for (const label of [
  "自動的に拡大",
  "全国での位置",
  "national-rate",
  "national-overview",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
for (const label of [
  "県外患者流動の読み方",
  "選択区域に住む入院患者",
  "県外に住む患者",
  "national-label-leader",
  "labelPositions",
  "Math.hypot",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
for (const label of [
  "構想区域の規模と広域連携",
  "20万人基準",
  "高齢者救急から在宅・介護まで",
  "人材とアクセス",
  "地域協議用サマリー",
  "新たな医療機関機能",
  "実搬送時間",
  "pdca-download",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
for (const label of [
  "cooperation-type",
  "cooperation-direction",
  "regional-comparison",
  "上位3区域",
  "現在の区域と連携時の単純合算",
  "candidate-grid",
])
  assert(page.includes(label) || app.includes(label), label + " missing");
assert(!/style\s*=/i.test(page), "inline style is forbidden");
assert(
  home.includes("/regional-healthcare-vision/"),
  "source home route missing",
);
assert(
  sitemap.includes("/regional-healthcare-vision/"),
  "source sitemap route missing",
);
assert(
  JSON.parse(pkg).scripts.test.includes("regional-healthcare-vision-test.mjs"),
  "test chain missing",
);
console.log(
  JSON.stringify({
    pass: true,
    route: "/regional-healthcare-vision/",
    areas: 335,
    cancerFacilities: currentCancer.facilities.length,
  }),
);

{
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const read = (file) => fs.readFileSync(path.join(root, file));
  const json = (file) => JSON.parse(read(file));
  const base = "regional-healthcare-vision/";
  const areaMap = json(base + "data/medical-area-municipalities.json");
  const future = JSON.parse(zlib.gunzipSync(Buffer.concat(
    ["00", "01", "02"].map((part) => read("population/future-" + part + ".part"))
  )));
  const app = read(base + "app.js").toString();
  const hook = "init().catch(showError);";
  assert.ok(app.includes(hook));
  const context = { document: {getElementById: () => ({})}, inputs: {areaMap, future} };
  vm.runInNewContext(app.replace(hook, `
    areaMap = inputs.areaMap;
    future = inputs.future;
    globalThis.result = versionedAreas();
    globalThis.population = populationSummary;
  `), context);
  
  const rows = [...context.result].sort((a, b) => a.code.localeCompare(b.code));
  assert.equal(rows.length, 330);
  const axis = rows.map((r) => [r.code, r.name, [...r.municipalities].sort()]);
  // Canonical sorted [area code, name, sorted [municipality code, name] pairs].
  // Computed independently from the identical axes of e-Stat 000040383774–778.
  assert.equal(crypto.createHash("sha256").update(JSON.stringify(axis)).digest("hex"),
    "b33296e2823e4eaa832adcf4e26327259bf130e2741f1427db03851f85c009dc");
  assert.equal(new Set(rows.flatMap((r) => r.municipalities.map(([c]) => c))).size, 1892);
  const forecast = (code) => {
    const r = rows.find((r) => r.code === code);
    return context.population(code, {municipalities: r.populationMembers}).p2040;
  };
  for (const [code, total] of Object.entries({
    "0501": 136121, "0502": 371634, "0503": 178445, "2208": 756154
  })) assert.equal(forecast(code).total, total);
  assert.equal(context.population("0502").p2040.total, 19693);
  assert.equal(context.population("0504").p2040.total, 303331);
  for (const year of ["p2020", "p2040"]) {
    const old = areaMap.areas.filter((r) => r.code.startsWith("05"));
    const merged = rows.filter((r) => r.code.startsWith("05"));
    assert.equal(old.reduce((n, r) => n + context.population(r.code)[year].total, 0),
      merged.reduce((n, r) => n + context.population(r.code, {municipalities: r.populationMembers})[year].total, 0));
  }
  const male = future.rows.findIndex((r) => r[0] === 2040 && r[1] === "22131" && r[2] === "M");
  assert.ok(male >= 0);
  const [removed] = future.rows.splice(male, 1);
  assert.equal(forecast("2208"), null);
  future.rows.push(removed, removed);
  assert.equal(forecast("2208"), null);
  console.log("2024 geography: official axis, population totals, both vintages, missing and duplicate rows passed");
}

async function checkGeographySwitch() {
  const { chromium } = await import("playwright-core");
  const { createServer } = await import("node:http");
  const { resolve, sep } = await import("node:path");
  const root = resolve(new URL("../../", import.meta.url).pathname);
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const file = resolve(root, "." + pathname + (pathname.endsWith("/") ? "index.html" : ""));
    if (!file.startsWith(root + sep)) return res.writeHead(404).end();
    try {
      const bytes = await readFile(file);
      const mime = file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
      res.writeHead(200, {"Content-Type": mime}).end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(0, "127.0.0.1", ok));
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"]});
    const base = `http://127.0.0.1:${server.address().port}/regional-healthcare-vision/`;
    for (const width of [390, 1440]) {
      const page = await browser.newPage({viewport: {width, height: 900}});
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "?area=0502");
      await page.locator("#diagnosis-content").waitFor();
      assert.match(await page.locator("#population-cards").innerText(), /19,693/);
      await page.selectOption("#vision-geography", "2024");
      await page.locator("#versioned-title").waitFor();
      assert.match(await page.locator("#versioned-title").innerText(), /県北/);
      await page.selectOption("#vision-area", "0502");
      assert.match(await page.locator("#versioned-cards").innerText(), /371,634/);
      assert.match(await page.locator("#versioned-title").innerText(), /県央/);
      const central = page.locator("#akita-acute-0502");
      assert.equal(await central.isVisible(), true);
      assert.equal(await central.locator("tbody tr").count(), 13);
      assert.match(await central.innerText(), /1,285床/);
      assert.equal(await page.locator("#akita-acute-0501").isVisible(), false);
      assert.equal(await page.locator("#legacy-diagnosis").isVisible(), false);
      await page.locator("#versioned-links a").first().click();
      await page.locator("#diagnosis-content").waitFor();
      assert.match(page.url(), /area=0504/);
      assert.equal(await central.isVisible(), true);
      assert.match(await page.locator("#population-cards").innerText(), /303,331/);
      await page.goto(base + "?area=2208&geography=2024");
      await page.locator("#versioned-title").waitFor();
      assert.match(await page.locator("#versioned-cards").innerText(), /756,154/);
      assert.equal(await central.isVisible(), false);
      await page.goto(base + "acute-hospitals/?area=0502");
      await page.locator("#acute-results tbody tr").first().waitFor();
      assert.match(await page.locator("#acute-results").innerText(), /1,285床/);
      assert.equal(await page.locator("#acute-results tbody tr").count(), 13);
      await page.selectOption("#acute-prefecture", "13");
      assert.match(await page.locator("#acute-results h2").innerText(), /東京都/);
      await page.selectOption("#acute-area", "1301");
      assert.match(await page.locator("#acute-results h2").innerText(), /区中央部/);
      await page.selectOption("#acute-prefecture", "");
      assert.equal(await page.locator("#acute-results tbody tr").count(), 47);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    server.close();
  }
}
if (process.env.FEATURE === "regional-healthcare-vision") await checkGeographySwitch();

