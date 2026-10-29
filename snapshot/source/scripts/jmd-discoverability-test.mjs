import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceRoot=resolve('.');
const repositoryRoot=resolve('..');
const read=path=>readFile(path,'utf8');

const [
  sourceIndex,
  productionIndex,
  sourceCardCss,
  productionCardCss,
  jmdIndex,
  sourceSitemap,
  productionSitemap,
  sourceRobots,
  productionRobots,
  sourceHeaders,
  productionHeaders
]=await Promise.all([
  read(resolve(sourceRoot,'index.html')),
  read(resolve(repositoryRoot,'index.html')),
  read(resolve(sourceRoot,'public/home-portal-v1.css')),
  read(resolve(repositoryRoot,'home-portal-v1.css')),
  read(resolve(repositoryRoot,'jmd/index.html')),
  read(resolve(sourceRoot,'public/sitemap.xml')),
  read(resolve(repositoryRoot,'sitemap.xml')),
  read(resolve(sourceRoot,'public/robots.txt')),
  read(resolve(repositoryRoot,'robots.txt')),
  read(resolve(sourceRoot,'public/_headers')),
  read(resolve(repositoryRoot,'_headers'))
]);

const [jmdApp,jmdCss]=await Promise.all([
  read(resolve(repositoryRoot,'jmd/app.js')),
  read(resolve(repositoryRoot,'jmd/style.css'))
]);

