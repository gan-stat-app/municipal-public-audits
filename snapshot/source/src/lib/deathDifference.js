import {availability} from './deathDifferenceAvailability.js';
export {availability} from './deathDifferenceAvailability.js';
import { aggregatePeriod } from './smr.js';
import { rowsForArea, rowsForDesignatedCity } from './areaAggregation.js';
import { designatedCityByCode } from '../catalogs/designatedCities.js';

export function calculateDifference(index, standard, area, dataset, q, unknown) {
  if(availability(q)) throw new Error(availability(q));
  if(!area) throw new Error('選択地域の年齢別データがありません。');
  const refs=designatedCityByCode(q.areaCode)?rowsForDesignatedCity(dataset,q.areaCode):rowsForArea(dataset,q.areaCode);
  const result={ages:index.ages, sexes:{}};
  for(const sex of ['M','F']) {
    const cells=index.ages.map(age=>({age,observed:0,expected:0}));
    for(let y=q.startYear;y<=q.endYear;y++) {
      const i=index.years.indexOf(y), input=area.sexes[sex], base=standard.years[String(y)]?.[sex];
      if(!unknown?.years[String(y)]) throw new Error('年齢不詳の原数が確認できません。');
      if(i<0 || !base || !input) throw new Error('選択期間の年齢別データがそろっていません。');
      const d=input.deaths[i],p=input.population[i];
      if(!d || !p || d.length!==cells.length || p.length!==cells.length || base.length!==cells.length) throw new Error('年齢階級が一致しません。');
      cells.forEach((c,j)=>{
        if(!Number.isFinite(d[j]) || !Number.isFinite(p[j]) || p[j]<0 || d[j]<0 || !Number.isFinite(base[j][0]) || base[j][0]<0 || !(base[j][1]>0)) throw new Error('選択期間に欠測があります。欠測を補って表示することはできません。');
        c.observed+=d[j];c.expected+=p[j]*base[j][0]/base[j][1];
      });
    }
    const unknownObserved=Array.from({length:q.endYear-q.startYear+1},(_,i)=>unknown?.years[String(q.startYear+i)]?.[q.areaCode+'|'+sex]??0).reduce((a,b)=>a+b,0);
    const observed=unknownObserved+cells.reduce((s,c)=>s+c.observed,0),expected=cells.reduce((s,c)=>s+c.expected,0);
    const ref=aggregatePeriod(refs,sex==='M'?'男':'女',q.startYear,q.endYear);
    // Published E is rounded to 6 decimals per annual source row. Never rescale age cells.
    const roundingRows=q.areaCode.endsWith('000')?dataset.rows.filter(r=>r[1].startsWith(q.areaCode.slice(0,2))):refs;
    const annualRows=roundingRows.filter(r=>r[2]===sex && r[0]>=q.startYear && r[0]<=q.endYear).length;
    if(!ref || ref.years!==q.endYear-q.startYear+1 || ref.observed!==observed || Math.abs(ref.expected-expected)>annualRows*0.00000051+1e-8) throw new Error('この地域・期間は、年齢別合計とSMR本体の観察・期待死亡数が一致しないため表示できません。公表表とSMR本体の集計範囲などを確認する必要があります。');
    result.sexes[sex]={cells:cells.map(c=>({...c,difference:c.observed-c.expected})),unknownObserved,observed,expected,difference:observed-expected};
  }
  return result;
}

// Adapt exact cause-specific counts to the existing SMR parity calculation.
export function calculateCauseDifference(index, area, dataset, q, payload) {
  if(availability(q)) throw new Error(availability(q));
  // Legacy files use cause_code; source-verified rebuilds use cause.
  // If both metadata fields exist, both must agree with the requested cause.
  const causeCodes = [dataset?.cause_code, dataset?.cause].filter(code => code !== undefined);
  if(payload?.causeCode!==q.datasetCode || !causeCodes.length || causeCodes.some(code => code !== q.datasetCode)) throw new Error('死因が一致しません。');
  if(JSON.stringify(payload.years)!==JSON.stringify(index.years) || JSON.stringify(payload.ages)!==JSON.stringify(index.ages)) throw new Error('死因別データの年・年齢階級が一致しません。');
  const source=payload.areas.find(a=>a.code===q.areaCode);
  if(!area || !source) throw new Error('選択した都道府県の死因別原数がありません。');
  const merged={...area,sexes:{}},unknown={years:{}};
  for(const sex of ['M','F']) {
    const rows=source.sexes[sex];
    if(!rows || !area.sexes[sex]) throw new Error('性別の原数がありません。');
    merged.sexes[sex]={population:area.sexes[sex].population,deaths:rows.deaths};
    for(let y=q.startYear;y<=q.endYear;y++) {
      const i=index.years.indexOf(y),u=rows.unknown[i],d=rows.deaths[i],total=rows.totals[i];
      if(!Number.isInteger(u) || u<0 || !Number.isInteger(total) || !d || d.length!==index.ages.length || d.some(n=>!Number.isInteger(n)||n<0) || d.reduce((a,b)=>a+b,0)+u!==total) throw new Error('死因別の年齢内訳・年齢不詳と公表総数が一致しません。');
      (unknown.years[String(y)]??={})[q.areaCode+'|'+sex]=u;
    }
  }
  // Reject an inconsistent annual input even if differences could cancel over a period.
  if(q.startYear!==q.endYear) for(let y=q.startYear;y<=q.endYear;y++) calculateDifference(index,payload.standard,merged,dataset,{...q,startYear:y,endYear:y},unknown);
  return calculateDifference(index,payload.standard,merged,dataset,q,unknown);
}
