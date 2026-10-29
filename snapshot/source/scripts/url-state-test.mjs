import assert from'node:assert/strict';import{queryFromLocation,queryToSearch}from'../src/lib/urlState.js';
const defaults={mode:'arbitrary',basis:'juki',datasetCode:'Se00',areaCode:'05201',sex:'男',startYear:1999,endYear:2024,officialPeriod:'2018-2022'};
const arbitrary=queryFromLocation(defaults,'?mode=arbitrary&area=01100&cause=Se02&sex=%E5%A5%B3&basis=census&start=2005&end=2019');assert.deepEqual(arbitrary,{...defaults,mode:'arbitrary',areaCode:'01100',datasetCode:'Se02',sex:'女',basis:'census',startYear:2005,endYear:2019});const a2=queryFromLocation(defaults,queryToSearch(arbitrary));assert.deepEqual(a2,arbitrary);
const official=queryFromLocation(defaults,'?mode=official&area=05201&cause=Se00&sex=%E7%94%B7%E5%A5%B3%E8%A8%88&period=2003-2007');assert.equal(official.mode,'official');assert.equal(official.sex,'男');assert.equal(official.officialPeriod,'2003-2007');const o2=queryFromLocation(defaults,queryToSearch(official));assert.deepEqual(o2,official);
const invalid=queryFromLocation(defaults,'?mode=nope&area=x&cause=bad&sex=other&basis=bad&start=1900&end=9999&period=nope');assert.deepEqual(invalid,defaults);
const reversed=queryFromLocation(defaults,'?start=2020&end=2001');assert.equal(reversed.startYear,2001);assert.equal(reversed.endYear,2020);
console.log(JSON.stringify({pass:true,cases:4}));

const regionDefaults={...defaults,regionUnit:'municipality',medicalAreaCode:'0504'};
const medical=queryFromLocation(regionDefaults,'?unit=medical-area&medical_area=2208&start=2020&end=2024');
assert.equal(medical.regionUnit,'medical-area');
assert.equal(medical.medicalAreaCode,'2208');
assert.deepEqual(queryFromLocation(regionDefaults,queryToSearch(medical)),medical);
assert.deepEqual(queryFromLocation(regionDefaults,'?unit=bad&medical_area=wrong'),regionDefaults);
assert.equal(queryFromLocation(regionDefaults,'?mode=official&unit=medical-area').regionUnit,'municipality');
console.log('PASS: medical-area URL roundtrip, invalid units and official reset');

