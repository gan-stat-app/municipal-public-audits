import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright-core';

const targetUrl=process.env.JMD_BASE_URL||'https://municipal-smr.jp/jmd/';
const targetOrigin=new URL(targetUrl).origin;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

let browser;
try{
  browser=await chromium.launch({
    executablePath:'/usr/bin/google-chrome',
    headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage']
  });

  const readiness=await browser.newPage({viewport:{width:1280,height:900}});
  let ready=false;
  let lastError='';
  for(let attempt=1;attempt<=12;attempt++){
    try{
      const response=await readiness.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:20000});
      if(!response?.ok())throw new Error(`HTTP ${response?.status()}`);
      await readiness.locator('#ranking .bar').first().waitFor({state:'visible',timeout:15000});
      const [mapCount,rankCount,externalScript,externalStyle,projection,okinawaPanels]=await Promise.all([
        readiness.locator('.map-wrap .map-region').count(),
        readiness.locator('#ranking .bar').count(),
        readiness.locator('script[src="/jmd/app.js"]').count(),
        readiness.locator('link[href="/jmd/style.css"]').count(),
        readiness.locator('#map').getAttribute('data-projection'),
        readiness.locator('#okinawaInsets .okinawa-panel').count()
      ]);
      if(mapCount===47&&rankCount===47&&externalScript===1&&externalStyle===1&&projection==='uniform-national-bounds'&&okinawaPanels===3){ready=true;break;}
      throw new Error(`map=${mapCount}, ranking=${rankCount}, script=${externalScript}, style=${externalStyle}, projection=${projection}, Okinawa=${okinawaPanels}`);
    }catch(error){
      lastError=String(error);
      if(attempt<12)await sleep(10000);
    }
  }
  await readiness.close();
  assert(ready,`production did not become ready: ${lastError}`);

  const run=async(viewport,label)=>{
    const page=await browser.newPage({viewport});
    const consoleErrors=[];
    const networkErrors=[];
    const pageErrors=[];
    const externalOrigins=new Set();
    const requestedPaths=new Set();
    page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
    page.on('pageerror',error=>pageErrors.push(String(error)));
    page.on('request',request=>{
      const requestUrl=new URL(request.url());
      if(requestUrl.protocol==='http:'||requestUrl.protocol==='https:'){
        requestedPaths.add(requestUrl.pathname);
        if(requestUrl.origin!==targetOrigin)externalOrigins.add(requestUrl.origin);
      }
    });
    page.on('response',response=>{
      if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))networkErrors.push(`${response.status()} ${response.url()}`);
    });

    const started=performance.now();
    const response=await page.goto(targetUrl,{waitUntil:'networkidle',timeout:30000});
    assert(response?.ok(),`${label}: page HTTP ${response?.status()}`);
    await page.locator('#ranking .bar').first().waitFor({state:'visible',timeout:30000});
    const navigationMs=+(performance.now()-started).toFixed(1);

    assert.equal(await page.title(),'都道府県別 年齢調整死亡率｜5分類・372死因・死因群',`${label}: title`);
    assert.equal(new URL(page.url()).origin,targetOrigin,`${label}: redirected origin`);
    assert.equal(await page.locator('style').count(),0,`${label}: inline style block remains`);
    assert.equal(await page.locator('script:not([src])').count(),0,`${label}: inline script remains`);
    assert.equal(await page.locator('[style]').count(),0,`${label}: inline style attribute remains`);
    const regionCodes = await page.locator('#pref option').evaluateAll(options => options.map(option => option.value));
    assert.deepEqual(regionCodes, Array.from({length:48}, (_,i) => `P${String(i).padStart(2,'0')}`), `${label}: national plus 47 prefecture options`);
    assert.match(await page.locator('#pref option[value="P00"]').innerText(), /全国/, `${label}: national trend option`);
    assert((await page.locator('#cause option').count())>=100,`${label}: cause master not loaded`);
    assert.equal(await page.locator('#causeGroup option').count(),8,`${label}: cause groups`);
    assert.equal(await page.locator('#causeSearch').count(),1,`${label}: cause search missing`);
    assert(await page.locator('#cancerComparison .cancer-row').count()>3,`${label}: cancer comparison missing`);
    await page.locator('#causeGroup').selectOption('cancer');
    await page.locator('#causeSearch').fill('胃');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length>0&&document.querySelectorAll('#cause option').length<10);
    await page.locator('#causeSearch').fill('');
    await page.locator('#causeGroup').selectOption('all');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length===111);
    assert.equal(await page.locator('.map-wrap .map-region').count(),47,`${label}: selectable map region count`);
    assert.equal(await page.locator('#map .map-region').count(),46,`${label}: main-map region count`);
    assert.equal(await page.locator('#ranking .bar').count(),47,`${label}: initial ranking count`);
    assert.equal(await page.locator('#ranking progress.rank-progress').count(),47,`${label}: CSP-safe ranking progress count`);
    assert((await page.locator('#prefLegend').innerText()).includes('秋田県'),`${label}: initial Akita trend legend`);
    assert(await page.locator('.map-wrap .map-selected').count()>=1,`${label}: selected map feature missing`);
    assert.equal(await page.locator('#map').getAttribute('data-projection'),'uniform-national-bounds',`${label}: uniform projection`);
    assert.equal(await page.locator('#map').getAttribute('data-color-scale'),'national-relative',`${label}: relative color scale`);
    assert.equal(await page.locator('#map').getAttribute('data-okinawa-layout'),'responsive-panels',`${label}: Okinawa layout`);
    assert.equal(await page.locator('#map').getAttribute('viewBox'),'0 0 900 640',`${label}: map viewBox`);
    assert.equal(await page.locator('#okinawaInsets .okinawa-panel').count(),3,`${label}: Okinawa panel count`);
    assert.equal(await page.locator('#okinawaInsets .okinawa-inset').count(),3,`${label}: Okinawa shape count`);
    assert.deepEqual(await page.locator('#okinawaInsets .okinawa-panel-title').allTextContents(),['沖縄本島周辺','宮古・八重山','大東諸島'],`${label}: Okinawa labels`);
    assert.equal(await page.locator('#mapLegend .legend-item').count(),8,`${label}: map legend class count`);
    assert((await page.locator('#mapLegend').innerText()).includes('全国の年齢調整死亡率'),`${label}: map legend explanation`);
    assert(await page.locator('#trend polyline[stroke="#345d86"]').count()>0,`${label}: prefecture trend missing`);
    assert(await page.locator('#trend polyline[stroke="#777"]').count()>0,`${label}: national trend missing`);
    assert(!(await page.locator('body').innerText()).match(/(^|[^A-Za-z])(SMR|ASDR)(?=$|[^A-Za-z])/),`${label}: visible abbreviation remains`);

    await page.locator('#map .map-region[data-code="P13"]').dispatchEvent('click');
    await page.waitForFunction(()=>document.querySelector('#pref')?.value==='P13'&&document.querySelector('#prefLegend')?.textContent?.includes('東京都'),null,{timeout:10000});
    assert((await page.locator('#mapTip').innerText()).includes('東京都を選択しました'),`${label}: map click feedback`);
    assert.equal(await page.locator('#map .map-region[data-code="P13"].map-selected').count(),1,`${label}: Tokyo map selection`);
    const mapValue=Number(await page.locator('#map .map-region[data-code="P13"]').getAttribute('data-value'));
    const rankingValue=Number(await page.locator('#ranking .rank-selected strong').innerText());
    const mapRatio=Number(await page.locator('#map .map-region[data-code="P13"]').getAttribute('data-ratio'));
    assert(Number.isFinite(mapValue)&&Math.abs(mapValue-rankingValue)<0.051,`${label}: map/ranking value mismatch ${mapValue} vs ${rankingValue}`);
    assert(Number.isFinite(mapRatio)&&mapRatio>0,`${label}: relative map value missing`);

    for(const sex of ['male','female','both']){
      await page.locator('#sex').selectOption(sex);
      await page.waitForFunction(expected=>document.querySelector('#sex')?.value===expected&&document.querySelectorAll('#ranking .bar').length>0,sex);
    }

    const cause=page.locator('#cause');
    const optionStartingWith=prefix=>cause.evaluate((select,prefix)=>[...select.options].find(option=>option.textContent.trim().startsWith(prefix))?.value||null,prefix);

    const stomach=await optionStartingWith('胃の悪性新生物');
    assert(stomach,`${label}: stomach cancer cause missing`);
    await cause.selectOption(stomach);
    await page.locator('#year').selectOption('1979');
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.startsWith('1979年'));
    assert(await page.locator('#ranking .bar').count()>0,`${label}: 1979 stomach cancer ranking empty`);

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

    const okinawaRegion=page.locator('#okinawaInsets .map-region[data-code="P47"]');
    assert.equal(await okinawaRegion.count(),1,`${label}: Okinawa selectable-region count`);
    await okinawaRegion.dispatchEvent('click');
    await page.waitForFunction(()=>document.querySelector('#pref')?.value==='P47',null,{timeout:10000});
    assert((await page.locator('#prefLegend').innerText()).includes('沖縄県'),`${label}: Okinawa inset selection`);

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
      assert(metrics.causeWidth<=metrics.viewport,`${label}: cause selector overflows ${JSON.stringify(metrics)}`);
      assert(metrics.okinawaMainWidth>=metrics.viewport*.70,`${label}: Okinawa main panel too small ${JSON.stringify(metrics)}`);
      assert(metrics.okinawaOtherWidth>=metrics.viewport*.32,`${label}: Okinawa secondary panel too small ${JSON.stringify(metrics)}`);
    }

    await page.screenshot({path:`jmd-${label}.png`,fullPage:true});

    const materialConsole=consoleErrors.filter(text=>!text.includes('Failed to load resource'));
    assert.equal(pageErrors.length,0,`${label}: page errors ${pageErrors.join(' | ')}`);
    assert.equal(networkErrors.length,0,`${label}: network errors ${networkErrors.join(' | ')}`);
    assert.equal(materialConsole.length,0,`${label}: console/CSP errors ${materialConsole.join(' | ')}`);
    assert.equal(externalOrigins.size,0,`${label}: external runtime origins ${[...externalOrigins].join(', ')}`);
    for(const path of[
      '/jmd/style.css',
      '/jmd/app.js',
      '/data/jmd/meta.json',
      '/data/jmd/classification_master.json',
      '/data/maps/prefectures-light.geojson',
      '/data/jmd/asdr_cndcs_both.json.gz',
      '/data/jmd/asdr_cndcs_male.json.gz',
      '/data/jmd/asdr_cndcs_female.json.gz'
    ])assert(requestedPaths.has(path),`${label}: required resource not requested ${path}`);

    const result={
      label,viewport,navigationMs,mapRegions:47,prefectureOptions:47,regionOptions:48,nationalTrendOption:true,
      causeOptions:await page.locator('#cause option').count(),
      strictCspCompatible:true,plainLanguage:true,uniformProjection:true,nationalRelativeColors:true,
      okinawaResponsivePanels:true,mapClickTokyo:true,mapRankingConsistent:true,sexes:['both','male','female'],
      stomach1979:true,suicide2024:true,covid2019Missing:true,covid2024:true,
      okinawaInset:true,sameOriginOnly:true,requestedPaths:[...requestedPaths].sort()
    };
    await page.close();
    return result;
  };

  const desktop=await run({width:1280,height:900},'desktop-production');
  const mobile=await run({width:390,height:844},'mobile-production');
  console.log(JSON.stringify({pass:true,targetUrl,targetOrigin,desktop,mobile}));
}finally{
  if(browser)await browser.close();
}
