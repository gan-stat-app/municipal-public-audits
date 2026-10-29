import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve("..");
const port = 4194;
const base = `http://127.0.0.1:${port}`;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".geojson": "application/geo+json",
  ".gz": "application/octet-stream",
};

const server = createServer(async (request, response) => {
  try {
    let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) throw new Error("outside root");
    if (!(await stat(file)).isFile()) throw new Error("not file");
    response.writeHead(200, {
      "content-type": mime[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((ok, fail) => server.once("error", fail).listen(port, "127.0.0.1", ok));

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(`page: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("favicon") && !message.text().includes("Failed to load resource")) errors.push(`console: ${message.text()}`);
  });
  page.on("response", response => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      errors.push(`http: ${response.status()} ${response.url()}`);
    }
  });

  const response = await page.goto(`${base}/dpc/`, { waitUntil: "networkidle", timeout: 30000 });
  assert(response?.ok(), `initial HTTP ${response?.status()}`);
  await page.locator("#area-detail h2").waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await page.locator("#prefecture-select").inputValue(), "", "二次医療圏地図の初期表示が全国ではない");
  assert.match(await page.locator("#area-detail").textContent(), /全国表示.*全国の二次医療圏/s);
  await page.selectOption("#prefecture-select", "05");
  await page.locator("#area-detail").filter({hasText: "秋田県全体"}).waitFor();
  assert.equal(await page.locator("path.region.selected").count(), 0, "都道府県変更後も以前の医療圏選択が残る");
  assert.match(await page.locator("#area-detail").textContent(), /退院患者数.*手術あり.*救急医療入院.*救急車搬送.*入院後24時間以内死亡.*集計対象/s);
  await page.selectOption("#prefecture-select", "13");
  await page.locator("#area-detail").filter({hasText: "東京都全体"}).waitFor();
  assert.doesNotMatch(await page.locator("#area-detail").textContent(), /秋田県全体/);
  await page.locator("#national-button").click();
  assert.equal(await page.locator("#prefecture-select").inputValue(), "");
  assert.match(await page.locator("#area-detail").textContent(), /全国表示.*全国の二次医療圏/s);
  await page.locator('[data-area-scope="mdc"]').click();
  await page.locator("#map-caption").filter({hasText: "01 神経系疾患"}).waitFor({timeout: 30000});
  assert.equal(new URL(page.url()).searchParams.get("areaMdc"), "01", "選択MDCがURLへ保存されない");
  await page.selectOption("#prefecture-select", "05");
  await page.locator("#area-detail").filter({hasText: "秋田県全体"}).filter({hasText: "01 神経系疾患"}).waitFor({timeout: 30000});
  await page.locator("path.region").first().click();
  await page.locator(".area-mdc-trend").waitFor({state: "visible", timeout: 30000});
  assert.equal(await page.locator(".area-mdc-trend tbody tr").count(), 4, "MDC年度推移が4年度分ではない");
  await page.locator('#year-tabs button[data-year="2023"]').click();
  await page.locator("#current-year-status").filter({hasText: "令和5年度"}).waitFor({timeout: 30000});
  assert.match(await page.locator("#area-detail").textContent(), /01 神経系疾患/);
  assert.match(await page.locator(".area-mdc-trend tr.selected").textContent(), /令和5年度/);
  await page.selectOption("#prefecture-select", "13");
  await page.locator("#area-detail").filter({hasText: "東京都全体"}).filter({hasText: "01 神経系疾患"}).waitFor({timeout: 30000});
  await page.locator('[data-area-scope="overall"]').click();
  assert.equal(await page.locator("#area-mdc-select").isHidden(), true, "全体表示でMDC選択欄が残る");
  assert.equal(new URL(page.url()).searchParams.has("areaMdc"), false, "全体表示後もMDCがURLに残る");
  await page.locator('#year-tabs button[data-year="2024"]').click();
  await page.locator("#national-button").click();
  assert.match(await page.locator("h1").textContent(), /DPC/);
  assert.match(await page.locator('[data-hospital-goal="surgery"]').textContent(), /診療分野を選ぶ.*病院を選ぶ.*疾患・手術を検索/s);

  await page.selectOption("#metric-select", "death24hPublished");
  const suppressedArea = page.locator('path[aria-label*="数値公表なし"]').first();
  await suppressedArea.waitFor({ state: "visible", timeout: 10000 });
  await suppressedArea.click();
  await page.locator("#area-detail").filter({hasText: "数値公表なし"}).waitFor({timeout: 30000});
  assert.match(await page.locator("#area-detail").textContent(), /数値公表なし（秘匿セル \d+／0件とは限りません）/);

  await page.locator("#hospital-tab").click();
  await page.locator("#hospital-result-count").filter({hasText: "6,372施設"}).waitFor({timeout: 120000});
  assert.equal(await page.locator("#hospital-prefecture").inputValue(), "", "初期都道府県が全国ではない");
  assert.equal(await page.locator("#hospital-area").isDisabled(), true, "全国時に二次医療圏が無効化されていない");
  await page.locator(".hospital-card-open-button").first().waitFor({ state: "visible", timeout: 30000 });
  assert.equal(await page.locator(".hospital-card").count(), 50, "全国検索の初期表示が50件ではない");
  assert.equal(await page.locator(".hospital-card").first().locator(".hospital-card-open-button").count(), 2, "病院カードに2種類の詳細ボタンがない");
  await page.locator(".hospital-card-surgery-button").first().click();
  await page.locator(".surgery-browser-priority").waitFor({state: "visible", timeout: 30000});
  assert.equal(await page.evaluate(() => {
    const section = document.querySelector(".surgery-browser");
    const summary = document.querySelector(".summary-grid");
    return Boolean(section.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING);
  }), true, "通常の病院検索から疾患・手術を開いたとき上部へ配置されない");
  await page.locator("#hospital-dialog-close").click();

  assert.equal(await page.locator("#hospital-more").isVisible(), true, "全国検索の「さらに表示」がない");
  await page.locator("#hospital-more").click();
  await page.waitForFunction(() => document.querySelectorAll(".hospital-card").length === 100);
  await page.selectOption("#hospital-prefecture", "05");
  await page.locator("#hospital-result-count").filter({hasText: "47施設"}).waitFor({timeout: 30000});
  assert.equal(await page.locator("#hospital-area").isDisabled(), false, "都道府県選択後も二次医療圏が無効");
  await page.locator('[data-hospital-goal="surgery"]').click();
  assert.match(await page.locator("#hospital-finder-help").textContent(), /①診療分野.*②病院カード/s);
  assert.equal(await page.locator(".hospital-card-surgery-button").first().isDisabled(), true, "MDC未選択でも疾患・手術ボタンが有効");
  assert.equal(await page.locator(".hospital-card-surgery-button").first().textContent(), "先に診療分野を選択");
  await page.selectOption("#hospital-mdc", "01");
  await page.locator("#hospital-result-count").filter({hasText: "退院患者数が多い順"}).waitFor();
  assert.equal(await page.locator(".hospital-card-surgery-button").first().isEnabled(), true);
  assert.equal(await page.locator(".hospital-card-surgery-button").first().textContent(), "疾患・手術を見る");
  await page.selectOption("#hospital-metric", "surgeryPublished");
  await page.locator("#hospital-result-count").filter({hasText: "退院患者数が多い順"}).waitFor();
  assert.equal(await page.locator("#hospital-metric-label").textContent(), "比較する病院機能");
  assert.match(await page.locator(".hospital-card-mdc-value").first().textContent(), /退院患者数.*件.*この件数が多い順に表示/s);
  assert.match(await page.locator(".hospital-card-compare").first().textContent(), /比較：手術あり患者数.*件/s);
  const hospitalCount = await page.locator(".hospital-card-surgery-button").count();
  let foundDefinition = false;
  for (let index = 0; index < Math.min(hospitalCount, 40); index += 1) {
    await page.locator(".hospital-card-surgery-button").nth(index).click();
    await page.locator("#surgery-results").waitFor({ state: "visible" });
    await page.waitForTimeout(150);
    if (index === 0) {
      assert.equal(await page.locator("#surgery-mdc").inputValue(), "01", "病院検索側MDCが疾患・手術検索へ連携されない");
      assert.equal(await page.locator(".surgery-browser-priority").count(), 1, "疾患・手術欄が優先表示されない");
      assert.equal(await page.evaluate(() => {
        const section = document.querySelector(".surgery-browser");
        const summary = document.querySelector(".summary-grid");
        return Boolean(section.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING);
      }), true, "疾患・手術欄が病院概要より後にある");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "surgery-search", "疾患・手術検索欄へ移動していない");
    }
    if (await page.locator(".surgery-procedures").count()) {
      foundDefinition = true;
      break;
    }
    await page.locator("#hospital-dialog-close").click();
  }
  assert(foundDefinition, "DPC公式定義に対応する指定手術グループが表示されない");
  const guide = await page.locator(".surgery-guide").textContent();
  assert.match(guide, /99.*手術なし/s);
  assert.match(guide, /97.*その他の手術あり/s);
  assert.match(guide, /01～06.*数字の大小は、重症度・難易度・治療成績を表しません/s);
  assert.match(guide, /98.*割り当てられていません/s);

  const firstDisease = page.locator(".surgery-disease").first();
  const diseaseCode = (await firstDisease.locator("h4 code").textContent()).trim();
  const officialGroup = firstDisease.locator(".surgery-category").filter({ has: page.locator(".surgery-procedures") }).first();
  assert.match(await officialGroup.locator("strong").textContent(), /指定手術グループ|手術|術/);
  await officialGroup.locator("summary").click();
  assert(await officialGroup.locator("li").count() > 0, "指定手術・Kコードの明細が空");
  assert.match(await officialGroup.locator("li").first().textContent(), /K\d|手術|術/);
  const exampleKCode = (await officialGroup.locator("li code").first().textContent()).trim();
  assert.match(exampleKCode, /^K/);
  await page.locator("#surgery-search").fill(exampleKCode);
  await page.waitForTimeout(100);
  assert((await page.locator(".surgery-disease").count()) > 0, "Kコード検索で結果が消えた");
  assert((await page.locator(".surgery-search-match").first().textContent()).includes(exampleKCode), "Kコードに一致する手術定義が表示されない");

  await page.locator("#surgery-search").fill(diseaseCode);
  await page.waitForTimeout(100);
  assert((await page.locator(".surgery-disease").count()) > 0, "疾患分類コード検索で結果が消えた");
  for (const code of await page.locator(".surgery-disease h4 code").allTextContents()) {
    assert(code.includes(diseaseCode), `検索外の疾患分類が表示された: ${code}`);
  }

  if (await page.locator("#hospital-dialog").evaluate(dialog => dialog.open)) {
    await page.locator("#hospital-dialog-close").click();
  }
  await page.locator("#area-tab").click();
  for (const [year, label] of [["2021", "令和3年度"], ["2022", "令和4年度"], ["2023", "令和5年度"], ["2024", "令和6年度"]]) {
    await page.locator(`#year-tabs button[data-year="${year}"]`).click();
    await page.locator("#current-year-status").filter({hasText: label}).waitFor({timeout: 30000});
    for (const metric of ["published", "surgeryPublished", "emergencyPublished", "ambulancePublished", "death24hPublished"]) {
      await page.selectOption("#metric-select", metric);
      assert.match(await page.locator("#area-detail").textContent(), /件|秘匿/);
    }
    await page.locator("#hospital-tab").click();
    await page.locator(".hospital-card-open-button").first().waitFor({state: "visible", timeout: 30000});
    let yearDefinitionFound = false;
    const yearHospitalCount = await page.locator(".hospital-card-surgery-button").count();
    for (let index = 0; index < Math.min(yearHospitalCount, 40); index += 1) {
      await page.locator(".hospital-card-surgery-button").nth(index).click();
      await page.locator("#surgery-results").waitFor({state: "visible"});
      await page.waitForTimeout(150);
      if (await page.locator(".surgery-procedures").count()) {
        assert.match(await page.locator(".surgery-footnote").first().textContent(), new RegExp(label));
        const yearKCode = (await page.locator(".surgery-procedures code").first().textContent()).trim();
        await page.locator("#surgery-search").fill(yearKCode);
        await page.waitForTimeout(100);
        assert((await page.locator(".surgery-search-match").count()) > 0, `${label}のKコード検索結果が表示されない`);
        assert((await page.locator(".surgery-search-match").first().textContent()).includes(yearKCode), `${label}のKコード検索結果が一致しない`);
        yearDefinitionFound = true;
        break;
      }
      await page.locator("#hospital-dialog-close").click();
    }
    assert(yearDefinitionFound, `${label}の指定手術名・Kコード詳細が表示されない`);
    if (await page.locator("#hospital-dialog").evaluate(dialog => dialog.open)) {
      await page.locator("#hospital-dialog-close").click();
    }
    await page.locator("#area-tab").click();
  }

  await page.locator("#hospital-tab").click();
  await page.locator("#hospital-reset").click();
  await page.locator("#hospital-result-count").filter({hasText: "6,372施設"}).waitFor({timeout: 120000});
  assert.equal(await page.locator("#hospital-prefecture").inputValue(), "", "リセット後に全国へ戻らない");
  assert.equal(await page.locator("#hospital-area").isDisabled(), true, "リセット後に二次医療圏が無効化されない");
  assert.equal(new URL(page.url()).searchParams.get("hospitalPref"), "all", "全国条件がURLへ保存されない");
  await page.locator("#area-tab").click();

  await page.locator('#year-tabs button[data-year="2021"]').click();
  await page.locator("#classification-tab").click();
  await page.locator("#classification-results button").first().waitFor({state: "visible", timeout: 30000});
  assert.match(await page.locator("#classification-result-count").textContent(), /令和3年度.*分類/);
  await page.locator("#classification-results button").first().click();
  assert.match(new URL(page.url()).searchParams.get("year"), /2021/);
  assert.equal(new URL(page.url()).searchParams.get("view"), "classification");
  assert(new URL(page.url()).searchParams.get("classification"), "classification URL state missing");

  await page.reload({waitUntil: "networkidle"});
  await page.locator("#classification-detail h2").waitFor({state: "visible", timeout: 30000});
  assert.match(await page.locator("#current-year-status").textContent(), /令和3年度/);
  assert.equal(await page.locator("#classification-panel").isVisible(), true);

  await page.setViewportSize({width: 390, height: 844});
  await page.reload({waitUntil: "networkidle"});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, "mobile horizontal overflow");
  await page.locator('#year-tabs button[data-year="2024"]').click();
  assert.match(await page.locator("#current-year-status").textContent(), /令和6年度/);
  assert.equal(errors.length, 0, errors.join("\n"));

  console.log(JSON.stringify({
    status: "PASS",
    hospitalButtonsChecked: Math.min(hospitalCount, 40),
    diseaseCode,
    verified: ["全国初期表示", "通常カード疾患手術上部表示", "医療圏MDC切替", "MDC年度推移", "MDC都道府県連携", "全国50件追加", "都道府県絞り込み", "条件リセット", "詳細ダイアログ", "全4年度", "全5指標", "秘匿表示", "病院選択", "疾患検索", "病院別Kコード検索", "全年度指定手術名", "全年度Kコード", "URL復元", "mobile"],
  }));
} finally {
  if (browser) await browser.close();
  await new Promise(ok => server.close(ok));
}
