import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {arbitraryCauses,officialCauseMap,causeAvailability,causeForMode} from '../src/catalogs/causes.js';
import {calculateArbitraryPeriodCase} from '../src/lib/parity.js';
import {rowsForArea} from '../src/lib/areaAggregation.js';
import {aggregatePeriod} from '../src/lib/smr.js';
const codes=new Set(arbitraryCauses.map(([c])=>c));
assert.equal(codes.size,37);
for(let i=1;i<=34;i++) assert(codes.has(`Se${String(i).padStart(2,'0')}`));
assert.equal(officialCauseMap.get('Se18'),'心不全');
assert.equal(new Map(arbitraryCauses).get('Se18'),'その他の虚血性心疾患');
assert.equal(causeForMode('Se18','official','arbitrary'),'Se20');
assert.equal(causeForMode('Se20','arbitrary','official'),'Se18');
assert.equal(causeForMode('Se18','arbitrary','official'),'Se00');
const q={mode:'arbitrary',basis:'juki',datasetCode:'Se01',sex:'男',startYear:2020,endYear:2024};
assert.equal(causeAvailability(q),'');
assert(causeAvailability({...q,basis:'census'}));
assert(causeAvailability({...q,startYear:2014}));
assert(causeAvailability({...q,datasetCode:'Se12'}));
assert(causeAvailability({...q,datasetCode:'Se12',sex:'男女計'}));
assert.equal(causeAvailability({...q,datasetCode:'Se12',sex:'女'}),'');
const root=new URL('../../',import.meta.url);
const read=c=>JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`data/juki-${c}-2024-boundary.json.gz`,root))));
for(const [combined,left,right] of [['SeCO','Se05','Se06'],['SeIH','Se17','Se18']]) {
 const a=new Map(read(left).rows.map(r=>[r.slice(0,3).join('|'),r]));
 const b=new Map(read(right).rows.map(r=>[r.slice(0,3).join('|'),r]));
 let tested=0;
 for(const row of read(combined).rows.filter(r=>r[0]>=2015)) {
  const key=row.slice(0,3).join('|'),l=a.get(key),r=b.get(key);
  assert(l&&r,key);assert.equal(l[3]+r[3],row[3],key);
  assert(Math.abs(l[4]+r[4]-row[4])<1.6e-6,key);tested++;
 }
 assert.equal(tested,37586);
}
const tb=read('Se01');
const result=await calculateArbitraryPeriodCase({...q,areaCode:'13121',dataset:tb});
assert(result.complete);assert(result.observed>0&&result.expected>0);
assert.equal(read('Se12').rows.some(r=>r[2]==='M'),false);
let prefectureCases=0;
const manifest=JSON.parse(fs.readFileSync(new URL('../selected-causes/manifest.json',import.meta.url)));
for(const item of manifest.outputs){
 const data=read(item.cause);
 for(let pref=1;pref<=47;pref++){
  const rows=rowsForArea(data,`${String(pref).padStart(2,'0')}000`);
  for(const sex of item.sexes){
   const value=aggregatePeriod(rows,sex==='F'?'女':'男',2015,2024);
   assert(value&&value.years===10&&value.expected>0,`${item.cause}/${pref}/${sex}`);prefectureCases++;
  }
 }
}
assert.equal(prefectureCases,1739);
const reconstruction=new URL('../selected-causes/reconstruction/',import.meta.url);
const inputs=JSON.parse(fs.readFileSync(new URL('archive.json',reconstruction)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const parts=inputs.parts.map(part=>{
 const bytes=fs.readFileSync(new URL(part.file,reconstruction));
 assert.equal(bytes.length,part.bytes,part.file);assert.equal(sha(bytes),part.sha256,part.file);
 return bytes;
});
assert.equal(sha(Buffer.concat(parts)),inputs.archive_sha256);
const verified=JSON.parse(fs.readFileSync(new URL('verification.json',reconstruction)));
assert.equal(verified.mismatched,0);assert.equal(verified.release_ready,false);
const overlap=JSON.parse(fs.readFileSync(new URL('confirmed-county-overlap.json',reconstruction)));
assert(overlap.cases.length>0&&overlap.cases.every(row=>row.county_groups.every(group=>group.overlap_confirmed)));
assert.equal(manifest.release_ready,false);
assert(manifest.blockers.some(reason=>reason.includes('county/municipality')));
console.log('PASS: complete catalogue, official/annual code separation, availability, 75,172 composite-count identities and TB period calculation');
