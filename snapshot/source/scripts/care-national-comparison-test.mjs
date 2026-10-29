import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const builtIndex=process.argv.indexOf('--built');
const publicRoot=builtIndex<0?root:resolve(root,'source',process.argv[builtIndex+1]);
const review=resolve(process.env.CARE_REVIEW_DIR||resolve(root,'source/care/browser-review'),builtIndex<0?'published':'built');
const manifest=JSON.parse(await readFile(resolve(root,'care/data/manifest.json'),'utf8'));
async function dataset(name){
 const spec=manifest.datasets[name],parts=await Promise.all(spec.files.map(async p=>JSON.parse(gunzipSync(await readFile(resolve(root,'care',p))))));
 if(spec.kind==='array')return parts.flat();
 return parts.reduce((out,p)=>{for(const [k,v] of Object.entries(p))out[k]=Array.isArray(v)?[...(out[k]||[]),...v]:v;return out},{})
}
const core=JSON.parse(gunzipSync(await readFile(resolve(root,'care/data/care_2024_core.json.gz'))));
const legacy=await dataset('d'),all=[...legacy,...core.d];
const national=JSON.parse(await readFile(resolve(root,'care/data/national-recognition.json'),'utf8'));
// Independent official national first-insured totals, not all-age/first-plus-second recognition.
const expectedTotals=[[2021,35886884,6765995],[2022,35845134,6814344],[2023,35889733,6952265],[2024,35839278,7075896]];
assert.deepEqual(national.records.map(x=>[+x.period,x.insured_total,x.certified_1st_total]),expectedTotals);
for(const r of national.records){assert.equal(r.certified_by_degree.reduce((a,b)=>a+b,0),r.certified_1st_total);assert.equal(r.certified_by_sex.male+r.certified_by_sex.female,r.certified_1st_total)}
const fmt=x=>Number.isFinite(x)?new Intl.NumberFormat('ja-JP',{minimumFractionDigits:2,maximumFractionDigits:2}).format(x):'—';
const rate=x=>Number.isFinite(x)?fmt(x)+'%':'—';
const points=x=>Number.isFinite(x)?(Number(x.toFixed(2))>0?'+':'')+fmt(Number(x.toFixed(2)))+'ポイント':'—';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.gz':'application/gzip'};
const server=createServer(async(req,res)=>{try{let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(pathname.endsWith('/'))pathname+='index.html';const file=resolve(publicRoot,`.${pathname}`);if(!file.startsWith(publicRoot+sep)||!(await stat(file)).isFile())throw new Error();res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});res.end(await readFile(file))}catch{res.writeHead(404);res.end('Not found')}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
async function checkRegion(page,p,n,year){
 const row=all.find(x=>x.period===year&&x.prefecture===p&&x.insurer===n);
 const country=expectedTotals.find(x=>String(x[0])===year),nr=country[2]/country[1]*100;
 await page.waitForFunction(([p,n,y])=>document.querySelector('#title')?.textContent===`${p} ${n}｜${y}年度`,[p,n,year]);
 assert.equal(await page.locator('#adj').textContent(),rate(row.adjusted_rate_pct));
 assert.equal(await page.locator('#nationalRate').textContent(),rate(nr));
 assert.equal(await page.locator('#nationalDifference').textContent(),points(row.adjusted_rate_pct-nr));
 if(Number.isFinite(row.adjusted_rank_national_high)){
  const expectedRank='全国 '+fmt(row.adjusted_rank_national_high).replace('.00','')+' / '+fmt(row.adjusted_n_national).replace('.00','')+'位';
  await page.waitForFunction(t=>document.querySelector('#arank')?.textContent.includes(t),expectedRank);
 }
 assert.match(await page.locator('#nationalPeriod').textContent(),new RegExp(year+'年度'));
 assert.equal(await page.locator('#crude').textContent(),rate(row.crude_rate_pct));
 assert.equal(await page.locator('#adjustmentChange').textContent(),points(row.adjusted_rate_pct-row.crude_rate_pct));
 const table=await page.locator('#tbl tr').evaluateAll(rows=>rows.map(r=>[...r.cells].map(c=>c.textContent)));
 assert.equal(table.length,4);
 for(let i=0;i<4;i++){
  const [y,insured,certified]=expectedTotals[i],local=all.find(x=>x.period===String(y)&&x.prefecture===p&&x.insurer===n),nat=100*certified/insured;
  assert.equal(table[i][0],String(y));assert.equal(table[i][1],rate(local?.adjusted_rate_pct));assert.equal(table[i][2],rate(nat));assert.equal(table[i][3],Number.isFinite(local?.adjusted_rate_pct)?points(local.adjusted_rate_pct-nat):'—');
 }
 const label=await page.locator('#chart').getAttribute('aria-label');
 assert.ok(label.includes(`${year}年度：この地域 ${rate(row.adjusted_rate_pct)}、全国 ${rate(nr)}`));
 assert.equal(await page.locator('#recognitionReference').evaluate(e=>e.open),false);
}
try{
 await mkdir(review,{recursive:true});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const viewport of [{width:1280,height:950},{width:390,height:844},{width:320,height:740}]){
  const page=await browser.newPage({viewport}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==base)external.push(r.url())});
  page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('/favicon.ico'))errors.push(r.url())});
  await page.goto(base+'/care/',{waitUntil:'networkidle'});
  await checkRegion(page,'秋田県','秋田市','2024');
  assert.equal(await page.locator('#nationalDifference').textContent(),'+0.41ポイント');
  assert.equal(await page.locator('#nationalDirection').textContent(),'全国より高い');
  // The selection unit stays insurer-wide; exact 2024 membership is display-only.
  assert.match(await page.locator('#insurer-selector-title').textContent(),/保険者を選ぶ/);
  await page.selectOption('#globalIns','大曲仙北広域市町村圏組合');
  await checkRegion(page,'秋田県','大曲仙北広域市町村圏組合','2024');
  await page.waitForFunction(()=>document.querySelector('#insurer-scope')?.textContent.includes('大仙市、仙北市、美郷町'));
  assert.match(await page.locator('#insurer-scope').textContent(),/2024年度.*市町村単独の値ではありません/);
  assert.equal(await page.locator('#insurer-scope a').getAttribute('href'),'data/insurer-scope.json');
  // A partial/reference area must never be presented as the complete insurer membership.
  await page.selectOption('#globalPref','沖縄県');
  await page.selectOption('#globalIns','沖縄県介護保険広域連合');
  assert.match(await page.locator('#insurer-scope').textContent(),/確認済みの対応資料にない/);
  assert.equal(await page.locator('#insurer-scope a').count(),0);
  await page.selectOption('#globalPref','秋田県');
  await page.selectOption('#globalIns','秋田市');
  await checkRegion(page,'秋田県','秋田市','2024');
  assert.match(await page.locator('#insurer-scope').textContent(),/秋田市保険者全体/);
  assert.ok(!(await page.locator('#insurer-scope').textContent()).includes('美郷町'));

  assert.match(await page.locator('#arank').textContent(),/295 \/ 1,571位/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page must not overflow horizontally');
  const colors=await page.locator('#chart').evaluate(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let teal=0,slate=0;for(let i=0;i<a.length;i+=4){if(a[i]===15&&a[i+1]===118&&a[i+2]===110)teal++;if(a[i]===71&&a[i+1]===85&&a[i+2]===105)slate++}return {teal,slate}});
  assert.ok(colors.teal>20&&colors.slate>20,'both region and national curves must be visible');
  await page.screenshot({path:resolve(review,`care-${viewport.width}.png`)});
  await page.locator('.recognition-primary').screenshot({path:resolve(review,`comparison-${viewport.width}.png`)});
  await page.locator('#chart').screenshot({path:resolve(review,`trend-${viewport.width}.png`)});
  // Past-year ranks load without requiring users to open the pooled reference first.
  if(viewport.width===390){await page.selectOption('#period','2023');await checkRegion(page,'秋田県','秋田市','2023');await page.selectOption('#period','2024');await checkRegion(page,'秋田県','秋田市','2024')}
  // Reference-only three-year values retain their own period and original pooled rates.
  await page.locator('#recognitionReference summary').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('#recognitionReferenceBody tr').length===5);
  const pooled=legacy.find(x=>x.prefecture==='秋田県'&&x.insurer==='秋田市'&&x.period==='2021–2023 3年');
  assert.equal(await page.locator('#recognitionReferenceBody tr').count(),5);
  assert.match(await page.locator('#recognitionReferenceBody tr').last().textContent(),/2021–2023 3年/);
  assert.equal(await page.locator('#recognitionReferenceBody tr').last().locator('td').nth(2).textContent(),rate(pooled.adjusted_rate_pct));
  await page.locator('#recognitionReference summary').focus();await page.keyboard.press('Enter');
  await page.selectOption('#period','2023');await checkRegion(page,'秋田県','秋田市','2023');
  await page.selectOption('#period','2024');await checkRegion(page,'秋田県','秋田市','2024');
  const low=[...core.d].filter(x=>Number.isFinite(x.adjusted_rate_pct)).sort((a,b)=>a.adjusted_rate_pct-b.adjusted_rate_pct)[0];
  await page.selectOption('#globalPref',low.prefecture);await page.selectOption('#globalIns',low.insurer);await checkRegion(page,low.prefecture,low.insurer,'2024');
  assert.equal(await page.locator('#nationalDirection').textContent(),'全国より低い');
  assert.equal(new URL(page.url()).searchParams.get('insurer'),low.insurer);
  const reorg=core.d.find(x=>!legacy.some(z=>z.period==='2021'&&z.prefecture===x.prefecture&&z.insurer===x.insurer));
  if(reorg){await page.selectOption('#globalPref',reorg.prefecture);await page.selectOption('#globalIns',reorg.insurer);await checkRegion(page,reorg.prefecture,reorg.insurer,'2024');assert.equal(await page.locator('#tbl tr').first().locator('td').nth(1).textContent(),'—')}
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();
 }
 // Missing and zero rates are distinct: neither reference nor regional null becomes 0%.
 const missing=await browser.newPage();
 await missing.route('**/national-recognition.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({records:[]})}));
 await missing.goto(base+'/care/',{waitUntil:'networkidle'});await missing.waitForFunction(()=>document.querySelector('#adj')?.textContent==='20.15%');
 assert.equal(await missing.locator('#nationalRate').textContent(),'—');assert.equal(await missing.locator('#nationalDifference').textContent(),'—');assert.equal(await missing.locator('#nationalDirection').textContent(),'比較できません');await missing.close();
 for(const adjusted of [null,0]){
  const page=await browser.newPage(),changed=structuredClone(core);changed.d.find(x=>x.prefecture==='秋田県'&&x.insurer==='秋田市').adjusted_rate_pct=adjusted;
  await page.route('**/care_2024_core.json.gz',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(changed)}));
  await page.goto(base+'/care/',{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#title')?.textContent.includes('秋田市｜2024年度'));
  assert.equal(await page.locator('#adj').textContent(),rate(adjusted));assert.equal(await page.locator('#nationalDifference').textContent(),adjusted===null?'—':points(-100*7075896/35839278));
  assert.equal(await page.locator('#tbl tr').last().locator('td').nth(1).textContent(),rate(adjusted));await page.close();
 }
 // Differences below the displayed precision must never show negative zero.
 for(const delta of [-.004,0,.004]){
  const page=await browser.newPage(),changed=structuredClone(core);changed.d.find(x=>x.prefecture==='秋田県'&&x.insurer==='秋田市').adjusted_rate_pct=100*7075896/35839278+delta;
  await page.route('**/care_2024_core.json.gz',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(changed)}));
  await page.goto(base+'/care/',{waitUntil:'networkidle'});await page.waitForFunction(()=>document.querySelector('#title')?.textContent.includes('秋田市｜2024年度'));
  assert.equal(await page.locator('#nationalDifference').textContent(),'0.00ポイント');assert.equal(await page.locator('#nationalDirection').textContent(),'表示桁では全国と同じ');await page.close();
 }
 console.log(`Care national comparison: ${builtIndex<0?'published':'built'} desktop/390px/320px; original values, fiscal years, pooled reference, missingness, zero, chart, keyboard, same-origin PASS`);
}finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok))}

