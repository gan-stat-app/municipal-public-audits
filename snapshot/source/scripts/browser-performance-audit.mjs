import{chromium}from'playwright-core';
import{performance}from'node:perf_hooks';
import{resolve}from'node:path';
import{readFile,writeFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{aggregateMedicalArea,normalizeMedicalAreas}from'../src/lib/medicalAreas.js';
import{applyMethodAcceptance}from'../src/lib/dataClient.js';
import{displayAreaName}from'../src/catalogs/designatedCities.js';
import{collectPerformanceSamples,summarizeMapSamples,assertMapPerformance}from'./browser-performance-sampling.mjs';
import{createAuditServer,classifyPopulationFallbacks,primaryMapExpectation,waitForPrimaryMap,measurePrimarySwitch,pageTimeline,runnerEnvironment,hostSnapshot,assetFingerprints,CHROME_PATH,CHROME_ARGS,VIEWPORT}from'./browser-performance-measurement.mjs';

const reconstructedPort=4173,legacyPort=4174;
const reconstructedUrl=`http://127.0.0.1:${reconstructedPort}/`,legacyUrl=`http://127.0.0.1:${legacyPort}/`;
const legacyRoot=resolve('..'),candidateRoot=resolve('dist');
const legacyIndex=await readFile(resolve(legacyRoot,'index.html'),'utf8');
const baseline=legacyIndex.includes('/assets/formal-app-')?'legacy-production':'reconstructed-production';
const serverRequests={legacy:[],reconstructed:[]};
const legacy=createAuditServer(legacyRoot,serverRequests.legacy),candidate=createAuditServer(candidateRoot,serverRequests.reconstructed,{sharedRoot:legacyRoot});
const attemptedSamples=[],measurements=[];
let report={pass:false,baseline,protocol:'matched-primary-map-v2',runner:runnerEnvironment(),hostBefore:hostSnapshot(),attemptedSamples,measurements,serverRequests};
let serverError='';
const waitForServer=async url=>{
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
    try{const response=await fetch(url);if(response.ok)return}catch{}
    await new Promise(resolveWait=>setTimeout(resolveWait,200));
  }
  throw new Error(`server did not start: ${url} ${serverError}`);
};
const elapsed=async action=>{const start=performance.now();await action();return +(performance.now()-start).toFixed(1)};
const settleMap=async(page,headingName)=>{
  const heading=page.getByRole('heading',{name:headingName});
  await heading.waitFor({state:'visible',timeout:20000});
  await heading.scrollIntoViewIfNeeded();
  let completed=true;
  try{await page.waitForFunction(()=>!['地図を読み込み中','地図境界を読み込んでいます','地図を描画しています','全国地図を読み込み中','都道府県地図を読み込み中','表示を準備しています'].some(text=>document.body.innerText.includes(text)),null,{timeout:20000})}
  catch(error){if(error?.name==='TimeoutError')completed=false;else throw error}
  await page.evaluate(()=>new Promise(resolveFrame=>requestAnimationFrame(()=>requestAnimationFrame(resolveFrame))));
  return completed;
};
const waitForNationwideMap=async(page,conditionId,texts)=>{
  await page.waitForFunction(({conditionId,texts})=>{
    const panel=document.querySelector('#national-municipality-map');
    const condition=document.getElementById(conditionId)?.textContent||'';
    return panel?.querySelector('canvas')&&!panel.querySelector('.map-loading')&&condition.includes('地図に表示中：')&&texts.every(text=>condition.includes(text));
  },{conditionId,texts},{timeout:30000});
};

