import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const origin = process.env.PUBLICATION_ORIGIN;
const docs = {
  provenance: ['provenance.md', '原資料来歴監査'],
  inventory: ['inventory.md', 'データ構成一覧'],
  review: ['review-2026-08-24.md', '専門レビュー結果'],
  changelog: ['changelog.md', '更新履歴'],
};
const privatePaths = ['PROVENANCE_AUDIT.md', 'DATA_INVENTORY.md',
  'EXPERT_REVIEW_RESULT_2026-08-24.md', 'CHANGELOG.md'];
const publicPaths = ['transparency/index.html', 'transparency/document/index.html',
  'transparency/document/document.js', ...Object.values(docs).map(([file]) => `transparency/documents/${file}`)];
execFileSync(process.env.PYTHON || 'python3', [fileURLToPath(new URL('scripts/publication_checks.py', root)),
  '--private', ...privatePaths, '--public', ...publicPaths]);

async function content(path) {
  if (!origin) return readFile(new URL(path, root), 'utf8');
  const response = await fetch(new URL(path, origin));
  assert(response.ok, `${path}: ${response.status}`);
  return response.text();
}
const code = await content('transparency/document/document.js');
assert.equal(code, await readFile(new URL('source/public/transparency/document/document.js', root), 'utf8'));
for (const path of ['transparency/index.html', 'transparency/document/index.html',
  'transparency/document/document.css', ...publicPaths.filter(p => p.endsWith('.md'))]) {
  assert.equal(await content(path), await readFile(new URL(`source/public/${path}`, root), 'utf8'), `mirror: ${path}`);
}
const page = await content('transparency/index.html');
for (const key of Object.keys(docs)) assert(page.includes(`/transparency/document/?doc=${key}`));

async function view(key, failure) {
  const elements = Object.fromEntries(['doc-title', 'doc-description', 'doc-status', 'document', 'doc-error']
    .map(id => [id, { hidden: ['document', 'doc-error'].includes(id), textContent: '' }]));
  const requests = [];
  const document = { title: '', getElementById: id => elements[id] };
  let done = Promise.resolve();
  const context = vm.createContext({ URLSearchParams, TextDecoder,
    location: { search: `?doc=${encodeURIComponent(key)}` }, document,
    fetch: async (path, options) => {
      assert(publicPaths.includes(path.slice(1)), `Unreviewed request: ${path}`);
      assert.equal(options.credentials, 'same-origin');
      requests.push(path);
      let response;
      if (failure === 'network') throw new Error('offline');
      if (failure === 'html') response = new Response('<!doctype html><title>SPA fallback</title>', { headers: { 'Content-Type': 'text/html' } });
      else if (failure === 'empty') response = new Response('', { headers: { 'Content-Type': 'text/markdown' } });
      else if (failure === 'status') response = new Response('unavailable', { status: 503 });
      else if (origin) response = await fetch(new URL(path, origin));
      else response = new Response(await readFile(new URL(path.slice(1), root)), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
      done = response.clone().arrayBuffer();
      return response;
    } });
  vm.runInContext(code, context);
  for (let i = 0; i < 200 && !elements['doc-status'].hidden; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await done;
  assert(elements['doc-status'].hidden, 'Reader did not finish');
  return { elements, requests, document };
}

for (const [key, [file, title]] of Object.entries(docs)) {
  const { elements, requests, document } = await view(key);
  assert.deepEqual(requests, [`/transparency/documents/${file}`]);
  assert.equal(elements['doc-title'].textContent, title);
  assert(document.title.startsWith(title));
  assert(!elements.document.hidden && elements['doc-error'].hidden);
  assert.equal(elements.document.textContent, await readFile(new URL(`transparency/documents/${file}`, root), 'utf8'));
  assert(!/municipal-smr-master-data|ChatGPT Library|source\/|scripts\/|Version ID|次の作業/.test(elements.document.textContent));
}
for (const key of ['unknown', '__proto__', 'toString', '../../MAINTENANCE.md', '']) {
  const { elements, requests } = await view(key);
  assert.equal(requests.length, 0);
  assert(elements.document.hidden && !elements['doc-error'].hidden);
}
for (const failure of ['network', 'html', 'empty', 'status']) {
  const { elements } = await view('provenance', failure);
  assert(elements.document.hidden && !elements['doc-error'].hidden, failure);
  assert.equal(elements.document.textContent, '');
}
console.log(JSON.stringify({ pass: true, documents: 4, invalid_selections: 5, failure_modes: 4,
  source_mirrors: true, origin: origin || 'local', publication_decisions: true }));
