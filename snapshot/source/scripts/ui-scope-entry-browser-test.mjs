import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const publicRoot=resolve(root,'source','dist');
const review=resolve(root,'source/care/browser-review/ui-entry-scope');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.gz':'application/gzip','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
 let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(pathname.endsWith('/'))pathname+='index.html';
 // Match the existing medical-area browser server and production data layout.
 const runtimeData=['/data/','/regional-healthcare-vision/','/population/','/age-specific-mortality/'].some(prefix=>pathname.startsWith(prefix));
 const fileRoot=runtimeData?root:publicRoot,file=resolve(fileRoot,`.${pathname}`);
 if(!file.startsWith(fileRoot+sep)||!(await stat(file)).isFile())throw new Error();
 res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
}catch{res.writeHead(404);res.end('Not found')}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 await mkdir(review,{recursive:true});
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const viewport of [{width:1280,height:950},{width:390,height:844},{width:320,height:740}]){
  const page=await browser.newPage({viewport}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/?mode=arbitrary&area=05201&cause=Se00&sex=%E7%94%B7&unit=municipality&basis=juki&start=1999&end=2024');
  const low=page.getByRole('heading',{name:'都道府県内で値が低い10自治体',exact:true});
  await low.waitFor();
  assert.equal(await page.locator('#portal-municipality-report-link').getAttribute('href'),'/municipality/#directory-main');
  assert.equal(await page.locator('.primary-entry,.secondary-entry').count(),21);
  assert.equal(await page.locator('.portal-nav a[href="/food-business/"]').count(),1);
  assert.equal(await page.locator('.secondary-entry[href="/food-business/"]').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'top must not overflow');
  await page.screenshot({path:resolve(review,`top-${viewport.width}.png`)});
  const lowSection=low.locator('..');
  // A low position within the prefecture can still be above the national baseline.
  await lowSection.getByRole('button',{name:/秋田市/}).waitFor();
  assert.match(await lowSection.textContent(),/秋田市/);
  assert.match(await lowSection.textContent(),/全国基準より有意に高い/);
  assert.match(await page.locator('.ranking-chart-grid').locator('..').textContent(),/全国基準100.*有意差の有無とは別/);
  await low.click();
  await page.screenshot({path:resolve(review,`ranking-${viewport.width}.png`)});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'ranking must not overflow');
  const scope=page.getByRole('group',{name:'ランキング範囲',exact:true});
  await scope.getByRole('button',{name:'全国',exact:true}).click();
  await page.getByRole('heading',{name:'全国で値が低い10自治体',exact:true}).waitFor();
  if(viewport.width===390){
   await page.getByRole('combobox',{name:'地域単位',exact:true}).selectOption({label:'2次医療圏別'});
   await page.getByRole('heading',{name:'全国で値が低い10医療圏',exact:true}).waitFor();
  }
  const entry=page.locator('#portal-municipality-report-link');
  await entry.focus();await page.keyboard.press('Enter');
  await page.waitForURL(base+'/municipality/#directory-main');
  await page.getByRole('searchbox',{name:'自治体名から探す',exact:true}).fill('秋田市');
  await page.getByRole('link',{name:'秋田県秋田市',exact:true}).waitFor();
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log(JSON.stringify({pass:true,viewports:[1280,390,320],rankingScopes:['prefecture','national','medical-area'],keyboardEntry:true}));
}finally{
 await browser?.close();await new Promise(ok=>server.close(ok));
}
