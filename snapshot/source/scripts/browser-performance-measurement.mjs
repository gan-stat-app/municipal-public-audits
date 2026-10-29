import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {performance} from 'node:perf_hooks';
import {cpus,loadavg,freemem,totalmem,release,arch} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

export const CHROME_PATH='/usr/bin/google-chrome';
export const CHROME_ARGS=['--no-sandbox','--disable-dev-shm-usage'];
export const VIEWPORT={width:1280,height:900};
const round=value=>+value.toFixed(1);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.geojson':'application/geo+json','.svg':'image/svg+xml','.png':'image/png','.gz':'application/octet-stream','.part':'application/octet-stream'};
// Preserve the production data placement in vite.config.js preview.proxy.
// Only these data families are shared; missing candidate bundles stay 404.
const sharedDataPrefixes=['/data/selected-cause-rebuild-v1/','/data/juki-','/data/census-'];
const sharedFallbackPaths=['/home-population-ranking-v1.css','/data/population-historical-juki-2024-boundary.json.gz','/data/population-future-ipss-2023.json.gz'];
const isSharedFallbackPath=path=>sharedFallbackPaths.includes(path)||/^\/population\/(?:historical|future)-\d{2}\.part$/.test(path);
const populationTransports=[['/data/population-historical-juki-2024-boundary.json.gz','historical',9],['/data/population-future-ipss-2023.json.gz','future',3]];

// Population's existing loader intentionally supports missing monolithic gzip
// files via published parts. A 404 is classified as a successful alternative
// transport ONLY after all exact parts succeeded and both modes rendered.
// Keep the original errors in the report; every other HTTP error still fails.
export function classifyPopulationFallbacks(errors,requests,populationReady){
  const completed=populationReady?populationTransports.filter(([,kind,count])=>Array.from({length:count},(_,i)=>`/population/${kind}-${String(i).padStart(2,'0')}.part`).every(path=>requests.some(row=>row.path===path&&row.status===200&&!row.error))).map(([path])=>path):[];
  const expected=errors.filter(error=>error.status===404&&completed.includes(new URL(error.url).pathname));
  return{expected,material:errors.filter(error=>!expected.includes(error))};
}

// Both builds use identical serving/cache behavior. Record disk/read time apart
// from browser Resource Timing (which also includes transfer and scheduling).
export function createAuditServer(root,requests=[],{sharedRoot}={}){
  root=resolve(root);
  if(sharedRoot)sharedRoot=resolve(sharedRoot);
  return createServer(async(req,res)=>{
    const start=performance.now();
    const record={path:new URL(req.url,'http://localhost').pathname,startWallMs:start,status:0,bytes:0};
    requests.push(record);
    try{
      let pathname=decodeURIComponent(record.path);
      if(pathname.endsWith('/'))pathname+='index.html';
      let fileRoot=sharedRoot&&sharedDataPrefixes.some(prefix=>pathname.startsWith(prefix))?sharedRoot:root;
      let file=resolve(fileRoot,`.${pathname}`);
      if(file!==fileRoot&&!file.startsWith(fileRoot+sep))throw new Error('outside root');
      let info;
      try{info=await stat(file)}catch(error){
        // Production keeps large population parts and this shell stylesheet
        // at the root. Prefer candidate copies; never use a general fallback.
        if(error.code!=='ENOENT'||!sharedRoot||!isSharedFallbackPath(pathname))throw error;
        fileRoot=sharedRoot;file=resolve(fileRoot,`.${pathname}`);info=await stat(file);
      }
      if(!info.isFile())throw new Error('not a file');
      record.source=fileRoot===root?'build-root':'shared-production-root';
      const readStart=performance.now(),bytes=await readFile(file);
      record.readMs=round(performance.now()-readStart);
      record.status=200;record.bytes=bytes.length;
      res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','content-length':bytes.length,'cache-control':'no-store'});
      res.end(bytes);
    }catch{record.status=404;res.writeHead(404);res.end('Not found')}
    record.handlerMs=round(performance.now()-start);
    record.endWallMs=performance.now();
  });
}

// Self-contained so Playwright can evaluate the exact same predicate tested in
// Node. A heading, an old canvas, or the absence of global status text is never
// sufficient: the target map must identify the newly requested conditions.
export function primaryMapExpectation(scope,areaCode,areaName){
  // The map reads names from the catalog, while Controls synthesizes a
  // prefecture option (e.g. 秋田県全体). Missing prefecture catalog entries use
  // App's drawn-name fallback 都道府県全体, not the synthesized option label.
  return{scope,areaCode,description:`${areaName||(scope==='national'?'都道府県全体':'選択地域')}（${scope==='national'?'全国都道府県':'都道府県内市町村'}）｜全死因｜男性｜1999～2024年｜住民基本台帳人口`};
}
export function primaryMapState({scope,description,areaCode,readyOnly=false},doc=globalThis.document){
  const conditionId=`map-drawn-condition-${scope}`;
  const condition=doc.getElementById(conditionId);
  const panel=condition?.closest('.section-panel');
  const canvas=panel?.querySelector('.map-frame canvas');
  const expectedLabel=scope==='national'?'全国都道府県標準化死亡比地図':'都道府県内標準化死亡比地図';
  const text=condition?.textContent||'';
  const loading=!!panel?.querySelector('.map-loading');
  const currentAreaCode=areaCode?new URL(doc.URL).searchParams.get('area'):null;
  const state={conditionId,condition:text,expectedCondition:`地図に表示中：${description}`,loading,
    currentAreaCode,expectedAreaCode:areaCode||null,
    canvas:canvas?{label:canvas.getAttribute('aria-label'),width:canvas.width,height:canvas.height}:null};
  state.ready=(!areaCode||currentAreaCode===areaCode)&&text===state.expectedCondition&&!loading&&!!canvas&&canvas.width>0&&canvas.height>0&&canvas.getAttribute('aria-label')===expectedLabel;
  return readyOnly?state.ready:state;
}

export async function waitForPrimaryMap(page,expected,{timeout=20000}={}){
  await page.waitForFunction(primaryMapState,{...expected,readyOnly:true},{timeout});
  // React's condition label and canvas effect commit together; observe two
  // paints and check again to reject an invalidated/stale draw.
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const state=await page.evaluate(primaryMapState,expected);
  if(!state.ready)throw new Error(`primary map changed before paint: ${JSON.stringify(state)}`);
  return state;
}

export async function pageTimeline(page,since=0){
  return page.evaluate(since=>({
    browserNowMs:performance.now(),
    longTasks:(window.__smrLongTasks||[]).filter(x=>x.startTime+x.duration>=since),
    resources:performance.getEntriesByType('resource').filter(x=>x.startTime+x.duration>=since).map(x=>({
      path:new URL(x.name,location.href).pathname,initiator:x.initiatorType,startMs:x.startTime,
      responseStartMs:x.responseStart,responseEndMs:x.responseEnd,durationMs:x.duration,
      transferBytes:x.transferSize,encodedBytes:x.encodedBodySize,decodedBytes:x.decodedBodySize
    })),
    activeMapLoads:[...document.querySelectorAll('.map-loading')].map(x=>x.textContent),
    statuses:[...document.querySelectorAll('[role="status"]')].map(x=>x.textContent)
  }),since);
}

export async function measurePrimarySwitch(page,select,code,headingName,expected,phases){
  const startBrowser=await page.evaluate(()=>performance.now());
  const start=performance.now(),phase={code,scope:expected.scope,startBrowserMs:startBrowser};
  phases.push(phase);
  try{
    await select.selectOption(code);
    phase.selectionMs=round(performance.now()-start);
    const heading=page.getByRole('heading',{name:headingName,exact:true});
    await heading.waitFor({state:'visible',timeout:20000});
    await heading.scrollIntoViewIfNeeded();
    phase.headingMs=round(performance.now()-start);
    phase.target=await waitForPrimaryMap(page,expected);
    phase.totalMs=round(performance.now()-start);
    phase.timeline=await pageTimeline(page,startBrowser);
    return phase.totalMs;
  }catch(error){
    phase.totalMs=round(performance.now()-start);phase.error=String(error);
    phase.target=await page.evaluate(primaryMapState,expected).catch(()=>null);
    phase.timeline=await pageTimeline(page,startBrowser).catch(()=>null);
    throw error;
  }
}

export function runnerEnvironment(){
  const git=(...args)=>{try{return execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{return null}};
  return{node:process.version,platform:process.platform,arch:arch(),kernel:release(),
    cpuModel:cpus()[0]?.model,cpuCount:cpus().length,totalMemoryBytes:totalmem(),
    checkoutCommit:git('rev-parse','HEAD'),checkoutTree:git('rev-parse','HEAD^{tree}'),
    actions:Object.fromEntries(['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_SHA','RUNNER_NAME','RUNNER_OS','RUNNER_ARCH','ImageOS','ImageVersion'].map(key=>[key,process.env[key]||null]))};
}
export const hostSnapshot=()=>({loadAverage:loadavg(),freeMemoryBytes:freemem(),processCpuMicros:process.cpuUsage()});
export async function assetFingerprints(root){
  return Promise.all(['index.html','data/prefecture-map-light.geojson','data/municipality-map-light.geojson'].map(async path=>{
    try{const bytes=await readFile(resolve(root,path));return{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}
    catch(error){return{path,error:String(error)}}
  }));
}
