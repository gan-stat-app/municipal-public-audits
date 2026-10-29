import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright-core';

const baseUrl=new URL(process.env.SITE_BASE_URL||'https://municipal-smr.jp/');
if(!baseUrl.pathname.endsWith('/'))baseUrl.pathname+='/';
const targetOrigin=baseUrl.origin;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const abbreviationPattern=/(^|[^A-Za-z])(SMR|ASDR)(?=$|[^A-Za-z])/;

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
      const response=await readiness.goto(baseUrl.href,{waitUntil:'domcontentloaded',timeout:20000});
      if(!response?.ok())throw new Error(`HTTP ${response?.status()}`);
      await readiness.locator('a.secondary-entry[href="/jmd/"]').waitFor({state:'visible',timeout:15000});
      const href=await readiness.locator('a.secondary-entry[href="/jmd/"]').getAttribute('href');
      if(href==='/jmd/'){ready=true;break;}
      throw new Error(`unexpected age-adjusted mortality link ${href}`);
    }catch(error){
      lastError=String(error);
      if(attempt<12)await sleep(10000);
    }
  }
  await readiness.close();
  assert(ready,`deployment did not become discoverability-ready: ${lastError}`);

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
    const response=await page.goto(baseUrl.href,{waitUntil:'networkidle',timeout:30000});
    assert(response?.ok(),`${label}: top page HTTP ${response?.status()}`);
    await page.locator('a.secondary-entry[href="/jmd/"]').waitFor({state:'visible',timeout:30000});
    await page.locator('.portal-hero h1').waitFor({state:'visible',timeout:30000});
    const topNavigationMs=+(performance.now()-started).toFixed(1);

    assert.equal(await page.locator('a.secondary-entry[href="/jmd/"]').count(),1,`${label}: entry card count`);
    assert.equal(await page.locator('.portal-hero h1').innerText(),'人口ピラミッド × 地域保健データラボ',`${label}: site brand heading`);
    assert.equal((await page.locator('a.secondary-entry[href="/jmd/"] b').innerText()).trim(),'年齢調整死亡率',`${label}: card title`);
    assert((await page.locator('a.secondary-entry[href="/jmd/"] small').innerText()).includes('1950～2024年'),`${label}: card period`);
    assert.equal(await page.locator('a.secondary-entry[href="/jmd/"]').getAttribute('href'),'/jmd/',`${label}: card href`);

    const sitemap=await page.evaluate(async()=>{
      const response=await fetch('/sitemap.xml',{cache:'no-store'});
      return{ok:response.ok,text:await response.text()};
    });
    assert(sitemap.ok,`${label}: sitemap request failed`);
    assert(sitemap.text.includes('<loc>https://municipal-smr.jp/jmd/</loc>'),`${label}: page missing from sitemap`);

    if(viewport.width<=430){
      const topMetrics=await page.evaluate(()=>({
        viewport:window.innerWidth,
        documentWidth:document.documentElement.scrollWidth,
        cardWidth:document.querySelector('a.secondary-entry[href="/jmd/"]')?.getBoundingClientRect().width||0,
        linkWidth:document.querySelector('a.secondary-entry[href="/jmd/"]')?.getBoundingClientRect().width||0
      }));
      assert(topMetrics.documentWidth<=topMetrics.viewport+1,`${label}: top page overflows ${JSON.stringify(topMetrics)}`);
      assert(topMetrics.cardWidth<=topMetrics.viewport,`${label}: card overflows ${JSON.stringify(topMetrics)}`);
      assert(topMetrics.linkWidth<=topMetrics.cardWidth,`${label}: link overflows ${JSON.stringify(topMetrics)}`);
    }

    const jmdStarted=performance.now();
    await Promise.all([
      page.waitForURL(url=>url.pathname==='/jmd/',{timeout:30000}),
      page.locator('a.secondary-entry[href="/jmd/"]').click()
    ]);
    await page.locator('#ranking .bar').first().waitFor({state:'visible',timeout:30000});
    const jmdNavigationMs=+(performance.now()-jmdStarted).toFixed(1);

    assert.equal(await page.title(),'都道府県別 年齢調整死亡率｜5分類・372死因・死因群',`${label}: title`);
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://municipal-smr.jp/jmd/',`${label}: canonical`);
    assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'),'https://municipal-smr.jp/jmd/',`${label}: OGP URL`);
    assert.equal(await page.locator('meta[name="twitter:card"]').getAttribute('content'),'summary_large_image',`${label}: Twitter card`);
    assert.equal(await page.locator('main[itemtype="https://schema.org/Dataset"]').count(),1,`${label}: Dataset microdata`);
    assert.equal(await page.locator('meta[itemprop="temporalCoverage"]').getAttribute('content'),'1950/2024',`${label}: temporal coverage`);
    assert.equal(await page.locator('meta[itemprop="spatialCoverage"]').getAttribute('content'),'日本・47都道府県',`${label}: spatial coverage`);
    assert.equal(await page.locator('.map-wrap .map-region').count(),47,`${label}: selectable map regions`);
    assert.equal(await page.locator('#map .map-region').count(),46,`${label}: main-map regions`);
    assert.equal(await page.locator('#cause option').count(),111,`${label}: cause options`);
    assert.equal(await page.locator('#causeGroup option').count(),8,`${label}: cause groups`);
    assert.equal(await page.locator('#causeSearch').count(),1,`${label}: cause search`);
    assert(await page.locator('#cancerComparison .cancer-row').count()>3,`${label}: cancer comparison`);
    assert.equal(await page.locator('#map').getAttribute('data-projection'),'uniform-national-bounds',`${label}: uniform map projection`);
    assert.equal(await page.locator('#map').getAttribute('data-color-scale'),'national-relative',`${label}: national-relative colors`);
    assert.equal(await page.locator('#map').getAttribute('data-okinawa-layout'),'responsive-panels',`${label}: Okinawa layout`);
    assert.equal(await page.locator('#okinawaInsets .okinawa-panel').count(),3,`${label}: Okinawa panel count`);
    assert(!abbreviationPattern.test(await page.locator('body').innerText()),`${label}: visible abbreviation remains`);

    if(viewport.width<=430){
      const jmdMetrics=await page.evaluate(()=>({
        viewport:window.innerWidth,
        documentWidth:document.documentElement.scrollWidth,
        mapWidth:document.querySelector('#map')?.getBoundingClientRect().width||0,
        okinawaMainWidth:document.querySelector('.okinawa-panel-main')?.getBoundingClientRect().width||0,
        okinawaOtherWidth:document.querySelector('.okinawa-panel-sakishima')?.getBoundingClientRect().width||0
      }));
      assert(jmdMetrics.documentWidth<=jmdMetrics.viewport+1,`${label}: page overflows ${JSON.stringify(jmdMetrics)}`);
      assert(jmdMetrics.mapWidth<=jmdMetrics.viewport,`${label}: map overflows ${JSON.stringify(jmdMetrics)}`);
      assert(jmdMetrics.okinawaMainWidth>=jmdMetrics.viewport*.70,`${label}: Okinawa main panel too small ${JSON.stringify(jmdMetrics)}`);
      assert(jmdMetrics.okinawaOtherWidth>=jmdMetrics.viewport*.32,`${label}: Okinawa secondary panel too small ${JSON.stringify(jmdMetrics)}`);
    }

    const materialConsole=consoleErrors.filter(text=>!text.includes('Failed to load resource'));
    assert.equal(pageErrors.length,0,`${label}: page errors ${pageErrors.join(' | ')}`);
    assert.equal(networkErrors.length,0,`${label}: network errors ${networkErrors.join(' | ')}`);
    assert.equal(materialConsole.length,0,`${label}: console/CSP errors ${materialConsole.join(' | ')}`);
    assert.equal(externalOrigins.size,0,`${label}: external runtime origins ${[...externalOrigins].join(', ')}`);

    for(const path of['/','/home-portal-v1.css','/sitemap.xml','/jmd/','/jmd/style.css','/jmd/app.js']){
      assert(requestedPaths.has(path),`${label}: required resource not requested ${path}`);
    }

    await page.close();
    return{
      label,
      viewport,
      topNavigationMs,
      jmdNavigationMs,
      cardVisible:true,
      plainLanguage:true,
      sitemapIncludesJmd:true,
      canonical:true,
      socialMetadata:true,
      datasetMicrodata:true,
      mapRegions:47,
      causeOptions:111,
      uniformProjection:true,
      nationalRelativeColors:true,
      okinawaResponsivePanels:true,
      sameOriginOnly:true
    };
  };

  const desktop=await run({width:1280,height:900},'desktop-discoverability');
  const mobile=await run({width:390,height:844},'mobile-discoverability');
  console.log(JSON.stringify({pass:true,targetUrl:baseUrl.href,targetOrigin,desktop,mobile}));
}finally{
  if(browser)await browser.close();
}
