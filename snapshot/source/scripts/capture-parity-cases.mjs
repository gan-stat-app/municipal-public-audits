import { gunzipSync } from 'node:zlib';
import { aggregatePeriod, byarObservedInterval } from '../src/lib/smr.js';
import { rowsForArea, aggregateDesignatedCity } from '../src/lib/areaAggregation.js';
import { designatedCityByCode } from '../src/catalogs/designatedCities.js';

const cases=[
 ['akita-juki-male-full','juki','Se00','05201','男',1999,2024],
 ['akita-juki-female-full','juki','Se00','05201','女',1999,2024],
 ['akita-juki-total-full','juki','Se00','05201','男女計',1999,2024],
 ['akita-juki-male-recent','juki','Se00','05201','男',2015,2024],
 ['akita-census-male-full','census','Se00','05201','男',1999,2024],
 ['akita-pref-juki-male-full','juki','Se00','05000','男',1999,2024],
 ['sapporo-juki-male-full','juki','Se00','01100','男',1999,2024],
];
const cache=new Map();
async function dataset(basis,code){const key=`${basis}-${code}`;if(cache.has(key))return cache.get(key);const url=`https://municipal-smr.jp/data/${basis}-${code}-2024-boundary.json.gz`;const r=await fetch(url);if(!r.ok)throw new Error(`${url}: ${r.status}`);const b=Buffer.from(await r.arrayBuffer());let d;try{d=JSON.parse(b.toString('utf8'))}catch{d=JSON.parse(gunzipSync(b).toString('utf8'))}cache.set(key,d);return d}
function calc(d,areaCode,sex,startYear,endYear){const a=designatedCityByCode(areaCode)?aggregateDesignatedCity(d,areaCode,sex,startYear,endYear):aggregatePeriod(rowsForArea(d,areaCode),sex,startYear,endYear);if(!a)throw new Error(`missing ${areaCode}`);const [lo,hi]=byarObservedInterval(a.observed);return {observed:a.observed,expected:a.expected,smr:a.smr,ci95Low:lo/a.expected*100,ci95High:hi/a.expected*100,years:a.years}}
const out=[];for(const [id,basis,datasetCode,areaCode,sex,startYear,endYear] of cases){const d=await dataset(basis,datasetCode);out.push({id,basis,datasetCode,areaCode,sex,startYear,endYear,...calc(d,areaCode,sex,startYear,endYear)})}
console.log(JSON.stringify({captured_at:new Date().toISOString().slice(0,10),cases:out},null,2));
