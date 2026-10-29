import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import worker from '../../smr-json-worker.mjs';

const root = new URL('../../', import.meta.url);
const config = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('smr-json/v1/index.json', root), 'utf8'));
const paths = ['/smr-json/v1/index.json', ...catalog.results.map(item => new URL(item.url).pathname)];
assert.equal(config.main, 'smr-json-worker.mjs');
assert.equal(config.assets.directory, './');
assert.equal(config.assets.binding, 'ASSETS');
assert.equal(config.assets.not_found_handling, 'single-page-application');
assert.deepEqual(config.assets.run_worker_first, ['/smr-json', '/smr-json/*', ...paths.map(path => `!${path}`)],
  'Only unpublished SMR paths may run first; every cataloged JSON must remain a static asset');
// Evaluate actual publication decisions; policy spelling is not the contract.
execFileSync(process.env.PYTHON || 'python3', [fileURLToPath(new URL('scripts/publication_checks.py', root)),
  '--private', 'smr-json-worker.mjs', 'wrangler.jsonc', 'smr-json/v1/not-published.json',
  '--public', ...paths.map(path => path.slice(1))], { stdio: 'pipe' });

const assets = new Map(await Promise.all(paths.map(async path => [path, await readFile(new URL(path.slice(1), root))])));
let assetCalls = 0;
const env = { ASSETS: { async fetch() {
  assetCalls++;
  return new Response('<!doctype html><title>existing SPA</title>', { headers: { 'Content-Type': 'text/html' } });
} } };
const unknown = [
  '/smr-json', '/smr-json/', '/smr-json/v1/not-published.json',
  '/smr-json/v1/juki/Se00/female/2020-2024/05201.json',
  '/smr-json/v1/juki/Se00/male/2020-2024/05202.json',
  '/smr-json/v1/census/Se00/male/2020-2024/05201.json',
  '/smr-json/v1/juki/Se00/male/2019-2024/05201.json',
];
for (const path of unknown) for (const method of ['GET', 'HEAD']) {
  const response = await worker.fetch(new Request(`https://municipal-smr.jp${path}`, { method }), env);
  assert.equal(response.status, 404);
  assert(response.headers.get('Content-Type').startsWith('application/json'));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=86400');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  if (method === 'HEAD') assert.equal(await response.text(), '');
  else {
    const body = await response.json();
    assert.equal(body.status, 'not_published');
    assert.equal(body.catalog_url, 'https://municipal-smr.jp/smr-json/v1/index.json');
    assert(!('result' in body) && !('selection' in body), 'An unpublished condition cannot expose a result');
  }
}
assert.equal(assetCalls, 0, 'Unpublished paths do not load the SPA or statistical inputs');
for (const path of ['/', '/?area=05201', '/school-dental/', '/some-existing-spa-path']) {
  const response = await worker.fetch(new Request(`https://municipal-smr.jp${path}`), env);
  assert.equal(response.status, 200);
  assert((await response.text()).includes('existing SPA'));
}

// HTTP harness follows the verified selective routing config; deployment is checked separately.
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    const bytes = assets.get(url.pathname);
    const result = bytes ? new Response(request.method === 'HEAD' ? null : bytes,
      { headers: { 'Content-Type': 'application/json' } })
      : await worker.fetch(new Request(url, { method: request.method, headers: request.headers }), env);
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of paths) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), assets.get(path).toString('utf8'));
  }
  for (const path of unknown) for (const headers of [{ Accept: 'application/json' },
    { Accept: 'text/html', 'Sec-Fetch-Mode': 'navigate' }]) {
    const response = await fetch(`${origin}${path}`, { headers });
    assert.equal(response.status, 404);
    assert(response.headers.get('Content-Type').startsWith('application/json'));
    assert.equal((await response.json()).status, 'not_published');
  }
  const response = await fetch(`${origin}${paths[1]}?sex=female`);
  assert.equal((await response.json()).selection.sex, '男');
} finally { await new Promise(resolve => server.close(resolve)); }
console.log(JSON.stringify({ pass: true, published_asset_paths: paths, unpublished_404_cases: unknown.length,
  checks: ['catalog_route_exclusions', 'published_bytes_unchanged', '404_json_not_html', 'head_no_body',
    'no_unknown_asset_fetch', 'unchanged_spa_fallback', 'query_does_not_change_selection', 'navigation_and_json_accept'] }));

