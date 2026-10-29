import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createContext,runInContext} from 'node:vm';

const root=new URL('../public/school-dental/',import.meta.url);
const app=readFileSync(new URL('app.js',root),'utf8');
const html=readFileSync(new URL('index.html',root),'utf8');
const css=readFileSync(new URL('style.css',root),'utf8');
for(const file of ['app.js','index.html','style.css']){
 assert.equal(readFileSync(new URL(file,root),'utf8'),readFileSync(new URL('../../school-dental/'+file,import.meta.url),'utf8'),'公開・source/publicの不一致: '+file);
}
assert.ok(html.includes('id="trendMissing"')&&html.includes('欠測の前後は線で結びません'),'欠測年度の説明欄がない');
assert.ok(css.includes('#trendChart{overflow-x:auto}')&&css.includes('#trendChart svg{min-width:640px}'),'全年度ラベルを狭い画面で読めない');
const dental=JSON.parse(gunzipSync(readFileSync(new URL('data/school-dental.json.gz',root))));
const body=JSON.parse(gunzipSync(readFileSync(new URL('data/school-body.json.gz',root))));
const bodyRows=body.columns?body.rows.map(values=>Object.fromEntries(body.columns.map((column,i)=>[column,values[i]]))):body.rows;
const key=r=>[r.year,r.age,r.sex,r.prefCode].join('/');
const bodyByKey=new Map(bodyRows.map(r=>[key(r),r]));
const combined=dental.rows.map(r=>({...r,...bodyByKey.get(key(r))}));
const dataBefore=JSON.stringify(combined);
const start=app.lastIndexOf('\ninit().catch(');
assert.ok(start>0,'初期ロードと表示関数を分けて検査できない');
const elements=new Map();
const element=selector=>{
 if(!elements.has(selector)){
  const el={textContent:'',options:[],add(option){this.options.push(option)}};
  let markup='';
  Object.defineProperty(el,'innerHTML',{get(){return markup},set(value){markup=value;this.options=[]}});
  elements.set(selector,el);
 }
 return elements.get(selector);
};
const ctx=createContext({document:{querySelector:element},Option:function(text,value){this.text=text;this.value=value},inputRows:combined});
runInContext(app.slice(0,start),ctx);
let cases=0;
function render(state,rows=combined){
 ctx.inputRows=rows;
 runInContext('DATA=inputRows;Object.assign(S,'+JSON.stringify({year:2025,age:12,sex:'total',pref:'05',metric:'vision_below_1',theme:'vision',...state})+');renderCharts()',ctx);
 cases++;
 return {svg:element('#trendChart').innerHTML,note:element('#trendMissing').textContent,title:element('#trendTitle').textContent};
}
function ticks(svg){
 return new Map([...svg.matchAll(/<text x="([^"]+)" y="271" text-anchor="middle">(\d{4})<\/text>/g)].map(m=>[+m[2],+m[1]]));
}
function points(svg,cls){
 return [...svg.matchAll(new RegExp('<circle class="'+cls+'" cx="([^"]+)" cy="([^"]+)" r="4"><title>(\\d{4})年度 ([^<]+)</title></circle>','g'))].map(m=>({year:+m[3],x:+m[1],y:+m[2],title:m[4]}));
}
function commands(svg,cls){
 const path=svg.match(new RegExp('<path class="'+cls+'" d="([^"]*)"/>'));
 assert.ok(path,'折れ線がない: '+cls);
 return [...path[1].matchAll(/([ML])([^ ,]+),([^ ]+)/g)].map(m=>({command:m[1],x:+m[2],y:+m[3]}));
}
function checkSeries(svg,rows,state,prefCode,cls,years){
 const values=years.map(year=>rows.find(r=>r.year===year&&r.age===state.age&&r.sex===state.sex&&r.prefCode===prefCode)?.[state.metric]);
 const valid=values.flatMap((v,i)=>Number.isFinite(v)?[{year:years[i],value:v}]:[]);
 const ps=points(svg,'dot-'+cls),cs=commands(svg,'line-'+cls),xs=ticks(svg);
 assert.deepEqual(ps.map(p=>p.year),valid.map(v=>v.year),'欠測に点がある／公表値の点がない: '+prefCode+'/'+state.metric);
 assert.equal(cs.length,ps.length,'線と点の件数が違う');
 const metric=runInContext('METRICS['+JSON.stringify(state.metric)+']',ctx);
 for(let i=0;i<valid.length;i++){
  assert.equal(ps[i].x,xs.get(valid[i].year),'年度座標がずれた');
  assert.equal(cs[i].x,ps[i].x);
  assert.equal(cs[i].y,ps[i].y);
  assert.equal(cs[i].command,i>0&&valid[i].year===valid[i-1].year+1?'L':'M','欠測期間を線でつないだ: '+prefCode+'/'+valid[i].year);
  assert.ok(ps[i].title.endsWith(valid[i].value.toFixed(metric.digits)+' '+metric.unit),'公表値の表示が変わった');
 }
 assert.ok(!/NaN|Infinity/.test(svg),'非数値の座標がある');
 return ps;
}
const years=Array.from({length:20},(_,i)=>2006+i);
const xsExpected=years.map(y=>48+(y-2006)*576/19);
function checkPublished(state,result){
 assert.deepEqual([...ticks(result.svg).keys()],years,'公表値がない年度が横軸から消えた');
 [...ticks(result.svg).values()].forEach((x,i)=>assert.ok(Math.abs(x-xsExpected[i])<1e-9,'年度間隔が詰まった'));
 checkSeries(result.svg,combined,state,state.pref,'pref',years);
 if(state.pref!=='00')checkSeries(result.svg,combined,state,'00','national',years);
 else assert.equal(points(result.svg,'dot-national').length,0,'全国系列が重複している');
 assert.ok(result.svg.includes('aria-describedby="trendMissing"'),'欠測注記がグラフから参照できない');
}
// PR #489の原表欠測を男女計・男子・女子と視力4項目で固定する。
for(const sex of ['total','male','female'])for(const metric of ['vision_below_1','vision_07_to_1','vision_03_to_07','vision_below_03']){
 const state={year:2025,age:12,sex,pref:'05',metric,theme:'vision'},r=render(state);
 checkPublished(state,r);
 assert.ok(r.note.includes('2025年度')&&r.note.includes('公表値なし'),'秋田県2025年度の欠測理由がない');
 assert.ok(!r.note.includes('調査対象外'),'秋田県の欠測を調査対象外と誤表示');
 assert.ok(!points(r.svg,'dot-pref').some(p=>p.year===2025),'秋田県2025年度に点がある');
 assert.ok(points(r.svg,'dot-national').some(p=>p.year===2025),'県の欠測に巻き込まれて全国値が消えた');
}
// 全15指標・3性別・対象外3県で2011年度の切断と全国の継続を検査する。
const metrics=Object.keys(runInContext('METRICS',ctx));
for(const pref of ['03','04','07'])for(const sex of ['total','male','female'])for(const metric of metrics){
 const state={year:2011,age:12,sex,pref,metric},r=render(state);
 checkPublished(state,r);
 assert.ok(r.note.includes('2011年度（調査対象外）'),'2011年度の対象外注記がない: '+pref+'/'+metric);
 assert.ok(!points(r.svg,'dot-pref').some(p=>p.year===2011),'対象外年度に点がある');
}
for(const sex of ['total','male','female'])for(const metric of ['dmft','vision_below_1','obesity_rate']){
 const state={year:2025,age:12,sex,pref:'00',metric},r=render(state);
 checkPublished(state,r);
 assert.ok(!r.note.includes('秋田県')&&!r.note.includes('調査対象外'),'全国に県の欠測注記が残る');
 assert.equal(r.title,'経年推移：全国');
}
// セレクターにも理由を出す。秋田県は2011年度も調査対象なので通常の欠測とする。
runInContext("DATA=inputRows;Object.assign(S,{theme:'vision',metric:'vision_below_1',year:2011,age:12,sex:'total',pref:'03'});cascade()",ctx);
for(const code of ['03','04','07'])assert.ok(element('#pref').options.find(o=>o.value===code).text.includes('調査対象外'));
runInContext("Object.assign(S,{year:2025,pref:'05'});cascade()",ctx);
assert.equal(element('#pref').options.find(o=>o.value==='05').text,'秋田県（公表値なし）');

// 年度全体の行が欠けても、中間年を残す。0は実測点として保つ。
const row=(year,prefCode,dmft)=>({year,prefCode,age:12,sex:'total',dmft});
const fixture=[row(2010,'05',null),row(2011,'05',0),row(2013,'05',2),row(2015,'05',null),row(2010,'00',1),row(2013,'00',null),row(2015,'00',3)];
const state={year:2015,age:12,sex:'total',pref:'05',metric:'dmft',theme:'dental'},r=render(state,fixture),fixtureYears=[2010,2011,2012,2013,2014,2015];
assert.deepEqual([...ticks(r.svg).keys()],fixtureYears);
const ps=checkSeries(r.svg,fixture,state,'05','pref',fixtureYears);
checkSeries(r.svg,fixture,state,'00','national',fixtureYears);
assert.equal(ps.find(p=>p.year===2011).y,247,'実測0が消えた');
assert.ok(r.note.includes('2014～2015年度（公表値なし）'),'連続する欠測年度の注記がない');
// chart()単体でも不規則な年度の間隔を維持し、飛んだ年度を線でつながない。
runInContext("chart('#trendChart',[1,2,3],[null,null,null],['2010','2012','2015'],'line')",ctx);
const sparse=element('#trendChart').innerHTML;
assert.deepEqual([...ticks(sparse).values()],[48,278.4,624]);
assert.deepEqual(commands(sparse,'line-pref').map(c=>c.command),['M','M','M']);
// 単年、全年度欠測、全国だけ欠測、県だけ欠測も有効なSVGと正しい注記にする。
for(const fixture of [
 [row(2025,'05',null),row(2025,'00',null)],
 [row(2024,'05',null),row(2025,'05',null),row(2024,'00',1),row(2025,'00',2)],
 [row(2024,'05',1),row(2025,'05',2),row(2024,'00',null),row(2025,'00',null)],
]){
 const result=render(state,fixture),ys=[...ticks(result.svg).keys()];
 checkSeries(result.svg,fixture,state,'05','pref',ys);
 checkSeries(result.svg,fixture,state,'00','national',ys);
 assert.ok(result.note.includes('公表値なし'));
}
assert.equal(JSON.stringify(combined),dataBefore,'表示処理で元データを変更した');
console.log(JSON.stringify({ok:true,schoolTrendRenderCases:cases,excludedPrefectureMetricSexCases:3*3*metrics.length,akitaVisionCases:12,years:[2006,2025],gapAndZeroFixtures:true}));
