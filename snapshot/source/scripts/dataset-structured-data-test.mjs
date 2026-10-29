import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "..");
const pages = ["jmd/index.html", "life-expectancy/index.html"];

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  if (!html.includes('itemtype="https://schema.org/Dataset"')) {
    throw new Error(`${page}: Dataset markup is missing`);
  }
  if (!html.includes('itemprop="creator" itemscope itemtype="https://schema.org/Organization"')) {
    throw new Error(`${page}: creator must be an Organization object`);
  }
  if (!html.includes('itemprop="license" itemscope itemtype="https://schema.org/CreativeWork"')) {
    throw new Error(`${page}: license must be a CreativeWork object`);
  }
  if (!html.includes('href="https://municipal-smr.jp/data-use/"')) {
    throw new Error(`${page}: canonical license URL is missing`);
  }
  if (/itemprop="creator"\s+content=/.test(html)) {
    throw new Error(`${page}: invalid text-only creator remains`);
  }
}

for (const page of ["data-use/index.html", "source/public/data-use/index.html"]) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  for (const required of ["公的統計・原資料", "本サイト独自の集計・計算結果", "無保証・非公式性"]) {
    if (!html.includes(required)) throw new Error(`${page}: missing ${required}`);
  }
}

console.log("Dataset structured data and license page: PASS");