let browser;
try{
  await Promise.all([new Promise((done,reject)=>legacy.once('error',reject).listen(legacyPort,'127.0.0.1',done)),new Promise((done,reject)=>candidate.once('error',reject).listen(reconstructedPort,'127.0.0.1',done))]);
  await Promise.all([waitForServer(reconstructedUrl),waitForServer(legacyUrl)]);
  report.assets={legacy:await assetFingerprints(legacyRoot),reconstructed:await assetFingerprints(candidateRoot)};
  browser=await chromium.launch({executablePath:CHROME_PATH,headless:true,args:CHROME_ARGS});
  report.browser={version:browser.version(),executablePath:CHROME_PATH,headless:true,args:CHROME_ARGS,viewport:VIEWPORT,playwrightVersion:JSON.parse(await readFile('node_modules/playwright-core/package.json','utf8')).version};

  const measureApp=async(label,url,featureAudit=false)=>{
    const page=await browser.newPage({viewport:VIEWPORT});
    const diagnostic={label,featureAudit,hostBefore:hostSnapshot(),mapPhases:[],requests:[]};
    measurements.push(diagnostic);
    const requestStart=new Map();
    page.on('request',request=>{const row={path:new URL(request.url()).pathname,startWallMs:performance.now()};diagnostic.requests.push(row);requestStart.set(request,row)});
    page.on('response',response=>{const row=requestStart.get(response.request());if(row)row.status=response.status()});
    const finish=(request,error)=>{const row=requestStart.get(request);if(row){row.durationMs=+(performance.now()-row.startWallMs).toFixed(1);row.error=error||null}};
    page.on('requestfinished',request=>finish(request));
    page.on('requestfailed',request=>finish(request,request.failure()?.errorText||'unknown'));
    const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
    const consoleErrors=[],networkErrors=[],crossRequests=[],crossPriorityChecks=[];
    diagnostic.consoleErrors=consoleErrors;diagnostic.networkErrors=networkErrors;
    page.on('request',request=>{if(request.url().includes('/data/cross-cause-profile-v1/'))crossRequests.push(request.url())});
    if(featureAudit)await page.route('**/data/cross-cause-profile-v1/*.json.gz',async route=>{
      crossPriorityChecks.push(await page.locator('.metric-grid').isVisible());
      await route.continue();
    });
    page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))consoleErrors.push(message.text())});
    page.on('pageerror',error=>consoleErrors.push(String(error)));
    page.on('response',response=>{if(response.status()>=400)networkErrors.push({status:response.status(),url:response.url()})});page.on('requestfailed',request=>networkErrors.push({status:'failed',url:request.url(),reason:request.failure()?.errorText||'unknown'}));
    await page.addInitScript(()=>{
      window.__smrLongTasks=[];
      new PerformanceObserver(list=>window.__smrLongTasks.push(...list.getEntries().map(entry=>({startTime:entry.startTime,duration:entry.duration})))).observe({type:'longtask',buffered:true});
    });
    const initialNavigationWallMs=await elapsed(()=>page.goto(url,{waitUntil:'networkidle',timeout:30000}));
    const initial=await page.evaluate(()=>{
      const navigation=performance.getEntriesByType('navigation')[0],paint=performance.getEntriesByType('paint');
      return{domContentLoaded:+navigation.domContentLoadedEventEnd.toFixed(1),load:+navigation.loadEventEnd.toFixed(1),firstContentfulPaint:+((paint.find(x=>x.name==='first-contentful-paint')?.startTime)||0).toFixed(1)};
    });
    const legacyMode=label==='legacy-official-build-local'&&baseline==='legacy-production';
    diagnostic.browser=await page.evaluate(()=>({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,deviceMemory:navigator.deviceMemory,devicePixelRatio,visibilityState:document.visibilityState}));
    diagnostic.metricsBefore=await cdp.send('Performance.getMetrics');
    if(!legacyMode){try{await page.locator('.metric-grid').waitFor({state:'visible',timeout:30000})}catch(error){const diagnostic=await page.locator('body').innerText();throw new Error(`initial metric unavailable: ${diagnostic.slice(-1800)} | console=${consoleErrors.join(' | ')} | network=${JSON.stringify(networkErrors)} | server=${serverError.slice(-1000)}`)}await page.locator('.ranking-scope-switch').waitFor({state:'visible',timeout:30000})}
    let crossCauseMs=null,nationalMunicipalityMapMs=null,nationalMunicipalityMapCompleted=null,nationalMedicalMapMs=null,nationalRankingCompleted=null,featureChecks=null,autoLoadChecks=null;
    if(featureAudit){
      if(crossRequests.length)throw new Error('cross-cause data fetched while its panel was offscreen');
      const noInitialButton=await page.getByRole('button',{name:'死因別特徴を表示',exact:true}).count()===0;
      const noOffscreenRequest=crossRequests.length===0;
      const noOffscreenNationalMap=await page.locator('#national-municipality-map canvas').count()===0;
      const noNationalMapButton=await page.locator('#national-municipality-map summary').count()===0;
      const primaryResultBeforeNationalMap=await page.locator('.metric-grid').isVisible();
      nationalMunicipalityMapMs=await elapsed(async()=>{
        await page.locator('#national-municipality-map').scrollIntoViewIfNeeded();
        await waitForNationwideMap(page,'map-drawn-condition-national-municipal',['全国市区町村','秋田市','全死因','男性','1999～2024年','住民基本台帳人口']);
      });
      const automaticNationalMap=true;
      crossCauseMs=await elapsed(async()=>{
        await page.locator('.cause-profile-panel').scrollIntoViewIfNeeded();
        await page.locator('.cause-list').waitFor({state:'visible',timeout:30000});
      });
      autoLoadChecks={noInitialButton,noOffscreenRequest,noOffscreenNationalMap,noNationalMapButton,primaryResultBeforeNationalMap,automaticNationalMap,automaticCauseDisplay:await page.locator('.cause-row').count()===36,primaryResultBeforeProfile:crossPriorityChecks.length>0&&crossPriorityChecks.every(Boolean)};
    }
    const prefecture=page.getByLabel('都道府県').first(),municipality=page.getByLabel(legacyMode?'市区町村・県全体':'自治体').first();
    await prefecture.selectOption('05');
    let nationalMapCompleted=false,municipalityMapCompleted=false,nationalMapMs,municipalityMapMs,activePanelsNationalMapMs=null,activePanelsMunicipalityMapMs=null;
    if(legacyMode){
      nationalMapMs=await elapsed(async()=>{await municipality.selectOption('05000');nationalMapCompleted=await settleMap(page,'標準化死亡比地図')});
      municipalityMapMs=await elapsed(async()=>{await municipality.selectOption('05201');municipalityMapCompleted=await settleMap(page,'標準化死亡比地図')});
    }else{
      const mapCatalog=JSON.parse(await readFile(resolve(label==='reconstructed-build-local'?candidateRoot:legacyRoot,'data/area-catalog.json'),'utf8'));
      const expected=(scope,code)=>{const row=mapCatalog.find(([areaCode])=>areaCode===code);return primaryMapExpectation(scope,code,row?displayAreaName(code,row[1]):undefined)};
      // Same cold context, same initial completed municipal map, same viewport
      // and cache history. Optional nationwide/cause panels are checked on a
      // separate page AFTER the timed samples, never on one side of the gate.
      if(!featureAudit){
        await municipality.selectOption('05201');
        await page.getByRole('heading',{name:'市町村・標準化死亡比地図',exact:true}).scrollIntoViewIfNeeded();
        await waitForPrimaryMap(page,await expected('prefecture','05201'));
      }
      nationalMapMs=await measurePrimarySwitch(page,municipality,'05000','全国都道府県・標準化死亡比地図',await expected('national','05000'),diagnostic.mapPhases);
      nationalMapCompleted=true;
      municipalityMapMs=await measurePrimarySwitch(page,municipality,'05201','市町村・標準化死亡比地図',await expected('prefecture','05201'),diagnostic.mapPhases);
      municipalityMapCompleted=true;
      if(baseline==='reconstructed-production'&&!featureAudit){
        // Keep the real post-scroll workload under the same 2.5x gate, with
        // BOTH builds opening the deferred panels on the same page/history.
        await page.locator('#national-municipality-map').scrollIntoViewIfNeeded();
        await waitForNationwideMap(page,'map-drawn-condition-national-municipal',['秋田市','全死因','男性','1999～2024年','住民基本台帳人口']);
        await page.locator('.cause-profile-panel').scrollIntoViewIfNeeded();
        await page.waitForFunction(()=>document.querySelectorAll('.cause-row').length===36,null,{timeout:30000});
        activePanelsNationalMapMs=await measurePrimarySwitch(page,municipality,'05000','全国都道府県・標準化死亡比地図',await expected('national','05000'),diagnostic.mapPhases);
        activePanelsMunicipalityMapMs=await measurePrimarySwitch(page,municipality,'05201','市町村・標準化死亡比地図',await expected('prefecture','05201'),diagnostic.mapPhases);
      }
    }
    if(featureAudit){
      const headings=await page.locator('main h2').allTextContents(),mapIndex=headings.findIndex(text=>text.includes('市町村・標準化死亡比地図')),causeIndex=headings.findIndex(text=>text.includes('秋田市の死因別特徴')),rankingIndex=headings.findIndex(text=>text.includes('市町村ランキング')),populationIndex=headings.findIndex(text=>text.includes('人口ピラミッド'));
      const mapGuide=page.locator('a.national-map-guide'),officialX=page.locator('a.official-x-link'),sourceDetails=page.locator('aside.source-details'),primaryCondition=page.locator('#map-drawn-condition-prefecture');
      const waitForPrimaryCondition=async requiredTexts=>{
        const handle=await page.waitForFunction(texts=>{
          const text=document.querySelector('#map-drawn-condition-prefecture')?.innerText||'';
          return texts.every(value=>text.includes(value))?text:false;
        },requiredTexts,{timeout:30000});
        return handle.jsonValue();
      };
      const initialMapCondition=await waitForPrimaryCondition(['地図に表示中：','秋田市','全死因']);
      const staleOverlay=page.locator('.map-frame:not(.national-municipality-map) .map-loading');
      await page.getByRole('combobox',{name:'死因',exact:true}).selectOption('Se02');
      let staleOverlayObserved=false,staleOverlayContentValid=true;
      try{
        await staleOverlay.waitFor({state:'visible',timeout:1000});
        staleOverlayObserved=true;
        try{
          await staleOverlay.filter({hasText:'悪性新生物'}).filter({hasText:'背後の地図：'}).filter({hasText:'全死因'}).filter({hasText:'前の条件'}).waitFor({state:'visible',timeout:2000});
        }catch(error){
          if(error?.name!=='TimeoutError')throw error;
          staleOverlayContentValid=!(await staleOverlay.isVisible());
        }
        await staleOverlay.waitFor({state:'hidden',timeout:30000});
      }catch(error){if(error?.name!=='TimeoutError')throw error}
      const changedMapCondition=await waitForPrimaryCondition(['地図に表示中：','秋田市','悪性新生物']);
      await page.getByRole('combobox',{name:'死因',exact:true}).selectOption('Se00');
      try{await staleOverlay.waitFor({state:'visible',timeout:1000});await staleOverlay.waitFor({state:'hidden',timeout:30000})}catch(error){if(error?.name!=='TimeoutError')throw error}
      await primaryCondition.filter({hasText:'全死因'}).waitFor({state:'visible',timeout:30000});
      await page.waitForFunction(()=>document.querySelectorAll('.cause-row').length===36,null,{timeout:30000});
      const allCauseChoices=await page.locator('.cause-row').count()===36;
      const allCauseDefault=await page.locator('.cause-profile-panel').getByRole('button',{name:'すべて',exact:true}).getAttribute('aria-pressed')==='true';
      const singleRegionalRequest=crossRequests.length===1;
      await page.locator('.cause-profile-panel').getByRole('button',{name:'有意に高いのみ',exact:true}).click();
      await page.locator('.cause-profile-panel').getByRole('button',{name:'すべて',exact:true}).click();
      await page.locator('#standardized-mortality').getByLabel('性別').selectOption('女');
      await page.waitForFunction(()=>document.querySelectorAll('.cause-row').length===37,null,{timeout:30000});
      const femaleChoicesIncludeUterus=await page.locator('.cause-row').filter({hasText:'子宮の悪性新生物'}).count()===1;
      await page.locator('#standardized-mortality').getByLabel('性別').selectOption('男');
      await page.waitForFunction(()=>document.querySelectorAll('.cause-row').length===36,null,{timeout:30000});
      const regionalCacheReused=crossRequests.length===1;
      featureChecks={
        ...autoLoadChecks,allCauseChoices,allCauseDefault,singleRegionalRequest,femaleChoicesIncludeUterus,regionalCacheReused,
        contentOrder:mapIndex>=0&&mapIndex<causeIndex&&causeIndex<rankingIndex&&rankingIndex<populationIndex,
        selectedAreaCauseHeading:causeIndex>=0,
        nationalMapGuide:await mapGuide.getAttribute('href')==='#national-municipality-map',
        officialX:await officialX.getAttribute('href')==='https://x.com/municipal_smr',
        detailedSources:await sourceDetails.count()>0,
        rankingConfidenceIntervals:await page.locator('.ranking-ci-overlay').count()===20,
        rankingSignificanceColors:await page.locator('.ranking-bar-button.significant-high,.ranking-bar-button.significant-low').count()>0,
        causeConfidenceIntervals:await page.locator('.cause-bar[aria-label*="95%信頼区間"]').count()>0,
        causeSignificanceColors:await page.locator('.cause-row.significant-high,.cause-row.significant-low').count()>0,
        initialMapCondition:initialMapCondition.includes('秋田市')&&initialMapCondition.split('｜').length===5,
        staleMapCondition:!staleOverlayObserved||staleOverlayContentValid,
        // The loading overlay can be shorter than one Playwright polling interval.
        // Its content is validated when observed; successful final-map replacement remains mandatory.
        changedMapCondition:changedMapCondition.includes('地図に表示中：')&&changedMapCondition.includes('秋田市')&&changedMapCondition.includes('悪性新生物')
      };
      const nationwideButton=page.locator('.ranking-scope-switch button').filter({hasText:'全国'});
      try{await nationwideButton.waitFor({state:'visible',timeout:30000})}catch(error){const diagnostic=await page.locator('body').innerText();throw new Error(`nationwide ranking control unavailable: ${diagnostic.slice(-2500)} | console=${consoleErrors.join(' | ')}`)};
      await nationwideButton.click();
      await page.locator('.selected-rank').waitFor({state:'visible',timeout:20000});
      nationalRankingCompleted=await page.locator('.ranking-bar-button').count()===20;
      await page.locator('#national-municipality-map').scrollIntoViewIfNeeded();
      await waitForNationwideMap(page,'map-drawn-condition-national-municipal',['全国市区町村','秋田市','全死因','男性']);
      nationalMunicipalityMapCompleted=true;

      const medicalCatalog=normalizeMedicalAreas(JSON.parse(await readFile(resolve('..','regional-healthcare-vision/data/medical-area-municipalities.json'),'utf8')).areas);
      const medicalDataset=applyMethodAcceptance(JSON.parse(gunzipSync(await readFile(resolve('..','data/selected-cause-rebuild-v1/juki-Se00-2024-boundary.json.gz')))),JSON.parse(await readFile(resolve('..','data/selected-cause-rebuild-v1/acceptance.json'),'utf8')));
      const waitForMedicalProfile=async(name,total,code,sex)=>{
        const expected=aggregateMedicalArea(medicalDataset,medicalCatalog.find(area=>area.code===code),sex,1999,2024);
        if(!expected?.complete)throw new Error(`incomplete browser medical-area reference ${code}/${sex}`);
        const expectedObserved=Math.round(expected.observed).toLocaleString('ja-JP');
        await page.getByRole('heading',{name:`${name}の死因別特徴：標準化死亡比が高い死因を見る`,exact:true}).waitFor({state:'visible',timeout:30000});
        await page.locator('.cause-profile-panel').scrollIntoViewIfNeeded();
        await page.waitForFunction(({name,total,expectedObserved})=>{
          const heading=document.querySelector('.cause-profile-panel h2')?.textContent||'';
          const rows=[...document.querySelectorAll('.cause-row')];
          const row=rows.find(x=>x.querySelector('strong')?.textContent==='全死因');
          const values=[...document.querySelectorAll('.metric-grid .metric-value')].map(x=>x.textContent);
          if(!heading.startsWith(name)||rows.length!==total||!row||values.length!==4||values[0]!==expectedObserved)return false;
          const [observed,expected,smr,ci]=values,[low,high]=ci.split('–'),plain=x=>x.replaceAll(',','');
          // Compare numerical content independently of thousands separators in accessible labels.
          return plain(row.getAttribute('aria-label')||'').includes(`標準化死亡比 ${plain(smr)}、95%信頼区間 ${plain(low)}から${plain(high)}、観察死亡数 ${plain(observed)}、期待死亡数 ${plain(expected)}`);
        },{name,total,expectedObserved},{timeout:30000});
      };
      await page.getByRole('combobox',{name:'地域単位',exact:true}).selectOption('medical-area');
      await page.getByRole('combobox',{name:'2次医療圏',exact:true}).selectOption('0504');
      await waitForMedicalProfile('秋田周辺',36,'0504','男');
      nationalMedicalMapMs=await elapsed(async()=>{
        await page.locator('#national-municipality-map').scrollIntoViewIfNeeded();
        await waitForNationwideMap(page,'map-drawn-condition-national-medical',['全国2次医療圏','秋田周辺','全死因','男性','1999～2024年','住民基本台帳人口']);
      });
      featureChecks.medicalAreaNationwideAutomaticMap=true;
      featureChecks.medicalAreaNationwideGuide=await page.locator('a.national-map-guide').innerText().then(text=>text.includes('全国2次医療圏'));
      featureChecks.medicalAreaMapConditionIdsUnique=await page.locator('#map-drawn-condition-medical-prefecture').count()===1&&await page.locator('#map-drawn-condition-national-medical').count()===1;
      featureChecks.medicalAreaAutomaticDisplay=true;
      featureChecks.medicalAreaPrimaryParity=true;
      featureChecks.medicalAreaCacheReused=crossRequests.length===1;
      await page.getByRole('combobox',{name:'性別',exact:true}).selectOption('女');
      await waitForMedicalProfile('秋田周辺',37,'0504','女');
      await waitForNationwideMap(page,'map-drawn-condition-national-medical',['秋田周辺','女性','全死因']);
      featureChecks.medicalAreaNationwideSexUpdate=true;
      await page.locator('.cause-row').filter({hasText:'子宮の悪性新生物'}).waitFor({state:'visible',timeout:30000});
      featureChecks.medicalAreaFemaleUterus=true;
      await page.getByRole('combobox',{name:'性別',exact:true}).selectOption('男女計');
      await waitForMedicalProfile('秋田周辺',36,'0504','男女計');
      featureChecks.medicalAreaCombinedSex=true;
      await page.getByRole('button',{name:/^自殺の詳細を表示。/}).click();
      await page.waitForFunction(()=>document.querySelector('.control-grid select')&&new URL(location.href).searchParams.get('cause')==='Se34',null,{timeout:30000});
      featureChecks.medicalAreaCauseSelection=await page.getByRole('combobox',{name:'地域単位',exact:true}).inputValue()==='medical-area'&&await page.getByRole('combobox',{name:'2次医療圏',exact:true}).inputValue()==='0504';
      await page.getByRole('combobox',{name:'死因',exact:true}).selectOption('Se00');
      await page.getByRole('combobox',{name:'性別',exact:true}).selectOption('男');
      await page.getByRole('combobox',{name:'都道府県',exact:true}).selectOption('22');
      // Let the first medical area settle before switching within the prefecture.
      // Requests cancelled by a rapid selection change are tested separately.
      await waitForMedicalProfile('賀茂',36,'2201','男');
      const medicalPackRequests=crossRequests.filter(url=>url.includes('/juki-22.json.gz')).length;
      await page.getByRole('combobox',{name:'2次医療圏',exact:true}).selectOption('2208');
      await waitForMedicalProfile('西部',36,'2208','男');
      await waitForNationwideMap(page,'map-drawn-condition-national-medical',['西部','男性','全死因']);
      featureChecks.medicalAreaNationwideRegionUpdate=true;
      featureChecks.medicalAreaPrefecturePack=medicalPackRequests===1&&crossRequests.filter(url=>url.includes('/juki-22.json.gz')).length===medicalPackRequests;
      featureChecks.medicalAreaPrimaryResultFirst=crossPriorityChecks.every(Boolean);
      featureChecks.medicalAreaNoPrematureRequest=!networkErrors.some(item=>item.url.includes('/data/cross-cause-profile-v1/'));
      featureChecks.medicalAreaRequestCounts={akita:crossRequests.filter(url=>url.includes('/juki-05.json.gz')).length,shizuoka:crossRequests.filter(url=>url.includes('/juki-22.json.gz')).length};
    }
    let populationReady=false;
    if(diagnostic.requests.some(row=>row.path.startsWith('/population/historical-')||row.path.startsWith('/population/future-')||row.path.startsWith('/data/population-'))){
      const waitPopulation=year=>page.waitForFunction(year=>{
        const panel=document.querySelector('#population-pyramid');
        return panel?.querySelector('.pyramid-row')&&panel.querySelector('.year-player strong')?.textContent===`${year}年`&&!panel.querySelector('.population-empty');
      },year,{timeout:30000});
      await waitPopulation(2024);
      await page.locator('#population-pyramid').getByRole('button',{name:'社人研推計 2020～2050年',exact:true}).click();
      await waitPopulation(2050);
      await page.locator('#population-pyramid').getByRole('button',{name:'実績 1999～2024年',exact:true}).click();
      await waitPopulation(2024);
      populationReady=true;
    }
    diagnostic.populationReady=populationReady;
    diagnostic.populationTransport=classifyPopulationFallbacks(networkErrors,diagnostic.requests,populationReady);
    const longTasks=await page.evaluate(()=>window.__smrLongTasks);
    diagnostic.timeline=await pageTimeline(page);diagnostic.metricsAfter=await cdp.send('Performance.getMetrics');diagnostic.hostAfter=hostSnapshot();
    const result={label,featureAudit,diagnostic,activePanelsNationalMapMs,activePanelsMunicipalityMapMs,initialNavigationWallMs,initial,nationalMapMs,nationalMapCompleted,municipalityMapMs,municipalityMapCompleted,crossCauseMs,nationalMunicipalityMapMs,nationalMunicipalityMapCompleted,nationalMedicalMapMs,nationalRankingCompleted,featureChecks,longTasks:{count:longTasks.length,totalMs:+longTasks.reduce((sum,x)=>sum+x.duration,0).toFixed(1),maximumMs:+(longTasks.length?Math.max(...longTasks.map(x=>x.duration)):0).toFixed(1)},consoleErrors,networkErrors};
    await page.close();
    return result;
  };

  const validateApp=app=>{
    const materialNetworkErrors=app.diagnostic.populationTransport.material.filter(item=>!item.url.endsWith('/favicon.ico')&&item.reason!=='net::ERR_ABORTED');
    if(app.consoleErrors.length)throw new Error(`${app.label} console errors: ${app.consoleErrors.join(' | ')}`);
    if(materialNetworkErrors.length)throw new Error(`${app.label} network errors: ${JSON.stringify(materialNetworkErrors)}`);
    if(app.label==='reconstructed-build-local'&&app.longTasks.maximumMs>1000)throw new Error(`${app.label} long task exceeds 1000ms`);
    if(!app.featureAudit&&baseline==='reconstructed-production'&&['activePanelsNationalMapMs','activePanelsMunicipalityMapMs'].some(key=>!Number.isFinite(app[key])||app[key]<=0))throw new Error('missing active-panel map measurement');
    if(!app.nationalMapCompleted||!app.municipalityMapCompleted)throw new Error('primary map interaction did not complete');
    if(app.featureAudit&&(!app.nationalMunicipalityMapCompleted||!app.nationalRankingCompleted))throw new Error('reconstructed nationwide map or ranking interaction did not complete');
    if(app.featureAudit&&Object.values(app.featureChecks||{}).some(value=>!value))throw new Error(`requested feature check failed: ${JSON.stringify(app.featureChecks)}`);
    if(app.featureAudit&&app.nationalMunicipalityMapMs>5000)throw new Error(`national municipality map exceeded 5000ms: ${app.nationalMunicipalityMapMs}`);
  };
  const sampling=await collectPerformanceSamples(
    app=>app==='legacy'?measureApp('legacy-official-build-local',legacyUrl):measureApp('reconstructed-build-local',reconstructedUrl),
    validateApp,{onSample:sample=>attemptedSamples.push(sample)}
  );
  report.sampling=sampling;
  // Only the map-switching gate uses medians. Other diagnostics below describe
  // the first measured pair. Each pair validates maps/errors/long tasks; all
  // optional-feature and absolute-time checks run on the separate feature page.
  const legacyResult=summarizeMapSamples(sampling.samples.legacy);
  const reconstructedResult=summarizeMapSamples(sampling.samples.reconstructed);
  const ratio=(newValue,oldValue)=>+(newValue/oldValue).toFixed(4);
  const comparisons={
    initialNavigationWall:ratio(reconstructedResult.initialNavigationWallMs,legacyResult.initialNavigationWallMs),
    firstContentfulPaint:ratio(reconstructedResult.initial.firstContentfulPaint,legacyResult.initial.firstContentfulPaint),
    nationalMap:ratio(reconstructedResult.nationalMapMs,legacyResult.nationalMapMs),
    ...(baseline==='reconstructed-production'?{activePanelsNationalMap:ratio(reconstructedResult.activePanelsNationalMapMs,legacyResult.activePanelsNationalMapMs),activePanelsMunicipalityMap:ratio(reconstructedResult.activePanelsMunicipalityMapMs,legacyResult.activePanelsMunicipalityMapMs)}:{}),
    municipalityMap:ratio(reconstructedResult.municipalityMapMs,legacyResult.municipalityMapMs),
    maximumLongTask:ratio(reconstructedResult.longTasks.maximumMs,legacyResult.longTasks.maximumMs)
  };
  let mapRegression;
  try{assertMapPerformance(baseline,legacyResult,reconstructedResult)}catch(error){mapRegression=error}
  report={...report,environment:'Chrome headless; both builds served locally with identical no-store headers; matched primary-map samples',legacy:legacyResult,reconstructed:reconstructedResult,ratiosReconstructedOverLegacy:comparisons,mapRegression:mapRegression?.message};
  const featureAudit=await measureApp('reconstructed-build-local',reconstructedUrl,true);
  validateApp(featureAudit);
  report.featureAudit=featureAudit;
  report.pass=!mapRegression;
  if(mapRegression)throw mapRegression;
}catch(error){
  report.pass=false;report.error={name:error.name,message:error.message,stack:error.stack};
  throw error;
}finally{
  if(browser)await browser.close();
  await Promise.all([legacy,candidate].map(server=>new Promise(done=>server.close(done))));
  report.hostAfter=hostSnapshot();
  // A valid JSON file survives timeouts/functional failures as well as the
  // performance gate. CI uploads it with always(); stdout is a compact summary.
  await writeFile('browser-performance.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({pass:report.pass,baseline,protocol:report.protocol,ratios:report.ratiosReconstructedOverLegacy,error:report.error?.message,diagnostics:'browser-performance.json'}));
}
