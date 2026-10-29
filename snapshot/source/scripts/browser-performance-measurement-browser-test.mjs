import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {primaryMapExpectation,primaryMapState,waitForPrimaryMap,CHROME_PATH,CHROME_ARGS,VIEWPORT} from './browser-performance-measurement.mjs';

const expected=primaryMapExpectation('national','05000');
let browser,page;
const diagnostic={pass:false,expected};
try{
  browser=await chromium.launch({executablePath:CHROME_PATH,headless:true,args:CHROME_ARGS});
  page=await browser.newPage({viewport:VIEWPORT});
  await page.route('**/audit?*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><section class="section-panel"><h2>全国都道府県・標準化死亡比地図</h2><div class="map-frame"><p id="map-drawn-condition-national">地図に表示中：前の条件</p><canvas width="600" height="300" aria-label="全国都道府県標準化死亡比地図"></canvas></div></section><aside role="status">全国地図を読み込み中</aside>`}));
  await page.goto('http://127.0.0.1/audit?area=05000');
  diagnostic.characterSet=await page.evaluate(()=>document.characterSet);
  diagnostic.canvasLabel=await page.locator('canvas').getAttribute('aria-label');
  assert.equal(diagnostic.characterSet,'UTF-8');
  assert.equal(diagnostic.canvasLabel,'全国都道府県標準化死亡比地図');
  // A new visible heading/old canvas must not resolve readiness during the
  // app's debounced selection, even with no target overlay yet.
  assert.equal(await page.evaluate(primaryMapState,{...expected,readyOnly:true}),false);
  await page.evaluate(description=>{
    window.drawFinished=false;
    setTimeout(()=>{
      const canvas=document.querySelector('canvas'),context=canvas.getContext('2d');
      context.fillStyle='#123f4b';context.fillRect(0,0,600,300);
      document.getElementById('map-drawn-condition-national').textContent=`地図に表示中：${description}`;
      window.drawFinished=true;
    },180);
  },expected.description);
  await waitForPrimaryMap(page,expected,{timeout:5000});
  assert.equal(await page.evaluate(()=>window.drawFinished),true);
  assert.equal(await page.locator('aside').textContent(),'全国地図を読み込み中');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data]),[18,63,75,255]);
  await page.evaluate(()=>history.replaceState(null,'','?area=06000'));
  assert.equal(await page.evaluate(primaryMapState,{...expected,readyOnly:true}),false);
  await page.evaluate(()=>history.replaceState(null,'','?area=05000'));

  // Real target work is still mandatory; a target overlay forces a timeout.
  await page.evaluate(()=>{
    const overlay=document.createElement('div');overlay.className='map-loading';
    document.querySelector('.map-frame').append(overlay);
  });
  await assert.rejects(()=>waitForPrimaryMap(page,expected,{timeout:250}),error=>error.name==='TimeoutError');
  await page.locator('.map-loading').evaluate(node=>node.remove());
  await waitForPrimaryMap(page,expected,{timeout:5000});
  // Neither stale condition changes nor a missing target canvas can pass.
  for(const mutation of ['condition','canvas']){
    await page.evaluate(mutation=>{
      if(mutation==='condition')document.getElementById('map-drawn-condition-national').textContent='地図に表示中：旧地域';
      else document.querySelector('canvas').remove();
    },mutation);
    assert.equal(await page.evaluate(primaryMapState,{...expected,readyOnly:true}),false);
  }
  diagnostic.pass=true;
  console.log('PASS: delayed target draw, painted canvas, unrelated loading, target timeout, stale conditions and missing canvas');
}catch(error){diagnostic.error={name:error.name,message:error.message};throw error}
finally{
  if(page)diagnostic.lastState=await page.evaluate(primaryMapState,expected).catch(()=>null);
  await writeFile('browser-performance-fixture.json',JSON.stringify(diagnostic,null,2)+'\n');
  console.log(JSON.stringify(diagnostic));
  if(browser)await browser.close();
}
