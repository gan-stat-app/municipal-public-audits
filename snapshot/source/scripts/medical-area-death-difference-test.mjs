import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {calculateMedicalAreaDifference as calculate} from '../src/lib/medicalAreaDeathDifference.js';
import {normalizeMedicalAreas,aggregateMedicalArea} from '../src/lib/medicalAreas.js';
import {availability} from '../src/lib/deathDifferenceAvailability.js';
import {mapViewportFeatures} from '../src/lib/mapScope.js';

const q={mode:'arbitrary',basis:'juki',regionUnit:'medical-area',medicalAreaCode:'9901',areaCode:'99000',datasetCode:'Se00',startYear:2020,endYear:2021,sex:'男'};
const index={years:[2020,2021],ages:['0–4','5–9']};
const standard={years:{2020:{M:[[2,100],[4,100]],F:[[1,100],[2,100]]},2021:{M:[[2,100],[4,100]],F:[[1,100],[2,100]]}}};
const unknown={years:{2020:{'99101|M':1},2021:{}}};
const area={code:'9901',name:'テスト圏',municipalities:[['99101','甲'],['99102','乙']]};
const ageAreas=area.municipalities.map(([code,name])=>({code,name,sexes:{M:{deaths:[[1,2],[1,2]],population:[[100,100],[100,100]]},F:{deaths:[[0,1],[0,1]],population:[[100,100],[100,100]]}}}));
const rows=[];
for(const year of index.years)for(const [code]of area.municipalities)for(const sex of ['M','F'])rows.push([year,code,sex,(sex==='M'?3:1)+(unknown.years[year][code+'|'+sex]??0),sex==='M'?6:3]);
const ds={rows};
const result=calculate(index,standard,area,ageAreas,ds,q,unknown);
assert.equal(result.sexes.M.observed,13);assert.equal(result.sexes.M.expected,24);assert.equal(result.sexes.M.unknownObserved,1);
assert.equal(result.sexes.F.observed,4);assert.equal(result.sexes.F.expected,12);
const mutate=fn=>{const copy=structuredClone(ageAreas);fn(copy);return()=>calculate(index,standard,area,copy,ds,q,unknown)};
assert.throws(mutate(x=>x[0].sexes.M.deaths[0][0]=null),/欠測/);
assert.throws(mutate(x=>x[0].sexes.M.population[0][0]=null),/欠測/);
assert.throws(mutate(x=>{x[0].sexes.M.deaths[0][0]++;x[0].sexes.M.deaths[1][0]--}),/一致しない/,'Opposite annual errors must not cancel');
assert.throws(mutate(x=>{x[0].sexes.M.population[0][0]++;x[1].sexes.M.population[0][0]--}),/一致しない/,'Opposite member errors must not cancel');
assert.throws(()=>calculate(index,standard,area,ageAreas.slice(1),ds,q,unknown),/そろっていません/);
assert.throws(()=>calculate(index,standard,area,ageAreas,{rows:rows.slice(1)},q,unknown),/そろっていません/);
assert.throws(()=>calculate(index,standard,area,ageAreas,ds,q,{years:{2020:unknown.years[2020]}}),/そろっていません/);
assert.throws(()=>calculate(index,standard,area,[...ageAreas,ageAreas[0]],ds,q,unknown),/重複/);
assert.match(availability({...q,datasetCode:'Se02'}),/2次医療圏は全死因のみ/,'A stored prefecture areaCode must not enable cause-specific medical data');
assert(availability({...q,startYear:2014}));assert(availability({...q,basis:'census'}));

