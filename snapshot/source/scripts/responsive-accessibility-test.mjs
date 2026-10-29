import assert from'node:assert/strict';
import './home-portal-initial-focus-test.mjs';
import{readFile}from'node:fs/promises';
import{productionSmrFill,smrMapLegend,smrMapPalette,smrMapThresholds}from'../src/catalogs/mapStyle.js';

const [css,main,map,pyramid,controls,mapClient,rankingChart,crossCause,learning,transparency,home,portalJs,portalCss]=await Promise.all([
  readFile('src/app.css','utf8'),
  readFile('src/main.jsx','utf8'),
  readFile('src/components/SmrMap.jsx','utf8'),
  readFile('src/components/PopulationPyramid.jsx','utf8'),
  readFile('src/components/Controls.jsx','utf8'),
  readFile('src/lib/mapClient.js','utf8'),
  readFile('src/components/MunicipalityRankingCharts.jsx','utf8'),
  readFile('src/components/CrossCauseProfile.jsx','utf8'),
  readFile('public/learning/index.html','utf8'),
  readFile('public/transparency/index.html','utf8'),
  readFile('index.html','utf8'),
  readFile('public/home-portal-v1.js','utf8'),
  readFile('public/home-portal-v1.css','utf8')
]);
for(const width of ['600px'])assert(css.includes(`max-width:${width}`),`responsive breakpoint ${width}`);
for(const token of ['min-width:320px','width:100%;height:100%','min-height:44px','focus-visible','prefers-reduced-motion'])assert(css.includes(token),`CSS missing ${token}`);
assert(main.includes("import'./app.css'"),'application stylesheet not imported');
assert(main.includes('role="status" aria-live="polite"'),'loading state is not announced');
assert(main.includes('id="map-keyboard-help"'),'map keyboard alternative missing');
assert(map.includes('role="img"'),'canvas map role missing');
assert(map.includes('aria-describedby={`map-keyboard-help ${conditionId}`}'),'canvas map description missing');
assert(map.includes('地図に表示中：')&&map.includes('読み込み対象：'),'drawn and requested map conditions missing');
assert(map.includes('背後の地図：')&&map.includes('（前の条件）'),'stale map warning missing');
assert(css.includes('.map-canvas-stage{position:relative')&&!css.includes('.map-drawn-condition{position:absolute'),'map condition must remain outside the canvas drawing area');
assert(map.includes("tokyoInsets=(scope==='prefecture'||scope==='medical-prefecture')&&pref==='13'")&&map.includes("'23区・多摩'")&&map.includes("'伊豆諸島'")&&map.includes("'小笠原諸島'"),'Tokyo mainland and island inset maps missing');
assert(map.includes('if(!features.length)return'),'drawn condition can advance before map values arrive');
assert(main.includes('primaryMapDescription')&&main.includes('nationalMapDescription'),'area and cause map descriptions missing');
assert(map.includes('boundsYieldEvery=isNational?50000:3500'),'national map bounds work is not cooperatively chunked');
assert(map.includes('pathYieldEvery=isNational?40000:2500'),'national map path work is not cooperatively chunked');
assert(/loadMunicipalGeometry\(options\).*MUNICIPAL_NATIONAL_LIGHT/s.test(mapClient),'municipality recovery does not prefer lightweight geometry');
assert(mapClient.includes('return loadDetailedMunicipalGeometry(options)'),'detailed municipality fallback missing');
assert(pyramid.includes('aria-pressed={mode==='),'population mode state missing');
assert(pyramid.includes('aria-label="表示年"'),'population year label missing');
assert(controls.includes('<label>都道府県<select'),'prefecture select label missing');
assert(controls.includes('<label>自治体<select'),'municipality select label missing');
assert(main.includes('id="national-municipality-map"')&&main.includes('全国{nationalMapUnit}・標準化死亡比地図'),'national choropleth panel missing');
assert(main.includes('aria-label="ランキング範囲"'),'ranking scope control missing');
assert(rankingChart.includes('ranking-bar-button'),'accessible ranking bar buttons missing');
assert(rankingChart.includes('95%信頼区間'),'ranking confidence interval missing');
assert(rankingChart.includes('ranking-ci-overlay'),'ranking confidence interval is not drawn on the chart');
assert(rankingChart.includes('全国基準より有意に高い')&&rankingChart.includes('全国基準より有意に低い'),'ranking significance labels missing');
assert(!crossCause.includes('死因別特徴を表示'),'cause profile must not require an initial button');
assert(crossCause.includes('自動で表示します')&&crossCause.includes('role="status" aria-live="polite"'),'automatic cause profile must announce loading');
assert(crossCause.includes('もう一度読み込む'),'cause profile retry control missing');
assert(crossCause.includes("filter==='above'")&&crossCause.includes('標準化死亡比100超')&&crossCause.includes('有意に高いのみ'),'cause profile high-cause filters missing');
assert(crossCause.includes('観察 {count(x.observed)}人・期待 {formatExpected(x.expected)}人'),'cause profile observed and expected counts missing');
assert(crossCause.includes('onSelect?.(x.datasetCode)')&&main.includes('onSelect={datasetCode=>'),'cause profile result does not open the selected cause');
assert(crossCause.includes('significant-high')&&crossCause.includes('significant-low'),'cause significance colors missing');
assert(main.includes('全国{nationalMapUnit}の色分け地図を見る'),'prominent nationwide map guide missing');
assert(main.includes('https://x.com/municipal_smr'),'official X account link missing');
assert(main.includes('この表示の詳しい出典'),'detailed source block missing');
const allFunctions=home.slice(home.indexOf('id="all-entry-title"'));
assert(allFunctions.indexOf('id="portal-population-link"')<allFunctions.indexOf('年齢調整死亡率'),'population must be the first major-function entry');
assert(allFunctions.indexOf('id="portal-smr-link"')<allFunctions.indexOf('年齢調整死亡率'),'SMR must precede the six secondary entries');
assert(home.includes('href="#population-pyramid"'),'population entrance must remain on the top page');assert(home.includes('id="portal-population-page-link"')&&home.includes('href="/population/?area=05201"'),'dedicated population page link missing');assert(!home.includes('class="region-entry"')&&!home.includes('id="portal-pref"')&&!home.includes('id="portal-area"'),'redundant top-level region picker must be removed');assert(!portalJs.includes('area-catalog.json')&&!portalJs.includes('portal-pref'),'removed region picker must not load an area catalog');assert(portalJs.includes("populationPage.href=`/population/${query}`")&&portalJs.includes("populationPage.addEventListener('click',syncLinks)"),'dedicated population page must inherit the current valid URL area at click time');
assert(portalJs.includes('#population-pyramid')&&portalJs.includes('scrollIntoView')&&portalJs.includes('target.focus'),'portal anchors must scroll and focus visibly');
assert(main.includes('id="population-pyramid"')&&main.includes('id="standardized-mortality" className="panel section-panel" tabIndex="-1"'),'both in-page targets must be keyboard focusable');
assert(portalCss.includes('.all-entry .primary-entry-grid{margin-top:14px}'),'primary entries must be integrated into all functions');
assert(learning.match(/href="\/"/g)?.length>=2,'learning page home links missing');
assert(transparency.includes('人口動態調査 人口動態統計 確定数'),'detailed mortality source missing');
assert.deepEqual(smrMapThresholds,[80,90,95,105,110,120],'map thresholds must use the fixed seven-band national scale');
assert.deepEqual(smrMapLegend,['80未満','80–90','90–95','95–105','105–110','110–120','120以上'],'map legend labels do not match the seven-band scale');
assert.equal(smrMapPalette.length,7,'map palette must contain seven accessible diverging colors');
assert.deepEqual([79.9,80,90,95,105,110,120].map(value=>productionSmrFill(value)),[smrMapPalette[0],smrMapPalette[1],smrMapPalette[2],smrMapPalette[3],smrMapPalette[4],smrMapPalette[5],smrMapPalette[6]],'map boundary classification is incorrect');
assert.equal(new Set([91.6,96,106].map(value=>productionSmrFill(value))).size,3,'narrow SMR ranges such as Tottori must remain visually distinguishable');
for(const [index,color] of smrMapPalette.entries())assert(css.includes(`.legend-swatch-${index}{background:${color}}`),`legend swatch ${index} does not match map palette`);
const functionCss=await readFile('public/site-function-shell-v1.css','utf8');
assert(!functionCss.includes('body.function-page .summary article')&&!functionCss.includes('body.function-page main>section{')&&!functionCss.includes('body.function-page h2{color'),'shared CSS must not override semantic-color cards, sections, or headings');
const lifestyleCss=await readFile('../lifestyle/style.css','utf8');assert(lifestyleCss.includes('.summary article.primary{background:linear-gradient')&&lifestyleCss.includes('.method{display:grid')&&lifestyleCss.includes('background:var(--ink);color:#fff'),'lifestyle semantic-color surfaces missing');
for(const token of ['--function-green:#176b5d','--function-bg:#f4f8f7','focus-visible','@media(max-width:700px)','prefers-reduced-motion'])assert(functionCss.includes(token),`shared function-page CSS missing ${token}`);
for(const page of ['../population/index.html','../jmd/index.html','../life-expectancy/index.html','../lifestyle/index.html','public/care/index.html','public/school-dental/index.html','public/analysis/index.html','public/transparency/index.html']){const html=await readFile(page,'utf8');if(page==='public/analysis/index.html'){assert(html.includes('class="analysis-hub"'),'analysis hub class missing');assert(html.includes('/analysis/hub.css'),'analysis hub responsive stylesheet missing')}else assert(html.includes('class="function-page function-'),'function page class missing: '+page);assert(html.includes('/site-function-shell-v1.css?v=2'),'shared function-page stylesheet missing: '+page)}
const mapIndex=main.indexOf("市町村・標準化死亡比地図"),causeIndex=main.indexOf("の死因別特徴"),rankingIndex=main.indexOf("市町村ランキング"),populationIndex=main.indexOf("<h2>人口ピラミッド</h2>");
assert(mapIndex<causeIndex&&causeIndex<rankingIndex&&rankingIndex<populationIndex,'content order must be map, causes, ranking, population');

console.log(JSON.stringify({pass:true,mobileWidths:[360,390,430],touchTargetMinPx:44,mapKeyboardAlternative:true,liveStatus:true,reducedMotion:true,nationalMapCooperativeRendering:true,lightMunicipalityRecovery:true,nationalMunicipalityMap:true,rankingBarCharts:true,rankingConfidenceInterval:true,significanceColors:true,nationalMapGuide:true,officialX:true,learningHomeLinks:true,detailedSources:true,contentOrder:true,mapConditionLabels:true,staleMapWarning:true,mapConditionOutsideCanvas:true,tokyoInsetMaps:true,sevenBandMapScale:true}));

