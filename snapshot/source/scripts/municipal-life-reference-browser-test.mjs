import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,stat } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
const root=resolve('public');
const datasets={};
for(const y of [2015,2016,2017,2018,2019,2020,2021,2022,2023]){const d=JSON.parse(await readFile(resolve(root,`life-expectancy/municipal-reference/data/estimates-${y}.json`),'utf8'));assert.equal(d.year,y);assert.equal(d.rows.length,1882);assert.equal(new Set(d.rows.map(r=>r.code)).size,1882);assert.equal(Object.keys(d.prefectures).length,47);for(const r of d.rows)for(const sex of ['male','female'])assert.ok(Number.isFinite(r[sex])&&r[sex]>0&&r[sex]<120);datasets[y]=d;}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.csv':'text/csv; charset=utf-8','.zip':'application/zip'};
const server=createServer(async(req,res)=>{
 try{
  let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(path.endsWith('/'))path+='index.html';
  const file=resolve(root,`.${path}`);if(!file.startsWith(root+sep)||!(await stat(file)).isFile())throw Error('not file');
  res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'"});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base=`http://127.0.0.1:${server.address().port}`,route='/life-expectancy/municipal-reference/';
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+route,{waitUntil:'networkidle'});
  for(const y of [2023,2022,2021,2020,2019,2018,2017,2016,2015]){
   await page.selectOption('#year',String(y));await page.waitForFunction(()=>!document.getElementById('pref').disabled);
   assert.equal(await page.locator('#populationNote').isVisible(),y===2015);await page.selectOption('#pref','05');await page.selectOption('#area','05201');
   for(const sex of ['male','female']){await page.selectOption('#sex',sex);assert.equal(await page.textContent('#estimate'),datasets[y].rows.find(r=>r.code==='05201')[sex].toFixed(1)+'年');assert.match(await page.textContent('#period'),new RegExp(`${y-1}～${y+1}`));}
  }
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.inputValue('#year'),'2015');assert.equal(await page.inputValue('#sex'),'female');assert.equal(await page.inputValue('#area'),'05201');
  await page.selectOption('#pref','all');assert.equal(await page.locator('#rows tr').count(),100);await page.click('#more');assert.equal(await page.locator('#rows tr').count(),200);
  await page.fill('#search','浜松市');assert.equal(await page.locator('#rows tr').count(),1);await page.click('#rows button');assert.match(await page.textContent('#areaNote'),/浜松市全体/);
  await page.fill('#search','該当しない地域xyz');assert.equal(await page.locator('#rows tr').count(),0);assert.match(await page.textContent('#status'),/該当する地域はありません/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile overflow');
  await page.goto(base+route+'methods.html',{waitUntil:'networkidle'});assert.match(await page.textContent('h1'),/計算方法と限界/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  for(const n of ['reference-estimates.csv','calculation-kit.zip'])assert.equal((await page.request.get(base+route+'data/'+n)).status(),200);
  assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage();await page.goto(base+route+'?year=2000&pref=bad&area=bad&sex=total',{waitUntil:'networkidle'});assert.equal(await page.inputValue('#year'),'2023');assert.equal(await page.inputValue('#pref'),'05');
 await page.route('**/data/estimates-2021.json',r=>r.fulfill({status:503,body:'error'}));await page.selectOption('#year','2021');await page.waitForFunction(()=>document.getElementById('status').className==='error');assert.equal(await page.textContent('#estimate'),'—');assert.equal(await page.locator('#rows tr').count(),0);assert.equal(await page.locator('#pref').isDisabled(),true);
 await page.selectOption('#year','2023');await page.waitForFunction(()=>!document.getElementById('pref').disabled);assert.match(await page.textContent('#condition'),/2023/);
 console.log(JSON.stringify({status:'passed',pairs:33876,years:[2015,2016,2017,2018,2019,2020,2021,2022,2023],checks:['values','periods','selection','URL','search','pagination','mobile','downloads','load failure','recovery','CSP']}));
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
