import { byarObservedInterval, isCalculableRow } from './smr.js';
import { designatedCityForWard } from '../catalogs/designatedCities.js';
const CATALOG_URL='/regional-healthcare-vision/data/medical-area-municipalities.json';
const GEOMETRY_URL='/regional-healthcare-vision/data/medical-areas-map.geojson.gz';
let catalogPromise;
const indexes=new WeakMap();

// 2022-12-31 partition; replace only Hamamatsu's old wards for the 2024 data.
export function normalizeMedicalAreas(areas){
  const normalized=areas.map(area=>area.code!=='2208'?area:{...area,municipalities:[
    ...area.municipalities.filter(([code])=>!/^2213[1-7]$/.test(code)),
    ['22138','中央区'],['22139','浜名区'],['22140','天竜区']
  ]});
  const cityAreas=new Map();
  for(const area of normalized)for(const[code]of area.municipalities){
    const city=designatedCityForWard(code);if(!city)continue;
    if(!cityAreas.has(city.code))cityAreas.set(city.code,new Set());
    cityAreas.get(city.code).add(area.code);
  }
  return normalized.map(area=>({...area,wholeCities:[...cityAreas]
    .filter(([,codes])=>codes.size===1&&codes.has(area.code))
    .map(([code])=>({code,wards:area.municipalities.filter(([ward])=>designatedCityForWard(ward)?.code===code).map(([ward])=>ward)}))}));
}
export async function loadMedicalAreas({signal}={}){
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(!catalogPromise)catalogPromise=fetch(CATALOG_URL,{credentials:'same-origin'})
    .then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}: ${CATALOG_URL}`);return r.json()})
    .then(x=>normalizeMedicalAreas(x.areas)).catch(e=>{catalogPromise=null;throw e});
  return catalogPromise;
}
export async function loadMedicalAreaGeometry({signal}={}){
  const response=await fetch(GEOMETRY_URL,{signal,credentials:'same-origin'});
  if(!response.ok)throw new Error(`HTTP ${response.status}: ${GEOMETRY_URL}`);
  const bytes=new Uint8Array(await response.arrayBuffer());let text;
  if(bytes[0]===0x1f&&bytes[1]===0x8b){
    if(typeof DecompressionStream!=='function')throw new Error('gzip decompression unavailable');
    text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }else text=new TextDecoder().decode(bytes);
  const geo=JSON.parse(text);
  if(geo?.type!=='FeatureCollection'||geo.features?.length!==335)throw new Error('Invalid medical-area GeoJSON');
  return geo.features.map(f=>({...f,properties:{...f.properties,area_code:String(f.properties.code)}}));
}
function rowIndex(dataset){
  if(indexes.has(dataset))return indexes.get(dataset);
  const index=new Map();
  for(const row of dataset.rows){
    const key=`${row[0]}|${row[1]}|${row[2]}`;
    if(index.has(key))throw new Error('Duplicate medical-area member/year/sex row');
    index.set(key,row);
  }
  indexes.set(dataset,index);return index;
}
// Share the exact annual membership with the age-specific pyramid.
export function medicalAreaAnnualRows(dataset,area,year,rowSex){
    if(!dataset||!area?.municipalities?.length)return null;
    const index=rowIndex(dataset);
    const members=new Set(area.municipalities.map(([code])=>String(code).padStart(5,'0')));
    // Replace ward rows only when the whole city belongs to this area.
    // City totals and their ward rows are never counted together.
    for(const city of area.wholeCities||[]){
      const direct=index.get(`${year}|${city.code}|${rowSex}`);
      if(!direct)continue;if(!isCalculableRow(direct))return null;
      for(const ward of city.wards)members.delete(ward);members.add(city.code);
    }
    const rows=[];
    for(const code of members){
      const row=index.get(`${year}|${code}|${rowSex}`);
      if(!row||!isCalculableRow(row))return null;
      rows.push(row);
    }
    return rows;
}
export function aggregateMedicalArea(dataset,area,sex,startYear,endYear){
  if(!dataset||!area||!area.municipalities.length||startYear>endYear)return null;
  const sexes=sex==='男女計'?['M','F']:[sex==='男'?'M':'F'];
  let observed=0,expected=0;
  for(let year=startYear;year<=endYear;year++)for(const rowSex of sexes){
    const rows=medicalAreaAnnualRows(dataset,area,year,rowSex);
    if(!rows)return null;
    for(const row of rows){observed+=row[3];expected+=row[4]}
  }
  if(expected<=0)return null;
  const[low,high]=byarObservedInterval(observed);
  return{complete:true,observed,expected,smr:observed/expected*100,ci95Low:low/expected*100,ci95High:high/expected*100,years:endYear-startYear+1};
}
export function buildMedicalAreaRanking(dataset,areas,{prefCode=null,sex,startYear,endYear}){
  const items=[];
  for(const area of areas){
    if(prefCode&&area.code.slice(0,2)!==prefCode)continue;
    const result=aggregateMedicalArea(dataset,area,sex,startYear,endYear);
    if(result)items.push({areaCode:area.code,name:area.name,...result,significantHigh:result.ci95Low>100,significantLow:result.ci95High<100});
  }
  const high=items.sort((a,b)=>b.smr-a.smr||a.areaCode.localeCompare(b.areaCode)),total=high.length;
  high.forEach((x,i)=>{x.rank=i+1;x.total=total});
  return{items:high,high,low:[...high].reverse(),total,significantHigh:high.filter(x=>x.significantHigh).length,significantLow:high.filter(x=>x.significantLow).length};
}
export function medicalAreaMapValues(dataset,areas,options){
  return new Map(buildMedicalAreaRanking(dataset,areas,options).items.map(x=>[x.areaCode,x]));
}
export function medicalAreaTrend(dataset,area,sex){
  const out=[];
  for(let year=1999;year<=2024;year++){const x=aggregateMedicalArea(dataset,area,sex,year,year);out.push({label:String(year),year,...(x||{smr:null,observed:null,expected:null,ci95Low:null,ci95High:null})})}
  return out;
}

