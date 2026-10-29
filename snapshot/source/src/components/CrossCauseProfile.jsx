import {formatExpected} from '../lib/smrDisplay.js';
import React from'react';
const f=v=>Number.isFinite(v)?v.toFixed(1):'—';
const count=v=>Number.isFinite(v)?Math.round(v).toLocaleString('ja-JP'):'—';
const significance=x=>x.ci95Low>100?{key:'significant-high',label:'全国基準より有意に高い'}:x.ci95High<100?{key:'significant-low',label:'全国基準より有意に低い'}:{key:'not-significant',label:'95%信頼区間が100を含む'};

export default function CrossCauseProfile({state,onRequest,onSelect}){
  const[filter,setFilter]=React.useState('all');
  if(state.status==='idle')return <div className="cause-idle"><p>選択した地域・期間・性別について、全死因・34死因・合成2項目の標準化死亡比を確認できます。子宮の悪性新生物は女性選択時に表示します。この欄が画面に近づくと自動で表示します。</p></div>;
  if(state.status==='loading')return <p role="status" aria-live="polite">死因別の標準化死亡比を読み込んでいます{state.progress?`（${state.progress.completed} / ${state.progress.total}項目）`:''}…</p>;
  if(state.status==='error')return <div><p role="alert">死因別データを取得できませんでした。</p><button type="button" onClick={onRequest}>もう一度読み込む</button></div>;
  const items=state.items||[];
  if(!items.length)return <p>表示できる死因別データがありません。</p>;
  const significant=items.filter(x=>x.ci95Low>100).length,above=items.filter(x=>x.smr>100).length;
  const shown=filter==='significant'?items.filter(x=>x.ci95Low>100):filter==='above'?items.filter(x=>x.smr>100):items;
  const max=Math.max(150,...items.map(x=>x.smr||0)),baseline=Math.min(100,(100/max)*100);
  return <div>
    <p className="fine-print"><strong>全国基準は100です。</strong> 選択した地域・期間で算定できる項目を、標準化死亡比が高い順に表示します。判定は95%信頼区間と100の位置関係に基づきます。子宮の悪性新生物は女性のみの対象です。</p>
    <div className="cause-summary" aria-live="polite"><strong>算定できた{items.length}項目中、標準化死亡比100超は{above}項目</strong><span>うち95％信頼区間の下限も100超：{significant}項目</span></div>
    <div className="cause-filter" role="group" aria-label="死因別特徴の表示条件">
      <button type="button" aria-pressed={filter==='significant'} onClick={()=>setFilter('significant')}>有意に高いのみ</button>
      <button type="button" aria-pressed={filter==='above'} onClick={()=>setFilter('above')}>標準化死亡比100超</button>
      <button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>すべて</button>
    </div>
    <p className="significance-legend"><span className="significance-badge significant-high">全国基準より有意に高い</span><span className="significance-badge significant-low">全国基準より有意に低い</span><span className="significance-badge not-significant">95%信頼区間が100を含む</span></p>
    <div className="cause-list">{shown.length?shown.map(x=>{const pct=Math.min(100,Math.max(1,(x.smr/max)*100)),sig=significance(x);return <button type="button" key={x.datasetCode} className={`cause-row ${sig.key}`} onClick={()=>onSelect?.(x.datasetCode)} aria-label={`${x.causeName}の詳細を表示。標準化死亡比 ${f(x.smr)}、95%信頼区間 ${f(x.ci95Low)}から${f(x.ci95High)}、観察死亡数 ${count(x.observed)}、期待死亡数 ${formatExpected(x.expected)}`}>
      <span><strong>{x.causeName}</strong><span className={`cause-significance significance-badge ${sig.key}`}>{sig.label}</span></span>
      <svg className="cause-bar" viewBox="0 0 100 12" role="img" aria-label={`${x.causeName} 標準化死亡比 ${f(x.smr)}、95%信頼区間 ${f(x.ci95Low)}から${f(x.ci95High)}、${sig.label}`} preserveAspectRatio="none"><rect x="0" y="0" width="100" height="12" rx="6" className="cause-track"/><rect x="0" y="0" width={pct} height="12" rx="6" className="cause-fill"/><line x1={baseline} x2={baseline} y1="0" y2="12" className="cause-baseline"/></svg>
      <span className="cause-value">標準化死亡比 {f(x.smr)}<span className="cause-ci">95%信頼区間 {f(x.ci95Low)}–{f(x.ci95High)}</span><span className="cause-counts">観察 {count(x.observed)}人・期待 {formatExpected(x.expected)}人</span></span>
    </button>}):<p className="cause-empty">現在の条件では該当する死因がありません。「標準化死亡比100超」または「すべて」で確認できます。</p>}</div>
    <p className="tiny-print">行を選ぶと、その死因の地図・順位・推移へ移動します。死因別の差は地域の特徴を探索するための情報です。標準化死亡比だけから個人の死亡リスクや原因を判断することはできません。</p>
  </div>
}

