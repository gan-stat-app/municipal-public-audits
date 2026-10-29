import assert from'node:assert/strict';
import{aggregateMedicalArea,buildMedicalAreaRanking}from'../src/lib/medicalAreas.js';
import{significanceFill,significancePalette}from'../src/catalogs/mapStyle.js';

const area={code:'9901',name:'検査圏',municipalities:[['99101','甲'],['99102','乙']]};
const rows=[];
for(const year of[2023,2024])for(const code of['99101','99102'])for(const sex of['M','F'])rows.push([year,code,sex,sex==='M'?12:8,10,null,null,'AVAILABLE']);
const dataset={rows};
const male=aggregateMedicalArea(dataset,area,'男',2023,2024);
assert.equal(male.complete,true);
assert.equal(male.observed,48);
assert.equal(male.expected,40);
assert.equal(male.smr,120);
const both=aggregateMedicalArea(dataset,area,'男女計',2023,2024);
assert.equal(both.observed,80);
assert.equal(both.expected,80);
assert.equal(both.smr,100);
assert.equal(buildMedicalAreaRanking(dataset,[area],{sex:'男',startYear:2023,endYear:2024}).total,1);
assert.equal(aggregateMedicalArea({rows:rows.slice(1)},area,'男女計',2023,2024),null);
assert.equal(significanceFill({smr:130,ci95Low:110,ci95High:150}),significancePalette.high);
assert.equal(significanceFill({smr:70,ci95Low:50,ci95High:90}),significancePalette.low);
assert.equal(significanceFill({smr:105,ci95Low:90,ci95High:120}),significancePalette.neutral);
console.log('medical-area SMR aggregation/significance: OK');
const bounded=significanceFill({smr:110,ci95Low:100,ci95High:120});
assert.equal(bounded,significancePalette.neutral,'CI touching 100 is not significant');
assert.equal(significanceFill({smr:90,ci95Low:80,ci95High:100}),significancePalette.neutral);
assert.equal(significanceFill({smr:90,ci95Low:null,ci95High:100}),significancePalette.missing);
assert.equal(aggregateMedicalArea({rows:[[2024,'99101','M',0,10],[2024,'99102','M',0,10]]},area,'男',2024,2024).smr,0);
assert.equal(aggregateMedicalArea({rows:rows.map((r,i)=>i===0?[...r.slice(0,3),null,null]:r)},area,'男女計',2023,2024),null);
assert.throws(()=>aggregateMedicalArea({rows:[...rows,rows[0]]},area,'男',2023,2024),/Duplicate/);
const {normalizeMedicalAreas,medicalAreaTrend}=await import('../src/lib/medicalAreas.js');
const whole=normalizeMedicalAreas([{code:'9901',municipalities:[['01101','中央区'],['01102','北区'],['01201','他市']]}])[0];
const cityRows={rows:[[2024,'01100','M',100,80],[2024,'01101','M',40,30],[2024,'01102','M',60,50],[2024,'01201','M',10,10]]};
assert.equal(aggregateMedicalArea(cityRows,whole,'男',2024,2024).observed,110,'City totals must not overlap wards');
const split=normalizeMedicalAreas([{code:'9901',municipalities:[['01101','中央区']]},{code:'9902',municipalities:[['01102','北区']]}]);
assert.equal(aggregateMedicalArea(cityRows,split[0],'男',2024,2024).observed,40,'A partial city cannot use its whole-city total');
assert.equal(medicalAreaTrend(cityRows,whole,'男').filter(x=>Number.isFinite(x.smr))[0].label,'2024');


