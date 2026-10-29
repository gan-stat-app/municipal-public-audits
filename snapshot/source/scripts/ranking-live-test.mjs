import { gunzipSync } from 'node:zlib';
import { buildMunicipalityRanking } from '../src/lib/ranking.js';

async function load(url){
  const response=await fetch(url);if(!response.ok)throw new Error(`fetch ${response.status}: ${url}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  try{return JSON.parse(bytes.toString('utf8'))}catch{return JSON.parse(gunzipSync(bytes).toString('utf8'))}
}
const [dataset,catalog]=await Promise.all([
  load('https://municipal-smr.jp/data/juki-Se00-2024-boundary.json.gz'),
  load('https://municipal-smr.jp/data/area-catalog.json'),
]);
const nameByCode=new Map(catalog.map(([code,name])=>[code,name]));
const ranking=buildMunicipalityRanking(dataset,{prefCode:'05',sex:'男',startYear:1999,endYear:2024,nameByCode});
if(ranking.total<20)throw new Error(`unexpected Akita ranking total ${ranking.total}`);
if(!ranking.high.length||!ranking.low.length)throw new Error('ranking empty');
for(const item of [...ranking.high.slice(0,5),...ranking.low.slice(0,5)]){
  if(!(item.observed>=0&&item.expected>0&&item.smr>0&&item.ci95Low>=0&&item.ci95High>item.ci95Low))throw new Error(`invalid ${item.areaCode}`);
  if(!item.name||item.name===item.areaCode||/^\d+$/.test(item.name))throw new Error(`municipality name unresolved: ${item.areaCode} => ${item.name}`);
}
console.log(JSON.stringify({pass:true,total:ranking.total,significantHigh:ranking.significantHigh,significantLow:ranking.significantLow,high:ranking.high.slice(0,5).map(x=>({areaCode:x.areaCode,name:x.name,smr:x.smr})),low:ranking.low.slice(0,5).map(x=>({areaCode:x.areaCode,name:x.name,smr:x.smr}))}));