const whole={code:'9901',municipalities:[['01101','中央区'],['01102','北区']],wholeCities:[{code:'01100',wards:['01101','01102']}]};
const cityAges=[{...structuredClone(ageAreas[0]),code:'01100'}];
const cityDs={rows:rows.filter(r=>r[1]==='99102').map(r=>[r[0],'01100',...r.slice(2)]).concat(rows.map(r=>[r[0],r[1]==='99101'?'01101':'01102',...r.slice(2)]))};
assert.equal(calculate(index,standard,whole,cityAges,cityDs,q,unknown).sexes.M.observed,6,'Whole city must be counted once, without its wards');
const partial={code:'9901',municipalities:[['01101','中央区']]};
const partialAges=[{...structuredClone(ageAreas[1]),code:'01101'}];
const partialDs={rows:cityDs.rows.map(r=>r[1]==='01101'?[...r.slice(0,3),r[2]==='M'?3:1,r[4]]:r)};
assert.equal(calculate(index,standard,partial,partialAges,partialDs,q,unknown).sexes.M.observed,6,'A partial city must use its ward, not the whole city');

const poly=y=>[[[139,y],[140,y],[140,y+.1],[139,y]]];
const geo=[{properties:{area_code:'0501'},geometry:{type:'Polygon',coordinates:poly(40)}},{properties:{area_code:'0504'},geometry:{type:'Polygon',coordinates:poly(39)}},{properties:{area_code:'1301'},geometry:{type:'Polygon',coordinates:poly(35.6)}},{properties:{area_code:'1313'},geometry:{type:'MultiPolygon',coordinates:[poly(34),poly(27)]}}];
assert.deepEqual(mapViewportFeatures(geo,'medical-prefecture','0504').map(f=>f.properties.area_code),['0501','0504']);
assert.equal(mapViewportFeatures(geo,'medical-area','0504').length,4);
const tokyo=mapViewportFeatures(geo,'medical-prefecture','1313');
assert.deepEqual(tokyo.map(f=>f.properties.inset_zone),['mainland','izu','ogasawara']);
assert.deepEqual(tokyo.slice(1).map(f=>f.properties.area_code),['1313','1313'],'Both island insets select the same medical area');
if(process.argv.includes('--unit-only')){console.log('PASS: medical-area age aggregation, missingness, annual/member parity, city/ward isolation, prefecture geometry and Tokyo insets');process.exit(0)}

const root=new URL('../../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),gz=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(p,root))));
const idx=read('age-specific-mortality/data/comparison/index.json'),base=read('data/death-difference/national-all-cause.json'),unk=read('data/death-difference/unknown-age.json');
const dataset=gz('data/selected-cause-rebuild-v1/juki-Se00-2024-boundary.json.gz');
const areas=normalizeMedicalAreas(read('regional-healthcare-vision/data/medical-area-municipalities.json').areas);
const shards=new Map(),periods=[[2020,2024],[2015,2024],...idx.years.map(y=>[y,y])],summaries=[];
for(const [startYear,endYear]of periods){
 let passed=0;const blocked=[];
 for(const a of areas){
  const pref=a.code.slice(0,2);if(!shards.has(pref))shards.set(pref,gz('age-specific-mortality/data/comparison/'+pref+'.json.gz').areas);
  let value;
  try{value=calculate(idx,base,a,shards.get(pref),dataset,{...q,medicalAreaCode:a.code,startYear,endYear},unk)}
  catch(e){blocked.push({code:a.code,reason:e.message});continue}
  for(const [sex,label]of [['M','男'],['F','女']]){
   assert.equal(value.sexes[sex].cells.length,21);
   const ref=aggregateMedicalArea(dataset,a,label,startYear,endYear);
   assert.equal(value.sexes[sex].observed,ref.observed);
   assert(Math.abs(value.sexes[sex].expected-ref.expected)<0.001);
  }
  passed++;
 }
 assert.equal(passed+blocked.length,335);assert.equal(passed,335,'All published medical areas must reconcile: '+JSON.stringify(blocked));
 for(const code of ['0504','2208','1412']){assert(areas.some(a=>a.code===code));assert(!blocked.some(x=>x.code===code),'Representative city/ward region blocked: '+code);}
 summaries.push({startYear,endYear,passed,blocked});
}
console.log(JSON.stringify({pass:true,conditions:areas.length*periods.length,summaries},null,2));
