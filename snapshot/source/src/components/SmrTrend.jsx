import React from 'react';
import {formatExpected, trendDisplay} from '../lib/smrDisplay.js';
const W=900,H=300,P={l:54,r:18,t:20,b:44};
const number=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('ja-JP',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
export default function SmrTrend({items=[],official=false}) {
  if(!items.length)return <p>経年データを取得できません。</p>;
  const {points,segments,fraction}=trendDisplay(items,official);
  const valid=points.filter(p=>Number.isFinite(p.v));
  const bounds=valid.flatMap(p=>official?[p.v]:[p.v,p.ci95Low,p.ci95High]).filter(Number.isFinite);
  const min=Math.max(0,Math.floor((Math.min(80,...bounds)-10)/10)*10),max=Math.ceil((Math.max(120,...bounds)+10)/10)*10;
  const x=p=>P.l+(W-P.l-P.r)*fraction(p),y=v=>P.t+(H-P.t-P.b)*(max-v)/(max-min);
  const missing=points.filter(p=>!Number.isFinite(p.v));
  return <div className="smr-trend">
    <div className="trend-scroll" tabIndex="0" role="region" aria-label="標準化死亡比の推移グラフ（横スクロール可能）">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="標準化死亡比の推移グラフ" className="trend-chart">
        <line x1={P.l} x2={W-P.r} y1={y(100)} y2={y(100)} stroke="currentColor" strokeDasharray="6 5" opacity=".45"/>
        <text x={P.l+4} y={y(100)-6} fontSize="12">全国基準 100</text>
        {!official&&valid.map(p=>Number.isFinite(p.ci95Low)&&Number.isFinite(p.ci95High)?<line key={`ci-${p.label}`} x1={x(p)} x2={x(p)} y1={y(p.ci95Low)} y2={y(p.ci95High)} stroke="currentColor" opacity=".28"/>:null)}
        {segments.map((segment,i)=><polyline key={i} points={segment.map(p=>`${x(p)},${y(p.v)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.5"/>)}
        {valid.map(p=><circle key={p.label} cx={x(p)} cy={y(p.v)} r="4" fill="currentColor"><title>{`${p.label}: 標準化死亡比 ${number(p.v)}${official?`（${p.basis}）`:`、95%信頼区間 ${number(p.ci95Low)}–${number(p.ci95High)}`}`}</title></circle>)}
        {points.map((p,i)=>(official||i%5===0||i===points.length-1)&&<text key={p.label} x={x(p)} y={H-18} textAnchor="middle" fontSize="11">{p.label}</text>)}
        <text x="8" y="16" fontSize="12">標準化死亡比 {max}</text><text x="8" y={H-P.b} fontSize="12">{min}</text>
      </svg>
    </div>
    <p className="fine-print">{official?'前半3期間は公表標準化死亡比、2013–2017年以降はベイズ推定標準化死亡比を表示します。':'縦線は各年の標準化死亡比の95%信頼区間、破線は全国基準100です。'} 算定できない年・期間は空け、線を結びません。</p>
    {missing.length>0&&<p className="fine-print" data-testid="smr-trend-missing">{official?'公表値なし':'算定できない年'}：{missing.map(p=>p.label).join('、')}{!official&&'（必要な死亡数・人口・区域のデータがそろわない年を含みます）'}</p>}
    <details className="smr-trend-details"><summary>{official?'期間別の数値を見る':'年ごとの数値・95%信頼区間を見る'}</summary>
      <div className="smr-trend-table-wrap" tabIndex="0" role="region" aria-label="推移の数値表（横スクロール可能）"><table className="smr-trend-table"><caption>{official?'国公式5年値の推移':'各年の標準化死亡比・95%信頼区間・死亡数'}</caption><thead><tr><th scope="col">{official?'期間':'年'}</th><th scope="col">標準化死亡比</th>{official?<th scope="col">値の種類</th>:<><th scope="col">95%信頼区間</th><th scope="col">観察死亡数</th><th scope="col">期待死亡数</th></>}</tr></thead><tbody>{points.map(p=><tr key={p.label}><th scope="row">{p.label}</th><td>{Number.isFinite(p.v)?number(p.v):official?'公表値なし':'算定不可'}</td>{official?<td>{p.basis||'—'}</td>:<><td>{Number.isFinite(p.v)?`${number(p.ci95Low)}–${number(p.ci95High)}`:'—'}</td><td>{number(p.observed,0)}</td><td>{formatExpected(p.expected)}</td></>}</tr>)}</tbody></table></div>
    </details>
  </div>;
}
