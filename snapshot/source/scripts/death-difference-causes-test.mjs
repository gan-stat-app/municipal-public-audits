import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {queryFromLocation,queryToSearch} from '../src/lib/urlState.js';
import {calculateCauseDifference,availability} from '../src/lib/deathDifference.js';
const root=new URL('../../',import.meta.url);const read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),gz=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(p,root))));
const index=read('age-specific-mortality/data/comparison/index.json'),areas=gz('age-specific-mortality/data/comparison/prefectures.json.gz').areas;
const codes=['Se02','Se04','Se07','Se10','Se16','Se17','Se21','Se23','Se24','Se26','Se27','Se29','Se30','Se31','Se34','SeCO','SeIH'];
const periods=[...index.years.map(y=>[y,y]),[2020,2024],[2015,2024]];
let checked=0;const blocked=[];let first;
for(const code of codes){
 const raw=gz(`data/death-difference/causes/${code}.json.gz`),full=gz(`data/juki-${code}-2024-boundary.json.gz`);
 assert.equal(raw.areas.length,47);
 for(const area of areas){
  const dataset={...full,rows:full.rows.filter(r=>r[1].startsWith(area.code.slice(0,2)))};
  for(const [startYear,endYear] of periods){
   const q={mode:'arbitrary',basis:'juki',datasetCode:code,areaCode:area.code,startYear,endYear,sex:'男'};
   try{const r=calculateCauseDifference(index,area,dataset,q,raw);assert.equal(r.sexes.M.cells.length,21);assert.equal(r.sexes.F.cells.length,21);checked++;if(!first)first={area,dataset,q,raw};}
   catch(e){blocked.push({cause:code,area:area.code,startYear,endYear,error:e.message});}
  }
 }
 console.log(code,'checked',checked,'blocked',blocked.length);
}
for(const code of ['SeCO','SeIH']){const q={mode:'arbitrary',basis:'juki',datasetCode:code,areaCode:'03000',startYear:2015,endYear:2024,sex:'男'};assert.equal(queryFromLocation(q,queryToSearch(q)).datasetCode,code);}
assert.ok(first);const {area,dataset,q,raw}=first;

// Exercise both published metadata schemas without weakening the cause/count guards.
const {cause_code: legacyCause, cause: rebuiltCause, ...withoutCause} = dataset;
const baseline = calculateCauseDifference(index,area,dataset,q,raw);
for (const metadata of [
 {cause_code:q.datasetCode}, {cause:q.datasetCode},
 {cause_code:q.datasetCode,cause:q.datasetCode}
]) assert.deepEqual(calculateCauseDifference(index,area,{...withoutCause,...metadata},q,raw),baseline);
for (const metadata of [
 {}, {cause:null}, {cause_code:null}, {cause:'Se34'},
 {cause_code:q.datasetCode,cause:'Se34'},
 {cause_code:'Se34',cause:q.datasetCode},
 {cause_code:q.datasetCode,cause:null}
]) assert.throws(()=>calculateCauseDifference(index,area,{...withoutCause,...metadata},q,raw),/死因が一致/);
const rebuiltDataset = {...withoutCause,cause:q.datasetCode};
const corruptRebuilt = {...rebuiltDataset,rows:rebuiltDataset.rows.map(r=>r[0]===q.startYear && r[2]==='M' ? [...r.slice(0,3),r[3]+1,...r.slice(4)] : r)};
assert.throws(()=>calculateCauseDifference(index,area,corruptRebuilt,q,raw),/一致しない/);

assert.ok(availability({...q,areaCode:'03201'}).includes('死因×性別×年齢階級'));
assert.ok(availability({...q,basis:'census'}));assert.ok(availability({...q,startYear:2014}));
assert.throws(()=>calculateCauseDifference(index,area,dataset,{...q,datasetCode:'Se34'},raw),/死因が一致/);
const bad=structuredClone(raw);bad.areas.find(a=>a.code===q.areaCode).sexes.M.unknown[0]=null;
assert.throws(()=>calculateCauseDifference(index,area,dataset,q,bad),/公表総数/);
const altered=structuredClone(raw);altered.areas.find(a=>a.code===q.areaCode).sexes.M.deaths[0][0]+=1;
assert.throws(()=>calculateCauseDifference(index,area,dataset,q,altered),/公表総数/);
const missing=structuredClone(raw);missing.standard.years['2015'].M[0][0]=null;
assert.throws(()=>calculateCauseDifference(index,area,dataset,q,missing),/欠測/);
const wrongPop=structuredClone(area);wrongPop.sexes.M.population[0][20]+=1000;
assert.throws(()=>calculateCauseDifference(index,wrongPop,dataset,q,raw),/一致しない/);
const report={checked,blockedCount:blocked.length,blocked};
if(process.argv.includes('--record')) fs.writeFileSync(new URL('source/death-difference-causes/validation.json',root),JSON.stringify(report,null,2)+'\n');
else assert.deepEqual(report,read('source/death-difference-causes/validation.json'),'Annual/period parity results changed; review exact mismatch conditions');
assert.equal(checked,9588);
assert.equal(blocked.length,0,JSON.stringify(blocked.slice(0,10)));
assert.ok(blocked.every(r=>r.error.includes('一致しない')),JSON.stringify(blocked.filter(r=>!r.error.includes('一致しない')).slice(0,5)));
console.log('PASS',checked,'prefecture/cause/period combinations, both sexes; missing, cause mismatch and count/population corruption rejected');
