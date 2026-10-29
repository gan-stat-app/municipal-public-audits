import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root=resolve('..'),port=4191,url=`http://127.0.0.1:${port}/jmd/`;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.svg':'image/svg+xml','.gz':'application/json'};
const server=createServer(async(req,res)=>{
  try{
    let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.endsWith('/'))pathname+='index.html';
    const file=resolve(root,`.${pathname}`);
    if(file!==root&&!file.startsWith(root+sep))throw new Error('outside root');
    if(!(await stat(file)).isFile())throw new Error('not file');
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found')}
});
await new Promise((ok,fail)=>server.once('error',fail).listen(port,'127.0.0.1',ok));

let browser;
try{
  browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const run=async(viewport,label)=>{
    const page=await browser.newPage({viewport});
    const pageErrors=[],networkErrors=[];
    page.on('pageerror',error=>pageErrors.push(String(error)));
    page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))networkErrors.push(`${response.status()} ${response.url()}`)});
    await page.goto(url,{waitUntil:'networkidle',timeout:30000});
    await page.locator('#ranking .bar').first().waitFor({state:'visible',timeout:30000});

    assert.equal(await page.locator('#classification option').count(),5,`${label}: classification count`);
    assert.equal(await page.locator('#classification').inputValue(),'cndcs',`${label}: default classification`);
    assert.equal(await page.locator('#cause option').count(),111,`${label}: CNDcs causes`);
    assert.equal(await page.locator('#year option').count(),46,`${label}: CNDcs years`);
    assert.equal(await page.locator('#causeGroup option').count(),8,`${label}: cause group count`);
    assert.equal(await page.locator('#causeSearch').count(),1,`${label}: cause search missing`);
    assert((await page.locator('#cancerComparison .cancer-row').count())>3,`${label}: cancer comparison rows`);
    await page.locator('#causeGroup').selectOption('cancer');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length>3);
    await page.locator('#causeSearch').fill('胃');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length>0&&document.querySelectorAll('#cause option').length<10);
    assert((await page.locator('#causeSearchInfo').innerText()).includes('件を表示'),`${label}: search result info`);
    await page.locator('#causeSearch').fill('');
    await page.locator('#causeGroup').selectOption('all');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length===111);
    assert.equal(await page.locator('.map-wrap .map-region').count(),47,`${label}: map region count including Okinawa inset`);
    assert.equal(await page.locator('#map .map-region').count(),46,`${label}: main-map region count`);

    await page.locator('#classification').selectOption('jmdc_cause');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length===163);
    assert.equal(await page.locator('#year option').count(),30,`${label}: JMDC years`);
    assert((await page.locator('#classificationInfo').innerText()).includes('163区分'),`${label}: JMDC info`);

    await page.locator('#classification').selectOption('jmdc_group');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length===20);

    await page.locator('#classification').selectOption('hi');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length===19);
    assert.equal(await page.locator('#year option').count(),75,`${label}: HI years`);
    await page.locator('#year').selectOption('1975');
    await page.locator('#ranking .bar').first().waitFor({state:'visible',timeout:30000});

    await page.locator('#classification').selectOption('hcd_cause');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length===59);
    assert((await page.locator('#cause option').first().innerText()).match(/[A-Za-z]/),`${label}: official English HCD label`);

    await page.locator('#classification').selectOption('cndcs');
    await page.waitForFunction(()=>document.querySelectorAll('#cause option').length===111);
    assert.equal(await page.locator('#year option').count(),46,`${label}: CNDcs return`);
    assert.equal(pageErrors.length,0,`${label}: page errors ${pageErrors.join(' | ')}`);
    assert.equal(networkErrors.length,0,`${label}: network errors ${networkErrors.join(' | ')}`);
    if(viewport.width<=430){
      for(const selector of ['#classification','#cause','#map']){
        const box=await page.locator(selector).boundingBox();
        assert(box&&box.width<=viewport.width,`${label}: overflow ${selector}`);
      }
    }
    await page.close();
    return{label,classifications:5,cndcs:111,jmdcCause:163,jmdcGroup:20,hi:19,hcd:59};
  };
  const desktop=await run({width:1280,height:900},'desktop');
  const mobile=await run({width:390,height:844},'mobile');
  console.log(JSON.stringify({pass:true,desktop,mobile}));
}finally{
  if(browser)await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
