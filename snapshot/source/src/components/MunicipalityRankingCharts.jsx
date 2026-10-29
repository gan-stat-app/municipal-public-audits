import React from 'react';

const n=(value,digits=1)=>value==null?'—':Number(value).toLocaleString('ja-JP',{maximumFractionDigits:digits,minimumFractionDigits:digits});
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
function significance(item){
 if(item.ci95Low>100)return{key:'significant-high',label:'全国基準より有意に高い'};
 if(item.ci95High<100)return{key:'significant-low',label:'全国基準より有意に低い'};
 return{key:'not-significant',label:'95%信頼区間が100を含む'};
}
function RankingBars({title,items,total,onSelect,unitLabel}){
 const shown=items.slice(0,10);
 const ceiling=Math.max(120,Math.ceil(Math.max(...shown.flatMap(item=>[item.smr,item.ci95High||0]),100)/20)*20);
 return <section className="ranking-chart" aria-label={title}>
  <h3>{title}</h3>
  <div className="ranking-axis" aria-hidden="true"><span>0</span><span>全国100</span><span>{ceiling}</span></div>
  <ol className="ranking-bars">
   {shown.map(item=>{const sig=significance(item),smr=clamp(item.smr/ceiling*100,0,100),low=clamp(item.ci95Low/ceiling*100,0,100),high=clamp(item.ci95High/ceiling*100,0,100);return <li key={item.areaCode}>
    <button type="button" className={`ranking-bar-button ${sig.key}`} onClick={()=>onSelect(item.areaCode)} aria-label={`${item.rank}位、${item.name}、標準化死亡比 ${n(item.smr)}、95%信頼区間 ${n(item.ci95Low)}から${n(item.ci95High)}、${sig.label}`}>
     <span className="ranking-bar-label"><b>{item.rank}位 / {total}{unitLabel}</b><span>{item.name}</span><small className={`significance-badge ${sig.key}`}>{sig.label}</small></span>
     <span className="ranking-bar-track" aria-hidden="true">
      <progress className={`ranking-bar-fill ${sig.key}`} max="100" value={smr}/>
      <svg className="ranking-ci-overlay" viewBox="0 0 100 20" preserveAspectRatio="none">
       <line className="ranking-national-baseline" x1={100/ceiling*100} x2={100/ceiling*100} y1="0" y2="20"/>
       <line className="ranking-ci-line" x1={low} x2={high} y1="10" y2="10"/>
       <line className="ranking-ci-cap" x1={low} x2={low} y1="5" y2="15"/>
       <line className="ranking-ci-cap" x1={high} x2={high} y1="5" y2="15"/>
      </svg>
     </span>
     <span className="ranking-bar-value"><b>{n(item.smr)}</b><small>95%信頼区間</small><small>{n(item.ci95Low)}–{n(item.ci95High)}</small><small>観察 {n(item.observed,0)} ／ 期待 {n(item.expected,0)}</small></span>
    </button>
   </li>})}
  </ol>
 </section>
}
export default function MunicipalityRankingCharts({ranking,scopeLabel='全国',selectedCode,onSelect,unitLabel='自治体'}){
 if(!ranking)return null;
 const selected=ranking.items.find(item=>item.areaCode===selectedCode),sig=selected&&significance(selected);
 return <>
  {selected&&<p className={`selected-rank ${sig.key}`}><strong>{selected.name}：</strong>{scopeLabel} {selected.rank}位 / {ranking.total}{unitLabel}　標準化死亡比 {n(selected.smr)}　95%信頼区間 {n(selected.ci95Low)}–{n(selected.ci95High)}　<span>{sig.label}</span></p>}
  <p className="significance-legend"><span className="significance-badge significant-high">全国基準より有意に高い</span><span className="significance-badge significant-low">全国基準より有意に低い</span><span className="significance-badge not-significant">95%信頼区間が100を含む</span></p>
  <p className="fine-print">{scopeLabel}の中で値が高い・低い地域を並べています。全国基準100を上回る・下回ることや、有意差の有無とは別です。</p>
  <div className="ranking-chart-grid">
   <RankingBars title={`${scopeLabel}で値が高い${Math.min(10,ranking.high.length)}${unitLabel}`} unitLabel={unitLabel} items={ranking.high} total={ranking.total} onSelect={onSelect}/>
   <RankingBars title={`${scopeLabel}で値が低い${Math.min(10,ranking.low.length)}${unitLabel}`} unitLabel={unitLabel} items={ranking.low} total={ranking.total} onSelect={onSelect}/>
  </div>
 </>;
}

