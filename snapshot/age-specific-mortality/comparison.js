/* Age-stratum comparison. National is a fixed reference; missing is never zero. */
(function(root){
'use strict';
const SEXES={M:['M'],F:['F'],B:['M','F']};
function pooled(record,sex,indices,age){
 let deaths=0,population=0;
 for(const s of SEXES[sex]||[]){
  const v=record[s];if(!v)return {status:'missing',reason:'死亡数または人口の収録がありません'};
  for(const j of indices){const d=v.deaths[j]?.[age],p=v.population[j]?.[age];
   if(!Number.isFinite(d)||!Number.isFinite(p))return {status:'missing',reason:'選択期間の死亡数または人口がそろいません'};
   if(d<0||p<0)return {status:'missing',reason:'原数を確認できません'};
   if(p===0&&d>0)return {status:'no_population',reason:'死亡数がある年の人口が0のため比較できません'};deaths+=d;population+=p;
  }
 }
 if(!indices.length)return {status:'missing',reason:'期間を選択してください'};
 if(population<=0)return {status:'no_population',deaths,population,reason:'期間内の人口が0のため計算できません'};
 const lo=deaths===0?0:deaths*Math.pow(Math.max(0,1-1/(9*deaths)-1.96/(3*Math.sqrt(deaths))),3);
 const hi=deaths===0?-Math.log(.025):(deaths+1)*Math.pow(1-1/(9*(deaths+1))+1.96/(3*Math.sqrt(deaths+1)),3);
 return {status:'available',deaths,population,rate:100000*deaths/population,lo:100000*lo/population,hi:100000*hi/population};
}
function compare(record,national,sex,indices,age){
 const local=pooled(record,sex,indices,age),ref=pooled(national,sex,indices,age);
 if(local.status!=='available')return {...local,national:ref.rate??null};
 if(ref.status!=='available'||ref.rate<=0)return {...local,ratio:null,national:ref.rate??null,reason:'全国の率が0または欠測のため比を計算できません'};
 return {...local,national:ref.rate,ratio:local.rate/ref.rate,ratioLo:local.lo/ref.rate,ratioHi:local.hi/ref.rate};
}
const api={pooled,compare};if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
let manifest=null,manifestPromise=null,request=0,current=null;const cache=new Map();const $=id=>document.getElementById(id);
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(n,k=1)=>Number.isFinite(n)?n.toLocaleString('ja-JP',{maximumFractionDigits:k,minimumFractionDigits:k}):'—';
async function init(){
 if(manifest)return manifest;
 if(!manifestPromise)manifestPromise=fetch('data/comparison/index.json').then(r=>{if(!r.ok)throw Error('全国比較の索引を取得できません');return r.json()}).then(d=>{manifest=d;return d}).catch(e=>{manifestPromise=null;throw e});
 return manifestPromise;
}
async function areaData(code){const p=code.endsWith('000')?'prefectures':code.slice(0,2);if(!cache.has(p)){const promise=fetch('data/comparison/'+(p==='prefectures'?manifest.prefectureFile:manifest.files[p]).path).then(r=>{if(!r.ok)throw Error('自治体の比較データを取得できません');return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()}).catch(e=>{cache.delete(p);throw e});cache.set(p,promise)}const d=await cache.get(p);return d.areas.find(a=>a.code===code);}
function controls(){
 if($('ageCompareControls'))return;
 const div=document.createElement('div');div.id='ageCompareControls';div.className='age-compare-controls';div.innerHTML='<label>表示<select id="ageView"><option value="compare">死亡率ピラミッド・全年代比較</option><option value="trend">年次推移（住基人口方式）</option><option value="jmd" id="ageJmdOption">年次推移（従来のJMD方式）</option></select></label><label id="agePeriodWrap">期間<select id="agePeriod"><option value="2020-2024">2020～2024年（5年間）</option><option value="2015-2019">2015～2019年（5年間）</option>'+manifest.years.slice().reverse().map(y=>`<option value="${y}">${y}年</option>`).join('')+'</select></label><div class="age-export"><button id="ageCopyLink" type="button">この条件のURLをコピー</button><button id="ageCsv" type="button">CSVを保存</button><button id="agePng" type="button">画像を保存</button></div>';
 div.insertAdjacentHTML('beforeend','<fieldset id="ageScaleControls" aria-describedby="ageScaleHelp"><legend>横軸の表示範囲</legend><label><input type="radio" name="ageScale" value="full" checked>全体表示</label><label><input type="radio" name="ageScale" value="near">全国付近を拡大</label><p id="ageScaleHelp">拡大時は0～2倍。範囲外の値も数値で確認できます。</p></fieldset>');
 document.querySelector('.controls').after(div);const q=new URLSearchParams(location.search);if(['trend','jmd'].includes(q.get('view')))$('ageView').value=q.get('view');if([...$('agePeriod').options].some(o=>o.value===q.get('period')))$('agePeriod').value=q.get('period');if(q.get('scale')==='near')div.querySelector('input[value="near"]').checked=true;
 div.querySelectorAll('input[name="ageScale"]').forEach(input=>input.addEventListener('change',()=>window.render()));
 for(const id of ['ageView','agePeriod'])$(id).addEventListener('change',()=>window.render());
 $('ageCopyLink').addEventListener('click',async()=>{updateUrl();try{await navigator.clipboard.writeText(location.href);($('ageExportStatus')||$('status')).textContent='選択条件のURLをコピーしました'}catch(e){($('ageExportStatus')||$('status')).textContent='アドレス欄のURLをコピーしてください'}});
 $('ageCsv').addEventListener('click',downloadCsv);$('agePng').addEventListener('click',downloadImage);
}
function selection(){const period=$('agePeriod').value.split('-').map(Number);const start=period[0],end=period[1]||start;return{sex:{'00110':'M','00120':'F','00100':'P'}[$('sex').value],indices:manifest.years.map((y,i)=>y>=start&&y<=end?i:-1).filter(i=>i>=0),period:start===end?String(start):`${start}～${end}`,view:$('ageView').value,scale:document.querySelector('input[name="ageScale"]:checked').value};}
function updateUrl(){const q=new URLSearchParams(location.search);q.set('level',$('level').value);q.set('area',$('area').value);q.set('sex',$('sex').value);q.set('view',$('ageView').value);q.set('period',$('agePeriod').value);q.set('scale',document.querySelector('input[name="ageScale"]:checked').value);history.replaceState(null,'',location.pathname+'?'+q);}
// Scale from point estimates; long intervals must not compress all bars.
function ratioMax(values,scale='full'){return scale==='near'?2:Math.ceil(Math.max(2,...values.filter(Number.isFinite))*2)/2;}
const scaleLabel=scale=>scale==='near'?'全国付近を拡大（0～2倍）':'全体表示';
const clip=(v,max)=>Math.max(0,Math.min(max,v));
function chartDescription(scale){return `${scaleLabel(scale)}。全国＝1、横線は95％信頼区間。塗りつぶした三角と切れ目は棒の全国比が表示範囲外、白抜きの矢印は信頼区間が表示範囲外に続く印です。実際の全国比と区間は下の数値表で確認できます。`;}
function pointMarker(r,max,xx,y,age,sex=''){
 if(!(r.ratio>max))return '';
 const edge=xx(max),d=xx(max)>xx(0)?1:-1;
 return `<g data-point-overflow="true" data-age="${esc(age)}" data-sex="${sex}"><title>全国比 ${fmt(r.ratio,2)}倍（棒は${fmt(max,2)}倍より先が表示範囲外）</title><path d="M${edge-d*27},${y-12}l${d*7},24 M${edge-d*19},${y-12}l${d*7},24" stroke="#fff" stroke-width="3"/><path d="M${edge-d*10},${y-10} L${edge},${y} L${edge-d*10},${y+10} Z" fill="#172f3e"/></g>`;
}
function interval(r,max,xx,y){
 if(!Number.isFinite(r.ratioLo)||!Number.isFinite(r.ratioHi))return '';
 const lo=xx(clip(r.ratioLo,max)),hi=xx(clip(r.ratioHi,max)),entire=r.ratioLo>max;
 const direction=xx(max)>xx(0)?1:-1;
 const end=r.ratioHi>max
  ?`M${hi-direction*7},${y-6} L${hi},${y} L${hi-direction*7},${y+6}`
  :`M${hi},${y-7}v14`;
 return `<g data-ci-overflow="${r.ratioHi>max}" data-ci-outside="${entire?'entire':r.ratioHi>max?'upper':'none'}" fill="none" stroke="#172f3e" stroke-width="2"><title>95％信頼区間：${fmt(r.ratioLo,2)}～${fmt(r.ratioHi,2)}倍${entire?'（区間全体が表示範囲外）':r.ratioHi>max?'（上限は表示範囲外）':''}</title>${entire?'':`<line x1="${lo}" x2="${hi}" y1="${y}" y2="${y}"/>`}<path d="${entire?'':`M${lo},${y-7}v14 `}${end}"/></g>`;
}
function plot(rows,w=1080,scale='full'){
 const max=ratioMax(rows.map(r=>r.ratio),scale);
 const left=w<700?100:120,right=w<700?90:105,top=55,h=rows.length*46+110,plotW=w-left-right;const xx=v=>left+plotW*v/max;
 let s=`<svg id="ageOverviewSvg" data-axis-max="${max}" data-scale="${scale}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="ageOverviewTitle ageOverviewDesc"><title id="ageOverviewTitle">全年齢階級の全国との死亡率比と95％信頼区間</title><desc id="ageOverviewDesc">${chartDescription(scale)}</desc><rect width="${w}" height="${h}" fill="#fff"/><text x="${left}" y="28" font-size="21" fill="#203d4e">全国＝1　横線：95％信頼区間</text>`;
 for(let t=0;t<=4;t++){const v=max*t/4,x=xx(v);s+=`<line x1="${x}" x2="${x}" y1="${top-8}" y2="${h-50}" stroke="#e0e7eb"/><text x="${x}" y="${h-18}" font-size="19" text-anchor="middle" fill="#425c6a">${fmt(v,2)}</text>`;}
 s+=`<line x1="${xx(1)}" x2="${xx(1)}" y1="${top-8}" y2="${h-50}" stroke="#3c596b" stroke-dasharray="6 4"/>`;
 rows.forEach((r,i)=>{const y=top+i*46+15;s+=`<text x="${left-15}" y="${y+7}" font-size="22" text-anchor="end" fill="#203d4e">${esc(r.age.replace('100+','100歳以上'))}</text>`;
  if(!Number.isFinite(r.ratio)){s+=`<text x="${left+15}" y="${y+7}" font-size="19" fill="#526674">${esc(r.reason||'比較値なし')}</text>`;return;}
  const col=r.ratio>1?'#916248':'#267c90';s+=`<rect data-age="${esc(r.age)}" data-ratio="${r.ratio}" x="${left}" y="${y-12}" width="${Math.max(0,xx(clip(r.ratio,max))-left)}" height="24" fill="${col}"><title>全国比 ${fmt(r.ratio,2)}倍${r.ratio>max?'（棒は表示範囲外）':''}</title></rect>${pointMarker(r,max,xx,y,r.age)}${interval(r,max,xx,y+(r.ratio>max?18:0))}<text x="${w-12}" y="${y+7}" font-size="${fmt(r.ratio,2).length>8?18:22}" text-anchor="end" fill="#203d4e">${fmt(r.ratio,2)}倍</text>`;
 });return s+'</svg>';
}
function pyramid(rows,w=1080,scale='full'){
 const max=ratioMax(rows.flatMap(r=>[r.M.ratio,r.F.ratio]),scale);
 const h=rows.length*46+110,top=55,mid=w/2,gap=48,edge=110,span=mid-gap-edge;
 const x=(v,sex)=>mid+(sex==='M'?-1:1)*(gap+span*v/max);
 let s=`<svg id="ageOverviewSvg" data-axis-max="${max}" data-scale="${scale}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="ageOverviewTitle ageOverviewDesc"><title id="ageOverviewTitle">男性を左、女性を右に配置した年齢別全国比。左右同じ尺度、各性の全国を1とする。</title><desc id="ageOverviewDesc">${chartDescription(scale)}</desc><rect width="${w}" height="${h}" fill="#fff"/>`;
 for(const sex of ['M','F']){
  const anchor=sex==='M'?'end':'start';s+=`<text x="${sex==='M'?mid-gap:mid+gap}" y="27" text-anchor="${anchor}" font-size="20" fill="#203d4e">${sex==='M'?'男性（全国男性＝1）':'女性（全国女性＝1）'}</text>`;
  for(let j=0;j<=4;j++){const v=max*j/4,xx=x(v,sex);s+=`<line x1="${xx}" x2="${xx}" y1="47" y2="${h-50}" stroke="#e0e7eb"/><text x="${xx}" y="${h-18}" text-anchor="middle" font-size="17" fill="#425c6a">${fmt(v,2)}</text>`;}
  s+=`<line x1="${x(1,sex)}" x2="${x(1,sex)}" y1="47" y2="${h-50}" stroke="#3c596b" stroke-dasharray="6 4"/>`;
 }
 rows.slice().reverse().forEach((row,i)=>{const y=top+i*46+15;s+=`<text x="${mid}" y="${y+6}" font-size="18" text-anchor="middle" fill="#203d4e">${esc(row.age.replace('100+','100歳以上'))}</text>`;
  for(const sex of ['M','F']){const r=row[sex],outside=sex==='M'?5:w-5,anchor=sex==='M'?'start':'end';
   if(!Number.isFinite(r.ratio)){s+=`<text x="${(x(0,sex)+x(max,sex))/2}" y="${y+6}" text-anchor="middle" font-size="18" fill="#526674">比較値なし</text>`;continue;}
   const col=r.ratio>1?'#916248':'#267c90';s+=`<rect data-sex="${sex}" data-age="${esc(row.age)}" data-ratio="${r.ratio}" x="${Math.min(x(0,sex),x(clip(r.ratio,max),sex))}" y="${y-12}" width="${span*clip(r.ratio,max)/max}" height="24" fill="${col}"><title>${sex==='M'?'男性':'女性'} ${esc(row.age)}：全国比 ${fmt(r.ratio,2)}倍${r.ratio>max?'（棒は表示範囲外）':''}</title></rect>${pointMarker(r,max,v=>x(v,sex),y,row.age,sex)}${interval(r,max,v=>x(v,sex),y+(r.ratio>max?18:0))}<text data-ratio-label="${sex}" x="${outside}" y="${y+6}" font-size="18" text-anchor="${anchor}" fill="#203d4e">${fmt(r.ratio,2)}倍</text>`;
  }
 });return s+'</svg>';
}
function pairedTable(rows){
 const fields=r=>`<td>${fmt(r.rate)}</td><td>${fmt(r.national)}</td><td>${Number.isFinite(r.ratio)?fmt(r.ratio,2)+'倍':'—'}</td><td>${Number.isFinite(r.ratioLo)?fmt(r.ratioLo,2)+'～'+fmt(r.ratioHi,2):'—'}</td><td>${fmt(r.deaths,0)}${r.reason?'<br>'+esc(r.reason):r.deaths<20?'<br>少数死亡':''}</td>`;
 const heads='<th scope="col">地域の率</th><th scope="col">全国の率</th><th scope="col">全国比</th><th scope="col">比の95％区間</th><th scope="col">死亡数</th>';
 return '<div class="age-table-scroll" tabindex="0" role="region" aria-label="男女別の死亡率・全国比・死亡数の表（横にスクロールできます）"><table><caption>男女別の死亡率・全国比・期間内死亡数（中央が年齢）</caption><thead><tr><th colspan="5" scope="colgroup">男性</th><th rowspan="2" scope="col">年齢</th><th colspan="5" scope="colgroup">女性</th></tr><tr>'+heads+heads+'</tr></thead><tbody>'+rows.slice().reverse().map(r=>'<tr>'+fields(r.M)+'<th scope="row">'+esc(r.age.replace('100+','100歳以上'))+'</th>'+fields(r.F)+'</tr>').join('')+'</tbody></table></div>';
}
function dataTable(rows){return '<div class="age-table-scroll" tabindex="0" role="region" aria-label="年齢別の死亡率・全国比・死亡数の表（横にスクロールできます）"><table><caption>年齢別の死亡率・全国比・観察死亡数</caption><thead><tr><th>年齢</th><th scope="col">地域の死亡率</th><th scope="col">全国の死亡率</th><th scope="col">全国比</th><th scope="col">比の95％信頼区間</th><th scope="col">期間内死亡数</th><th scope="col">確認事項</th></tr></thead><tbody>'+rows.map(r=>`<tr><th scope="row">${esc(r.age.replace('100+','100歳以上'))}</th><td>${fmt(r.rate)}</td><td>${fmt(r.national)}</td><td>${Number.isFinite(r.ratio)?fmt(r.ratio,2)+'倍':'—'}</td><td>${Number.isFinite(r.ratioLo)?fmt(r.ratioLo,2)+'～'+fmt(r.ratioHi,2):'—'}</td><td>${Number.isFinite(r.deaths)?fmt(r.deaths,0):'—'}</td><td>${esc(r.reason||(r.deaths<20?'少数死亡：区間の幅に注意':''))}</td></tr>`).join('')+'</tbody></table></div>';}
function overflowEntries(rows,sex,max){return rows.flatMap(row=>(sex==='P'?['M','F']:[sex]).map(s=>({age:row.age,sex:s,r:sex==='P'?row[s]:row}))).filter(e=>Number.isFinite(e.r.ratio)&&(e.r.ratio>max||e.r.ratioHi>max));}
function scaleNote(rows,sel){
 const max=ratioMax(rows.flatMap(r=>sel.sex==='P'?[r.M.ratio,r.F.ratio]:[r.ratio]),sel.scale),entries=overflowEntries(rows,sel.sex,max),points=entries.filter(e=>e.r.ratio>max),ciOnly=entries.filter(e=>e.r.ratio<=max);
 const item=e=>`<li>${e.sex==='M'?'男性':'女性'} ${esc(e.age.replace('100+','100歳以上'))}：<strong>全国比 ${fmt(e.r.ratio,2)}倍</strong>${e.r.ratio>max?'（棒は範囲外）':''}／95％信頼区間 ${fmt(e.r.ratioLo,2)}～${fmt(e.r.ratioHi,2)}倍${e.r.ratioLo>max?'（区間全体が範囲外）':e.r.ratioHi>max?'（上限が範囲外）':''}</li>`;
 return `<div class="age-scale-note" id="ageScaleNote"><p><strong>${scaleLabel(sel.scale)}：横軸0～${fmt(max,2)}倍</strong>。全国＝1。表示範囲の切り替えで統計値は変わりません。</p><p class="age-scale-key"><span><svg viewBox="0 0 38 24" aria-hidden="true"><path d="M0 3h25v18H0z" fill="#916248"/><path d="M13 3l6 18 M21 3l6 18" stroke="#fff" stroke-width="3"/><path d="M28 3l10 9-10 9z" fill="#172f3e"/></svg>塗りつぶした三角＋切れ目：棒の全国比が範囲外</span><span><svg viewBox="0 0 38 24" aria-hidden="true"><path d="M0 12h35 M27 4l8 8-8 8" fill="none" stroke="#172f3e" stroke-width="2"/></svg>白抜きの矢印：95％信頼区間が範囲外</span></p><p>棒が範囲外の場合、信頼区間の印は棒の下に表示します。</p>${points.length?`<p><strong>棒の全国比が範囲外：${points.length}階級</strong>。実際の値は次のとおりです。</p><ul id="agePointOverflowValues">${points.map(item).join('')}</ul>`:'<p id="agePointOverflowValues">棒の全国比はすべて表示範囲内です。</p>'}${ciOnly.length?`<details class="age-ci-values"><summary>信頼区間だけが範囲外：${ciOnly.length}階級（数値を確認）</summary><ul>${ciOnly.map(item).join('')}</ul></details>`:''}</div>`;
}
const note='<div class="age-method"><p>死亡率は人口10万人対・年当たり。複数年は死亡数合計÷各年人口合計×10万で計算し、年次率を単純平均していません。死亡数は選択期間の合計です。</p><p>地域・全国とも日本人住民人口を使用。全国は47都道府県の死亡数と人口の合計です。従来のJMD系列とは分母が異なります。都道府県の全死亡では「年次推移（従来のJMD方式）」も選択できます。</p><p>全国比は同じ年齢階級の率の比で、SMRではありません。95％信頼区間は全国を固定したPoisson近似で、多重比較・分母誤差・5歳階級内の年齢構成差を調整していません。色は点推定の高低で、有意差を表しません。高齢まで同じ人を追跡した結果や原因・医療の質を示すものではありません。</p><p>欠測や区域不一致は補完しません。期間中の一部の年だけで5年間の値を作りません。<a href="data/comparison/sources.json">死亡数の原表・ハッシュ</a> ／ <a href="data/comparison/validation.json">地域対応と検証記録</a> ／ <a href="comparison-methods.html">計算方法</a></p></div>';
async function render(){
 const token=++request;try{await init()}catch(e){$('status').textContent=e.message;$('status').className='status error';$('charts').innerHTML='';return true;}if(!['municipality','prefecture'].includes($('level').value)){if($('ageCompareControls'))$('ageCompareControls').hidden=true;return false;}
 controls();$('ageCompareControls').hidden=false;const level=$('level').value;$('ageJmdOption').hidden=level!=='prefecture';if(level!=='prefecture'&&$('ageView').value==='jmd')$('ageView').value='compare';const sel=selection();$('ageScaleControls').hidden=sel.view!=='compare';if(sel.view==='jmd'){$('agePeriodWrap').hidden=true;$('ageCsv').hidden=$('agePng').hidden=true;updateUrl();return false;}$('agePeriodWrap').hidden=sel.view==='trend';$('ageCsv').hidden=$('agePng').hidden=sel.view==='trend';$('status').textContent='自治体の原数を読み込んでいます…';
 try{const code=$('area').value,a=await areaData(code);if(token!==request||$('level').value!==level)return true;if(!a)throw Error('この自治体は原数と地域境界の対応を確認できていません');
 const rows=manifest.ages.map((age,i)=>sel.sex==='P'?{age,M:compare(a.sexes,manifest.national,'M',sel.indices,i),F:compare(a.sexes,manifest.national,'F',sel.indices,i)}:{age,...compare(a.sexes,manifest.national,sel.sex,sel.indices,i)});current={a,sel,rows};updateUrl();const sexLabel={M:'男性',F:'女性',P:'男女を左右比較'}[sel.sex];
 $('title').textContent=`${[a.prefecture,a.name].filter(Boolean).join(' ')}・全死亡・${sexLabel}${sel.view==='compare'&&sel.sex==='P'?'｜死亡率ピラミッド':''}`;$('subtitle').textContent=`${sel.view==='compare'?sel.period:'2015～2024'}年／住基人口方式・全年齢階級／全国と同じ分母で比較`;$('comparisonLegend').hidden=sel.view==='compare';
 if(sel.view==='compare')$('charts').innerHTML='<div class="age-overview"><p><strong>'+scaleLabel(sel.scale)+'</strong>／全国＝1。棒の範囲外は塗りつぶした三角、信頼区間の範囲外は白抜きの矢印で表示します。</p><div class="age-chart-scroll" tabindex="0" role="region" aria-label="年齢別全国比のグラフ（狭い画面では横にスクロールできます）">'+(sel.sex==='P'?pyramid:plot)(rows,innerWidth<700?620:1080,sel.scale)+'</div>'+scaleNote(rows,sel)+(sel.sex==='P'?'<p>左：男性／右：女性。左右は同じ尺度。各性の全国＝1、横線は95％信頼区間。棒の長さは死亡率の全国比で、人口や死亡数ではありません。</p>'+pairedTable(rows):dataTable(rows))+note+'<p id="ageExportStatus" role="status"></p></div>';
 else $('charts').innerHTML=manifest.ages.flatMap((age,i)=>(sel.sex==='P'?['M','F']:[sel.sex]).map(sex=>{const v=manifest.years.map((_,j)=>pooled(a.sexes,sex,[j],i).rate??null),n=manifest.years.map((_,j)=>pooled(manifest.national,sex,[j],i).rate??null);return window.chart(age+(sel.sex==='P'?'・'+(sex==='M'?'男性':'女性'):''),v,manifest.years.map(String),n,a.name)})).join('')+'<div class="age-overview">'+note+'<p id="ageExportStatus" role="status"></p></div>';
 $('status').className='status';$('status').textContent=sel.view==='compare'?`全21年齢階級を表示／${sel.sex==='P'?'男性'+rows.filter(r=>r.M.status==='available').length+'／女性'+rows.filter(r=>r.F.status==='available').length:rows.filter(r=>r.status==='available').length}階級で死亡率を計算／死亡数は${sel.indices.length}年間の合計／${scaleLabel(sel.scale)}`:'全21年齢階級の年次推移／全国も住基人口方式で表示';
 }catch(e){if(token!==request)return true;$('status').className='status error';$('status').textContent=e.message;$('charts').innerHTML='<p>死亡数・人口・区域の対応が確認できる自治体を選択してください。</p>';current=null;}
 return true;
}
function save(blob,name){const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
function downloadCsv(){if(!current)return;const {a,sel,rows}=current;const fields=['area_code','area_name','sex','period','age','rate_per_100000','national_rate_per_100000','rate_ratio','ratio_ci95_lower','ratio_ci95_upper','deaths','summed_annual_population','status','note'];const exportRows=sel.sex==='P'?rows.slice().reverse().flatMap(r=>['M','F'].map(sex=>({age:r.age,sex,...r[sex]}))):rows;const values=exportRows.map(r=>[a.code,a.name,r.sex||sel.sex,sel.period,r.age,r.rate,r.national,r.ratio,r.ratioLo,r.ratioHi,r.deaths,r.population,r.status,r.reason||'']);const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';save(new Blob(['\ufeff'+[fields,...values].map(v=>v.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),`age-mortality-${a.code}-${sel.sex}-${sel.period}.csv`);}
async function downloadImage(){
 if(!current)return;const {a,sel,rows}=current;
 const max=ratioMax(rows.flatMap(r=>sel.sex==='P'?[r.M.ratio,r.F.ratio]:[r.ratio]),sel.scale),canvas=document.createElement('canvas');canvas.width=1800;canvas.height=4500;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#173748';ctx.font='bold 40px sans-serif';ctx.fillText(`${[a.prefecture,a.name].filter(Boolean).join(' ')}｜${{M:'男性',F:'女性',P:'男女を左右比較'}[sel.sex]}・全死亡`,60,65);ctx.font='30px sans-serif';ctx.fillText(`${sel.period}年｜${sel.sex==='P'?'死亡率ピラミッド（年齢別・全国比）':'年齢別の全国比'}・95％信頼区間`,60,110);ctx.fillText(`${scaleLabel(sel.scale)}｜横軸0～${fmt(max,2)}倍`,60,155);
 const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent((sel.sex==='P'?pyramid:plot)(rows,1080,sel.scale)),img=new Image();
 try{
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});ctx.drawImage(img,35,190,1730,1730*(rows.length*46+110)/1080);
  const table=(heads,cols,values,y)=>{ctx.font='bold 24px sans-serif';heads.forEach((v,i)=>ctx.fillText(v,cols[i],y));ctx.font='25px sans-serif';values.forEach((row,j)=>row.forEach((v,i)=>ctx.fillText(v,cols[i],y+55+j*43)));};
  const ordered=sel.sex==='P'?rows.slice().reverse():rows;
  if(sel.sex==='P')table(['年齢','男性の率','全国男性の率','男性死亡数','女性の率','全国女性の率','女性死亡数'],[45,280,505,730,940,1160,1400],ordered.map(r=>[r.age.replace('100+','100歳以上'),fmt(r.M.rate),fmt(r.M.national),fmt(r.M.deaths,0),fmt(r.F.rate),fmt(r.F.national),fmt(r.F.deaths,0)]),1980);
  else table(['年齢','地域の死亡率','全国の死亡率','期間内死亡数'],[60,470,920,1400],ordered.map(r=>[r.age.replace('100+','100歳以上'),fmt(r.rate),fmt(r.national),fmt(r.deaths,0)]),1980);
  const ratio=r=>Number.isFinite(r.ratio)?fmt(r.ratio,2)+'倍'+(r.ratio>max?' ▲':''):'—';
  const ci=r=>Number.isFinite(r.ratioLo)?fmt(r.ratioLo,2)+'～'+fmt(r.ratioHi,2)+(r.ratioLo>max?' →（全体が範囲外）':r.ratioHi>max?' →':''):'—';
  if(sel.sex==='P')table(['年齢','男性の全国比','男性の95％信頼区間（倍）','女性の全国比','女性の95％信頼区間（倍）'],[45,260,510,1030,1280],ordered.map(r=>[r.age.replace('100+','100歳以上'),ratio(r.M),ci(r.M),ratio(r.F),ci(r.F)]),3020);
  else table(['年齢','全国比','95％信頼区間（倍）'],[60,470,920],ordered.map(r=>[r.age.replace('100+','100歳以上'),ratio(r),ci(r)]),3020);
  ctx.font='26px sans-serif';const lines=[`${scaleLabel(sel.scale)}。塗りつぶした三角＋切れ目／表の▲：棒の全国比が範囲外。`,'白抜きの矢印／表の→：95％信頼区間が範囲外。実際の値を上の表に掲載。','棒が範囲外の信頼区間の印は棒の下に表示。表示範囲の切り替えで統計値は変わりません。','地域・全国とも日本人住基人口。死亡率：人口10万人対・年当たり。',sel.sex==='P'?'左は男性、右は女性。各性の全国＝1。左右同じ尺度。横線：95％信頼区間。':'期間死亡数合計÷各年人口合計による死亡率を比較。SMRではありません。','全国を固定したPoisson近似区間。多重比較・分母誤差は未調整。','死亡数の少ない階級は変動に注意。個人の加齢・原因を示しません。','出典：municipal-smr.jp/age-specific-mortality/'];lines.forEach((l,i)=>ctx.fillText(l,60,4080+i*48));
  canvas.toBlob(b=>{if(b)save(b,`age-mortality-${a.code}-${sel.sex}-${sel.period}-${sel.scale}.png`);},'image/png');
 }catch(e){$('ageExportStatus').textContent='画像を保存できませんでした。再度お試しください。';}
}
root.AgeComparison={...api,init,render,hide(){request++;if($('ageCompareControls'))$('ageCompareControls').hidden=true;}};
})(typeof window==='undefined'?globalThis:window);


