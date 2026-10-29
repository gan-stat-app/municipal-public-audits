import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('..');
const review = resolve('map-display-review');
await mkdir(review, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let path = new URL(req.url, 'http://localhost').pathname;
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) throw Error('outside root');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/json' })[extname(file)] || 'application/octet-stream', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(ok => server.listen(4198, '127.0.0.1', ok));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const [route, selector, count] of [['cancer-screening', '#map', 47], ['dpc', '#area-map', 335]]) {
      await page.goto(`http://127.0.0.1:4198/${route}/`);
      await page.waitForFunction(({ selector, count }) => document.querySelectorAll(`${selector} path`).length === count, { selector, count });
      await page.waitForFunction(selector => document.querySelector(selector).getAttribute('viewBox')?.split(' ').length === 4, selector);
      const svg = page.locator(selector);
      await svg.scrollIntoViewIfNeeded();
      const initial = await svg.getAttribute('viewBox');
      assert(await svg.locator('path').evaluateAll(paths => paths.every(p => p.getAttribute('vector-effect') === 'non-scaling-stroke')));
      await page.locator('[data-map-zoom="in"]').click();
      assert.notEqual(await svg.getAttribute('viewBox'), initial);
      assert.equal(await svg.evaluate(el => el.classList.contains('map-zoomed')), true);
      const zoomed = await svg.getAttribute('viewBox');
      const box = await svg.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20, { steps: 4 });
      await page.mouse.up();
      assert.notEqual(await svg.getAttribute('viewBox'), zoomed, 'drag should pan the magnified map');
      await page.locator('[data-map-zoom="reset"]').click();
      assert.equal(await svg.getAttribute('viewBox'), initial);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route}: mobile overflow`);
      await page.locator(route === 'dpc' ? '.map-layout' : '.map-card').screenshot({ path: `${review}/${route}-${width}.png` });
      if (route === 'cancer-screening') {
        await page.selectOption('#pref', '沖縄県');
        await page.locator('#map-focus').click();
        assert.notEqual(await svg.getAttribute('viewBox'), initial);
        assert.match(await page.locator('#selectedLabel').textContent(), /沖縄県/);
        await page.locator('[data-map-zoom="reset"]').click();
      } else {
        await page.selectOption('#prefecture-select', '05');
        await page.waitForFunction(() => document.querySelectorAll('#area-map path').length < 335);
        await page.locator('#area-map path').first().focus();
        await page.keyboard.press('Enter');
        await page.locator('#area-map .selected').waitFor();
        await page.locator('#national-button').click();
        await page.waitForFunction(() => document.querySelectorAll('#area-map path').length === 335);
      }
    }
    await page.goto('http://127.0.0.1:4198/facility-standards/');
    assert(await page.evaluate(() => !!(document.querySelector('[aria-labelledby="search-title"]').compareDocumentPosition(document.querySelector('[aria-labelledby="coverage-title"]')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    await page.locator('#facility-query').waitFor();
    await page.screenshot({ path: `${review}/facility-${width}.png` });
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: 47 prefectures, 335 medical areas, zoom/reset, Okinawa focus, keyboard selection, search-first order, desktop/mobile and strict CSP');
} finally { await browser.close(); await new Promise(ok => server.close(ok)); }
