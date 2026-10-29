import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function read(path) {
  return readFile(path, 'utf8');
}

async function write(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

function addJmdCard(source) {
  const definitionMarker = 'function TransparencyCard(){';
  const cardDefinition = 'function JmdFeatureCard(){return <aside className="panel transparency-card jmd-feature-card" aria-labelledby="jmd-feature-title"><p className="eyebrow">都道府県の死亡率</p><h2 id="jmd-feature-title" className="card-title">都道府県別 年齢調整死亡率（JMD）</h2><p className="card-copy">1979～2024年のJMD公表値を、全国地図・47都道府県ランキング・選択県と全国の経年推移で確認できます。</p><p className="card-copy">年齢調整死亡率（人口10万対）は、市町村別に表示している標準化死亡比（SMR）とは別の指標です。</p><a href="/jmd/"><strong>都道府県別の年齢調整死亡率を見る →</strong></a></aside>}\n';

  let next = source;
  if (!next.includes('function JmdFeatureCard(){')) {
    assert(next.includes(definitionMarker), 'TransparencyCard definition marker not found');
    next = next.replace(definitionMarker, cardDefinition + definitionMarker);
  }

  if (!/<JmdFeatureCard\s*\/>/.test(next)) {
    const renderMarker = /<TransparencyCard\s*\/>/;
    assert(renderMarker.test(next), 'TransparencyCard render marker not found');
    next = next.replace(renderMarker, '<JmdFeatureCard/><TransparencyCard/>');
  }

  assert.equal((next.match(/href="\/jmd\/"/g) || []).length, 1, 'Expected one JMD link in main source');
  return next;
}

function addSitemapEntry(source) {
  const loc = 'https://municipal-smr.jp/jmd/';
  if (source.includes(`<loc>${loc}</loc>`)) return source;
  assert(source.includes('</urlset>'), 'sitemap closing tag not found');
  return source.replace(
    '</urlset>',
    `  <url><loc>${loc}</loc><lastmod>2026-08-27</lastmod></url>\n</urlset>`
  );
}

function addJmdMetadata(source) {
  const description = '日本版死亡データベース（JMD）の都道府県別年齢調整死亡率を、全国地図・ランキング・経年推移で確認できます。';
  const descriptionTag = `<meta name="description" content="${description}">`;
  const metadata = `${descriptionTag}\n  <meta name="robots" content="index,follow,max-image-preview:large">\n  <link rel="canonical" href="https://municipal-smr.jp/jmd/">\n  <meta property="og:type" content="website">\n  <meta property="og:locale" content="ja_JP">\n  <meta property="og:site_name" content="全国市町村別標準化死亡比">\n  <meta property="og:title" content="都道府県別 年齢調整死亡率（JMD）">\n  <meta property="og:description" content="${description}">\n  <meta property="og:url" content="https://municipal-smr.jp/jmd/">\n  <meta property="og:image" content="https://municipal-smr.jp/assets/og-municipal-smr.png">\n  <meta property="og:image:width" content="1730">\n  <meta property="og:image:height" content="909">\n  <meta name="twitter:card" content="summary_large_image">\n  <meta name="twitter:title" content="都道府県別 年齢調整死亡率（JMD）">\n  <meta name="twitter:description" content="${description}">\n  <meta name="twitter:image" content="https://municipal-smr.jp/assets/og-municipal-smr.png">`;

  let next = source;
  if (!next.includes('rel="canonical" href="https://municipal-smr.jp/jmd/"')) {
    assert(next.includes(descriptionTag), 'JMD description marker not found');
    next = next.replace(descriptionTag, metadata);
  }

  if (!next.includes('itemtype="https://schema.org/WebApplication"')) {
    const mainMarker = '<main class="wrap">';
    const structuredMain = `<main class="wrap" itemscope itemtype="https://schema.org/WebApplication">\n    <meta itemprop="url" content="https://municipal-smr.jp/jmd/">\n    <meta itemprop="name" content="都道府県別 年齢調整死亡率（JMD）">\n    <meta itemprop="description" content="${description}">\n    <meta itemprop="applicationCategory" content="HealthApplication">\n    <meta itemprop="operatingSystem" content="Web">`;
    assert(next.includes(mainMarker), 'JMD main marker not found');
    next = next.replace(mainMarker, structuredMain);
  }

  assert(next.includes('rel="canonical" href="https://municipal-smr.jp/jmd/"'));
  assert(next.includes('property="og:title" content="都道府県別 年齢調整死亡率（JMD）"'));
  assert(next.includes('name="twitter:card" content="summary_large_image"'));
  assert(next.includes('itemtype="https://schema.org/WebApplication"'));
  return next;
}

async function patchPackageJson() {
  const path = resolve(repoRoot, 'source/package.json');
  const pkg = JSON.parse(await read(path));
  const testScript = pkg.scripts?.test;
  assert.equal(typeof testScript, 'string', 'source/package.json scripts.test missing');
  if (!testScript.includes('jmd-discoverability-test.mjs')) {
    pkg.scripts.test = `${testScript} && node scripts/jmd-discoverability-test.mjs`;
  }
  await write(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function syncStaticFile(relativePath, transform) {
  const rootPath = resolve(repoRoot, relativePath);
  assert(await exists(rootPath), `${relativePath} not found`);
  const updated = transform(await read(rootPath));
  await write(rootPath, updated);

  const publicPath = resolve(repoRoot, 'source/public', relativePath);
  if (await exists(publicPath)) {
    await write(publicPath, transform(await read(publicPath)));
  } else {
    await write(publicPath, updated);
  }
}

const mainPath = resolve(repoRoot, 'source/src/main.jsx');
await write(mainPath, addJmdCard(await read(mainPath)));
await syncStaticFile('sitemap.xml', addSitemapEntry);
await syncStaticFile('jmd/index.html', addJmdMetadata);
await patchPackageJson();

const testPath = resolve(repoRoot, 'source/scripts/jmd-discoverability-test.mjs');
const testSource = `import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport { dirname, resolve } from 'node:path';\nimport { fileURLToPath } from 'node:url';\n\nconst here=dirname(fileURLToPath(import.meta.url));\nconst root=resolve(here,'../..');\nconst read=path=>readFile(resolve(root,path),'utf8');\nconst count=(text,needle)=>text.split(needle).length-1;\n\nconst [main,sitemap,jmd,publicSitemap,publicJmd]=await Promise.all([\n  read('source/src/main.jsx'),\n  read('sitemap.xml'),\n  read('jmd/index.html'),\n  read('source/public/sitemap.xml'),\n  read('source/public/jmd/index.html')\n]);\n\nassert(main.includes('function JmdFeatureCard(){'),'JMD feature card definition missing');\nassert(/<JmdFeatureCard\\s*\\/>/.test(main),'JMD feature card not rendered');\nassert.equal(count(main,'href=\\"/jmd/\\"'),1,'main page must contain exactly one JMD link');\nfor(const [label,text] of [['sitemap',sitemap],['public sitemap',publicSitemap]]){\n  assert.equal(count(text,'<loc>https://municipal-smr.jp/jmd/</loc>'),1,\\\`${label}: JMD URL missing or duplicated\\\`);\n}\nfor(const [label,text] of [['JMD page',jmd],['public JMD page',publicJmd]]){\n  assert(text.includes('rel=\\"canonical\\" href=\\"https://municipal-smr.jp/jmd/\\"'),\\\`${label}: canonical missing\\\`);\n  assert(text.includes('property=\\"og:title\\" content=\\"都道府県別 年齢調整死亡率（JMD）\\"'),\\\`${label}: OGP missing\\\`);\n  assert(text.includes('name=\\"twitter:card\\" content=\\"summary_large_image\\"'),\\\`${label}: Twitter card missing\\\`);\n  assert(text.includes('itemtype=\\"https://schema.org/WebApplication\\"'),\\\`${label}: microdata missing\\\`);\n  assert(!/<style\\b/i.test(text),\\\`${label}: inline style block introduced\\\`);\n  assert(!/<script(?![^>]*\\bsrc=)[^>]*>/i.test(text),\\\`${label}: inline script introduced\\\`);\n  assert(!/\\sstyle\\s*=/i.test(text),\\\`${label}: inline style attribute introduced\\\`);\n}\nconsole.log(JSON.stringify({pass:true,jmdLink:true,sitemap:true,canonical:true,ogp:true,twitter:true,microdata:true}));\n`;
await write(testPath, testSource);

for (const relative of [
  'source/scripts/_probe.txt',
  'source/scripts/_probe2.txt',
  'source/scripts/_probe3.txt',
  'source/scripts/_temporary_probe_remove_me.txt',
  'source/scripts/_temporary_probe_remove_me2.txt',
  'source/scripts/_temporary_probe_remove_me3.txt',
  'source/scripts/_temporary_probe_remove_me4.txt',
  '.github/workflows/test-nonexistent.yml'
]) {
  await rm(resolve(repoRoot, relative), { force: true });
}

console.log(JSON.stringify({
  pass: true,
  updated: [
    'source/src/main.jsx',
    'sitemap.xml',
    'source/public/sitemap.xml',
    'jmd/index.html',
    'source/public/jmd/index.html',
    'source/package.json',
    'source/scripts/jmd-discoverability-test.mjs'
  ]
}));
