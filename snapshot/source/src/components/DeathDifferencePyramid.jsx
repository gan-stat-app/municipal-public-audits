import './deathDifference.css';
import React,{useEffect,useState} from 'react';
import {loadJson} from '../lib/dataClient.js';
import {calculateDifference,calculateCauseDifference} from '../lib/deathDifference.js';
import {calculateMedicalAreaDifference} from '../lib/medicalAreaDeathDifference.js';
import {arbitraryCauseMap} from '../catalogs/causes.js';
import {byarObservedInterval} from '../lib/smr.js';
const fmt=(n,d=1)=>n.toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d});
const signed=n=>(n>0?'+':'')+fmt(n);
async function comparison(path) {
  const r=await fetch('/age-specific-mortality/data/comparison/'+path,{credentials:'same-origin'});
  if(!r.ok)throw new Error('年齢別データを読み込めませんでした。閉じてから再度お試しください。');
  let b=await r.arrayBuffer();
  if(new Uint8Array(b)[0]===31 && new Uint8Array(b)[1]===139)b=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return JSON.parse(new TextDecoder().decode(b));
}
export default function DeathDifferencePyramid({query,dataset,areaName,medicalArea}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[selected,setSelected]=useState(null);
  useEffect(()=>{let active=true;setData(null);setError('');setSelected(null);
    const causeSpecific=query.datasetCode!=='Se00',medical=query.regionUnit==='medical-area';
    Promise.all([comparison('index.json'),comparison(medical?query.medicalAreaCode.slice(0,2)+'.json.gz':query.areaCode.endsWith('000')?'prefectures.json.gz':query.areaCode.slice(0,2)+'.json.gz'),
      causeSpecific?loadJson('/data/death-difference/causes/'+query.datasetCode+'.json.gz'):Promise.all([loadJson('/data/death-difference/unknown-age.json'),loadJson('/data/death-difference/national-all-cause.json')])])
    .then(([idx,shard,inputs])=>{const a=medical?medicalArea:shard.areas.find(a=>a.code===query.areaCode);const value=medical?calculateMedicalAreaDifference(idx,inputs[1],medicalArea,shard.areas,dataset,query,inputs[0]):causeSpecific?calculateCauseDifference(idx,a,dataset,query,inputs):calculateDifference(idx,inputs[1],a,dataset,query,inputs[0]);if(active)setData({...value,areaName:a.name});})
    .catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
  },[query,dataset,medicalArea]);
  if(error)return <p role="alert">{error}</p>;
  if(!data)return <p role="status">年齢別の原数とSMR本体の一致を確認しています…</p>;
  const sexLabel={M:'男性',F:'女性'};
  const intervals=c=>byarObservedInterval(c.observed).map(n=>n-c.expected);
  const bound=Math.max(1,...Object.values(data.sexes).flatMap(s=>s.cells.flatMap(c=>intervals(c).map(Math.abs))));
  const axis=Math.ceil(bound/10)*10,x=n=>205+n/axis*140;
  return <section className="death-difference" aria-label="死亡数差ピラミッド">
    <h3>{data.areaName||areaName}の死亡数差ピラミッド</h3>
    <p>{query.startYear}～{query.endYear}年｜{arbitraryCauseMap.get(query.datasetCode)}｜日本人住民・住民基本台帳人口方式</p>
    {query.regionUnit==='medical-area'&&<p className="fine-print">2022年末の医療圏区分で、構成市区町村の年齢別死亡数と期待死亡数を合算しています。各年・各市区町村・男女別にSMR本体との一致を確認しています。</p>}
    <p><strong>観察死亡数 − 期待死亡数（人・期間合計）</strong>。期待死亡数は、その年・性・年齢・死因の全国死亡率を地域人口に当てはめた人数です。</p>
    <p>右（＋）は全国基準より多い、左（−）は少ないことを示します。黒線は95％信頼区間。男女は同じ目盛りです。年齢は5歳階級（100+は100歳以上）。年齢の行をタップすると数値を確認できます。</p>
    <div className="death-difference-panels">{['M','F'].map(sex=>{const s=data.sexes[sex];return <section key={sex}>
      <h4>{sexLabel[sex]}{query.sex===(sex==='M'?'男':'女')?'（SMR画面で選択中）':''}</h4>
      <p>観察 {fmt(s.observed,0)}人／期待 {fmt(s.expected)}人<br/><strong>差 {signed(s.difference)}人</strong></p><p className="fine-print">年齢不詳 {fmt(s.unknownObserved,0)}人を観察死亡数に含みます。年齢別の棒には配分していません。</p>
      <svg viewBox="0 0 400 810" role="img" aria-label={`${sexLabel[sex]}、全21年齢階級の死亡数差と95％信頼区間`}>
        {[-axis,0,axis].map(v=><g key={v}><line x1={x(v)} x2={x(v)} y1="34" y2="768" stroke={v===0?'#637381':'#d9e1e8'}/><text x={x(v)} y="22" textAnchor="middle" fontSize="12">{v>0?'+':''}{fmt(v,0)}</text></g>)}
        {[...s.cells].reverse().map((c,i)=>{const y=48+i*34,[lo,hi]=intervals(c);return <g key={c.age} tabIndex="0" role="button" aria-label={`${c.age}歳、差${signed(c.difference)}人、数値を見る`} onClick={()=>setSelected({...c,sex,lo,hi})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected({...c,sex,lo,hi});}}}>
          <title>{`${c.age}歳：観察${c.observed}人、期待${fmt(c.expected)}人、差${signed(c.difference)}人`}</title>
          <rect x="0" y={y-14} width="400" height="32" fill={selected?.sex===sex&&selected?.age===c.age?'#e7f0f7':'transparent'}/>
          <text x="59" y={y+4} textAnchor="end" fontSize="15">{c.age}</text>
          <rect x={Math.min(x(0),x(c.difference))} y={y-9} width={Math.max(0.7,Math.abs(x(c.difference)-x(0)))} height="18" fill={c.difference>=0?'#be526d':'#258180'}/>
          <path d={`M${x(lo)},${y}H${x(hi)} M${x(lo)},${y-4}V${y+4} M${x(hi)},${y-4}V${y+4}`} stroke="#263746" fill="none" strokeWidth="1.5"/>
        </g>;})}<text x="205" y="790" textAnchor="middle" fontSize="13">少ない ← 0 → 多い（人）</text>
      </svg>
    </section>;})}</div>
    <div className="death-difference-detail" aria-live="polite">{selected?<p><strong>{sexLabel[selected.sex]}・{selected.age.replace('100+','100以上')}歳</strong><br/>観察死亡数 {fmt(selected.observed,0)}人／期待死亡数 {fmt(selected.expected)}人<br/>差 {signed(selected.difference)}人（95％信頼区間 {signed(selected.lo)}～{signed(selected.hi)}人）</p>:<p>グラフの行をタップすると、観察死亡数・期待死亡数・差・信頼区間を表示します。</p>}</div>
    <details><summary>全年齢の数値表を開く</summary><div className="death-difference-table"><table><thead><tr><th>性</th><th>年齢</th><th>観察死亡数</th><th>期待死亡数</th><th>差（人）</th><th>95％信頼区間</th></tr></thead><tbody>{['M','F'].flatMap(sex=>[...data.sexes[sex].cells].reverse().map(c=><tr key={sex+c.age}><th>{sexLabel[sex]}</th><th>{c.age}</th><td>{fmt(c.observed,0)}</td><td>{fmt(c.expected)}</td><td>{signed(c.difference)}</td><td>{intervals(c).map(signed).join('～')}</td></tr>))}</tbody></table></div></details>
    <p className="fine-print">期待死亡数は年ごとに計算して期間合計しています。年齢別合計（観察数は原表の年齢不詳を加算）はSMR本体と照合済みです（保存時の丸め差を除く）。男女計のSMRは、男女それぞれの観察数・期待数の合計に対応します。全国死亡率を固定して観察死亡数にByar近似を適用した95％区間で、多重比較の調整はしていません。区間が0を含む年齢では差があるとは判断できません。</p>
    <p className="fine-print">この差は全国基準との比較です。過去の推移から予測する「超過死亡」や、予防できた死亡数、死因・生活習慣の因果的な寄与を表しません。人口規模にも左右され、地域間の死亡リスクの順位には使えません。<a href="/transparency/">出典・計算方法</a>。死因別の死亡数：<a href="https://www.e-stat.go.jp/dbview?sid=0003412077">人口動態統計確定数・都道府県編第2表</a>（年計）。</p>
  </section>;
}

