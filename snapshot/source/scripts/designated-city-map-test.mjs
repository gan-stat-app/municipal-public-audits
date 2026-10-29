import assert from'node:assert/strict';import{designatedCities,designatedCityForWard,designatedCityWardCodes,isSelectedMapArea,displayAreaName}from'../src/catalogs/designatedCities.js';
const fixtures={
'01100':['01101','01102','01103','01104','01105','01106','01107','01108','01109','01110'],
'40100':['40101','40103','40105','40106','40107'],
'40130':['40131','40132','40133','40134','40135','40136','40137'],
'22100':['22101','22102','22103']};
for(const[cityCode,wards]of Object.entries(fixtures)){const city=designatedCities.find(x=>x.code===cityCode);assert(city,cityCode);for(const ward of wards){assert.equal(designatedCityForWard(ward)?.code,cityCode,`${ward} parent`);assert(isSelectedMapArea(cityCode,ward,wards),`${city.name}: ${ward} should highlight`)}assert.equal(designatedCityWardCodes(cityCode,wards).length,wards.length,`${city.name}: ward count`);assert(isSelectedMapArea(cityCode,cityCode,wards));assert(!isSelectedMapArea(cityCode,'99999',wards))}
assert.equal(displayAreaName('01101','中央区'),'札幌市中央区');assert.equal(displayAreaName('01101','札幌市中央区'),'札幌市中央区');assert.equal(displayAreaName('01100','札幌市'),'札幌市');assert(isSelectedMapArea('01101','01101',fixtures['01100']));assert(!isSelectedMapArea('01101','01102',fixtures['01100']));
console.log(JSON.stringify({pass:true,cities:Object.keys(fixtures).length,wardChecks:Object.values(fixtures).flat().length}));
