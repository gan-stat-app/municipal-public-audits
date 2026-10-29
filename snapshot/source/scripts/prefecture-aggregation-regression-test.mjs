import assert from'node:assert/strict';
import{rowsForArea}from'../src/lib/areaAggregation.js';
import{aggregatePeriod}from'../src/lib/smr.js';

const dataset={rows:[
  [2024,'01000','M',999,999],
  [2024,'01100','M',100,100],
  [2024,'01101','M',40,40],
  [2024,'01102','M',60,60],
  [2024,'01202','M',10,10],
  [2023,'01100','M',100,100],
  [2023,'01202','M',20,20]
]};
const rows=rowsForArea(dataset,'01000');
const y2024=aggregatePeriod(rows,'男',2024,2024);
assert.deepEqual(y2024,{observed:999,expected:999,smr:100,years:1},'direct prefecture row must override fallback for same year');
const y2023=aggregatePeriod(rows,'男',2023,2023);
assert.deepEqual(y2023,{observed:120,expected:120,smr:100,years:1},'city aggregate must remain when wards are unavailable');
const fallbackOnly={rows:dataset.rows.filter(row=>row[1]!=='01000')};
const fallback2024=aggregatePeriod(rowsForArea(fallbackOnly,'01000'),'男',2024,2024);
assert.deepEqual(fallback2024,{observed:110,expected:110,smr:100,years:1},'city aggregate and wards must not be double counted');
console.log(JSON.stringify({pass:true,directOverride:true,cityWithoutWards:true,wardCollisionExcluded:true}));