const unexplainedMortalityPattern=/(^|[^A-Za-z])(SMR|ASDR)(?=$|[^A-Za-z])/;
const checkTopPage=(html,label)=>{
  assert(/href="\/home-portal-v1\.css(?:\?v=\d+)?"/.test(html),`${label}: entry stylesheet missing`);
  assert(html.includes('class="data-portal"'),`${label}: data portal missing`);
  assert(html.includes('id="portal-population-link"')&&html.includes('人口ピラミッドと、人口実績・将来推計を見る'),`${label}: population entry missing`);
  assert(html.includes('id="portal-smr-link"')&&html.includes('期間・性別・死因・人口方式を選んで調べる'),`${label}: arbitrary-period SMR entry missing`);
  assert(html.includes('id="jmd-entry-title"'),`${label}: entry title missing`);
  assert(html.includes('href="/jmd/"'),`${label}: entry link missing`);
  assert(html.includes('人口ピラミッド × 地域保健データラボ'),`${label}: site brand missing`);
  assert(html.includes('年齢調整死亡率'),`${label}: entry label missing`);
  assert(html.includes('年齢調整死亡率'),`${label}: mortality rate entry missing`);
  assert(html.includes('平均寿命'),`${label}: life expectancy entry missing`);
  assert(html.includes('生活習慣・栄養・身体活動'),`${label}: lifestyle entry missing`);
  assert(html.includes('介護保険地域比較'),`${label}: care entry missing`);
  assert(html.includes('子どもの歯・視力・体格'),`${label}: school health entry missing`);
  // A navigation link alone does not preserve the card entry after rebuilding.
  const cards=[...html.matchAll(/<a\b[^>]*class="(?:primary|secondary)-entry\b[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map(match=>match[0]);
  const cardHrefs=cards.map(card=>card.match(/href="([^"]+)"/)?.[1]);
  for(const route of ['/food-poisoning/','/mental-health/','/age-specific-mortality/','/cancer-screening/','/facility-standards/']){
    assert.equal(cardHrefs.filter(href=>href===route).length,1,`${label}: missing or duplicate home card ${route}`);
  }
  assert.equal(new Set(cardHrefs).size,cards.length,`${label}: duplicate home card target`);
  assert.equal(Number(html.match(/class="portal-unit">(\d+)機能を一覧表示/)?.[1]),cards.length,`${label}: displayed feature count differs from cards`);
  assert(!unexplainedMortalityPattern.test(html),`${label}: unexplained public abbreviation remains`);
};

checkTopPage(sourceIndex,'source index');
checkTopPage(productionIndex,'production index');
assert(sourceIndex.includes('<title>人口ピラミッド × 地域保健データラボ｜任意期間標準化死亡比・地域統計</title>'),'source brand title missing');
assert(productionIndex.includes('<title>人口ピラミッド × 地域保健データラボ｜任意期間標準化死亡比・地域統計</title>'),'production brand title missing');
assert.equal(sourceCardCss,productionCardCss,'entry CSS differs between source and production');
assert(sourceCardCss.includes('@media(max-width:600px)'), 'entry CSS mobile rule missing');
assert(sourceCardCss.includes(':focus-visible'), 'entry CSS focus style missing');

assert(jmdIndex.includes('<title>都道府県別 年齢調整死亡率｜5分類・372死因・死因群</title>'),'plain-language title missing');
assert(jmdIndex.includes('<link rel="canonical" href="https://municipal-smr.jp/jmd/">'),'canonical missing');
assert(jmdIndex.includes('<meta property="og:url" content="https://municipal-smr.jp/jmd/">'),'OGP URL missing');
assert(jmdIndex.includes('<meta name="twitter:card" content="summary_large_image">'),'Twitter card missing');
assert(jmdIndex.includes('itemscope itemtype="https://schema.org/Dataset"'),'Dataset microdata missing');
assert(jmdIndex.includes('itemprop="temporalCoverage" content="1950/2024"'),'temporal coverage missing');
assert(jmdIndex.includes('itemprop="spatialCoverage" content="日本・47都道府県"'),'spatial coverage missing');
assert(jmdIndex.includes('JMD（日本版死亡データベース）'),'JMD expansion missing');
assert(jmdIndex.includes('HCD（Human Cause-of-Death Database）'),'HCD expansion missing');
assert(!unexplainedMortalityPattern.test(jmdIndex),'public age-adjusted mortality HTML contains an unexplained abbreviation');
assert(!/<style\b/i.test(jmdIndex),'inline style block introduced');
assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(jmdIndex),'inline script introduced');
assert(!/\sstyle\s*=/i.test(jmdIndex),'inline style attribute introduced');
for(const id of ['resultContext','cancerComparisonCard','cancerComparisonTitle','mapTitle','trendTitle','rankingTitle'])assert(jmdIndex.includes(`id="${id}"`),`dynamic JMD context target missing: ${id}`);
assert(jmdIndex.includes('id="cancerComparisonCard" hidden'),'cancer comparison must start hidden until a cancer cause is confirmed');
assert(jmdApp.includes("cancerComparisonCardEl.hidden=!cancerSelected"),'non-cancer causes must hide the cancer-site comparison');
assert(jmdApp.includes("item.cause===cause?'cancer-selected':''"),'selected cancer site must be highlighted');
assert(jmdApp.includes('表示中：${causeLabel}／${sexLabel}／${year}年／${prefectureLabel}'),'selected result context must include cause, sex, year, and prefecture');
for(const target of ['mapTitleEl.textContent','trendTitleEl.textContent','rankingTitleEl.textContent'])assert(jmdApp.includes(target),`dynamic result heading missing: ${target}`);
assert(jmdCss.includes('.cancer-row.cancer-selected')&&jmdCss.includes('.result-context'),'dynamic context styling missing');
for(const id of ['causeProfileCard','causeProfileToggle','causeProfileBody','causeProfileSummary','causeProfileList','mapContext','rankingContext'])assert(jmdIndex.includes(`id="${id}"`),`JMD region-high explorer target missing: ${id}`);
for(const text of ['全国比120以上','全国比100超','統計的な有意差を示すものではありません','死因・死因群には親子関係や重複'])assert(jmdIndex.includes(text),`JMD region-high explorer explanation missing: ${text}`);
for(const marker of ['function causeProfileRows()','function drawCauseProfile()',"causeProfileFilter='above'","slice(0,50)","document.querySelector('#mapCard').scrollIntoView"])assert(jmdApp.includes(marker),`JMD region-high explorer behavior missing: ${marker}`);
assert(jmdApp.includes("mapContextEl.textContent=sectionContext")&&jmdApp.includes("rankingContextEl.textContent=sectionContext"),'map and ranking must repeat the current conditions');
assert(jmdCss.includes('.cause-profile-row')&&jmdCss.includes('.section-context'),'JMD region-high explorer styling missing');

for(const id of ['trendProfileCard','trendProfileToggle','trendProfileBody','trendProfileSummary','trendProfileList','trendCard'])assert(jmdIndex.includes(`id="${id}"`),`JMD five-year change target missing: ${id}`);
for(const text of ['直近5年平均','増加した死因','減少した死因','低率・変動注意','両期間で各5年すべて'])assert(jmdIndex.includes(text),`JMD five-year change explanation missing: ${text}`);
for(const marker of ['function trendComparisonPeriod()','function trendProfileRows()','function drawTrendProfile()',"trendProfileFilter='increase'","previousYears.length!==5||recentYears.length!==5","slice(0,50)","document.querySelector('#trendCard').scrollIntoView"])assert(jmdApp.includes(marker),`JMD five-year change behavior missing: ${marker}`);
assert(jmdCss.includes('.trend-change-up')&&jmdCss.includes('.trend-low-note'),'JMD five-year change styling missing');


const jmdSitemapMatches=productionSitemap.match(/<loc>https:\/\/municipal-smr\.jp\/jmd\/<\/loc>/g)||[];
assert.equal(jmdSitemapMatches.length,1,'sitemap entry must appear exactly once');
assert.equal(sourceSitemap,productionSitemap,'sitemap differs between source and production');
assert.equal(sourceRobots,productionRobots,'robots.txt differs between source and production');
assert(productionRobots.includes('Sitemap: https://municipal-smr.jp/sitemap.xml'),'robots sitemap reference missing');
assert.equal(sourceHeaders,productionHeaders,'_headers differs between source and production');
assert(/\/jmd\/\*[\s\S]*no-transform/.test(productionHeaders),'no-transform header missing');
assert(/\n\/\n\s+Cache-Control: no-cache, no-store, must-revalidate, no-transform/.test(productionHeaders),'top-page no-transform header missing');

console.log(JSON.stringify({
  pass:true,
  topPageCard:true,
  plainLanguage:true,
  canonical:true,
  socialMetadata:true,
  datasetMicrodata:true,
  sitemap:true,
  robots:true,
  sourceProductionParity:true,
  strictCspPreserved:true
}));
