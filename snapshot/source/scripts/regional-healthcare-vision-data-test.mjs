import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {gunzipSync} from "node:zlib";
const bedPaths=process.argv.length>3?process.argv.slice(2,4):[0,1].map(i=>new URL(`../../regional-healthcare-vision/data/bed-function-facilities-v4.json.gz.${i}`,import.meta.url));
const carePath=process.argv[4]||new URL("../public/regional-healthcare-vision/data/area-care-summary-v3.json",import.meta.url);
const bedRaw=Buffer.concat(await Promise.all(bedPaths.map(path=>readFile(path))));
const bed=JSON.parse(gunzipSync(bedRaw));
const care=JSON.parse(await readFile(carePath,"utf8"));
assert.equal(bed.sourcePlanningAreaCount,339);
assert.equal(bed.areas.length,335);
assert.equal(new Set(bed.areas.map(x=>x.code)).size,335);
assert.equal(bed.fiscalYear,2025);
assert.equal(bed.reportedAt,"2025-07-01");
assert.equal(bed.plannedAt,"2026-07-01");
assert.equal(bed.areas.reduce((n,x)=>n+x.facilities.length,0),6877);
assert.equal(bed.areas.reduce((n,x)=>n+x.facilities.reduce((m,f)=>m+f.totalBeds,0),0),1139471);
assert.equal(bed.areas.reduce((n,x)=>n+x.facilities.reduce((m,f)=>m+f.missingBedsWardCount,0),0),0);
assert.deepEqual(bed.areas.find(x=>x.code==="2401").sourcePlanningAreas,["2405","2406","2407"]);
for(const code of ["0501","0502","0503","0504","0505","0506","0507","0508"])
  assert(bed.areas.some(x=>x.code===code),`Akita planning area ${code}`);
assert.equal(care.areas.length,335);
assert(care.areas.some(x=>x.service_composition?.matched_insurers>0));
assert.equal(care.areas.filter(x=>x.service_composition?.matched_insurers).length,335);
assert.equal(care.areas.filter(x=>x.insurer_scope==="reference").length,5);
assert.equal(care.areas.find(x=>x.code==="0506").insurers[0].name,"大曲仙北広域市町村圏組合");
for(const x of care.areas.filter(x=>x.service_composition?.matched_insurers)){
  const c=x.service_composition; assert(Math.abs(c.home_share_pct+c.community_share_pct+c.facility_share_pct-100)<1e-7,x.code);
}
console.log(JSON.stringify({pass:true,sourceAreas:339,pageAreas:335,facilities:6877,beds:1139471,careCompositionAreas:care.areas.filter(x=>x.service_composition?.matched_insurers).length}));
