import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { calculateArbitraryPeriodCase } from '../src/lib/parity.js';
import { applyMethodAcceptance } from '../src/lib/dataClient.js';
import { smrExportLink } from '../src/lib/smrExport.js';

const source = fileURLToPath(new URL('../', import.meta.url)), root = path.dirname(source.replace(/[\\/]$/, ''));
const review = path.join(source, 'smr-export-review');
fs.mkdirSync(review, { recursive: true });
const headers = fs.readFileSync(path.join(source, 'dist/_headers'), 'utf8');
const csp = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1];
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '');
  if (relative.includes('..')) { res.writeHead(400).end(); return; }
  const built = path.join(source, 'dist', relative || 'index.html');
  const file = relative.startsWith('data/selected-cause-rebuild-v1/') ? path.join(root, relative) : fs.existsSync(built) ? built : path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream';
  res.setHeader('Content-Type', type);
  if (path.extname(file) === '.html' && csp) res.setHeader('Content-Security-Policy', csp);
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', headless: true });
const base = { mode: 'arbitrary', dataRevision: 'rebuilt', regionUnit: 'municipality', medicalAreaCode: '0504', areaCode: '05201', basis: 'juki', datasetCode: 'Se00', sex: '男', startYear: 1999, endYear: 2024 };
const policy = JSON.parse(fs.readFileSync(path.join(root, 'data/selected-cause-rebuild-v1/acceptance.json')));
const dataset = applyMethodAcceptance(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'data/selected-cause-rebuild-v1/juki-Se00-2024-boundary.json.gz')))), policy);
const expected = await calculateArbitraryPeriodCase({ ...base, dataset });
const rebase = url => { const parsed = new URL(url); return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`; };
const reports = [];
try {
  for (const viewport of [{ width: 1200, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/data/*.geojson.gz', route => route.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
    const controls = name => page.locator('#standardized-mortality label').filter({ hasText: new RegExp(`^${name}`) }).locator('select');
    const jsonButton = page.getByRole('button', { name: 'JSONで保存', exact: true });
    const csvButton = page.getByRole('button', { name: 'CSVで保存', exact: true });
    const readJson = async () => JSON.parse(await page.locator('[data-testid="smr-export-json"]').textContent());
    await page.goto(rebase(new URL(`/${new URL(smrExportLink(base)).search.replace('&export=json', '')}`, 'https://municipal-smr.jp').href));
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'JSONで保存' && !button.disabled));
    const selected = await readJson();
    assert.equal(selected.selection.region.name, '秋田県秋田市');
    for (const [field, value] of Object.entries({ observed_deaths: expected.observed, expected_deaths: expected.expected, standardized_mortality_ratio: expected.smr, ci95_lower: expected.ci95Low, ci95_upper: expected.ci95High })) assert.equal(selected.result[field], value);
    const annualRows = dataset.rows.filter(row => row[1] === '05201' && row[2] === 'M').sort((a,b)=>a[0]-b[0]);
    await page.locator('.smr-trend-details summary').click();
    const tableRows = page.locator('.smr-trend-table tbody tr');
    assert.equal(await tableRows.count(), 26);
    for (const row of annualRows) {
      const cells = tableRows.filter({has: page.getByRole('rowheader', {name: String(row[0]), exact:true})}).locator('td');
      const annualResult = await calculateArbitraryPeriodCase({...base, dataset, startYear:row[0], endYear:row[0]});
      if (!annualResult?.complete) continue;
      const fmt = v => v.toLocaleString('ja-JP',{minimumFractionDigits:1,maximumFractionDigits:1});
      assert.equal(await cells.nth(0).textContent(),fmt(annualResult.smr));
      assert.equal(await cells.nth(1).textContent(),`${fmt(annualResult.ci95Low)}–${fmt(annualResult.ci95High)}`);
    }
    await page.locator('.smr-trend').screenshot({path:path.join(review,`${viewport.width}-annual-table.png`)});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.locator('.smr-trend-details summary').click();
    const dataRequests = () => requests.filter(url => url.includes('/data/selected-cause-rebuild-v1/')).length;
    const before = dataRequests();
    for (const [format, button] of [['json', jsonButton], ['csv', csvButton]]) {
      const pending = page.waitForEvent('download');
      await button.click();
      const download = await pending, file = path.join(review, `${viewport.width}-${download.suggestedFilename()}`);
      await download.saveAs(file);
      const contents = fs.readFileSync(file, 'utf8');
      if (format === 'json') assert.deepEqual(JSON.parse(contents), selected);
      else {
        assert(contents.startsWith('\uFEFF'));
        for (const value of Object.values(selected.result).filter(value => typeof value === 'number')) assert(contents.includes(`"${value}"`));
        assert(contents.includes('秋田県秋田市'));
      }
    }
    assert.equal(dataRequests(), before, 'Saving must not refetch statistical data');
    await page.getByText('同じ結果を取得するリンク・JSONの内容', { exact: true }).click();
    assert.equal(await page.locator('.smr-export input').inputValue(), smrExportLink(base));
    await page.locator('.smr-export').screenshot({ path: path.join(review, `${viewport.width}-download-controls.png`) });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

    // Delay a newly selected cause and prove neither an old download nor old JSON remains available.
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    await page.route('**/data/selected-cause-rebuild-v1/juki-Se01-2024-boundary.json.gz', async route => { await hold; await route.continue(); });
    try {
      const pendingCause = page.waitForRequest('**/data/selected-cause-rebuild-v1/juki-Se01-2024-boundary.json.gz');
      await controls('死因').selectOption('Se01');
      await pendingCause;
      assert(await csvButton.isDisabled()); assert(await jsonButton.isDisabled());
      assert.equal(await page.locator('[data-testid="smr-export-json"]').count(), 0);
    } finally { release(); }
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'JSONで保存' && !button.disabled));
    assert.equal((await readJson()).selection.cause_code, 'Se01');
    await page.unroute('**/data/selected-cause-rebuild-v1/juki-Se01-2024-boundary.json.gz');

    const autoDownload = page.waitForEvent('download');
    await page.goto(rebase(smrExportLink(base)));
    const auto = await autoDownload;
    const file = path.join(review, `${viewport.width}-acquisition.json`);
    await auto.saveAs(file);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).result, selected.result);
    let invalidDownloads = 0;
    page.on('download', () => invalidDownloads++);
    await page.goto(`${origin}/?export=json&area=bad#standardized-mortality`);
    await page.getByText('取得リンクの条件が不完全です。画面で条件を選び直してから保存してください。', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'JSONで保存' && !button.disabled));
    assert.equal(invalidDownloads, 0);
    const missing = { ...base, basis: 'census', areaCode: '22138', startYear: 2024 };
    await page.goto(rebase(smrExportLink(missing)));
    await page.getByText('2024年の浜松市の国勢調査方式は市全体を選択してください。区別の期待死亡数は配分していません。', { exact: true }).waitFor();
    assert(await csvButton.isDisabled()); assert(await jsonButton.isDisabled());
    assert.equal(await page.locator('[data-testid="smr-export-json"]').count(), 0);
    assert.equal(invalidDownloads, 0);
    // Synthetic gaps exercise the rendered chart without altering production data.
    const fixture = {...dataset, rows: dataset.rows.map(row => {
      if(row[1]!=='05201'||row[2]!=='M')return row;
      const copy=[...row];
      if(row[0]===2020){copy[3]=0;copy[4]=0.01;}
      if(row[0]===2021){copy[3]=null;copy[4]=null;}
      return copy;
    })};
    await page.route('**/data/selected-cause-rebuild-v1/juki-Se00-2024-boundary.json.gz',route=>route.fulfill({json:fixture}));
    const fixtureUrl=new URL(smrExportLink({...base,startYear:2020,endYear:2020}));fixtureUrl.searchParams.delete('export');
    await page.goto(rebase(fixtureUrl.href));
    await page.waitForFunction(()=>document.querySelector('.metric-grid')?.textContent.includes('0.1未満'));
    assert((await page.locator('[data-testid="smr-trend-missing"]').textContent()).includes('2021'));
    assert((await page.locator('.trend-chart polyline').count())>=2);
    const plottedYears=await page.locator('.trend-chart circle title').allTextContents();
    assert(plottedYears.some(text=>text.startsWith('2020: 標準化死亡比 0.0')));
    assert(!plottedYears.some(text=>text.startsWith('2021:')));
    await page.locator('.smr-trend-details summary').click();
    const missingRow=page.locator('.smr-trend-table tbody tr').filter({has:page.getByRole('rowheader',{name:'2021',exact:true})});
    assert((await missingRow.textContent()).includes('算定不可'));
    await page.locator('.smr-trend').screenshot({path:path.join(review,`${viewport.width}-missing-year.png`)});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.deepEqual(errors, []);
    reports.push({ viewport, unrounded_metrics_match: true, csv_json_downloads: true, no_download_refetch: true, acquisition_link: true, stale_and_missing_blocked: true, invalid_link_blocked: true, csp: !!csp, horizontal_overflow: false });
    await context.close();
  }
  fs.writeFileSync(path.join(review, 'verification.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ ok: true, cases: reports }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }

