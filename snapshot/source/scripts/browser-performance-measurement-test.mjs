import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifyPopulationFallbacks,primaryMapExpectation,primaryMapState,waitForPrimaryMap,createAuditServer} from './browser-performance-measurement.mjs';

const expected={scope:'national',description:'秋田県全体（全国都道府県）｜全死因｜男性｜1999～2024年｜住民基本台帳人口'};
function documentFixture({text=`地図に表示中：${expected.description}`,loading=false,label='全国都道府県標準化死亡比地図',width=800,canvas=true,condition=true,areaCode='05000'}={}){
  const image=canvas?{width,height:600,getAttribute:()=>label}:null;
  const panel={querySelector:selector=>selector==='.map-loading'?(loading?{}:null):image};
  return{URL:`http://localhost/?area=${areaCode}`,getElementById:id=>condition&&id==='map-drawn-condition-national'?{textContent:text,closest:()=>panel}:null};
}
test('a synthesized prefecture option is not mistaken for the drawn catalog name',()=>{
  const target=primaryMapExpectation('national','05000');
  assert.ok(target.description.startsWith('都道府県全体（全国都道府県）'));
  assert.equal(primaryMapState(target,documentFixture({text:`地図に表示中：${target.description}`})).ready,true);
  assert.equal(primaryMapState(target,documentFixture({text:`地図に表示中：${target.description}`,areaCode:'06000'})).ready,false);
  assert.ok(primaryMapExpectation('prefecture','05201','秋田市').description.startsWith('秋田市（都道府県内市町村）'));
});
test('new requested conditions and a drawn target canvas are required',()=>{
  assert.equal(primaryMapState(expected,documentFixture()).ready,true);
  for(const fixture of [{text:'地図に表示中：秋田市（都道府県内市町村）'},{text:`読み込み対象：${expected.description}`},{loading:true},{canvas:false},{width:0},{condition:false},{label:'都道府県内標準化死亡比地図'}]){
    assert.equal(primaryMapState(expected,documentFixture(fixture)).ready,false,JSON.stringify(fixture));
  }
});
test('a stale canvas with a visible new heading cannot pass',()=>{
  const doc=documentFixture({text:'地図に表示中：前の条件'});
  assert.equal(primaryMapState({...expected,readyOnly:true},doc),false);
});
test('completion reads only the target map, never page-wide loading text',()=>{
  const doc=documentFixture();
  Object.defineProperty(doc,'body',{get(){throw new Error('unrelated page-wide loading state')}});
  assert.equal(primaryMapState({...expected,readyOnly:true},doc),true);
});
test('paint invalidation fails rather than accepting the first ready state',async()=>{
  const page={waitForFunction:async(fn,args)=>assert.equal(fn(args,documentFixture()),true),
    evaluate:async(fn,args)=>args?fn(args,documentFixture({loading:true})):undefined};
  await assert.rejects(()=>waitForPrimaryMap(page,expected),/changed before paint/);
});
test('render timeout is propagated without retry, fallback, or discarded sample',async()=>{
  let calls=0;
  const page={waitForFunction:async()=>{calls++;throw new Error('render timeout')},evaluate:()=>assert.fail('must not continue')};
  await assert.rejects(()=>waitForPrimaryMap(page,expected),/render timeout/);
  assert.equal(calls,1);
});
test('both servers have identical cache behavior and report read/transfer bytes',async()=>{
  const roots=await Promise.all([1,2].map(()=>mkdtemp(join(tmpdir(),'smr-audit-')))),servers=[];
  try{
    for(const root of roots){
      await writeFile(join(root,'index.html'),'test');
      const requests=[],server=createAuditServer(root,requests);servers.push(server);
      await new Promise(done=>server.listen(0,'127.0.0.1',done));
      const url=`http://127.0.0.1:${server.address().port}`;
      const response=await fetch(url+'/');
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(response.headers.get('content-length'),'4');
      assert.equal(await response.text(),'test');
      assert.equal(requests[0].bytes,4);
      assert.ok(requests[0].handlerMs>=requests[0].readMs);
      assert.equal((await fetch(url+'/missing')).status,404);
    }
  }finally{await Promise.all(servers.map(server=>new Promise(done=>server.close(done))));await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})))}
});

test('candidate serves production-shared data and shell CSS without hiding missing build files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'smr-routing-')),candidate=join(root,'candidate'),shared=join(root,'shared');
  await Promise.all([candidate,shared].map(path=>mkdir(join(path,'data/selected-cause-rebuild-v1'),{recursive:true})));
  await writeFile(join(shared,'data/selected-cause-rebuild-v1/example.json'),'verified production data');
  await writeFile(join(candidate,'data/selected-cause-rebuild-v1/example.json'),'stale candidate data');
  await writeFile(join(shared,'data/juki-example.json'),'juki production data');
  await writeFile(join(shared,'data/census-example.json'),'census production data');
  await writeFile(join(shared,'home-population-ranking-v1.css'),'shared shell');
  await writeFile(join(shared,'missing-candidate.js'),'must not mask an incomplete build');
  await mkdir(join(shared,'population'));
  await writeFile(join(shared,'population/historical-00.part'),'historical part');
  await writeFile(join(shared,'population/future-00.part'),'future part');
  const requests=[],server=createAuditServer(candidate,requests,{sharedRoot:shared});
  try{
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const url=`http://127.0.0.1:${server.address().port}`;
    for(const [path,body] of [['/data/selected-cause-rebuild-v1/example.json','verified production data'],['/data/juki-example.json','juki production data'],['/data/census-example.json','census production data'],['/home-population-ranking-v1.css','shared shell'],['/population/historical-00.part','historical part'],['/population/future-00.part','future part']]){
      const response=await fetch(url+path);
      assert.equal(response.status,200);assert.equal(await response.text(),body);
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(requests.at(-1).source,'shared-production-root');
    }
    await writeFile(join(candidate,'home-population-ranking-v1.css'),'candidate shell');
    assert.equal(await (await fetch(url+'/home-population-ranking-v1.css')).text(),'candidate shell');
    assert.equal((await fetch(url+'/missing-candidate.js')).status,404);
    assert.equal((await fetch(url+'/data/selected-cause-rebuild-v1/missing.json')).status,404);
  }finally{await new Promise(done=>server.close(done));await rm(root,{recursive:true,force:true})}
});

const populationRequests=()=>['historical','future'].flatMap(kind=>Array.from({length:kind==='historical'?9:3},(_,i)=>({path:`/population/${kind}-${String(i).padStart(2,'0')}.part`,status:200,error:null})));
const populationErrors=[{status:404,url:'http://localhost/data/population-historical-juki-2024-boundary.json.gz'},{status:404,url:'http://localhost/data/population-future-ipss-2023.json.gz'}];
test('population fallback is valid only after all parts and both displayed datasets succeed',()=>{
  assert.equal(classifyPopulationFallbacks(populationErrors,populationRequests(),true).material.length,0);
  assert.deepEqual(classifyPopulationFallbacks(populationErrors,populationRequests(),true).expected,populationErrors);
  for(const ready of [false,undefined])assert.deepEqual(classifyPopulationFallbacks(populationErrors,populationRequests(),ready).material,populationErrors);
  const requests=populationRequests().filter(row=>!row.path.endsWith('future-02.part'));
  assert.deepEqual(classifyPopulationFallbacks(populationErrors,requests,true).material,[populationErrors[1]]);
});
test('failed population parts, 500s and unrelated bundle 404s remain failures',()=>{
  const other=[{status:404,url:'http://localhost/missing.js'},{status:500,url:populationErrors[0].url},{status:404,url:'http://localhost/population/future-02.part'}];
  const requests=populationRequests().map(row=>row.path.endsWith('future-02.part')?{...row,status:404}:row);
  const result=classifyPopulationFallbacks([...populationErrors,...other],requests,true);
  assert.ok(result.material.includes(populationErrors[1]));
  for(const error of other)assert.ok(result.material.includes(error));
});
