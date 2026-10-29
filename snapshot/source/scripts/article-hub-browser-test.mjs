// Common article navigation checks, independent of any one article's data suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require=createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/' : import.meta.url);
const {chromium}=require('playwright-core');
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root=path.dirname(source), built=process.argv.indexOf('--built');
const published=built<0 ? root : path.resolve(process.cwd(), process.argv[built+1]);
assert(fs.existsSync(path.join(published,'analysis/index.html')));
const csp=fs.readFileSync(path.join(root,'_headers'),'utf8').split('\n')
  .find(line=>line.trimStart().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy: '.length);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  if(pathname==='/favicon.ico'||pathname==='/favicon.svg'){response.writeHead(204).end();return;}
  const file=path.resolve(published,pathname.slice(1)+(pathname.endsWith('/')?'index.html':''));
  if(!file.startsWith(published+path.sep)){response.writeHead(400).end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404).end();return;}
  response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream',
    'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'});
  fs.createReadStream(file).pipe(response);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const review=path.join(source,'article-index-review');fs.mkdirSync(review,{recursive:true});
const failures=[],results=[];
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});
  for(const width of [1440,390,320]) {
    let recordCount=0;
    for(const javaScriptEnabled of [true,false]) {
      const context=await browser.newContext({viewport:{width,height:900},locale:'ja-JP',javaScriptEnabled});
      const page=await context.newPage();
      page.on('pageerror',error=>failures.push(error.message));
      page.on('console',message=>{if(message.type()==='error')failures.push(message.text());});
      page.on('request',request=>{if(!request.url().startsWith(origin))failures.push('External runtime request: '+request.url());});
      const response=await page.goto(origin+'/analysis/',{waitUntil:'networkidle'});
      assert.equal(response.status(),200);
      assert.equal(await page.locator('h1').count(),1);
      if(javaScriptEnabled) {
        const cards=page.locator('.hub-results > a');
        recordCount=await cards.count();assert(recordCount>0);
        assert(await page.locator('.hub-controls').isVisible());
        const first=cards.first(),href=await first.getAttribute('href');
        const query=await first.evaluate(el=>{const copy=el.cloneNode(true);copy.querySelector('.hub-tag')?.remove();return copy.textContent.trim().replace(/\s+/g,' ').slice(0,8);});
        await page.locator('#article-query').fill(query);
        assert(await first.isVisible(),'search must retain the matching article');
        assert.equal(await first.getAttribute('href'),href);
        const category=await first.locator('.hub-tag').textContent();
        await page.getByRole('button',{name:category,exact:true}).click();
        assert(await first.isVisible(),'category filter must retain the matching article');
        await page.locator('#article-query').fill('ci-no-such-article-572eac09');
        assert.equal(await page.locator('.hub-results > a:visible').count(),0);
        assert(await page.locator('.hub-empty').isVisible());
        await page.locator('#hub-reset').click();
        assert.equal(await page.locator('#article-query').inputValue(),'');
        assert.equal(await page.locator('.hub-results > a:visible').count(),recordCount);
      } else {
        assert(await page.locator('.articlelist a[href]').count()>=recordCount);
        assert.equal(await page.locator('.hub-results').count(),0);
        assert(await page.locator('.hub-controls').isHidden());
      }
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'article index must fit the viewport');
      const label=width+(javaScriptEnabled?'-js':'-no-js');
      await page.screenshot({path:path.join(review,label+'.png'),fullPage:false});
      results.push({width,javaScriptEnabled,ok:true});
      await context.close();
    }
  }
  assert.deepEqual(failures,[]);
  fs.writeFileSync(path.join(review,'results.json'),JSON.stringify({ok:true,results},null,2)+'\n');
  console.log('PASS: article index search, category/reset, local links and CSP at 1440/390/320px, with and without JavaScript');
} finally {
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
