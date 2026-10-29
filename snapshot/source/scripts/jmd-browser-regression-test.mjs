// Final release-gate regression for the prefecture age-adjusted mortality view.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root=resolve('..');
const port=4185;
const url=`http://127.0.0.1:${port}/jmd/`;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.svg':'image/svg+xml','.png':'image/png','.gz':'application/octet-stream'};

const [headersFile,jmdHtml,jmdApp,jmdCss]=await Promise.all([
  readFile(resolve(root,'_headers'),'utf8'),
  readFile(resolve(root,'jmd/index.html'),'utf8'),
  readFile(resolve(root,'jmd/app.js'),'utf8'),
  readFile(resolve(root,'jmd/style.css'),'utf8')
]);
const contentSecurityPolicy=headersFile.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1];
assert(contentSecurityPolicy,'global Content-Security-Policy missing');
assert(contentSecurityPolicy.includes("script-src 'self'"),'script-src self missing');
assert(contentSecurityPolicy.includes("style-src 'self'"),'style-src self missing');
assert(!/<style\b/i.test(jmdHtml),'page must not contain inline style blocks');
assert(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(jmdHtml),'page must not contain inline scripts');
assert(!/\sstyle\s*=/i.test(jmdHtml),'page must not contain inline style attributes');
assert(!/style\s*=/.test(jmdApp),'script must not generate inline style attributes');
assert(jmdApp.includes('DecompressionStream'),'script must decode raw gzip assets');
assert(jmdHtml.includes('href="/jmd/style.css"'),'stylesheet reference missing');
assert(jmdHtml.includes('src="/jmd/app.js"'),'script reference missing');
assert(jmdCss.includes('.map-swatch-6'),'seven-step relative map palette missing');
assert(jmdCss.includes('#f5b544'),'selected-prefecture highlight missing');
assert(jmdCss.includes('.okinawa-panel-main'),'responsive Okinawa panel styles missing');
assert(!/(^|[^A-Za-z])(SMR|ASDR)(?=$|[^A-Za-z])/.test(jmdHtml),'public HTML contains an unexplained mortality abbreviation');
assert(jmdHtml.includes('JMD（日本版死亡データベース）'),'JMD expansion is missing');
assert(jmdHtml.includes('HCD（Human Cause-of-Death Database）'),'HCD expansion is missing');

const server=createServer(async(request,response)=>{
  try{
    let pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname.endsWith('/'))pathname+='index.html';
    const file=resolve(root,`.${pathname}`);
    if(file!==root&&!file.startsWith(root+sep))throw new Error('outside root');
    if(!(await stat(file)).isFile())throw new Error('not file');
    const responseHeaders={
      'content-type':mime[extname(file)]||'application/octet-stream',
      'cache-control':'no-store',
      'content-security-policy':contentSecurityPolicy,
      'x-content-type-options':'nosniff'
    };
    response.writeHead(200,responseHeaders);
    response.end(await readFile(file));
  }catch{
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolveListen,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolveListen));

