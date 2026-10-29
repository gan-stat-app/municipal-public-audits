import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

const source=fileURLToPath(new URL('../',import.meta.url)),root=path.dirname(source.replace(/\/$/,''));
const builtIndex=process.argv.indexOf('--built'),publicRoot=builtIndex<0?path.join(source,'public'):path.resolve(process.argv[builtIndex+1]);
const review=path.join(source,'school-trend-review');
fs.mkdirSync(review,{recursive:true});
const csp=fs.readFileSync(path.join(root,'_headers'),'utf8').match(/Content-Security-Policy:\s*(.+)/)[1];
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'');
 if(relative.includes('..')){res.writeHead(400).end();return}
 const name=relative.endsWith('/')?relative+'index.html':relative;
 const published=path.join(publicRoot,name),file=fs.existsSync(published)?published:path.join(root,name);
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}
 const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/json'}[path.extname(file)]||'application/octet-stream';
 res.setHeader('Content-Type',type);
 if(path.extname(file)==='.html')res.setHeader('Content-Security-Policy',csp);
 res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const reports=[];
try{
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',headless:true,args:process.env.SCHOOL_BROWSER_ARGS?JSON.parse(process.env.SCHOOL_BROWSER_ARGS):['--no-sandbox']});
 const page=await browser.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('request',r=>requests.push(r.url()));
 async function select(id,value){await page.locator('#'+id).selectOption(value)}
 async function read(){
  return page.evaluate(()=>{
   const svg=document.querySelector('#trendChart svg'),box=document.querySelector('#trendChart');
   return {
    years:[...svg.querySelectorAll('text[text-anchor="middle"]')].map(t=>+t.textContent),
    prefTitles:[...svg.querySelectorAll('.dot-pref title')].map(t=>t.textContent),
    nationalTitles:[...svg.querySelectorAll('.dot-national title')].map(t=>t.textContent),
    prefPath:svg.querySelector('.line-pref').getAttribute('d'),
    note:document.querySelector('#trendMissing').textContent,
    containerWidth:box.clientWidth,scrollWidth:box.scrollWidth,svgWidth:svg.getBoundingClientRect().width,
    documentWidth:document.documentElement.scrollWidth,viewportWidth:window.innerWidth,
   };
  });
 }
 const years=Array.from({length:20},(_,i)=>2006+i);
 for(const width of [1200,390,320]){
  await page.setViewportSize({width,height:900});
  await page.goto('http://127.0.0.1:'+server.address().port+'/school-dental/');
  await page.waitForSelector('#trendChart svg');
  assert.equal(requests.filter(url=>url.includes('school-body.json.gz')).length,0,'体格データを初期表示で取得した');
  await select('theme','vision');await select('metric','vision_below_1');await select('year','2025');await select('age','12');await select('pref','05');
  for(const sex of ['total','male','female']){
   await select('sex',sex);
   const r=await read();
   assert.deepEqual(r.years,years);
   assert.ok(r.note.includes('2025年度（公表値なし）'));
   assert.ok(!r.prefTitles.some(t=>t.startsWith('2025年度')));
   assert.ok(r.nationalTitles.some(t=>t.startsWith('2025年度 全国')));
   assert.ok(r.documentWidth<=width+1,'ページが横にはみ出す');
   assert.ok(r.svgWidth>=640,'年度ラベルが縮小された');
   assert.ok(r.scrollWidth>r.containerWidth,'全年度をスクロールできない');
   reports.push({width,pref:'05',year:2025,sex,...r});
   if(sex==='total')await page.locator('article').filter({has:page.locator('#trendChart')}).screenshot({path:path.join(review,width+'-akita-vision.png')});
  }
  await select('theme','dental');await select('metric','dmft');await select('year','2011');await select('sex','total');
  for(const pref of ['03','04','07']){
   await select('pref',pref);
   const r=await read();
   assert.deepEqual(r.years,years);
   assert.ok(r.note.includes('2011年度（調査対象外）'));
   assert.ok(!r.prefTitles.some(t=>t.startsWith('2011年度')));
   assert.ok(r.nationalTitles.some(t=>t.startsWith('2011年度 全国')));
   assert.equal((r.prefPath.match(/M/g)||[]).length,2,'2011年度の前後を線で結んだ');
   assert.ok((await page.locator('#pref option[value="'+pref+'"]').textContent()).includes('調査対象外'));
   assert.ok((await page.locator('#map [data-code="'+pref+'"] title').textContent()).includes('調査対象外'));
   reports.push({width,pref,year:2011,sex:'total',...r});
   if(pref==='03')await page.locator('article').filter({has:page.locator('#trendChart')}).screenshot({path:path.join(review,width+'-iwate-dmft.png')});
  }
  await select('theme','body');
  await page.waitForFunction(()=>BODY_LOADED);
  await select('metric','obesity_rate');await select('pref','07');
  const body=await read();
  assert.deepEqual(body.years,years);
  assert.ok(body.note.includes('2011年度（調査対象外）'));
  assert.equal((body.prefPath.match(/M/g)||[]).length,2);
  reports.push({width,pref:'07',metric:'obesity_rate',year:2011,...body});
  await select('pref','00');
  const national=await read();
  assert.deepEqual(national.years,years);
  assert.equal(national.nationalTitles.length,0);
  assert.equal(national.note,'欠測年度：なし。');
  const before=requests.length;
  await page.locator('#trendChart').evaluate(el=>{el.scrollLeft=el.scrollWidth});
  assert.equal(requests.length,before,'グラフのスクロールでデータを取得した');
  assert.ok(await page.locator('#trendChart').evaluate(el=>el.scrollLeft>0));
  requests.length=0;
 }
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(review,'verification.json'),JSON.stringify({ok:true,productionCsp:true,widths:[1200,390,320],cases:reports},null,2)+'\n');
 console.log(JSON.stringify({ok:true,productionCsp:true,widths:[1200,390,320],cases:reports.length}));
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
