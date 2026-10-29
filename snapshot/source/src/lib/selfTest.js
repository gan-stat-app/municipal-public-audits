import { causeDataPath } from './dataClient.js';
import { byarObservedInterval, smrWith95CI } from './smr.js';
import { designatedCityByCode, designatedCityForWard, displayAreaName } from '../catalogs/designatedCities.js';
import { arbitraryCauses, officialCauses } from '../catalogs/causes.js';

function assert(condition,message){if(!condition)throw new Error(message)}

export function runSelfTests(){
  assert(arbitraryCauses.length===37,'selected causes plus all-death and composite cause count');
  assert(officialCauses.length===18,'official cause count');
  assert(causeDataPath({basis:'juki',datasetCode:'Se00'})==='/data/juki-Se00-2024-boundary.json.gz','Se00 path');
  assert(causeDataPath({basis:'census',datasetCode:'SeCO'})==='/data/census-SeCO-2024-boundary.json.gz','SeCO path');
  assert(causeDataPath({basis:'juki',datasetCode:'SeIH'})==='/data/juki-SeIH-2024-boundary.json.gz','SeIH path');
  assert(designatedCityByCode('01100')?.name==='札幌市','Sapporo city code');
  assert(designatedCityForWard('01101')?.code==='01100','Sapporo ward mapping');
  assert(displayAreaName('01101','中央区')==='札幌市中央区','ward display name');
  const zero=byarObservedInterval(0); assert(zero[0]===0 && zero[1]>3.68 && zero[1]<3.69,'Byar zero');
  const ci=smrWith95CI(100,100); assert(Math.abs(ci.smr-100)<1e-12 && ci.ci95Low<100 && ci.ci95High>100,'SMR CI');
  return {pass:true,checks:10};
}
