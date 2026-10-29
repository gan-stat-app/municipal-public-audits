// Reuse the site's exact direct-prefecture / designated-city coverage rules.
import fs from 'node:fs';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import {rowsForArea} from '../src/lib/areaAggregation.js';
const root=new URL('../../',import.meta.url), read=p=>JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(p,root))));
const check=process.argv.includes('--check'), byKey=new Map();
const causes=['Se00','Se02','Se04','Se07','Se10','Se16','Se17','Se21','Se23','Se24','Se26','Se27','Se29','Se30','Se31','Se34','SeCO','SeIH'];
for(const basis of ['census','juki']) for(const cause of causes){
 const data=read(`data/${basis}-${cause}-2024-boundary.json.gz`);
 for(let p=1;p<=47;p++){
  const pref=String(p).padStart(2,'0');
  for(const row of rowsForArea(data,pref+'000')) if(row[0]>=2015&&row[0]<=2018){
   const key=[basis,cause,pref,row[0],row[2]].join('|');assert(!byKey.has(key));byKey.set(key,row);
  }
 }
}
let changed=0;
function replace(row,i,value){if(row[i]!==value){if(check)throw Error(`Stale prefecture cache ${row}: ${row[i]} != ${value}`);row[i]=value;changed++;}}
for(const file of ['data/prefecture-cause-annual.json.gz','data/prefecture-cause-annual-v2.json.gz']){
 const doc=read(file);for(const [basis,causes] of Object.entries(doc))for(const [cause,prefs] of Object.entries(causes))for(const [pref,sexes] of Object.entries(prefs))for(const [sex,rows] of Object.entries(sexes))for(const row of rows){
  if(row[0]<2015||row[0]>2018)continue;const ref=byKey.get([basis,cause,pref,row[0],sex].join('|'));assert(ref);
  replace(row,1,ref[3]);replace(row,2,Number(ref[4].toFixed(4)));
 }
 if(!check)fs.writeFileSync(new URL(file,root),zlib.gzipSync(JSON.stringify(doc),{level:9,mtime:0}));
}
const parts=['data/prefecture-smr-annual-00.part','data/prefecture-smr-annual-01.part'],buffers=parts.map(p=>fs.readFileSync(new URL(p,root)));
const doc=JSON.parse(zlib.gunzipSync(Buffer.concat(buffers)));
for(const row of doc.rows){
 const [basis,cause,year,area,sex]=row;if(year<2015||year>2018)continue;
 const ref=byKey.get([basis,cause,area.slice(0,2),year,sex].join('|'));assert(ref);
 replace(row,5,ref[3]);replace(row,6,Number(ref[4].toFixed(6)));
}
if(!check){const b=zlib.gzipSync(JSON.stringify(doc),{level:9,mtime:0});assert(b.length>buffers[0].length);fs.writeFileSync(new URL(parts[0],root),b.subarray(0,buffers[0].length));fs.writeFileSync(new URL(parts[1],root),b.subarray(buffers[0].length));}
console.log('Prefecture cache cells refreshed:',changed);
