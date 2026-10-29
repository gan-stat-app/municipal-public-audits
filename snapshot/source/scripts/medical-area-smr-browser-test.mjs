import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../',import.meta.url)),root=path.resolve(source,'..');
const out=path.join(source,'medical-area-review');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'')||'index.html';
 if(relative.includes('..')){res.writeHead(400).end();return}
 const file=path.join(relative.startsWith('data/')||relative.startsWith('regional-healthcare-vision/')||relative.startsWith('age-specific-mortality/')||relative.startsWith('population/')?root:path.join(source,'dist'),relative);
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}
 const ext=path.extname(file);
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[ext]||'application/octet-stream');
 res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true});
const reports=[];
try{
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const waitTrend=name=>page.getByRole('heading',{name:`${name}の標準化死亡比の推移`,exact:true}).waitFor();
  const control=name=>page.locator('#standardized-mortality label').filter({hasText:new RegExp('^'+name)}).locator('select');
  await page.goto('http://127.0.0.1:'+server.address().port+'/?mode=arbitrary&unit=medical-area&medical_area=0504&basis=juki&cause=Se00&area=05201&sex=%E7%94%B7&start=2020&end=2024#standardized-mortality');
  await page.locator('#standardized-mortality .metric-grid').waitFor();
  assert.equal(await control('地域単位').inputValue(),'medical-area');
  assert.equal(await control('2次医療圏').inputValue(),'0504');
  await page.locator('#standardized-mortality').screenshot({path:path.join(out,'controls-'+width+'.png')});
  assert(await page.locator('.trend-chart').textContent().then(t=>t.includes('2024')));
  await waitTrend('秋田周辺');
  await page.locator('section[aria-labelledby="smr-trend-title"]').screenshot({path:path.join(out,'trend-title-'+width+'.png')});
  const map=page.locator('section').filter({has:page.getByRole('group',{name:'2次医療圏の地図範囲',exact:true})});
  await page.getByRole('heading',{name:'都道府県内2次医療圏・標準化死亡比地図',exact:true}).waitFor();
  await map.scrollIntoViewIfNeeded();
  await map.locator('.map-drawn-condition').filter({hasText:'地図に表示中：'}).waitFor();
  const colors=()=>page.locator('canvas').first().evaluate(canvas=>{
   const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
   const counts={};for(let i=0;i<p.length;i+=4){if(!p[i+3])continue;const key=[p[i],p[i+1],p[i+2]].join(',');counts[key]=(counts[key]||0)+1}return counts;
  });
  // Element screenshots larger than the viewport resize the page internally.
  // Make that resize explicit, then wait for the canvas to finish redrawing.
  const captureMap=async name=>{
   await page.setViewportSize({width,height:1600});
   await map.scrollIntoViewIfNeeded();
   await page.waitForTimeout(250); // debounce of the intentional viewport resize
   await map.locator('.map-loading').waitFor({state:'hidden'});
   await map.screenshot({path:path.join(out,name+'-'+width+'.png')});
   await page.setViewportSize({width,height:900});
   await page.waitForTimeout(250);
   await map.locator('.map-loading').waitFor({state:'hidden'});
  };
  await captureMap('prefecture-smr-map');
  const prefectureColors=await colors();
  await map.getByRole('button',{name:'95%信頼区間による判定',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.map-drawn-condition')?.textContent.startsWith('地図に表示中：')&&!document.querySelector('.map-loading'));
  await captureMap('prefecture-significance-map');
  await map.getByRole('group',{name:'2次医療圏の地図範囲'}).getByRole('button',{name:'全国',exact:true}).click();
  await map.getByRole('img',{name:'全国2次医療圏標準化死亡比地図',exact:true}).waitFor();
  await map.locator('.map-loading').waitFor({state:'hidden'});
  // Scope/ARIA labels update before the debounced canvas preparation. Wait
  // for the completed drawing's scope, then let its paint effect run.
  await map.locator('.map-drawn-condition').filter({hasText:'地図に表示中：'}).filter({hasText:'秋田周辺（全国2次医療圏）'}).waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.notDeepEqual(await colors(),prefectureColors,'Nationwide and prefecture maps must have different geometry');
  await map.getByRole('button',{name:'標準化死亡比の値',exact:true}).click();
  await captureMap('smr-map');
  const before=await colors();
  await map.getByRole('button',{name:'95%信頼区間による判定',exact:true}).click();
  await page.waitForFunction(()=>{
   const c=document.querySelector('canvas'),p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
   for(let i=0;i<p.length;i+=4)if(p[i]===179&&p[i+1]===59&&p[i+2]===69)return true;
   return false;
  });
  const after=await colors();assert.notDeepEqual(after,before,'Color switch must repaint cached paths');
  for(const color of ['179,59,69','170,180,186','40,125,163'])assert(after[color]>0,'Missing significance class '+color);
  await captureMap('significance-map');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert(!overflow,'Horizontal overflow '+width);
  await map.getByRole('group',{name:'2次医療圏の地図範囲'}).getByRole('button',{name:'都道府県内',exact:true}).click();
  const nationwideMap=page.locator('#national-municipality-map');
  assert.equal(await nationwideMap.locator('summary').count(),0);
  await nationwideMap.scrollIntoViewIfNeeded();
  await nationwideMap.getByRole('img',{name:'全国2次医療圏標準化死亡比地図',exact:true}).waitFor();
  await nationwideMap.locator('#map-drawn-condition-national-medical').filter({hasText:'地図に表示中：'}).filter({hasText:'秋田周辺'}).filter({hasText:'全死因'}).filter({hasText:'男性'}).filter({hasText:'2020～2024年'}).waitFor();
  await nationwideMap.locator('.map-loading').waitFor({state:'hidden'});
  assert.equal(await page.locator('[id="map-drawn-condition-medical-prefecture"]').count(),1);
  assert.equal(await page.locator('[id="map-drawn-condition-national-medical"]').count(),1);
  await nationwideMap.screenshot({path:path.join(out,'automatic-national-medical-map-'+width+'.png')});
  await page.getByRole('button',{name:'死亡数差ピラミッドを見る',exact:true}).click();
  const pyramid=page.getByRole('region',{name:'死亡数差ピラミッド',exact:true});
  await pyramid.getByRole('heading',{name:'秋田周辺の死亡数差ピラミッド',exact:true}).waitFor();
  assert.equal(await pyramid.locator('svg').count(),2);
  assert.equal(await pyramid.locator('svg g[role="button"]').count(),42);
  assert((await pyramid.innerText()).includes('13,890人／期待 13,369.8人'));
  await pyramid.locator('svg g[role="button"]').first().click();
  assert((await pyramid.locator('.death-difference-detail').innerText()).includes('観察死亡数'));
  await pyramid.screenshot({path:path.join(out,'medical-death-difference-'+width+'.png')});
  await page.getByRole('button',{name:'死亡数差ピラミッドを閉じる',exact:true}).click();
  await control('死因').selectOption('Se02');
  await page.waitForFunction(()=>document.querySelector('.death-difference-entry button')?.disabled);
  assert((await page.locator('.death-difference-entry').innerText()).includes('2次医療圏は全死因のみ'));
  await control('死因').selectOption('Se00');
  await page.waitForFunction(()=>document.querySelector('.death-difference-entry button')?.disabled===false);
  await control('都道府県').selectOption('13');
  await map.locator('.map-drawn-condition').filter({hasText:'区中央部（都道府県内2次医療圏）'}).waitFor();
  await waitTrend('区中央部');
  await captureMap('tokyo-prefecture');
  await control('都道府県').selectOption('05');
  await control('2次医療圏').selectOption('0501');
  await page.waitForFunction(()=>document.querySelector('.display-condition')?.textContent.includes('大館・鹿角'));
  await control('都道府県').selectOption('22');
  await control('2次医療圏').selectOption('2208');
  await control('人口方式').selectOption('census');
  await page.waitForFunction(()=>document.querySelector('.display-condition')?.textContent.includes('西部')&&document.querySelector('.display-condition')?.textContent.includes('国勢調査基準人口'));
  // Controls change before the debounced result fetch. Wait for the known
  // census result itself, not a metric container belonging to the old query.
  const expectedWestern=['25,437','27,215.4','93.5','92.3–94.6'];
  const waitWestern=()=>page.waitForFunction(expected=>{
   const values=[...document.querySelectorAll('#standardized-mortality .metric-value')].map(x=>x.textContent);
   return JSON.stringify(values)===JSON.stringify(expected)?values:false;
  },expectedWestern).then(handle=>handle.jsonValue());
  const westernValues=await waitWestern();
  await waitTrend('西部');
  await page.reload();
  assert.deepEqual(await waitWestern(),westernValues);
  await waitTrend('西部');
  assert.equal(await control('2次医療圏').inputValue(),'2208');
  await control('地域単位').selectOption('municipality');
  await page.getByRole('heading',{name:'全国都道府県・標準化死亡比地図',exact:true}).waitFor();
  await control('都道府県').selectOption('05');
  await control('自治体').selectOption('05201');
  await page.getByRole('heading',{name:'市町村・標準化死亡比地図',exact:true}).waitFor();
  await page.locator('#standardized-mortality .metric-grid').waitFor();
  await waitTrend('秋田市');
  // Previously, medical -> municipality left the population observer detached.
  await page.locator('#population-pyramid').scrollIntoViewIfNeeded();
  await page.locator('#population-pyramid .pyramid-chart').waitFor();
  assert((await page.locator('#population-pyramid .pyramid-row').count())>=17);
  await page.locator('#population-pyramid .population-pyramid').screenshot({path:path.join(out,'population-restored-'+width+'.png')});
  await control('地域単位').selectOption('medical-area');
  await page.getByRole('heading',{name:'都道府県内2次医療圏・標準化死亡比地図',exact:true}).waitFor();
  await page.locator('#population-pyramid').scrollIntoViewIfNeeded();
  await page.locator('#population-pyramid .pyramid-chart').waitFor();
  await page.locator('#population-pyramid .population-pyramid h2').filter({hasText:'秋田県'}).waitFor();
  await control('表示方式').selectOption('official');
  await page.getByRole('heading',{name:'国公式5年標準化死亡比',exact:true}).waitFor();
  await page.locator('#standardized-mortality .metric-grid').waitFor();
  assert.equal(await control('地域単位').count(),0);
  assert.deepEqual(errors,[]);
  reports.push({width,passed:true,significanceColors:3,urlRestored:true,municipalityAndOfficial:true,westernValues,selectedRegionTrendTitle:true,prefectureMedicalMap:true,automaticNationalMedicalMap:true,tokyoInsets:true,medicalDeathDifference:true,populationRestored:true});
  await page.close();
 }
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({pass:true,reports},null,2));
 console.log(JSON.stringify({pass:true,reports}));
}finally{await browser.close();await new Promise(r=>server.close(r))}

