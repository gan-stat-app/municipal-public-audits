import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('..'),port=4194,base=`http://127.0.0.1:${port}`,mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.gz':'application/gzip'};
const server=createServer(async(req,res)=>{try{let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname.endsWith('/'))pathname+='index.html';const file=resolve(root,`.${pathname}`);if(file!==root&&!file.startsWith(root+sep))throw new Error();if(!(await stat(file)).isFile())throw new Error();res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(await readFile(file))}catch{res.writeHead(404);res.end('Not found')}});
await new Promise((ok,fail)=>server.once('error',fail).listen(port,'127.0.0.1',ok));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
 const current=JSON.parse(await readFile(resolve(root,'welfare/data-2024.json'),'utf8'));
 const previous=JSON.parse(await readFile(resolve(root,'welfare/data-2023.json'),'utf8'));
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))errors.push(r.url())});
  await page.goto(base+'/welfare/',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#year')?.value==='2024');
  assert.match(await page.locator('#surveyYear').textContent(),/2024年度/);
  const akita=current.prefectures.find(r=>r.code==='05');
  assert.equal(await page.locator('#observed').textContent(),new Intl.NumberFormat('ja-JP').format(akita.observed)+'人');
  assert.equal(await page.locator('#adjusted').textContent(),akita.adjusted_per_1000.toFixed(2));
  assert.equal(await page.locator('#ranking tr').count(),47);
  assert.equal(await page.locator('#ageBars .age-row').count(),14);
  assert.equal(await page.locator('#trend tr').count(),5);
  await page.selectOption('#year','2023');
  assert.match(await page.locator('#surveyYear').textContent(),/2023年度/);
  assert.equal(await page.locator('#adjusted').textContent(),previous.prefectures.find(r=>r.code==='05').adjusted_per_1000.toFixed(2));
  await page.selectOption('#year','2024');
  await page.selectOption('#pref','13');
  assert.equal(await page.locator('#adjusted').textContent(),current.prefectures.find(r=>r.code==='13').adjusted_per_1000.toFixed(2));
  assert.ok(new URL(page.url()).searchParams.get('year')==='2024');
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('welfare 2024 desktop/mobile data loading and year switching: PASS');
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok))}

