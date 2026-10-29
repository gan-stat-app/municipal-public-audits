import {formatExpected} from '../lib/smrDisplay.js';
import React from'react';
const n=(v,d=1)=>v==null?'—':Number(v).toLocaleString('ja-JP',{maximumFractionDigits:d,minimumFractionDigits:d});
export function Rank({title,items,total}){return <div><h3>{title}</h3><ol>{items.map(x=><li key={x.areaCode} className="rank-item">{x.rank!=null?`${x.rank}位 / ${x.total??total}自治体　`:''}<strong>{x.areaName||x.name||x.areaCode}</strong>　標準化死亡比 {n(x.rankingValue??x.smr)}　観察死亡数 {n(x.observed,0)}{x.expected!=null?` ／ 期待死亡数 ${formatExpected(x.expected)}`:''}</li>)}</ol></div>}
export function Metric({label,value}){return <div className="metric-card"><div className="metric-label">{label}</div><strong className="metric-value">{value}</strong></div>}

