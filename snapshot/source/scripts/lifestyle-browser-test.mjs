import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('..'),port=4193,base=`http://127.0.0.1:${port}`,mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.gz':'application/gzip'};
const server=createServer(async(req,res)=>{try{let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname.endsWith('/'))pathname+='index.html';const file=resolve(root,`.${pathname}`);if(file!==root&&!file.startsWith(root+sep))throw new Error();if(!(await stat(file)).isFile())throw new Error();res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(await readFile(file))}catch{res.writeHead(404);res.end('Not found')}});
await new Promise((ok,fail)=>server.once('error',fail).listen(port,'127.0.0.1',ok));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport}),errors=[];
  page.on('pageerror',e=>errors.push(`page:${e.message}`));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('Failed to load resource'))errors.push(`console:${m.text()}`)});page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))errors.push(`http:${r.status()}:${r.url()}`)});
  await page.goto(`${base}/lifestyle/`,{waitUntil:'networkidle'});await page.waitForTimeout(1500);if(errors.length)throw new Error(errors.join('\n'));await page.waitForFunction(()=>document.querySelector('#selectedValue')?.textContent?.includes('%'),null,{timeout:10000});
  assert.match(await page.locator('h1').textContent(),/生活習慣・栄養・身体活動/);assert.equal(await page.locator('#map .map-region').count(),47);assert.equal(await page.locator('#mapLegend .legend-item').count(),8);assert.match(await page.locator('#selectedLabel').textContent(),/秋田県・2025年・男女計・粗率/);assert.equal(await page.locator('#year').inputValue(),'2025');assert.equal(await page.locator('#highRank li').count(),5);assert.equal(await page.locator('#lowRank li').count(),5);
  assert.equal((await page.locator('.age-sample-note').textContent()).trim(),'標本調査に基づく推計割合です。都道府県・性別・年齢階級に分けると標本数が限られるため、小さな差や単年の変動の解釈には注意が必要です。');assert.equal(await page.locator('.age-sample-note').isVisible(),true);
  assert.ok(await page.locator('#ageChart .age-row').count()>0);assert.ok(await page.locator('#ageChart .bar-local').count()>0);assert.ok(Number(await page.locator('#ageChart .bar-local').first().getAttribute('width'))>0);assert.notEqual(await page.locator('#mapLegend .swatch').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  await page.getByRole('button',{name:'飲酒',exact:true}).click();await page.getByRole('button',{name:'毎日',exact:true}).click();assert.match(await page.locator('#definition').textContent(),/毎日飲酒率/);assert.equal(await page.locator('.age-sample-note').isVisible(),true);
  await page.locator('#sex button[data-value="男性"]').click();await page.locator('#mode button[data-value="年齢調整率"]').click();assert.match(await page.locator('#selectedLabel').textContent(),/男性・年齢調整率/);assert.equal(await page.locator('#map .map-region').count(),47);
  await page.getByRole('button',{name:'栄養・身体活動',exact:true}).click();
  await page.getByRole('button',{name:'野菜',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#selectedValue')?.textContent?.includes('g/日'));
  assert.match(await page.locator('#selectedLabel').textContent(),/男性/);assert.match(await page.locator('#definition').textContent(),/野菜摂取量/);assert.equal(await page.locator('#map .map-region').count(),47);assert.equal(await page.locator('#ageCard').isHidden(),true);assert.equal(await page.locator('.age-sample-note').isHidden(),true);
  await page.getByRole('button',{name:'歩数',exact:true}).click();assert.match(await page.locator('#selectedValue').textContent(),/歩\/日/);
  await page.selectOption('#year','2016');await page.selectOption('#pref','熊本県');assert.equal(await page.locator('#selectedValue').textContent(),'公表値なし');
  await page.selectOption('#pref','東京都');assert.match(await page.locator('#selectedLabel').textContent(),/東京都/);assert.equal(errors.length,0,errors.join('\n'));
 }
 console.log('lifestyle browser test: PASS');
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok))}
