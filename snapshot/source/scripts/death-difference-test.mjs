import fs from 'node:fs';import zlib from 'node:zlib';import assert from 'node:assert/strict';
import {calculateDifference,availability} from '../src/lib/deathDifference.js';
const root=new URL('../../',import.meta.url);const read=p=>JSON.parse(fs.readFileSync(new URL(p,root))),gz=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(p,root))));
const index=read('age-specific-mortality/data/comparison/index.json'),standard=read('data/death-difference/national-all-cause.json'),dataset=gz('data/juki-Se00-2024-boundary.json.gz');
const base={mode:'arbitrary',basis:'juki',datasetCode:'Se00',startYear:2020,endYear:2024,areaCode:'05201',sex:'男'};
const unknown=read('data/death-difference/unknown-age.json');
const calculate= (...args)=>calculateDifference(...args,unknown);
let passed=0;const blocked=[];
for(let pref=1;pref<=47;pref++){
 const shard=gz(`age-specific-mortality/data/comparison/${String(pref).padStart(2,'0')}.json.gz`);
 for(const area of shard.areas){
  try {const r=calculate(index,standard,area,dataset,{...base,areaCode:area.code});assert.equal(r.sexes.M.cells.length,21);assert.equal(r.sexes.F.cells.length,21);passed++;}
  catch(e){blocked.push({code:area.code,reason:e.message});}
 }
}
let prefectures=0;
for(const area of gz('age-specific-mortality/data/comparison/prefectures.json.gz').areas){try{calculate(index,standard,area,dataset,{...base,areaCode:area.code});prefectures++;}catch(e){blocked.push({code:area.code,reason:e.message});}}
// The official-table repair must also reconcile all-cause totals in the audited years.
let repairedPrefecturePeriods=0;
for(const area of gz('age-specific-mortality/data/comparison/prefectures.json.gz').areas){
 const scoped={...dataset,rows:dataset.rows.filter(r=>r[1].startsWith(area.code.slice(0,2)))};
 for(const [startYear,endYear] of [[2015,2015],[2016,2016],[2017,2017],[2018,2018],[2015,2024]]){
  calculate(index,standard,area,scoped,{...base,areaCode:area.code,startYear,endYear});repairedPrefecturePeriods++;
 }
}
assert.equal(repairedPrefecturePeriods,235);
const akita=gz('age-specific-mortality/data/comparison/05.json.gz').areas.find(a=>a.code==='05201');
const reference=calculate(index,standard,akita,dataset,{...base,startYear:2024});assert.equal(reference.sexes.M.observed,2138);assert.ok(Math.abs(reference.sexes.M.expected-2102.0757773481114)<1e-8);
const missing=structuredClone(akita);missing.sexes.M.deaths[9][0]=null;assert.throws(()=>calculate(index,standard,missing,dataset,base),/欠測/);
const wrong=structuredClone(akita);wrong.sexes.M.deaths[9][0]+=1;assert.throws(()=>calculate(index,standard,wrong,dataset,base),/一致しない/);
const wrongPopulation=structuredClone(akita);wrongPopulation.sexes.M.population[9][20]+=100;assert.throws(()=>calculate(index,standard,wrongPopulation,dataset,base),/一致しない/);
assert.ok(availability({...base,basis:'census'}));assert.ok(availability({...base,startYear:2014}));assert.ok(availability({...base,datasetCode:'Se02'}));
assert.ok(passed>1500);assert.ok(prefectures>10);
console.log(JSON.stringify({passedMunicipalities:passed,passedPrefectures:prefectures,blockedCount:blocked.length,blocked},null,2));
