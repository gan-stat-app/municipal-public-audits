import assert from'node:assert/strict';
import{isPrefectureWide,mapScopeForArea}from'../src/lib/mapScope.js';

const cycles=[
  {areaCode:'05201',scope:'prefecture',prefectureWide:false},
  {areaCode:'05000',scope:'national',prefectureWide:true},
  {areaCode:'05201',scope:'prefecture',prefectureWide:false},
  {areaCode:'13000',scope:'national',prefectureWide:true},
  {areaCode:'13101',scope:'prefecture',prefectureWide:false},
  {areaCode:'13000',scope:'national',prefectureWide:true},
  {areaCode:'13101',scope:'prefecture',prefectureWide:false}
];
for(const c of cycles){
  assert.equal(mapScopeForArea(c.areaCode),c.scope,`${c.areaCode}: map scope`);
  assert.equal(isPrefectureWide(c.areaCode),c.prefectureWide,`${c.areaCode}: prefecture-wide state`);
}
assert.throws(()=>mapScopeForArea('0500'),/Invalid area code/);
console.log(JSON.stringify({pass:true,transitions:cycles.length-1,sequence:cycles.map(x=>`${x.areaCode}:${x.scope}`)}));
