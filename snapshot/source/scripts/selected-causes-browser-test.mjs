import {chromium} from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import {calculateArbitraryPeriodCase} from '../src/lib/parity.js';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../',import.meta.url));
const root=path.dirname(source.replace(/[\\/]$/,''));
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),relative=decodeURIComponent(url.pathname).replace(/^\//,'');
 if(relative.includes('..')){res.writeHead(400).end();return;}
 const file=relative.startsWith('data/')?path.join(root,relative):path.join(source,'dist',relative||'index.html');
 if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 const ext=path.extname(file);res.setHeader('Content-Type',ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.html'?'text/html':ext==='.json'?'application/json':'application/octet-stream');res.end(fs.readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const executablePath=process.env.CHROMIUM_PATH||(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':'/usr/bin/google-chrome');
const browser=await chromium.launch({executablePath,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});const control=name=>page.locator('#standardized-mortality label').filter({hasText:new RegExp('^'+name)}).locator('select');const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 // Maps and the separate population panel are unchanged; isolate control/SMR
 // behavior using real local SMR files, without loading their large geometry.
 await page.route('**/data/*.geojson.gz',r=>r.fulfill({json:{type:'FeatureCollection',features:[]}}));
 const port=server.address().port;
 const check=async q=>{
  const dataset=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,`data/selected-cause-rebuild-v1/${q.basis}-${q.datasetCode}-2024-boundary.json.gz`))));
  const result=await calculateArbitraryPeriodCase({...q,dataset});assert(result?.complete);
  const fmt=(v,d=1)=>Number(v).toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d});
  const expected=[fmt(result.observed,0),fmt(result.expected),fmt(result.smr),`${fmt(result.ci95Low)}–${fmt(result.ci95High)}`];
  await page.waitForFunction(values=>JSON.stringify([...document.querySelectorAll('#standardized-mortality .metric-grid .metric-value')].map(n=>n.textContent))===JSON.stringify(values),expected);
 };
 const q={basis:'juki',datasetCode:'Se01',areaCode:'13121',sex:'男',startYear:2020,endYear:2024};
 await page.goto(`http://127.0.0.1:${port}/?mode=arbitrary&basis=juki&cause=Se01&area=13121&sex=%E7%94%B7&start=2020&end=2024#standardized-mortality`);
 await control('死因').waitFor();
 await page.locator('#standardized-mortality .metric-grid').waitFor();
 await check(q);
 assert.equal(await control('死因').locator('option').count(),37);
 await control('死因').selectOption('Se20');
 await page.getByText('心不全',{exact:true}).first().waitFor({state:'attached'});
 await page.waitForTimeout(300);
 assert.equal(await control('死因').inputValue(),'Se20');
 await control('人口方式').selectOption('census');
 await page.waitForFunction(()=>document.querySelector('#standardized-mortality .metric-grid')!==null);
 await page.locator('[data-testid="rebuild-notice"]').waitFor();
 await check({...q,basis:'census',datasetCode:'Se20'});
 await control('人口方式').selectOption('juki');
 await control('死因').selectOption('Se12');
 assert.equal(await control('性別').inputValue(),'女');
 await page.getByText('観察死亡数',{exact:true}).first().waitFor();
 await control('開始年').selectOption('2014');
 await page.locator('#standardized-mortality .metric-grid').waitFor();
 await control('開始年').selectOption('2001');
 await control('人口方式').selectOption('census');
 await page.locator('[data-testid="rebuild-notice"] strong').waitFor();
 assert(!(await page.locator('[data-testid="rebuild-notice"]').textContent()).includes('参考値'));
 assert((await page.locator('[data-testid="rebuild-notice"]').textContent()).includes('検証した改訂値'));
 await check({...q,basis:'census',datasetCode:'Se12',sex:'女',startYear:2001});
 await page.locator('#standardized-mortality .metric-grid').waitFor();
 await page.goto(`http://127.0.0.1:${port}/?mode=arbitrary&basis=census&cause=Se00&area=11100&sex=%E7%94%B7&start=2005&end=2005#standardized-mortality`);
 await check({...q,basis:'census',datasetCode:'Se00',areaCode:'11100',startYear:2005,endYear:2005});
 await page.goto(`http://127.0.0.1:${port}/?mode=arbitrary&basis=census&cause=Se00&area=22130&sex=%E7%94%B7&start=2024&end=2024#standardized-mortality`);
 await check({...q,basis:'census',datasetCode:'Se00',areaCode:'22130',startYear:2024,endYear:2024});
 if(process.env.SMR_SCREENSHOT)await page.locator('#standardized-mortality').screenshot({path:process.env.SMR_SCREENSHOT});
 await page.goto(`http://127.0.0.1:${port}/?mode=arbitrary&basis=census&cause=Se00&area=22138&sex=%E7%94%B7&start=2024&end=2024#standardized-mortality`);
 await page.getByText('2024年の浜松市の国勢調査方式は市全体を選択してください。区別の期待死亡数は配分していません。',{exact:true}).waitFor();
 assert.equal(await page.locator('#standardized-mortality .metric-grid').count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: 37 choices, actual TB/heart-failure/uterus data, female-only condition, both population methods, pre-2015 values and source-verified census revision notice');
}finally{await browser.close();await new Promise(r=>server.close(r));}
