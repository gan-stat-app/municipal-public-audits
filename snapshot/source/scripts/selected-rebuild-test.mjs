import assert from 'node:assert/strict';
import {aggregatePeriod} from '../src/lib/smr.js';
import {buildMunicipalityRanking} from '../src/lib/ranking.js';
import {rowsForArea,aggregateDesignatedCity} from '../src/lib/areaAggregation.js';
const rows=[[2023,'05201','M',2,4],[2024,'05201','M',null,5],[2023,'05202','M',1,2],[2024,'05202','M',1,2]];
assert.equal(aggregatePeriod(rows.filter(r=>r[1]==='05201'),'男',2023,2024),null);
const ranking=buildMunicipalityRanking({rows},{sex:'男',startYear:2023,endYear:2024});
assert.deepEqual(ranking.items.map(r=>r.areaCode),['05202']);
assert.equal(aggregatePeriod(rowsForArea({rows},'05000'),'男',2023,2024),null);
assert.equal(aggregatePeriod([[2024,'05201','M',1,2]],'男女計',2024,2024),null);
assert.throws(()=>aggregatePeriod([[2024,'05201','M',1,2],[2024,'05201','M',1,2]],'男',2024,2024),/Duplicate/);
const city={strict_missing:true,rows:[[2024,'22130','M',20,10],[2024,'22138','M',null,null],[2024,'22139','M',null,null],[2024,'22140','M',null,null]]};
assert.equal(aggregateDesignatedCity(city,'22130','男',2024,2024).observed,20);
assert.equal(buildMunicipalityRanking(city,{sex:'男',startYear:2024,endYear:2024}).total,0);
console.log('PASS: missing years, missing sexes, duplicate rows and unallocatable wards cannot become partial SMRs');

const {arbitraryCauses,causeAvailability}=await import('../src/catalogs/causes.js');
const {causeDataPath}=await import('../src/lib/dataClient.js');
for(const [datasetCode] of arbitraryCauses)for(const basis of ['juki','census']){const q={mode:'arbitrary',dataRevision:'rebuilt',basis,datasetCode,sex:datasetCode==='Se12'?'女':'男',startYear:1999,endYear:2024};assert.equal(causeAvailability(q),'');assert.equal(causeDataPath(q),`/data/selected-cause-rebuild-v1/${basis}-${datasetCode}-2024-boundary.json.gz`);}

const {applyMethodAcceptance}=await import('../src/lib/dataClient.js');
const policy={version:'test',decision:'accepted',source_version:'test',basis:'census',years:[2001,2009]};
const archived={basis:'census',source_version:'test',reference_years:[2001,2009],rows:[[2005,'11100','M',4109,4482,10,10,'REBUILT_REFERENCE'],[2005,'13381','M',null,null,1,0,'NONCALCULABLE_COMPONENT']]};
const revised=applyMethodAcceptance(archived,policy);assert.equal(revised.rows[0][7],'SOURCE_VERIFIED');assert.equal(revised.rows[1][3],null);assert.equal(archived.rows[0][7],'REBUILT_REFERENCE');assert.deepEqual(revised.reference_years,[]);assert.throws(()=>applyMethodAcceptance(archived,{...policy,source_version:'other'}));
