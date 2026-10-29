import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(new URL('../../',import.meta.url).pathname);
const server=http.createServer((req,res)=>{const f=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));try{const p=fs.statSync(f).isDirectory()?path.join(f,'index.html'):f;const csp=fs.readFileSync(path.join(root,'_headers'),'utf8').match(/Content-Security-Policy: (.+)/)[1];res.setHeader('Content-Security-Policy',csp);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.json')?'application/json':p.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(p));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(4185,'127.0.0.1',resolve));
import{chromium}from'playwright-core';import assert from'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
let loads=0;page.on('request',r=>{if(r.url().includes('/data/death-difference/'))loads++;});
await page.goto('http://127.0.0.1:4185/?area=03000&start=2020&end=2024&sex=%E7%94%B7#standardized-mortality');
const button=page.getByRole('button',{name:'死亡数差ピラミッドを見る',exact:true});await button.waitFor();assert.equal(loads,0);
await button.click();await page.locator('.death-difference svg').first().waitFor({timeout:30000});assert.equal(await page.locator('.death-difference svg g[role="button"]').count(),42);assert.equal(await page.locator('.death-difference h3').innerText(),'岩手県の死亡数差ピラミッド');
assert.ok((await page.locator('.death-difference-panels').innerText()).includes('45,937'));assert.ok((await page.locator('.death-difference-panels').innerText()).includes('年齢不詳 1人'));
await page.locator('.death-difference svg g[role="button"]').first().click();assert.ok((await page.locator('.death-difference-detail').innerText()).includes('95％信頼区間'));
await page.locator('.death-difference').screenshot({path:'/tmp/death-difference-desktop.png'});
await page.setViewportSize({width:390,height:844});await page.locator('.death-difference').screenshot({path:'/tmp/death-difference-mobile.png'});const openWidth=await page.evaluate(()=>document.documentElement.scrollWidth);assert.ok(await page.locator('.death-difference').evaluate(e=>e.getBoundingClientRect().right<=window.innerWidth && e.scrollWidth<=e.clientWidth));
await page.getByRole('button',{name:'死亡数差ピラミッドを閉じる',exact:true}).click();assert.equal(await page.locator('.death-difference').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),openWidth);
// Cause data is fetched only after opening; municipality cause views remain blocked.
for(const [area,cause,start,end,label] of [['03000','Se02',2020,2024,'悪性新生物'],['05000','SeCO',2015,2015,'大腸の悪性新生物'],['03000','SeIH',2020,2024,'虚血性心疾患']]){
 let causeLoads=0;const listener=r=>{if(r.url().includes('/death-difference/causes/'))causeLoads++;};page.on('request',listener);
 await page.goto(`http://127.0.0.1:4185/?area=${area}&cause=${cause}&start=${start}&end=${end}#standardized-mortality`);
 await button.waitFor();assert.equal(causeLoads,0);await button.click();
 await page.locator('.death-difference svg').first().waitFor({timeout:30000});
 assert.equal(await page.locator('.death-difference svg g[role="button"]').count(),42);
 assert.ok((await page.locator('.death-difference').innerText()).includes(label));assert.equal(causeLoads,1);
 assert.ok(await page.locator('.death-difference').evaluate(e=>e.getBoundingClientRect().right<=window.innerWidth && e.scrollWidth<=e.clientWidth));
 if(cause==='Se02')await page.locator('.death-difference').screenshot({path:'/tmp/death-difference-causes-mobile.png'});
 page.off('request',listener);
}
await page.goto('http://127.0.0.1:4185/?area=05201&cause=Se02&start=2020&end=2024#standardized-mortality');await button.waitFor();assert.equal(await button.isDisabled(),true);assert.ok((await page.locator('.death-difference-entry').innerText()).includes('死因別のピラミッドは計算できません'));
assert.deepEqual(errors,[]);console.log('PASS: lazy loading, all-cause and cause-specific 42 age/sex rows, municipal explanation, composite-cause URL, desktop/mobile/tap/close');await browser.close();server.close();
