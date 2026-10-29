// Bounded release review: no rebuilds, regenerated data or unrelated suites.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const production = process.argv.includes('--production');
const root = resolve('..');
const out = resolve('ndb-dpc-ui-review', production ? 'production' : 'checkout');
await mkdir(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/octet-stream', '.geojson': 'application/geo+json' };
let server, browser, activePage;
let base = 'https://municipal-smr.jp';
const reports = [];
try {
  if (!production) {
    server = createServer(async (req, res) => {
      try {
        let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (pathname.endsWith('/')) pathname += 'index.html';
        const file = resolve(root, '.' + pathname);
        assert(file.startsWith(root + sep));
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(data);
      } catch { res.writeHead(404); res.end('Not found'); }
    });
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${server.address().port}`;
  } else {
    const paths = ['dpc/app.js', 'dpc/index.html', 'dpc/style.css', 'ndb/service-volume/index.html', 'ndb/service-volume/style.css'];
    let matched = false;
    for (let attempt = 0; attempt < 16 && !matched; attempt++) {
      matched = (await Promise.all(paths.map(async path => {
        const response = await fetch(`${base}/${path}?release-review=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
        return response.ok && Buffer.from(await response.arrayBuffer()).equals(await readFile(resolve(root, path)));
      }))).every(Boolean);
      if (!matched && attempt < 15) await new Promise(ok => setTimeout(ok, 15000));
    }
    assert(matched, 'Production has not published all five exact reviewed assets');
  }
  browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: 1 });
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const report = { width, base, production, checks: [] };
    const screenshot = async name => page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
    const noOverflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow at ${width}: ${page.url()}`);
    const shown = async selector => assert(await page.locator(selector).isVisible(), `${selector} not visible`);
    await page.goto(`${base}/ndb/service-volume/`, { waitUntil: 'networkidle' });
    await page.locator('#featured-detail h2').waitFor();
    await shown('#metric-wrap');
    await page.locator('#metric').selectOption('emergency_management');
    await page.locator('#metric').selectOption('stroke_hyperacute');
    await page.locator('[data-surface="all"]').click();
    await page.locator('#query').waitFor();
    assert.equal(await page.locator('#metric-wrap').isVisible(), false);
    await page.locator('#query').fill('訪問診療');
    await page.locator('#results button').first().waitFor();
    await page.locator('#results button').first().focus();
    await page.locator('#results button').first().press('Enter');
    await page.locator('#all-map-card .value').waitFor();
    report.ndb = await page.locator('#all-map-card .detail').innerText();
    assert.match(report.ndb, /秋田周辺/);
    await noOverflow();
    await screenshot('ndb-all');
    await page.locator('[data-year="2023"]').click();
    await page.waitForFunction(() => document.querySelector('#current-year-status').textContent.includes('令和5'));
    assert.equal(await page.locator('#metric-wrap').isVisible(), false);
    await page.locator('[data-surface="featured"]').click();
    await shown('#metric-wrap');
    await noOverflow();
    await screenshot('ndb-featured');
    report.checks.push('NDB representative selection, search Enter selection, year switch, hidden/restored metric control, no horizontal overflow');

    await page.goto(`${base}/dpc/`, { waitUntil: 'networkidle' });
    await page.locator('#area-detail h2').waitFor();
    await page.locator('#prefecture-select').selectOption('05');
    await page.locator('#area-detail h2').filter({ hasText: '秋田県全体' }).waitFor();
    assert.match(await page.locator('#area-detail .big-value').innerText(), /88,533件以上[\s\S]*1,140/);
    await page.locator('path.region[aria-label*="秋田周辺"]').click();
    await page.locator('#area-detail h2').filter({ hasText: '秋田周辺' }).waitFor();
    report.dpc = await page.locator('#area-detail .big-value').innerText();
    assert.match(report.dpc, /44,636件以上[\s\S]*475/);
    const layout = await page.locator('#area-detail').evaluate(el => {
      const r = el.getBoundingClientRect();
      const map = el.previousElementSibling.getBoundingClientRect();
      const value = el.querySelector('.big-value .count-value').getBoundingClientRect();
      const note = el.querySelector('.big-value .suppression-note').getBoundingClientRect();
      return { detailWidth: r.width, mapWidth: map.width, stacked: r.top >= map.bottom - 1, separateNote: note.top >= value.bottom - 1, noteFont: getComputedStyle(el.querySelector('.suppression-note')).fontSize };
    });
    assert(layout.separateNote, 'suppression note must be a separate line');
    if (width === 390) assert(layout.stacked, 'mobile map/detail must stack');
    else { assert(layout.detailWidth >= 360); assert(layout.mapWidth / layout.detailWidth > 1.7 && layout.mapWidth / layout.detailWidth < 2.1); }
    report.layout = layout;
    await noOverflow();
    await screenshot('dpc-area');
    await page.locator('#metric-select').selectOption('hospitalCount');
    assert.match(await page.locator('#area-detail .big-value').innerText(), /19施設/);
    await page.locator('#metric-select').selectOption('death24hPublished');
    await page.locator('path.region[aria-label*="北秋田"]').click();
    await page.locator('#area-detail h2').filter({ hasText: '北秋田' }).waitFor();
    const suppressed = (await page.locator('#area-detail .big-value').innerText()).replace(/\s+/g, '');
    assert.equal(suppressed, '数値公表なし（秘匿セル18／0件とは限りません）');
    await noOverflow();
    await screenshot('dpc-suppressed');
    await page.locator('#year-tabs [data-year="2023"]').click();
    await page.waitForFunction(() => document.querySelector('#current-year-status').textContent.includes('令和5'));
    report.checks.push('DPC prefecture/area counts, 19 facilities, lower-bound and fully suppressed wording, separate note, responsive layout, year switch, no horizontal overflow');
    assert.deepEqual(errors, []);
    reports.push(report);
    await writeFile(`${out}/report.json`, JSON.stringify({ completed: reports.length === 2, reports }, null, 2));
    await context.close();
  }
  assert.equal(reports[0].ndb, reports[1].ndb, 'NDB mobile/desktop values differ');
  assert.equal(reports[0].dpc, reports[1].dpc, 'DPC mobile/desktop values differ');
  console.log(JSON.stringify({ pass: true, reports }));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${out}/failure.txt`, String(error.stack));
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(ok => server.close(ok));
}
