import { byarObservedInterval, sexMatches, isCalculableRow } from './smr.js';
import { designatedCityForWard, designatedCityByCode, displayAreaName } from '../catalogs/designatedCities.js';

export function municipalityCodes(dataset, prefCode){
  const codes=new Set();
  for(const row of dataset.rows){
    const code=row[1];
    if(!code?.startsWith(prefCode) || code.endsWith('000')) continue;
    // Ranking uses municipality/ward units; designated-city aggregate rows are excluded.
    if(designatedCityByCode(code)) continue;
    codes.add(code);
  }
  return [...codes];
}

function finalizeRanking(items){
  const high=[...items].sort((a,b)=>b.smr-a.smr || a.areaCode.localeCompare(b.areaCode));
  const total=high.length;
  high.forEach((item,index)=>{item.rank=index+1;item.total=total});
  const low=[...high].reverse();
  return {items:high,high,low,total,significantHigh:high.filter(x=>x.significantHigh).length,significantLow:high.filter(x=>x.significantLow).length};
}

export function filterMunicipalityRanking(ranking,prefCode){
  return finalizeRanking(ranking.items.filter(item=>item.areaCode.startsWith(prefCode)));
}

export function buildMunicipalityRanking(dataset,{prefCode=null,sex,startYear,endYear,nameByCode=new Map()}){
  const expectedYears=endYear-startYear+1;
  const grouped=new Map();
  for(const row of dataset.rows){
    const [year,areaCode,rowSex,rowObserved,rowExpected]=row;
    if(!areaCode || areaCode.endsWith('000') || designatedCityByCode(areaCode))continue;
    if(prefCode && !areaCode.startsWith(prefCode))continue;
    if(year<startYear || year>endYear || !sexMatches(rowSex,sex))continue;
    const current=grouped.get(areaCode)??{observed:0,expected:0,years:new Set(),keys:new Set(),invalid:false};
    if(!isCalculableRow(row))current.invalid=true;
    else {
      const key=`${year}|${rowSex}`;
      if(current.keys.has(key))throw new Error('Duplicate ranking area/year/sex row');
      current.keys.add(key);current.observed+=rowObserved;current.expected+=rowExpected;current.years.add(year);
    }
    grouped.set(areaCode,current);
  }
  const items=[];
  for(const [areaCode,result] of grouped){
    if(result.invalid || result.years.size!==expectedYears || !result.expected || (sex==='男女計' && result.keys.size!==expectedYears*2))continue;
    const [lo,hi]=byarObservedInterval(result.observed);
    const ci95Low=lo/result.expected*100,ci95High=hi/result.expected*100;
    const rawName=nameByCode.get(areaCode)??areaCode;
    items.push({
      areaCode,
      name:displayAreaName(areaCode,rawName),
      observed:result.observed,
      expected:result.expected,
      smr:result.observed/result.expected*100,
      ci95Low,
      ci95High,
      significantHigh:ci95Low>100,
      significantLow:ci95High<100,
      designatedCity:designatedCityForWard(areaCode)?.code??null,
    });
  }
  return finalizeRanking(items);
}
