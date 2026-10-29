import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const distDir = new URL('../dist/', import.meta.url);
const assetsDir = new URL('./assets/', distDir);
const failures = [];
const checked = [];

const shellSources = [
  readFileSync(new URL('../index.html', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
];
const rankingContainerCount = shellSources.reduce(
  (total, source) => total + (source.match(/id=["']home-population-ranking["']/g) || []).length,
  0
);
checked.push(`home-population-ranking containers: ${rankingContainerCount}`);
if (rankingContainerCount !== 1) failures.push(`home-population-ranking container count: ${rankingContainerCount}`);

const indexPath = new URL('./index.html', distDir);
const indexHtml = readFileSync(indexPath, 'utf8');
for (const match of indexHtml.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)) {
  const file = match[1];
  checked.push(file);
  if (!existsSync(new URL(`./assets/${file}`, distDir))) failures.push(`index.html -> ${file}`);
}

for (const file of readdirSync(assetsDir).filter(name => name.endsWith('.js'))) {
  const source = readFileSync(new URL(`./assets/${file}`, distDir), 'utf8');
  for (const match of source.matchAll(/import\(\s*["'`]\.\/([^"'`]+)["'`]\s*\)/g)) {
    const imported = match[1];
    checked.push(`${file} -> ${imported}`);
    if (!existsSync(new URL(`./assets/${imported}`, distDir))) failures.push(`${file} -> ${imported}`);
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, checked }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checked }, null, 2));
