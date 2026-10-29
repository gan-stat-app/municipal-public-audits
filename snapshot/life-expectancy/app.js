'use strict';
const $=id=>document.getElementById(id);
const sexEl=$('sex'),prefEl=$('pref'),yearEl=$('year'),scopeEl=$('scope'),areaEl=$('area'),measureEl=$('measure');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=Number.isFinite;
let family='life',data={},geo=null,municipalGeo=null,mapPending=false,mapFailed=false,limit=100;
const params=new URLSearchParams(location.search);
const sexLabel=()=>sexEl.selectedOptions[0]?.textContent||'';
const municipal=()=>family==='life'&&scopeEl.value==='municipality';
const city=()=>family==='health'&&scopeEl.value==='city';
const dataset=()=>municipal()?data.municipal:family==='life'?data.jmd:data[family];
const selected=()=>municipal()||city()?areaEl.value:prefEl.value;
const metadata=code=>dataset().areas?.[code]||data.health.areas[code];
const areaName=code=>metadata(code)?.name||code;
const field=()=>measureEl.value||'value';
const precision=()=>dataset().precision;
const fmt=v=>finite(v)?`${v.toFixed(precision())}年`:'公表値なし';
const ci=t=>t&&finite(t[1])&&finite(t[2])?`${t[1].toFixed(precision())}～${t[2].toFixed(precision())}年`:'—';
const row=(code,year)=>dataset().index.get(`${code}|${year}|${sexEl.value}`);
const tuple=(code,year)=>row(code,year)?.[field()]||[null,null,null];
const value=(code,year)=>tuple(code,year)[0];
const yearLabel=y=>municipal()&&y===2015?'2015年（2020年方式）':`${y}年`;
const measureName=()=>measureEl.selectedOptions[0]?.textContent||'平均寿命';
const yearRows=()=>dataset().rows.filter(r=>r.year===Number(yearEl.value)&&r.sex===sexEl.value&&finite(r[field()]?.[0])&&!metadata(r.area)?.referenceYears?.includes(r.year)&&metadata(r.area)?.scope===(municipal()?'municipality':city()?'city':'prefecture')).sort((a,b)=>b[field()][0]-a[field()][0]||a.area.localeCompare(b.area,'ja'));
async function json(url){const response=await fetch(url);if(!response.ok)throw new Error(`HTTP ${response.status}: ${url}`);const bytes=new Uint8Array(await response.arrayBuffer());if(bytes[0]===31&&bytes[1]===139){const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text())}return JSON.parse(new TextDecoder().decode(bytes))}
function options(el,entries,wanted){el.replaceChildren(...entries.map(([v,label])=>new Option(label,v)));el.value=entries.some(([v])=>String(v)===String(wanted))?wanted:entries[0]?.[0]||'';}
function fillAreas(wanted){
 if(!municipal()&&!city())return;
 const available=new Set(dataset().rows.filter(r=>r.year===Number(yearEl.value)).map(r=>r.area));
 const entries=Object.entries(dataset().areas).filter(([code,a])=>available.has(code)&&(city()?a.scope==='city':a.pref===prefEl.value&&a.scope==='municipality')).map(([code,a])=>[code,a.name+(a.referenceYears?.includes(Number(yearEl.value))?'（参考・順位対象外）':'')]);
 options(areaEl,entries,wanted);
}
function syncControls(wanted={}){
 const oldScope=wanted.scope||scopeEl.value;
 options(scopeEl,family==='life'?[['prefecture','全国・都道府県'],['municipality','市区町村']]:family==='health'?[['prefecture','全国・都道府県'],['city','大都市']]:[['prefecture','全国・都道府県']],oldScope);
 const s=wanted.sex||sexEl.value;
 options(sexEl,family==='life'&&!municipal()?[['total','総数'],['male','男性'],['female','女性']]:[['male','男性'],['female','女性']],s);
 const prefs=Object.entries(data.health.areas).filter(([code])=>/^P\d\d$/.test(code)&&(!municipal()||code!=='P00')).map(([code,a])=>[code,a.name]);
 options(prefEl,prefs,wanted.pref||prefEl.value||'P05');
 prefEl.parentElement.hidden=city();
 $('areaControl').hidden=!municipal()&&!city();
 const measures=family==='kdb'?[['value','平均自立期間'],['life','平均余命（同じ資料）'],['gap','要介護２以上の期間（参考）']]:family==='health'&&!city()?[['value','健康寿命'],['gap','日常生活に制限のある期間']]:[['value',family==='health'?'健康寿命':'平均寿命']];
 options(measureEl,measures,wanted.measure||'value');$('measureControl').hidden=measures.length===1;
 options(yearEl,[...dataset().years].sort((a,b)=>b-a).map(y=>[String(y),yearLabel(y)]),wanted.year||yearEl.value);
 fillAreas(wanted.area||areaEl.value);
 $('rankingScopeControl').hidden=!municipal();
 $('search').value='';limit=100;
 for(const b of document.querySelectorAll('[data-family]'))b.setAttribute('aria-pressed',String(b.dataset.family===family));
 render();
}
function context(){return `${measureName()}｜${municipal()?'市区町村':city()?'大都市':'全国・都道府県'}｜${yearLabel(Number(yearEl.value))}｜${sexLabel()}｜選択：${areaName(selected())}`;}
function renderNotes(){
 $('definition').textContent=municipal()?'厚生労働省の市区町村別生命表から、0歳の平均余命を表示します。国・県との比較にも同じ資料の参考値を使います。':family==='life'?'日本版死亡データベース005_002版が公表する0歳平均余命です。その年に死亡した人の平均年齢ではありません。':family==='health'?'健康上の問題で日常生活に制限がない期間の平均です。国民生活基礎調査などに基づく健康寿命研究班の公表値を表示します。':'要介護２以上を不健康な状態と定義した、0歳からの平均自立期間です。国保中央会の公表値で、生活の制限に基づく健康寿命とは異なります。';
 let note=municipal()?'各年の公表地域による値で、現在の市区町村境界には統一していません。2015年は厚労省の2020年方式による再計算値です。2020年値は2019～2021年の死亡状況を表します。':family==='health'?'2016年は熊本地震により熊本県・熊本市が調査対象外です。95％信頼区間は推定の不確実性を示し、順位差は有意差を意味しません。':family==='kdb'?'資料の対象年を表示しています（公開年ではありません）。外国人を含む住民基本台帳人口を使用し、KDBへの介護情報の連携状況により対象外の保険者が生じる場合があります。':'全国・都道府県の単年値です。地域によって収録開始年が異なります。';
 if(field()==='gap')note+=' この期間の短縮だけで健康状態の改善とは判断できません。平均寿命や健康寿命の変化も併せて確認してください。';
 $('methodNote').textContent=note;
 $('condition').textContent=context();$('mapCondition').textContent=context();$('rankingCondition').textContent=context();
 $('sourceNote').textContent=municipal()?'出典：厚生労働省「市区町村別生命表」2000・2005・2010・2015・2020年。2015年は「令和２年と同様の方法で算出」の参考表を使用。2000年は訂正後の掲載原表を使用。2020年の対象外９町村は欠測。2000～2010年と2015・2020年では95歳以上の算定方法が異なります。市町村合併・区再編前後を同一境界へ再計算していません。公表桁は小数１桁で、丸め前の公式順位と異なることがあります。':family==='life'?'出典：国立社会保障・人口問題研究所「日本版死亡データベース」005_002版、平均寿命（period, 1×1）。公表された0歳平均余命を使用。全国1947～2024年、都道府県は地域により収録開始年が異なります。':family==='health'?'出典：厚生労働科学研究 健康寿命のページ、令和６年度分担研究報告書付表1-1～1-4・5-1～5-2（2010・2013・2016・2019・2022年）。日常生活に制限のある期間とその信頼区間も同じ資料の公表値です。大都市は2010年20地域、2013年以降21地域が対象（2016年の熊本市は欠測）。一般市町村に都道府県の健康割合を当てはめて算定していません。':'出典：国民健康保険中央会「平均自立期間・平均余命 都道府県別一覧」2017～2024年統計情報分。40歳未満は全員健康と仮定し、40歳以上の要介護２以上を不健康とするKDB仕様。平均余命も同じKDB資料の0歳平均余命。差は小数１桁の公表値の差による参考値で、差の信頼区間は算定していません。';
}
function renderSummary(){
 const year=Number(yearEl.value),code=selected(),t=tuple(code,year),n=tuple('P00',year),ranked=yearRows();
 $('selectedLabel').textContent=`${areaName(code)}・${year}年・${sexLabel()}`;$('nationalLabel').textContent=`${year}年・${sexLabel()}${municipal()?'・同じ生命表の参考値':''}`;
 $('selectedValue').textContent=fmt(t[0]);$('nationalValue').textContent=fmt(n[0]);$('selectedCI').textContent=ci(t)==='—'?'':`95％信頼区間 ${ci(t)}`;$('nationalCI').textContent=ci(n)==='—'?'':`95％信頼区間 ${ci(n)}`;
 $('differenceValue').textContent=finite(t[0])&&finite(n[0])?`${t[0]-n[0]>=0?'+':''}${(t[0]-n[0]).toFixed(precision())}年`:'—';
 const eligible=ranked.some(r=>r.area===code);$('rankValue').textContent=eligible?`${ranked.filter(r=>r[field()][0]>t[0]).length+1}位`:'—';$('rankDenominator').textContent=`${ranked.length}${municipal()?'市区町村':city()?'大都市':'都道府県'}中（同値は同順位）`;
 const present=dataset().years.filter(y=>finite(value(code,y)));$('availability').textContent=present.length?`収録：${present[0]}～${present.at(-1)}年`:'この条件の公表値なし';
 $('pairedSection').hidden=!['health','kdb'].includes(family)||city();
 const r=row(code,year);
 const measures=family==='kdb'?[['平均自立期間','value'],['平均余命','life'],['要介護２以上の期間（参考）','gap']]:[['健康寿命','value'],['日常生活に制限のある期間','gap']];
 $('pairedValues').innerHTML=measures.map(([label,key])=>`<article><span>${esc(label)}</span><strong>${fmt(r?.[key]?.[0])}</strong><small>${ci(r?.[key])==='—'?'':`95％信頼区間 ${ci(r?.[key])}`}</small></article>`).join('');
 $('pairedNote').textContent=family==='kdb'?'選択地域・同年・同じ資料の値です。要介護２以上の期間は、丸められた平均余命から平均自立期間を引いた参考値です。差の信頼区間は公表されていません。':'選択地域・同年の研究班公表値です。制限のある期間も公表値を使い、JMDの平均寿命からの差し引きは行っていません。';
}
function segments(points,x,y){let parts=[],p=[];for(const [yr,v] of points){if(!finite(v)){if(p.length)parts.push(p);p=[];}else p.push(`${x(yr)},${y(v)}`)}if(p.length)parts.push(p);return parts;}
function drawTrend(){
 const years=dataset().years,code=selected();$('prefLegend').textContent=areaName(code);$('trendTitle').textContent=municipal()?'公表年ごとの値（当時の地域）':'選択地域と全国の経年推移';
 $('trendNote').textContent=municipal()?'同じ名称でも合併等により範囲が異なる場合があります。境界を統一した連続推移ではないため、点を線で結びません。2015年は2020年方式の参考値、2000～2010年は各年の公表方式です。':family==='life'?'地域によって収録開始年が異なります。欠測は0として補完せず、線を途切れさせます。':'縦線は選択地域の95％信頼区間です（公表されている場合）。調査年・公表年の値のみを示し、欠測を補完しません。';
 const local=years.map(y=>[y,value(code,y)]),national=years.map(y=>[y,value('P00',y)]),values=[...local,...national].map(r=>r[1]).filter(finite);
 for(const year of years){const t=tuple(code,year);if(finite(t[1]))values.push(t[1],t[2]);}
 $('trendTable').innerHTML=[...years].reverse().map(y=>`<tr><td>${yearLabel(y)}</td><td>${fmt(value(code,y))}</td><td>${ci(tuple(code,y))}</td><td>${fmt(value('P00',y))}</td></tr>`).join('');
 const svg=$('trend');svg.setAttribute('aria-label',`${measureName()}：${areaName(code)}と全国の年別値。詳細は年別の表で確認できます。`);
 if(!values.length){svg.innerHTML='';return;}
 const first=years[0],last=years.at(-1),min=Math.floor(Math.min(...values)-.5),max=Math.ceil(Math.max(...values)+.5),x=v=>65+(v-first)/(last-first||1)*795,y=v=>295-(v-min)/(max-min||1)*270;
 const step=Math.max(.5,Math.ceil((max-min)/6));let html='';
 for(let v=min;v<=max;v+=step)html+=`<line x1="65" x2="860" y1="${y(v)}" y2="${y(v)}" stroke="#dce5eb"/><text x="55" y="${y(v)+5}" text-anchor="end" font-size="14">${v}</text>`;
 const ticks=years.length>12?years.filter(yr=>yr%10===0):years;
 for(const yr of ticks)html+=`<text x="${x(yr)}" y="326" text-anchor="middle" font-size="14">${yr}</text>`;
 for(const [series,color,dash] of [[national,'#66788a','7 5'],[local,'#23668a','']]){
  if(!municipal())for(const p of segments(series,x,y))html+=`<polyline points="${p.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}"/>`;
  for(const [yr,v] of series){if(!finite(v))continue;const isLocal=series===local,t=tuple(code,yr);if(isLocal&&finite(t[1]))html+=`<path d="M${x(yr)},${y(t[1])}V${y(t[2])}M${x(yr)-4},${y(t[1])}H${x(yr)+4}M${x(yr)-4},${y(t[2])}H${x(yr)+4}" stroke="${color}" fill="none"/>`;if(years.length<=12||yr===Number(yearEl.value))html+=`<circle cx="${x(yr)}" cy="${y(v)}" r="4" fill="${color}"><title>${yr}年 ${isLocal?esc(areaName(code)):'全国'} ${fmt(v)}</title></circle>`;}
 }
 svg.innerHTML=html;
}
const thresholds=[-2,-1,-.5,.5,1,2],palette=['#a83f46','#d97c63','#efc0ad','#ece7db','#a8c8d8','#4f8fb3','#155b83'];
const labels=['全国より2年以上短い','全国より1～2年短い','全国より0.5～1年短い','全国差 −0.5～＋0.5年','全国より0.5～1年長い','全国より1～2年長い','全国より2年以上長い'];
function color(v){let i=0;while(i<thresholds.length&&v>=thresholds[i])i++;return palette[i];}
function rings(f){return f.geometry?.type==='Polygon'?f.geometry.coordinates:f.geometry?.type==='MultiPolygon'?f.geometry.coordinates.flat():[];}
function drawMap(){
 const svg=$('map'),year=Number(yearEl.value);$('mapTip').textContent='';
 if(city()||(municipal()&&year!==2020)){
  svg.innerHTML='';svg.toggleAttribute('hidden',true);$('mapLegend').innerHTML='';$('mapTitle').textContent=city()?'大都市の比較':'当時の市区町村境界';
  $('mapNote').textContent=city()?'大都市は下の一覧と経年推移で比較できます。都道府県全体の値に置き換えて地図表示することはありません。':'この年の市区町村境界は未収録です。当時の公表値は一覧と年別の表で確認できます。2020年を選ぶと、現在の名称と照合した参考地図を表示します。';return;
 }
 if(municipal()&&!municipalGeo){
  svg.toggleAttribute('hidden',true);svg.innerHTML='';$('mapLegend').innerHTML='';$('mapTitle').textContent='市区町村の参考地図';$('mapNote').textContent=mapFailed?'地図を読み込めませんでした。数値は一覧で確認できます。':'市区町村の地図を読み込んでいます…';
  if(!mapPending&&!mapFailed){mapPending=true;json('/data/municipality-map-light.geojson').then(g=>{municipalGeo=g;mapPending=false;if(municipal())drawMap();}).catch(()=>{mapPending=false;mapFailed=true;if(municipal())drawMap();});}return;
 }
 let features,selectionMap=new Map();
 if(municipal()){
  const lookup=new Map();for(const [code,a] of Object.entries(data.municipal.areas)){if(a.pref!==prefEl.value)continue;const name=a.name.replace(/^.*?郡/,'');if(lookup.has(name))lookup.set(name,null);else lookup.set(name,code);}
  features=municipalGeo.features.filter(f=>`P${String(f.properties.area_code).slice(0,2)}`===prefEl.value);
  for(const f of features){const code=lookup.get(f.properties.area_name);if(code&&row(code,year))selectionMap.set(f,code);}
  $('mapTitle').textContent=`${areaName(prefEl.value)}の市区町村・2020年値（参考地図）`;
  $('mapNote').textContent='2024年境界の参考地図に、名称が一意に一致する地域の2020年公表値を表示します。当時の境界図ではありません。区再編・名称不一致などは灰色で示し、値を他地域へ配分しません。赤は全国より短く、青は長いことを表し、有意差や優劣は示しません。';
 }else{
  features=geo.features;for(const f of features){const p=f.properties,raw=String(p.area_code??p.code??p.N03_007??'').match(/\d+/)?.[0];const code=raw?`P${raw.padStart(2,'0').slice(0,2)}`:Object.keys(data.health.areas).find(c=>data.health.areas[c].name===(p.pref_name||p.N03_001));selectionMap.set(f,code);}
  $('mapTitle').textContent='全国地図（都道府県）';$('mapNote').textContent='同じ年・性別・指標の全国値との差です。赤は全国より短く、青は長いことを示し、有意差や地域の優劣は表しません。地域を押すと選択が切り替わります。';
 }
 let bounds=[122,20,154,46];if(municipal()){const pts=features.flatMap(f=>rings(f).flat());if(!pts.length)return;bounds=[Math.min(...pts.map(p=>p[0])),Math.min(...pts.map(p=>p[1])),Math.max(...pts.map(p=>p[0])),Math.max(...pts.map(p=>p[1]))];}
 const sx=860/(bounds[2]-bounds[0]||1),sy=570/(bounds[3]-bounds[1]||1),scale=Math.min(sx,sy),project=([lon,lat])=>[20+(860-(bounds[2]-bounds[0])*scale)/2+(lon-bounds[0])*scale,20+(570-(bounds[3]-bounds[1])*scale)/2+(bounds[3]-lat)*scale];
 const path=f=>rings(f).map(r=>r.length?`M${r.map(project).map(p=>p.map(n=>n.toFixed(1)).join(',')).join('L')}Z`:'').join('');
 const national=value('P00',year);let html='';
 for(const f of features){const code=selectionMap.get(f),v=code?value(code,year):null,diff=finite(v)&&finite(national)?v-national:null,name=code?areaName(code):f.properties.area_name||'地域',desc=`${name}：${fmt(v)}${finite(diff)?`、全国差 ${diff>=0?'+':''}${diff.toFixed(precision())}年`:''}`;html+=`<path class="map-region ${code===selected()?'map-selected':''}" ${code?`data-code="${esc(code)}" tabindex="0" role="button"`:''} aria-label="${esc(desc)}" d="${path(f)}" fill="${finite(diff)?color(diff):'#d7dde3'}" fill-rule="evenodd" stroke="#fff" stroke-width="1.1"><title>${esc(desc)}</title></path>`;}
 svg.toggleAttribute('hidden',false);svg.setAttribute('aria-label',$('mapTitle').textContent+' '+measureName());svg.innerHTML=html;
 for(const el of svg.querySelectorAll('[data-code]')){const select=()=>{(municipal()?areaEl:prefEl).value=el.dataset.code;render();};el.addEventListener('click',select);el.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();select();}});el.addEventListener('pointerenter',()=>$('mapTip').textContent=el.getAttribute('aria-label'));el.addEventListener('focus',()=>$('mapTip').textContent=el.getAttribute('aria-label'));}
 $('mapLegend').innerHTML=labels.map((label,i)=>`<span class="legend-item"><span class="swatch legend-color-${i}"></span>${label}</span>`).join('')+'<span class="legend-item"><span class="swatch legend-missing"></span>公表値なし・未対応</span>';
}
function drawRanking(){
 const ranked=yearRows(),q=$('search').value.trim(),scope=municipal()&&$('rankingScope').value!=='all';
 const filtered=ranked.filter(r=>(!scope||metadata(r.area).pref===prefEl.value)&&(!q||`${areaName(r.area)} ${areaName(metadata(r.area).pref)}`.includes(q)));
 $('rankingTitle').textContent=municipal()?`${scope?areaName(prefEl.value)+'内':'全国'}の市区町村比較`:city()?'大都市の比較':'都道府県の比較';
 $('status').className='';$('status').textContent=`${yearLabel(Number(yearEl.value))}・${sexLabel()}・${filtered.length}地域${filtered.length>limit?`中1～${limit}地域を表示`:''}（順位は${municipal()?'全国の市区町村':city()?'対象大都市':'全国の都道府県'}内）`;
 const ranks=new Map();ranked.forEach((r,i)=>{if(!ranks.has(r[field()][0]))ranks.set(r[field()][0],i+1);});
 $('ranking').innerHTML=filtered.slice(0,limit).map(r=>`<button type="button" class="rank-row ${r.area===selected()?'rank-selected':''}" data-area="${esc(r.area)}"><span>${ranks.get(r[field()][0])}. ${esc(areaName(r.area))}${municipal()&&!scope?`<small>${esc(areaName(metadata(r.area).pref))}</small>`:''}</span><span class="rank-ci">${ci(r[field()])==='—'?'':`95％信頼区間 ${ci(r[field()])}`}</span><strong>${fmt(r[field()][0])}</strong></button>`).join('')||'<p>この条件の公表値はありません。</p>';
 $('more').hidden=filtered.length<=limit;
 for(const b of $('ranking').querySelectorAll('[data-area]'))b.addEventListener('click',()=>{const code=b.dataset.area;if(municipal()){prefEl.value=metadata(code).pref;fillAreas(code);}else if(city())areaEl.value=code;else prefEl.value=code;render();});
}
function render(){renderNotes();renderSummary();drawTrend();drawMap();drawRanking();const p=new URLSearchParams({indicator:family,scope:scopeEl.value,sex:sexEl.value,pref:prefEl.value,year:yearEl.value,measure:field()});if(municipal()||city())p.set('area',areaEl.value);history.replaceState(null,'',`${location.pathname}?${p}`);}
async function init(){try{
 const [jmd,health,kdb,muni,map]=await Promise.all([json('/data/jmd/life_expectancy.json.gz'),json('/life-expectancy/data/health.json.gz?v=20260906'),json('/life-expectancy/data/kdb.json.gz?v=20260906'),json('/life-expectancy/data/municipal.json.gz?v=20260906'),json('/data/maps/prefectures-light.geojson')]);
 data={health,kdb,municipal:muni,jmd:{areas:Object.fromEntries(Object.entries(health.areas).filter(([c])=>c.startsWith('P'))),precision:2,years:[...new Set(jmd.rows.map(r=>r[1]))].sort((a,b)=>a-b),rows:jmd.rows.flatMap(r=>[['female',2],['male',3],['total',4]].map(([sex,i])=>({area:r[0],year:r[1],sex,value:[r[i],null,null]})))}};geo=map;
 for(const d of Object.values(data))d.index=new Map(d.rows.map(r=>[`${r.area}|${r.year}|${r.sex}`,r]));
 family=['life','health','kdb'].includes(params.get('indicator'))?params.get('indicator'):'life';
 syncControls({scope:params.get('scope'),sex:params.get('sex')||'total',pref:params.get('pref')||'P05',year:params.get('year'),area:params.get('area'),measure:params.get('measure')});
 for(const b of document.querySelectorAll('[data-family]'))b.addEventListener('click',()=>{family=b.dataset.family;syncControls({scope:'prefecture'});});
 scopeEl.addEventListener('change',()=>syncControls());
 sexEl.addEventListener('change',render);prefEl.addEventListener('change',()=>{fillAreas();render();});areaEl.addEventListener('change',render);yearEl.addEventListener('change',()=>{fillAreas(areaEl.value);limit=100;render();});measureEl.addEventListener('change',()=>{limit=100;render();});$('search').addEventListener('input',()=>{limit=100;drawRanking();});$('rankingScope').addEventListener('change',()=>{limit=100;drawRanking();});$('more').addEventListener('click',()=>{limit+=100;drawRanking();});
 }catch(error){console.error(error);$('status').className='error';$('status').textContent='データを読み込めませんでした。再読み込みしてください。';$('definition').textContent='公表データを読み込めませんでした。';}}
init();
