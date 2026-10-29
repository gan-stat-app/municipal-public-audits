import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {normalizeMedicalAreas,aggregateMedicalArea,buildMedicalAreaRanking} from '../src/lib/medicalAreas.js';
const read=relative=>fs.readFileSync(new URL(relative,import.meta.url));
const catalog=JSON.parse(read('../../regional-healthcare-vision/data/medical-area-municipalities.json'));
const areas=normalizeMedicalAreas(catalog.areas);
const codes=new Set(JSON.parse(read('../../data/area-catalog.json')).map(([code])=>code));
assert.equal(areas.length,335);
const members=areas.flatMap(x=>x.municipalities.map(([code])=>code));
assert.equal(new Set(members).size,members.length,'Medical areas must not overlap');
for(const code of members)assert(codes.has(code),'Unknown current municipality: '+code);
const western=areas.find(x=>x.code==='2208');
assert.deepEqual(western.municipalities.map(([code])=>code).sort(),['22138','22139','22140','22221']);
assert.equal(western.wholeCities[0].code,'22130');
if(process.argv.includes('--catalog-only')){console.log('PASS: all 335 catalog areas, unique current members, Hamamatsu and Kosai');process.exit(0)}
const summaries=[];
for(const basis of ['juki','census']){
 const ds=JSON.parse(zlib.gunzipSync(read('../../data/selected-cause-rebuild-v1/'+basis+'-Se00-2024-boundary.json.gz')));
 for(const sex of ['男','女','男女計']){
  for(const [startYear,endYear] of [[1999,2024],[2020,2024],[2024,2024]]){
   const ranking=buildMedicalAreaRanking(ds,areas,{sex,startYear,endYear});
   assert(ranking.total>300,'Unexpected widespread missingness');
   summaries.push({basis,sex,startYear,endYear,available:ranking.total,total:areas.length});
  }
  // Independent fixed-geography checks: Akita's seven municipalities and
  // Western Shizuoka's entire Hamamatsu city plus Kosai city.
  for(const[code,selected]of [['0504',['05201','05206','05211','05361','05363','05366','05368']],['2208',['22130','22221']]]){
   const rows=ds.rows.filter(r=>r[0]>=2020&&r[0]<=2024&&selected.includes(r[1])&&(sex==='男女計'||r[2]===(sex==='男'?'M':'F')));
   assert.equal(rows.length,selected.length*5*(sex==='男女計'?2:1));
   const value=aggregateMedicalArea(ds,areas.find(x=>x.code===code),sex,2020,2024);
   assert(value,'Complete reference region '+code);
   assert.equal(value.observed,rows.reduce((sum,r)=>sum+r[3],0));
   assert(Math.abs(value.expected-rows.reduce((sum,r)=>sum+r[4],0))<1e-6);
  }
 }
}
console.log(JSON.stringify({pass:true,catalogAsOf:catalog.meta.as_of,summaries}));

