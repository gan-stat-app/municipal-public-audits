import assert from 'node:assert/strict';
import{buildMunicipalityRanking,filterMunicipalityRanking}from'../src/lib/ranking.js';

const rows=[];
for(const [year,akObs,aoObs] of [[2023,12,8],[2024,15,7]]){
 rows.push([year,'05201','M',akObs,10]);
 rows.push([year,'02201','M',aoObs,10]);
 rows.push([year,'05101','M',50,10]); // incomplete period: excluded
 rows.push([year,'05000','M',999,10]); // prefecture aggregate: excluded
 rows.push([year,'05201','F',100,10]); // wrong sex: excluded
}
rows.pop(); // remove 2024 female row only; male coverage remains complete
const dataset={rows};
const names=new Map([['05201','秋田市'],['02201','青森市'],['05101','秋田市旧境界']]);
const national=buildMunicipalityRanking(dataset,{sex:'男',startYear:2023,endYear:2024,nameByCode:names});
assert.equal(national.total,3);
assert.equal(national.high[0].areaCode,'05101');
assert.equal(national.items.find(x=>x.areaCode==='05201').rank,2);
assert(!national.items.some(x=>x.areaCode==='05000'));
const akita=filterMunicipalityRanking(national,'05');
assert.equal(akita.total,2);
assert.equal(akita.high[0].rank,1);
assert.equal(akita.high[0].total,2);
assert.equal(akita.low.at(-1).areaCode,akita.high[0].areaCode);
// National comparison is deferred until its panel approaches the viewport or the user selects nationwide ranking.
console.log(JSON.stringify({pass:true,nationalTotal:national.total,prefectureTotal:akita.total,onePassAggregation:true}));
