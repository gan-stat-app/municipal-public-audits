import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root=resolve('..'),port=4192,base=process.env.LIFE_EXPECTANCY_BASE_URL||`http://127.0.0.1:${port}`;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.gz':'application/json'};
const server=createServer(async(req,res)=>{
  try{
    let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.endsWith('/'))pathname+='index.html';
    const file=resolve(root,`.${pathname}`);
    if(file!==root&&!file.startsWith(root+sep))throw new Error('outside root');
    if(!(await stat(file)).isFile())throw new Error('not file');
    res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'"});
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found')}
});
await new Promise((ok,fail)=>server.once('error',fail).listen(port,'127.0.0.1',ok));
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});
  const errors=[],blockedAnalytics=[];
  page.on('pageerror',error=>errors.push(`page:${error.message}`));
  page.on('console',message=>{
   if(message.type()!=='error')return;
   const text=message.text();
   // Production injects Cloudflare analytics; the site's same-origin CSP correctly blocks it.
   // Record this one known block, while preserving all application and other CSP failures.
   if(process.env.LIFE_EXPECTANCY_BASE_URL&&/^Loading the script 'https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js(?:\/[^']*)?' violates the following Content Security Policy directive:/.test(text))blockedAnalytics.push(text);
   else errors.push(`console:${text}`);
  });
  page.on('response',response=>{if(response.status()>=400)errors.push(`http:${response.status()}:${response.url()}`)});
  await page.goto(`${base}/life-expectancy/`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#selectedValue')?.textContent?.includes('年'));
  assert.match(await page.locator('h1').textContent(),/平均寿命/);
  assert.equal(await page.locator('#map .map-region').count(),47);
  assert.equal(await page.locator('#mapLegend .legend-item').count(),8);
  assert.notEqual(await page.locator('#mapLegend .swatch').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('.rank-row').count(),47);
  assert.match(await page.locator('#selectedLabel').textContent(),/秋田県・2024年・総数/);
  await page.selectOption('#sex','female');
  assert.match(await page.locator('#selectedLabel').textContent(),/女性/);
  await page.selectOption('#pref','P47');
  assert.equal((await page.locator('#selectedValue').textContent()).trim(),'86.96年');
  await page.selectOption('#sex','male');
  assert.equal((await page.locator('#selectedValue').textContent()).trim(),'79.84年');
  await page.selectOption('#year','1970');
  assert.match(await page.locator('#selectedValue').textContent(),/公表値なし/);
  await page.selectOption('#pref','P01');
  assert.match(await page.locator('#selectedValue').textContent(),/年|公表値なし/);
  await page.locator('[data-family="health"]').click();
  await page.selectOption('#pref','P05');
  assert.equal(await page.locator('#sex option[value="total"]').count(),0);
  await page.selectOption('#year','2022');
  assert.equal(await page.locator('#selectedValue').textContent(),'72.43年');
  assert.match(await page.locator('#selectedCI').textContent(),/71.71～73.15/);
  assert.equal(await page.locator('.rank-row').count(),47);
  await page.selectOption('#pref','P43');
  await page.selectOption('#year','2016');
  assert.equal(await page.locator('#selectedValue').textContent(),'公表値なし');
  assert.equal(await page.locator('.rank-row').count(),46);
  await page.selectOption('#scope','city');
  assert.equal(await page.locator('#map').isVisible(),false);
  await page.selectOption('#year','2022');
  assert.equal(await page.locator('.rank-row').count(),21);
  await page.locator('[data-family="kdb"]').click();
  await page.selectOption('#pref','P05');
  await page.selectOption('#year','2024');
  assert.equal(await page.locator('#selectedValue').textContent(),'78.8年');
  assert.match(await page.locator('#selectedCI').textContent(),/78.4～79.1/);
  await page.selectOption('#measure','gap');
  assert.equal(await page.locator('#selectedValue').textContent(),'1.3年');
  assert.equal(await page.locator('#selectedCI').textContent(),'');
  await page.locator('[data-family="life"]').click();
  await page.selectOption('#scope','municipality');
  await page.selectOption('#area','M05:秋田市');
  assert.equal(await page.locator('#selectedValue').textContent(),'81.2年');
  assert.equal(await page.locator('#nationalValue').textContent(),'81.5年');
  assert.match(await page.locator('#rankDenominator').textContent(),/1887市区町村/);
  await page.waitForFunction(()=>document.querySelector('#map')?.querySelectorAll('path').length>0&&!document.querySelector('#map').hasAttribute('hidden'));
  await page.selectOption('#year','2015');
  assert.equal(await page.locator('#map').isVisible(),false);
  assert.equal(await page.locator('#trend polyline').count(),0);
  await page.selectOption('#pref','P01');
  await page.selectOption('#area','M01:札幌市中央区');
  assert.equal(await page.locator('#selectedValue').textContent(),'80.7年');
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#selectedValue')?.textContent==='80.7年');
  assert.equal(await page.locator('#scope').inputValue(),'municipality');
  await page.selectOption('#year','2020');
  await page.selectOption('#rankingScope','all');
  await page.fill('#search','秋田市');
  assert.equal(await page.locator('.rank-row').count(),2); // 秋田市・北秋田市
  await page.locator('.rank-row[data-area="M05:秋田市"]').click();
  assert.equal(await page.locator('#pref').inputValue(),'P05');
  assert.equal(await page.locator('#selectedValue').textContent(),'81.2年');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log(JSON.stringify({viewport,pass:true,knownAnalyticsCspBlocks:blockedAnalytics.length,applicationErrors:errors.length}));
 }
 console.log('life expectancy browser test: PASS');
}finally{
  if(browser)await browser.close();
  await new Promise(resolveClose=>server.close(resolveClose));
}
