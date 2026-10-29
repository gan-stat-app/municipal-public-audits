import { buildMunicipalityRanking } from './ranking.js';
import { aggregatePeriod, byarObservedInterval } from './smr.js';
import { rowsForArea } from './areaAggregation.js';

export function municipalityMapValues(dataset, options){
  const ranking=buildMunicipalityRanking(dataset,options);
  return new Map(ranking.items.map(item=>[item.areaCode,{
    areaCode:item.areaCode,smr:item.smr,observed:item.observed,expected:item.expected,
    ci95Low:item.ci95Low,ci95High:item.ci95High,significantHigh:item.significantHigh,significantLow:item.significantLow
  }]));
}

export function prefectureMapValues(dataset,{sex,startYear,endYear}){
  const expectedYears=endYear-startYear+1; const out=new Map();
  for(let i=1;i<=47;i++){
    const pref=String(i).padStart(2,'0'), areaCode=`${pref}000`;
    const result=aggregatePeriod(rowsForArea(dataset,areaCode),sex,startYear,endYear);
    if(!result||result.years!==expectedYears||!result.expected)continue;
    const [lo,hi]=byarObservedInterval(result.observed);
    out.set(areaCode,{areaCode,smr:result.smr,observed:result.observed,expected:result.expected,ci95Low:lo/result.expected*100,ci95High:hi/result.expected*100});
  }
  return out;
}

// Classification/palette is intentionally separate. Do not invent thresholds or colors;
// recover them from the production implementation before wiring choropleth styling.
export function classifyByThresholds(value, thresholds){
  if(value==null||!Number.isFinite(value))return null;
  if(!Array.isArray(thresholds)||thresholds.length!==4||thresholds.some((x,i)=>i&&x<thresholds[i-1]))throw new Error('four ascending thresholds required');
  let index=0; while(index<thresholds.length&&value>thresholds[index])index++; return index;
}
