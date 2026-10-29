import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { applyMethodAcceptance } from '../src/lib/dataClient.js';
import { calculateArbitraryPeriodCase } from '../src/lib/parity.js';
import { aggregateMedicalArea, normalizeMedicalAreas } from '../src/lib/medicalAreas.js';
import { buildSmrExport, smrExportLink } from '../src/lib/smrExport.js';

const source = fileURLToPath(new URL('../', import.meta.url)), root = path.dirname(source.replace(/[\\/]$/, ''));
const fixtureRoot = process.env.SMR_BATCH_FIXTURE_ROOT;
const review = path.join(source, 'smr-export-review'); fs.mkdirSync(review, { recursive: true });
const csp = fs.readFileSync(path.join(source, 'dist/_headers'), 'utf8').match(/Content-Security-Policy:\s*(.+)/)?.[1];
const policy = JSON.parse(fs.readFileSync(path.join(root, 'data/selected-cause-rebuild-v1/acceptance.json')));
const medicalAreas = normalizeMedicalAreas(JSON.parse(fs.readFileSync(path.join(root, 'regional-healthcare-vision/data/medical-area-municipalities.json'))).areas);
const cache = new Map();
const load = (basis, cause) => {
  const key = `${basis}-${cause}`;
  if (!cache.has(key)) {
    const raw = fixtureRoot ? JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${key}.json`)))
      : JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, `data/selected-cause-rebuild-v1/${key}-2024-boundary.json.gz`))));
    if (fixtureRoot) raw.source_version = policy.source_version;
    cache.set(key, applyMethodAcceptance(raw, policy));
  }
  return cache.get(key);
};
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '');
  if (relative.includes('..')) { res.writeHead(400).end(); return; }
  const cause = relative.match(/^data\/selected-cause-rebuild-v1\/(juki|census)-(Se\w{2})-2024-boundary.json.gz$/);
  if (fixtureRoot && cause) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(load(cause[1], cause[2]))); return; }
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
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome',
  args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [], headless: true });
const base = { mode: 'arbitrary', dataRevision: 'rebuilt', regionUnit: 'municipality', medicalAreaCode: '0504', areaCode: '05201',
  basis: 'juki', datasetCode: 'Se00', sex: '男', startYear: 2020, endYear: 2024 };
const reports = [];
try {
  for (const viewport of [{ width: 1200, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 800 }]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(String(error))); page.on('request', request => requests.push(request.url()));
    await page.route('**/data/*.geojson.gz', route => route.fulfill({ json: { type: 'FeatureCollection', features: [] } }));
    const rebase = url => { const u = new URL(url); return `${origin}${u.pathname}${u.search.replace('&export=json', '')}${u.hash}`; };
    const dataRequests = () => requests.filter(url => /selected-cause-rebuild-v1\/.+\.json\.gz/.test(url)).length;
    await page.addInitScript(() => {
      window.batchKeyboardEvents = [];
      for (const type of ['focusin', 'focusout', 'keydown', 'keyup', 'click', 'input', 'change']) document.addEventListener(type, event => {
        if (!event.target.closest?.('.smr-batch') && !['keydown', 'keyup'].includes(type)) return;
        window.batchKeyboardEvents.push({ type, key: event.key, target: event.target.closest('label')?.textContent?.trim() ?? event.target.tagName,
          active: document.activeElement?.closest('label')?.textContent?.trim() ?? document.activeElement?.tagName,
          checked: event.target.checked, documentFocus: document.hasFocus(), trusted: event.isTrusted, time: performance.now() });
        window.batchKeyboardEvents.splice(0, Math.max(0, window.batchKeyboardEvents.length - 60));
      }, true);
    });
    await page.goto(rebase(smrExportLink(base)));
    await page.bringToFront();
    await page.getByRole('button', { name: 'JSONで保存', exact: true }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'JSONで保存' && !button.disabled));
    assert(!requests.some(url => /assets\/SmrBatchExport-/.test(url)), 'Batch code is lazy');
    const beforeOpen = dataRequests();
    await page.getByText('複数の結果をまとめて保存', { exact: true }).click();
    const batch = page.locator('.smr-batch');
    await batch.getByRole('button', { name: '選んだ結果を準備', exact: true }).waitFor();
    assert.equal(dataRequests(), beforeOpen, 'Opening selectors must not fetch statistical data');
    const regions = batch.getByRole('group', { name: '保存する地域', exact: true });
    const causes = batch.getByRole('group', { name: '保存する死因', exact: true });
    const sexes = batch.getByRole('group', { name: '保存する性別', exact: true });
    const csvButton = batch.getByRole('button', { name: 'まとめてCSVで保存', exact: true });
    const jsonButton = batch.getByRole('button', { name: 'まとめてJSONで保存', exact: true });
    const prepare = batch.getByRole('button', { name: '選んだ結果を準備', exact: true });
    const download = async (format, label) => {
      const pending = page.waitForEvent('download'); await (format === 'csv' ? csvButton : jsonButton).click();
      const item = await pending, file = path.join(review, `${viewport.width}-batch-${label}.${format}`);
      await item.saveAs(file); return fs.readFileSync(file, 'utf8');
    };
    const assertParity = async payload => {
      assert.equal(payload.counts.requested, payload.records.length);
      for (const record of payload.records) {
        const s = record.selection, q = { ...base, basis: s.population_basis, datasetCode: s.cause_code,
          sex: s.sex, startYear: s.period.start_year, endYear: s.period.end_year, areaCode: s.region.code };
        if (s.cause_code === 'Se12' && s.sex !== '女') { assert.equal(record.result.standardized_mortality_ratio, null); continue; }
        const dataset = load(q.basis, q.datasetCode);
        const expected = s.region.unit === 'medical-area'
          ? aggregateMedicalArea(dataset, medicalAreas.find(area => area.code === s.region.code), q.sex, q.startYear, q.endYear)
          : await calculateArbitraryPeriodCase({ ...q, dataset });
        if (!expected?.complete) { assert.equal(record.result.status, 'unavailable'); assert.equal(record.result.observed_deaths, null); continue; }
        for (const [out, field] of Object.entries({ observed_deaths: 'observed', expected_deaths: 'expected', standardized_mortality_ratio: 'smr', ci95_lower: 'ci95Low', ci95_upper: 'ci95High' })) assert.equal(record.result[out], expected[field]);
      }
    };
    const waitForSelection = async (femaleSelected, count, requireFocus = true) => {
      try {
        await page.waitForFunction(({ femaleSelected, count, requireFocus }) => {
          const batch = document.querySelector('.smr-batch');
          const [male, female, total] = batch?.querySelectorAll('.smr-batch-sex input') ?? [];
          return male?.checked && female?.checked === femaleSelected && total?.checked === false
            && (!requireFocus || document.activeElement === female)
            && batch.querySelector('.smr-batch-count')?.textContent === `2地域 × 2死因 × ${femaleSelected ? 2 : 1}区分 ＝ ${count}件`;
        }, { femaleSelected, count, requireFocus }, { timeout: 5000 });
      } catch (error) {
        const diagnostic = await page.evaluate(() => ({ documentFocus: document.hasFocus(), active: document.activeElement?.outerHTML,
          count: document.querySelector('.smr-batch-count')?.textContent,
          sexes: [...document.querySelectorAll('.smr-batch-sex label')].map(label => ({ name: label.textContent.trim(), checked: label.querySelector('input').checked })),
          events: window.batchKeyboardEvents }));
        fs.writeFileSync(path.join(review, `${viewport.width}-batch-keyboard-failure.json`), JSON.stringify({ viewport, femaleSelected, count, diagnostic, errors }, null, 2));
        throw new Error(`Batch keyboard selection did not settle at ${viewport.width}px: ${JSON.stringify(diagnostic)}`, { cause: error });
      }
    };
    await regions.getByRole('checkbox', { name: '横手市', exact: true }).check();
    await causes.getByRole('checkbox', { name: '結核', exact: true }).check();
    // Settle both pointer selections before the native Space action focuses its target.
    await waitForSelection(false, 4, false);
    await sexes.getByRole('checkbox', { name: '女性', exact: true }).press('Space');
    await waitForSelection(true, 8);
    // Further Space presses must keep focus through React updates and toggle 8 -> 4 -> 8.
    await page.keyboard.press('Space'); await waitForSelection(false, 4);
    await page.keyboard.press('Space'); await waitForSelection(true, 8);
    const keyEvents = await page.evaluate(() => window.batchKeyboardEvents.filter(event => ['keydown', 'keyup'].includes(event.type)));
    assert.deepEqual(keyEvents.map(({ type, key, target, trusted }) => ({ type, key, target, trusted })),
      Array.from({ length: 3 }, () => ['keydown', 'keyup'].map(type => ({ type, key: ' ', target: '女性', trusted: true }))).flat());
    assert((await batch.locator('.smr-batch-count').textContent()).includes('8件'));
    assert(await jsonButton.isDisabled());
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/data/selected-cause-rebuild-v1/juki-Se01-2024-boundary.json.gz', async route => { await held; await route.continue(); });
    const causeRequest = page.waitForRequest('**/data/selected-cause-rebuild-v1/juki-Se01-2024-boundary.json.gz');
    const beforePrepare = dataRequests();
    await prepare.click(); await causeRequest;
    assert(await csvButton.isDisabled()); assert(await jsonButton.isDisabled());
    release(); await page.unroute('**/data/selected-cause-rebuild-v1/juki-Se01-2024-boundary.json.gz');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'まとめてJSONで保存' && !button.disabled));
    assert.equal(dataRequests(), beforePrepare + 1, 'Reuse current cause, fetch each extra cause once');
    const beforeSave = dataRequests();
    const payload = JSON.parse(await download('json', 'eight-results'));
    assert.deepEqual(payload.counts, { requested: 8, complete: 8, unavailable: 0 }); await assertParity(payload);
    const csv = await download('csv', 'eight-results');
    assert(csv.startsWith('\uFEFF')); assert.equal(csv.split('\r\n').length, 10);
    for (const record of payload.records) assert(csv.includes(`"${record.result.expected_deaths}"`));
    assert.equal(dataRequests(), beforeSave, 'Saving must not refetch');
    await batch.screenshot({ path: path.join(review, `${viewport.width}-batch-controls.png`) });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('body *')].map(element => ({ tag: element.tagName, cls: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).filter(element => element.right > window.innerWidth + 1 && typeof element.cls === 'string').slice(-25))));
    assert.equal(JSON.parse(await page.locator('[data-testid="smr-export-json"]').textContent()).selection.region.code, base.areaCode);

    await causes.getByRole('checkbox', { name: '子宮の悪性新生物＜腫瘍＞', exact: true }).check();
    assert(await jsonButton.isDisabled(), 'Changed selections invalidate prepared results immediately');
    let releaseNew;
    const heldNew = new Promise(resolve => { releaseNew = resolve; });
    await page.route('**/data/selected-cause-rebuild-v1/juki-Se12-2024-boundary.json.gz', async route => { await heldNew; await route.continue(); });
    const pendingNew = page.waitForRequest('**/data/selected-cause-rebuild-v1/juki-Se12-2024-boundary.json.gz');
    await prepare.click(); await pendingNew;
    await sexes.getByRole('checkbox', { name: '女性', exact: true }).uncheck();
    assert(await jsonButton.isDisabled());
    releaseNew(); await page.unroute('**/data/selected-cause-rebuild-v1/juki-Se12-2024-boundary.json.gz');
    await prepare.waitFor({ state: 'visible' });
    assert(await jsonButton.isDisabled(), 'Cancelled obsolete work cannot restore a stale download');
    await sexes.getByRole('checkbox', { name: '女性', exact: true }).check();
    await prepare.click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'まとめてJSONで保存' && !button.disabled));
    const missing = JSON.parse(await download('json', 'unavailable'));
    assert.deepEqual(missing.counts, { requested: 12, complete: 10, unavailable: 2 }); await assertParity(missing);
    assert((await download('csv', 'unavailable')).includes('"算定不可"'));
    await batch.getByText('算定できない組み合わせ（2件）', { exact: true }).click();
    assert((await batch.locator('.smr-batch-missing').textContent()).includes('女性を選択'));

    await batch.getByRole('button', { name: '画面の地域・死因・性別を選択', exact: true }).click();
    await batch.getByLabel('一括保存の地域単位').selectOption('prefecture');
    assert(await prepare.isDisabled());
    assert.equal(await regions.getByRole('checkbox').count(), 47);
    await regions.getByRole('checkbox', { name: '秋田県全体', exact: true }).check();
    await regions.getByRole('checkbox', { name: '埼玉県全体', exact: true }).check();
    await prepare.click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'まとめてJSONで保存' && !button.disabled));
    const prefectures = JSON.parse(await download('json', 'prefectures')); await assertParity(prefectures);
    assert.deepEqual(prefectures.selection.region_codes, ['05000', '11000']);

    await batch.getByLabel('一括保存の地域単位').selectOption('medical-area');
    await regions.getByRole('checkbox', { name: medicalAreas.find(area => area.code === '0504').name, exact: true }).check();
    await prepare.click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'まとめてJSONで保存' && !button.disabled));
    const medical = JSON.parse(await download('json', 'medical-area')); await assertParity(medical);
    assert.equal(medical.records[0].selection.region.unit, 'medical-area');
    assert(medical.records[0].provenance.constituent_municipalities.length > 0);

    const basis = page.locator('#standardized-mortality .control-grid label').filter({ hasText: /^人口方式/ }).locator('select');
    await basis.selectOption('census'); assert(await csvButton.isDisabled()); assert(await jsonButton.isDisabled());
    assert((await batch.locator('.smr-batch-condition').textContent()).includes('国勢調査基準人口'));
    assert.deepEqual(errors, []);
    reports.push({ viewport, input_mode: fixtureRoot ? 'local_ui_fixtures' : 'published_repository_data', combinations: 8,
      exact_existing_calculation_parity: true, csv_json_downloads: true, lazy_code_and_statistical_loading: true,
      current_dataset_reused: true, no_download_refetch: true, stale_and_cancelled_results_blocked: true,
      native_space_key_pairs: 3, keyboard_focus_and_sex_selection: true,
      unavailable_rows_preserved: true, prefecture_medical_area: true, csp: !!csp, horizontal_overflow: false });
    await context.close();
  }
  fs.writeFileSync(path.join(review, 'batch-verification.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify({ ok: true, cases: reports }, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