let browser;
try{
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const run=async(viewport,label)=>{
    const page=await browser.newPage({viewport});
    const consoleErrors=[];
    const networkErrors=[];
    const pageErrors=[];
    const requestedPaths=new Set();
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
    page.on('pageerror',error=>pageErrors.push(String(error)));
    page.on('request',request=>requestedPaths.add(new URL(request.url()).pathname));
    page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))networkErrors.push(`${response.status()} ${response.url()}`)});

    const initialResponse=await page.goto(url,{waitUntil:'networkidle',timeout:30000});
    assert(initialResponse?.ok(),`${label}: initial HTTP ${initialResponse?.status()}`);
    await page.locator('#ranking .bar').first().waitFor({state:'visible',timeout:30000});

    assert.equal(await page.title(),'都道府県別 年齢調整死亡率｜5分類・372死因・死因群',`${label}: title`);
    assert.equal(await page.locator('.map-wrap .map-region').count(),47,`${label}: selectable map region count`);
    assert.equal(await page.locator('#map .map-region').count(),46,`${label}: main-map region count`);
    assert.equal(await page.locator('#ranking .bar').count(),47,`${label}: initial ranking count`);
    assert.equal(await page.locator('#ranking progress.rank-progress').count(),47,`${label}: CSP-safe ranking progress count`);
    assert((await page.locator('#prefLegend').innerText()).includes('秋田県'),`${label}: initial Akita trend legend`);
    assert(await page.locator('.map-wrap .map-selected').count()>=1,`${label}: selected map feature missing`);
    assert.equal(await page.locator('#map').getAttribute('data-projection'),'uniform-national-bounds',`${label}: uniform projection flag`);
    assert.equal(await page.locator('#map').getAttribute('data-color-scale'),'national-relative',`${label}: national-relative color flag`);
    assert.equal(await page.locator('#map').getAttribute('data-okinawa-layout'),'responsive-panels',`${label}: Okinawa layout flag`);
    assert.equal(await page.locator('#map').getAttribute('viewBox'),'0 0 900 640',`${label}: map viewBox`);
    assert.equal(await page.locator('#okinawaInsets .okinawa-panel').count(),3,`${label}: Okinawa panel count`);
    assert.equal(await page.locator('#okinawaInsets .okinawa-inset').count(),3,`${label}: Okinawa shape count`);
    assert.deepEqual(await page.locator('#okinawaInsets .okinawa-panel-title').allTextContents(),['沖縄本島周辺','宮古・八重山','大東諸島'],`${label}: Okinawa labels`);
    assert.equal(await page.locator('#mapLegend .legend-item').count(),8,`${label}: relative legend item count`);
    assert((await page.locator('#mapLegend').innerText()).includes('全国の年齢調整死亡率'),`${label}: relative legend explanation`);
    const bodyText=await page.locator('body').innerText();
    assert(!bodyText.match(/(^|[^A-Za-z])(SMR|ASDR)(?=$|[^A-Za-z])/),`${label}: unexplained mortality abbreviation remains`);
    assert(bodyText.includes('JMD（日本版死亡データベース）'),`${label}: visible JMD expansion missing`);
    assert(bodyText.includes('HCD（Human Cause-of-Death Database）'),`${label}: visible HCD expansion missing`);

    assert.equal(await page.locator('#trendProfileCard').count(),1,`${label}: five-year change card missing`);
    await page.locator('#trendProfileToggle').click();
    await page.locator('#trendProfileList .trend-profile-row').first().waitFor({state:'visible',timeout:10000});
    const changeSummary=await page.locator('#trendProfileSummary').innerText();
    assert(changeSummary.includes('2015～2019年平均')&&changeSummary.includes('2020～2024年平均'),`${label}: five-year periods missing`);
    const changeRows=page.locator('#trendProfileList .trend-profile-row');
    const changeCount=await changeRows.count();
    assert(changeCount>0&&changeCount<=50,`${label}: five-year result count ${changeCount}`);
    const firstChange=changeRows.first();
    assert((await firstChange.innerText()).includes('変化量')&&(await firstChange.innerText()).includes('変化率'),`${label}: five-year values missing`);
    const changeCause=await firstChange.getAttribute('data-cause');
    await firstChange.dispatchEvent('click');
    await page.waitForFunction(cause=>document.querySelector('#cause')?.value===cause,changeCause,{timeout:10000});
    assert((await page.locator('#trendTitle').innerText()).length>0,`${label}: change result did not open the existing trend`);


    // Keep the pointer outside the map: re-rendering paths beneath a stationary
    // pointer can legitimately replace click feedback with pointerenter details.
    await page.mouse.move(0,0);
    const tokyoPath=page.locator('#map .map-region[data-code="P13"]');
    await tokyoPath.dispatchEvent('click');
    await page.waitForFunction(()=>document.querySelector('#pref')?.value==='P13'&&document.querySelector('#prefLegend')?.textContent?.includes('東京都')&&document.querySelector('#mapTip')?.textContent?.includes('東京都を選択しました'),null,{timeout:10000});
    assert((await page.locator('#mapTip').innerText()).includes('東京都を選択しました'),`${label}: map click feedback`);
    const mapValue=Number(await page.locator('#map .map-region[data-code="P13"]').getAttribute('data-value'));
    const rankingValue=Number(await page.locator('#ranking .rank-selected strong').innerText());
    const mapRatio=Number(await page.locator('#map .map-region[data-code="P13"]').getAttribute('data-ratio'));
    assert(Number.isFinite(mapValue)&&Math.abs(mapValue-rankingValue)<0.051,`${label}: map/ranking mismatch`);
    assert(Number.isFinite(mapRatio)&&mapRatio>0,`${label}: national relative value missing`);

    const okinawaRegion=page.locator('#okinawaInsets .map-region[data-code="P47"]');
    assert.equal(await okinawaRegion.count(),1,`${label}: Okinawa must be one selectable region`);
    await okinawaRegion.dispatchEvent('click');
    await page.waitForFunction(()=>document.querySelector('#pref')?.value==='P47'&&document.querySelector('#prefLegend')?.textContent?.includes('沖縄県')&&document.querySelector('#mapTip')?.textContent?.includes('沖縄県を選択しました'),null,{timeout:10000});
    assert((await page.locator('#mapTip').innerText()).includes('沖縄県を選択しました'),`${label}: Okinawa click feedback`);

    const cause=page.locator('#cause');
    const optionStartingWith=prefix=>cause.evaluate((select,prefix)=>[...select.options].find(option=>option.textContent.trim().startsWith(prefix))?.value||null,prefix);
    const selfHarm=await optionStartingWith('自殺');
    assert(selfHarm,`${label}: suicide cause missing`);
    await cause.selectOption(selfHarm);
    await page.locator('#year').selectOption('2024');
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('2024年'));
    assert(await page.locator('#ranking .bar').count()>0,`${label}: suicide 2024 ranking empty`);

    const covid=await optionStartingWith('新型コロナウイルス感染症 （');
    assert(covid,`${label}: COVID cause missing`);
    await cause.selectOption(covid);
    await page.locator('#year').selectOption('2019');
    await page.waitForFunction(()=>document.querySelector('#periodWarn')?.textContent?.includes('0としては扱いません'));
    assert.equal(await page.locator('#ranking .bar').count(),0,`${label}: pre-COVID ranking should be empty`);
    assert((await page.locator('#mapLegend').innerText()).includes('公表値なし'),`${label}: pre-COVID map missing legend`);

    await page.locator('#year').selectOption('2024');
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('2024年')&&document.querySelectorAll('#ranking .bar').length>0);
    assert(await page.locator('#ranking .bar').count()>0,`${label}: COVID 2024 ranking empty`);

    if(viewport.width<=430){
      const metrics=await page.evaluate(()=>({
        viewport:window.innerWidth,
        documentWidth:document.documentElement.scrollWidth,
        mapWidth:document.querySelector('#map')?.getBoundingClientRect().width||0,
        causeWidth:document.querySelector('#cause')?.getBoundingClientRect().width||0,
        okinawaMainWidth:document.querySelector('.okinawa-panel-main')?.getBoundingClientRect().width||0,
        okinawaOtherWidth:document.querySelector('.okinawa-panel-sakishima')?.getBoundingClientRect().width||0
      }));
      assert(metrics.documentWidth<=metrics.viewport+1,`${label}: body overflows ${JSON.stringify(metrics)}`);
      assert(metrics.mapWidth<=metrics.viewport,`${label}: map overflows ${JSON.stringify(metrics)}`);
      assert(metrics.causeWidth<=metrics.viewport,`${label}: selector overflows ${JSON.stringify(metrics)}`);
      assert(metrics.okinawaMainWidth>=metrics.viewport*.70,`${label}: Okinawa main panel too small ${JSON.stringify(metrics)}`);
      assert(metrics.okinawaOtherWidth>=metrics.viewport*.32,`${label}: Okinawa secondary panel too small ${JSON.stringify(metrics)}`);
    }

    const materialConsole=consoleErrors.filter(text=>!text.includes('Failed to load resource'));
    assert.equal(pageErrors.length,0,`${label}: page errors ${pageErrors.join(' | ')}`);
    assert.equal(networkErrors.length,0,`${label}: network errors ${networkErrors.join(' | ')}`);
    assert.equal(materialConsole.length,0,`${label}: console/CSP errors ${materialConsole.join(' | ')}`);
    for(const path of['/jmd/style.css','/jmd/app.js','/data/jmd/meta.json','/data/jmd/classification_master.json','/data/maps/prefectures-light.geojson','/data/jmd/asdr_cndcs_both.json.gz'])assert(requestedPaths.has(path),`${label}: resource not requested ${path}`);

    await page.close();
    return{label,viewport,cspEnforced:true,rawGzipDecoded:true,mapRegions:47,initialRanking:47,plainLanguage:true,uniformProjection:true,nationalRelativeColors:true,okinawaResponsivePanels:true,mapClickTokyo:true,mapRankingConsistent:true,suicide2024:true,covidMissingWarning:true,covid2024:true};
  };

  const desktop=await run({width:1280,height:900},'desktop');
  const mobile=await run({width:390,height:844},'mobile');
  console.log(JSON.stringify({pass:true,csp:contentSecurityPolicy,desktop,mobile}));
}finally{
  if(browser)await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
