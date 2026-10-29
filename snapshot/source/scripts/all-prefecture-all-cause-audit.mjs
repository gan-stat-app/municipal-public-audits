import assert from'node:assert/strict';
import{arbitraryCauses as allCauses,legacyArbitraryCodes}from'../src/catalogs/causes.js';
// Preserve the complete 1999–2024 production audit. The separately verified
// 2015–2024 extension is audited by selected-causes-test.mjs in the same CI job.
const arbitraryCauses=allCauses.filter(([code])=>legacyArbitraryCodes.has(code));
import{clearMemoryDataCache,loadCauseData}from'../src/lib/dataClient.js';
import{completeAggregateWithCI,rowsForArea}from'../src/lib/areaAggregation.js';
import{aggregatePeriod}from'../src/lib/smr.js';
import{designatedCityByCode,designatedCityForWard}from'../src/catalogs/designatedCities.js';

const dataOrigin=process.env.DATA_ORIGIN||'https://municipal-smr.jp';
const bases=['juki','census'],sexes=['男','女','男女計'],startYear=1999,endYear=2024,expectedYears=26;
const summary={pass:true,dataOrigin,bases:{},causes:arbitraryCauses.length,prefectures:47,sexes:sexes.length,cases:0,directYearSexRows:0,fallbackYearSexRows:0,designatedCityCollisionsExcluded:0,datasets:[]};

for(const basis of bases){
  const basisSummary={datasets:0,cases:0,directYearSexRows:0,fallbackYearSexRows:0};
  summary.bases[basis]=basisSummary;
  for(const[datasetCode,causeName]of arbitraryCauses){
    const dataset=await loadCauseData({basis,datasetCode},{origin:dataOrigin});
    assert(Array.isArray(dataset?.rows),`${basis}/${datasetCode}: rows missing`);
    let directRows=0,fallbackRows=0,collisions=0;
    const wardKeys=new Set(dataset.rows.map(row=>{const city=designatedCityForWard(row[1]);return city?`${city.code}|${row[0]}|${row[2]}`:null}).filter(Boolean));
    for(const row of dataset.rows){const city=designatedCityByCode(row[1]);if(city&&wardKeys.has(`${city.code}|${row[0]}|${row[2]}`))collisions++;}
    for(let i=1;i<=47;i++){
      const areaCode=`${String(i).padStart(2,'0')}000`;
      const direct=dataset.rows.filter(row=>row[1]===areaCode&&['M','F'].includes(row[2])&&row[0]>=startYear&&row[0]<=endYear);
      const directKeys=new Set(direct.map(row=>`${row[0]}|${row[2]}`));
      directRows+=directKeys.size;
      fallbackRows+=expectedYears*2-directKeys.size;
      const rows=rowsForArea(dataset,areaCode);
      for(const sex of sexes){
        const result=completeAggregateWithCI(aggregatePeriod(rows,sex,startYear,endYear),expectedYears);
        assert(result,`${basis}/${datasetCode}/${areaCode}/${sex}: incomplete 1999-2024`);
        assert(Number.isInteger(result.observed)&&result.observed>=0,`${basis}/${datasetCode}/${areaCode}/${sex}: invalid observed`);
        for(const key of['expected','smr','ci95Low','ci95High'])assert(Number.isFinite(result[key]),`${basis}/${datasetCode}/${areaCode}/${sex}: invalid ${key}`);
        assert(result.expected>0,`${basis}/${datasetCode}/${areaCode}/${sex}: expected <= 0`);
        assert(result.ci95Low<=result.smr&&result.smr<=result.ci95High,`${basis}/${datasetCode}/${areaCode}/${sex}: SMR outside CI`);
        summary.cases++;basisSummary.cases++;
      }
    }
    summary.directYearSexRows+=directRows;summary.fallbackYearSexRows+=fallbackRows;summary.designatedCityCollisionsExcluded+=collisions;
    basisSummary.directYearSexRows+=directRows;basisSummary.fallbackYearSexRows+=fallbackRows;basisSummary.datasets++;
    summary.datasets.push({basis,datasetCode,causeName,directYearSexRows:directRows,fallbackYearSexRows:fallbackRows,designatedCityCollisionsExcluded:collisions,cases:47*sexes.length});
    clearMemoryDataCache();
  }
}
assert.equal(summary.cases,bases.length*arbitraryCauses.length*47*sexes.length,'case count');
console.log(JSON.stringify(summary));
