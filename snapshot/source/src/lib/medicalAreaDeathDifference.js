import {availability} from './deathDifferenceAvailability.js';
import {medicalAreaAnnualRows} from './medicalAreas.js';

// Sum original age counts and annual expected counts, never municipality SMRs.
// Validate every member/year/sex so opposite errors cannot cancel in a period.
export function calculateMedicalAreaDifference(index,standard,area,ageAreas,dataset,q,unknown){
  if(availability(q))throw new Error(availability(q));
  if(!area||area.code!==q.medicalAreaCode)throw new Error('選択した2次医療圏の構成市区町村が確認できません。');
  if(q.datasetCode!=='Se00')throw new Error('2次医療圏の死亡数差ピラミッドは全死因のみ対応しています。');
  const ageByCode=new Map();
  for(const a of ageAreas){
    if(ageByCode.has(a.code))throw new Error('年齢別データに同じ地域が重複しています。');
    ageByCode.set(a.code,a);
  }
  const result={ages:index.ages,sexes:{}};
  for(const sex of ['M','F']){
    const cells=index.ages.map(age=>({age,observed:0,expected:0}));
    let unknownObserved=0;
    for(let year=q.startYear;year<=q.endYear;year++){
      const i=index.years.indexOf(year),base=standard.years[String(year)]?.[sex];
      const rows=medicalAreaAnnualRows(dataset,area,year,sex);
      if(i<0||!rows||!base||base.length!==cells.length||!unknown?.years[String(year)])throw new Error('選択期間の構成市区町村の原数がそろっていません。欠測を補って表示することはできません。');
      for(const row of rows){
        const code=row[1],member=ageByCode.get(code),input=member?.sexes?.[sex];
        const d=input?.deaths?.[i],p=input?.population?.[i];
        const label=`${member?.name||code}・${year}年・${sex==='M'?'男性':'女性'}`;
        if(!d||!p||d.length!==cells.length||p.length!==cells.length)throw new Error(`${label}の年齢別データがそろっていません。`);
        // The preserved unknown-age file is sparse: absent keys are published zeroes.
        const u=unknown.years[String(year)][code+'|'+sex]??0;
        if(!Number.isInteger(u)||u<0)throw new Error(`${label}の年齢不詳数が確認できません。`);
        let observed=u,expected=0;
        const annual=d.map((value,j)=>{
          if(!Number.isInteger(value)||value<0||!Number.isFinite(p[j])||p[j]<0||!Number.isFinite(base[j]?.[0])||base[j][0]<0||!Number.isFinite(base[j]?.[1])||!(base[j]?.[1]>0))throw new Error(`${label}に欠測があります。欠測を補って表示することはできません。`);
          const e=p[j]*base[j][0]/base[j][1];observed+=value;expected+=e;
          return {observed:value,expected:e};
        });
        // Each published annual E is rounded to six decimal places.
        if(observed!==row[3]||Math.abs(expected-row[4])>0.00000051+1e-8)throw new Error(`${label}の年齢別合計とSMR本体の観察・期待死亡数が一致しないため表示できません。`);
        annual.forEach((c,j)=>{cells[j].observed+=c.observed;cells[j].expected+=c.expected});
        unknownObserved+=u;
      }
    }
    const observed=unknownObserved+cells.reduce((s,c)=>s+c.observed,0),expected=cells.reduce((s,c)=>s+c.expected,0);
    result.sexes[sex]={cells:cells.map(c=>({...c,difference:c.observed-c.expected})),unknownObserved,observed,expected,difference:observed-expected};
  }
  return result;
}
