import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { byarObservedInterval, aggregatePeriod } from '../src/lib/smr.js';
import { rowsForArea, aggregateDesignatedCity } from '../src/lib/areaAggregation.js';
import { designatedCityByCode } from '../src/catalogs/designatedCities.js';

const fixture=JSON.parse(await readFile(new URL('../fixtures/production-parity.json',import.meta.url),'utf8'));
// PRs validate the candidate files before publication; main also checks the live site.
const sources=process.argv.includes('--local-only')||process.env.GITHUB_EVENT_NAME==='pull_request'?['checkout']:['checkout','production'];
const cache=new Map();
async function load(basis,datasetCode,source){
  const key=`${source}:${basis}-${datasetCode}`; if(cache.has(key))return cache.get(key);
  const url=`https://municipal-smr.jp/data/${basis}-${datasetCode}-2024-boundary.json.gz`;
  let bytes;
  if(source==='checkout')bytes=await readFile(new URL(`../../data/${basis}-${datasetCode}-2024-boundary.json.gz`,import.meta.url));
  else {
    const response=await fetch(url,{headers:{'Cache-Control':'no-cache'}}); if(!response.ok)throw new Error(`${url}: ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
  }
  let dataset;
  try{dataset=JSON.parse(bytes.toString('utf8'));}catch{dataset=JSON.parse(gunzipSync(bytes).toString('utf8'));}
  if(!Array.isArray(dataset.rows)||!dataset.rows.length)throw new Error(`${url}: rows missing`);
  cache.set(key,dataset); return dataset;
}
function actualFor(dataset,c){
  const result=designatedCityByCode(c.areaCode)
    ? aggregateDesignatedCity(dataset,c.areaCode,c.sex,c.startYear,c.endYear)
    : aggregatePeriod(rowsForArea(dataset,c.areaCode),c.sex,c.startYear,c.endYear);
  if(!result)throw new Error(`${c.id}: aggregate missing`);
  const [lo,hi]=byarObservedInterval(result.observed);
  return {observed:result.observed,expected:result.expected,smr:result.smr,ci95Low:lo/result.expected*100,ci95High:hi/result.expected*100,years:result.years};
}
const tolerances={observed:0,expected:1e-9,smr:1e-9,ci95Low:1e-9,ci95High:1e-9,years:0};
const passed=[];
for(const source of sources)for(const expected of fixture.cases){
  const dataset=await load(expected.basis,expected.datasetCode,source); const actual=actualFor(dataset,expected);
  for(const [field,tolerance] of Object.entries(tolerances)){
    const delta=Math.abs(actual[field]-expected[field]);
    if(!Number.isFinite(delta)||delta>tolerance)throw new Error(`${source}/${expected.id}: ${field} regression actual=${actual[field]} expected=${expected[field]} delta=${delta}`);
  }
  passed.push({source,id:expected.id,...actual});
}
console.log(JSON.stringify({pass:true,cases:fixture.cases.length,sources,checks:passed.length,passed}));
