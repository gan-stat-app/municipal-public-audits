import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..','..');
const html=readFileSync(join(root,'facility-standards','index.html'),'utf8');
const app=readFileSync(join(root,'facility-standards','app.js'),'utf8');

assert.match(html,/id="dataset" hidden/);
assert.doesNotMatch(html,/<label>収録範囲/);
assert.doesNotMatch(html,/正規化待ち/);
assert.match(html,/全8管轄・全項目を検索可能/);
assert.ok(html.indexOf('<label>都道府県')<html.indexOf('<label>市区町村'));
assert.match(html,/id="facility-query"/);
assert.match(html,/id="notification-query"/);
assert.match(html,/id="notification-suggestions"[^>]*role="listbox"/);
assert.equal((html.match(/data-theme=/g)||[]).length,6);
assert.match(html,/app\.js\?v=24/);
assert.match(html,/style\.css\?v=9/);
const css=readFileSync(join(root,'facility-standards','style.css'),'utf8');
assert.match(css,/\.suggestion-summary\{position:sticky/);
assert.match(css,/\.suggestion-more\{position:sticky/);
assert.match(html,/id="clear-notification-theme"/);
assert.match(html,/さらに表示.*全候補/);
assert.match(html,/医科・歯科・薬局の区分別に数えた掲載施設数/);
assert.match(app,/function bureauForPref\(code\)/);
assert.match(app,/pref\.addEventListener\('change',selectPrefecture\)/);
assert.match(app,/dataset\.value=code==='all'\?'national':bureauForPref\(code\)/);
assert.match(app,/facilityTerms=searchTerms\(facilityQuery\.value\)/);
assert.match(app,/notificationTerms=searchTerms\(notificationQuery\.value\)/);
assert.match(app,/includesAllTerms\(\[r\.institution_name,r\.address,r\.institution_number\],facilityTerms\)/);
assert.match(app,/rowMatchesNotification\(r,notificationTerms\)/);
assert.match(app,/initialParams\.get\('facility'\)\|\|initialParams\.get\('query'\)/);
assert.match(app,/initialParams\.get\('notification'\)/);
assert.match(app,/const pageSize=100/);
assert.match(app,/selectedInstitutionNumber.*r\.institution_number!==selectedInstitutionNumber/s);
assert.match(app,/function groupFacilities\(records\).*facilityIdentity\(row\)/s);
assert.match(app,/function ensureNotificationCatalog\(\)/);
assert.match(app,/function loadNationalNotificationMatches\(value\)/);
assert.match(app,/notification-postings-/);
assert.match(app,/nationalNotificationMatches\.has\(rowIndex\)/);
assert.match(app,/data-show-all/);
assert.match(app,/const notificationThemes=/);
assert.match(app,/async function updateNotificationSuggestions\(value,themeName=activeNotificationTheme\)/);
assert.match(app,/data-name-id=/);
assert.match(app,/aria-pressed/);
assert.match(app,/selectedNotificationNameId/);
assert.match(app,/function notificationStableKey\(item\)/);
assert.match(app,/function decodeNotificationStableKey\(value\)/);
assert.match(app,/function resolveInitialNotificationSelection\(data\)/);
assert.match(app,/initialParams\.get\('notificationId'\)/);
assert.match(app,/searchParams\.set\('notificationKey'/);
assert.doesNotMatch(app,/searchParams\.set\('notificationId'/);
assert.match(app,/if\(matches\.length===1\)selectNotificationNameId/);
assert.match(app,/function rowMatchesNotification\(row,terms\)/);
assert.match(app,/normalizeSearch\(row\.accepted_name\)===normalizeSearch\(item\[0\]\)/);
assert.match(app,/normalizeSearch\(row\.acceptance_symbol\)===normalizeSearch\(item\[1\]\)/);
assert.match(app,/clearSelectedNotification\(\);setActiveTheme/);
assert.match(app,/event\.key==='ArrowDown'/);
assert.match(app,/event\.key==='ArrowUp'/);
assert.match(app,/全国.*施設・区分/);
assert.match(app,/notificationSuggestionLimit=12/);
assert.match(app,/items\.slice\(0,notificationSuggestionLimit\)/);
assert.match(app,/data-show-more-suggestions/);
assert.match(app,/notificationSuggestions\.addEventListener\('click',async event=>\{event\.stopPropagation\(\)/);
assert.match(app,/notificationSuggestionLimit\+=12/);
assert.match(app,/候補中 1～/);
assert.match(app,/clearThemeButton\.addEventListener/);
assert.match(app,/updateNotificationSuggestions\(notificationQuery\.value,activeNotificationTheme\)/);

const sourceRegistry=JSON.parse(readFileSync(join(root,'data','facility-standards','source-registry.json'),'utf8'));
assert.equal(sourceRegistry.bureaus.length,8);
assert.ok(sourceRegistry.bureaus.every(bureau=>bureau.normalized==='all-current'));
const bureaus=['hokkaido','tohoku','kanto-shinetsu','tokai-hokuriku','kinki','chugoku','shikoku','kyushu'];
const prefectureBureaus=new Map();
for(const bureau of bureaus){
  const index=JSON.parse(readFileSync(join(root,'data','facility-standards','normalized',bureau,'index.json'),'utf8'));
  for(const part of index.partitions){
    const previous=prefectureBureaus.get(part.prefectureCode);
    assert.ok(!previous||previous===bureau,`都道府県コード ${part.prefectureCode} が複数管轄にあります`);
    prefectureBureaus.set(part.prefectureCode,bureau);
  }
}
assert.equal(prefectureBureaus.size,47);
assert.equal(prefectureBureaus.get('05'),'tohoku');
assert.equal(prefectureBureaus.get('13'),'kanto-shinetsu');
assert.equal(prefectureBureaus.get('47'),'kyushu');

const tohoku=JSON.parse(readFileSync(join(root,'data','facility-standards','normalized','tohoku','index.json'),'utf8'));
const akitaPart=tohoku.partitions.find(x=>x.prefectureCode==='05'&&x.category==='医科');
assert.ok(akitaPart);
const akita=JSON.parse(gunzipSync(readFileSync(join(root,'data','facility-standards','normalized','tohoku',akitaPart.path))));
const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const terms=value=>String(value??'').normalize('NFKC').toLowerCase().replaceAll('、',' ').replaceAll(',',' ').split(' ').filter(Boolean);
const includesAll=(values,words)=>{const haystack=normalize(values.join(' '));return words.every(word=>haystack.includes(normalize(word)))};
const hits=akita.records.filter(row=>
  normalize(row.address).startsWith('秋田市')&&
  includesAll([row.institution_name,row.address,row.institution_number],terms('土崎 病院'))&&
  includesAll([row.accepted_name,row.acceptance_symbol,row.acceptance_number],terms('地域包括 ケア'))
);
assert.equal(new Set(hits.map(row=>row.institution_number)).size,1);
assert.ok(hits.length>=1);

const facilityMeta=JSON.parse(readFileSync(join(root,'data','facility-standards','facility-index-meta.json'),'utf8'));
const notificationRoot=join(root,'data','facility-standards','notification-index');
const notificationMeta=JSON.parse(readFileSync(join(notificationRoot,'notification-index-meta.json'),'utf8'));
const notificationCatalog=JSON.parse(gunzipSync(readFileSync(join(notificationRoot,'notification-catalog.json.gz'))));
assert.equal(notificationMeta.schemaVersion,1);
assert.equal(notificationCatalog.schemaVersion,1);
assert.equal(notificationMeta.facilityCount,facilityMeta.recordCount);
assert.equal(notificationCatalog.items.length,notificationMeta.recordCount);
assert.ok(notificationMeta.maxShardCompressedBytes<750000);
const notificationNameGroups=new Map();
notificationCatalog.items.forEach((item,index)=>{
  if(!notificationNameGroups.has(item[0]))notificationNameGroups.set(item[0],[]);
  notificationNameGroups.get(item[0]).push({index,symbol:item[1],count:item[3],shard:item[2]});
});
const duplicateNameGroups=[...notificationNameGroups.values()].filter(items=>items.length>1);
assert.ok(duplicateNameGroups.length>0);
assert.ok(duplicateNameGroups.some(items=>new Set(items.map(item=>item.symbol)).size>1));
const stableKey=item=>[item[0]||'',item[1]||''].map(encodeURIComponent).join('|');
const decodeStableKey=value=>value.split('|').map(decodeURIComponent);
const stableSample=notificationCatalog.items.find(item=>item[0]&&item[1]);
const stableSampleKey=stableKey(stableSample);
const stablePair=decodeStableKey(stableSampleKey);
const reorderedCatalog=[...notificationCatalog.items].reverse();
const restoredAfterReorder=reorderedCatalog.find(item=>item[0]===stablePair[0]&&item[1]===stablePair[1]);
assert.deepEqual(restoredAfterReorder.slice(0,2),stableSample.slice(0,2));
const themeDefinitions={
  emergency:['救急'],
  intensive:['特定集中治療室','ハイケアユニット','救命救急入院料'],
  'community-care':['地域包括ケア'],
  rehabilitation:['回復期リハビリテーション'],
  psychiatry:['精神'],
  'home-care':['在宅']
};
const themeCandidateCounts={};
for(const [theme,keywords] of Object.entries(themeDefinitions)){
  const candidates=notificationCatalog.items.filter(item=>keywords.some(keyword=>normalize(item[0]).includes(normalize(keyword))));
  assert.ok(candidates.length>0,`テーマ ${theme} に正式な届出名候補がありません`);
  themeCandidateCounts[theme]=candidates.length;
}
assert.equal(themeCandidateCounts['community-care'],4);
assert.equal(themeCandidateCounts.rehabilitation,5);
for(const count of Object.values(themeCandidateCounts)){
  let reachable=12;
  while(reachable<count)reachable+=12;
  assert.ok(reachable>=count);
}
assert.ok(themeCandidateCounts['home-care']>12);
assert.ok(themeCandidateCounts.psychiatry>12);
const regionalNameIds=new Set();
const regionalShards=new Set();
notificationCatalog.items.forEach((item,index)=>{
  if(includesAll([item[0],item[1]],terms('地域包括 ケア 病棟 入院料２'))){
    regionalNameIds.add(index);
    regionalShards.add(item[2]);
  }
});
assert.ok(regionalNameIds.size>0);
const nationwideFacilities=new Set();
for(const shard of regionalShards){
  const name=String(shard).padStart(3,'0');
  const payload=JSON.parse(gunzipSync(readFileSync(join(notificationRoot,`notification-postings-${name}.json.gz`))));
  for(const [nameId,facilityIds] of payload.postings){
    if(!regionalNameIds.has(nameId))continue;
    for(const facilityId of facilityIds){
      assert.ok(facilityId>=0&&facilityId<notificationMeta.facilityCount);
      nationwideFacilities.add(facilityId);
    }
  }
}
assert.ok(nationwideFacilities.size>0);

console.log(JSON.stringify({
  prefectures:prefectureBureaus.size,
  akitaFacilityMatches:new Set(hits.map(row=>row.institution_number)).size,
  akitaNotificationMatches:hits.length,
  pageSize:100,
  notificationNames:notificationMeta.recordCount,
  duplicateNotificationNames:duplicateNameGroups.length,
  themeCandidateCounts,
  nationwideRegionalCareFacilities:nationwideFacilities.size
}));
