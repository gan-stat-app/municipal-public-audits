import React from'react';
import{arbitraryCauses,officialCauses,causeForMode}from'../catalogs/causes.js';
import{prefectures}from'../lib/areaCatalog.js';
import{selectableAreas}from'../lib/areaCatalogClient.js';
import{officialPeriods,officialAreas}from'../lib/officialClient.js';
const years=Array.from({length:26},(_,i)=>1999+i);
export default function Controls({query,setQuery,catalog,officialData,medicalAreas=[]}){
 const official=query.mode==='official',medical=!official&&query.regionUnit==='medical-area';
 const pref=medical?query.medicalAreaCode.slice(0,2):query.areaCode.slice(0,2);
 const areas=official?(officialData?officialAreas(officialData,{period:query.officialPeriod,sex:query.sex,prefCode:pref}):[]):selectableAreas(catalog,pref);
 const medicalChoices=medicalAreas.filter(x=>x.code.startsWith(pref)),ready=medical?!!medicalAreas.length:official?!!officialData:!!catalog.length;
 const setPref=p=>{if(medical){const first=medicalAreas.find(x=>x.code.startsWith(p));setQuery(q=>({...q,medicalAreaCode:first?.code??q.medicalAreaCode}))}else if(official&&officialData){const xs=officialAreas(officialData,{period:query.officialPeriod,sex:query.sex,prefCode:p});setQuery(q=>({...q,areaCode:xs[0]?.code??`${p}000`}))}else setQuery(q=>({...q,areaCode:`${p}000`}))};
 const setStart=y=>setQuery(q=>({...q,startYear:y,endYear:Math.max(y,q.endYear)})),setEnd=y=>setQuery(q=>({...q,endYear:y,startYear:Math.min(q.startYear,y)}));
 const setMode=mode=>setQuery(q=>({...q,mode,regionUnit:mode==='official'?'municipality':q.regionUnit,datasetCode:causeForMode(q.datasetCode,q.mode,mode),sex:mode==='official'&&q.sex==='男女計'?'男':q.sex}));
 return <div className="control-grid">
  <label>表示方式<select value={query.mode} onChange={e=>setMode(e.target.value)}><option value="arbitrary">任意期間標準化死亡比</option><option value="official">国公式5年値</option></select></label>
  {!official&&<label>地域単位<select value={query.regionUnit} onChange={e=>{const unit=e.target.value;setQuery(q=>{if(unit==='medical-area'){const first=medicalAreas.find(x=>x.municipalities.some(([code])=>code===q.areaCode))||medicalAreas.find(x=>x.code.startsWith(q.areaCode.slice(0,2)));return{...q,regionUnit:unit,medicalAreaCode:first?.code??`${q.areaCode.slice(0,2)}00`}}return{...q,regionUnit:unit,areaCode:`${q.medicalAreaCode.slice(0,2)}000`}})}}><option value="municipality">市区町村別</option><option value="medical-area">2次医療圏別</option></select></label>}
  <label>都道府県<select value={pref} onChange={e=>setPref(e.target.value)}>{prefectures.map(([c,x])=><option key={c} value={c}>{x}</option>)}</select></label>
  {medical?<label>2次医療圏<select value={query.medicalAreaCode} onChange={e=>setQuery(q=>({...q,medicalAreaCode:e.target.value}))} disabled={!ready}>{!ready&&<option>地域一覧を読込中</option>}{ready&&medicalChoices.map(a=><option key={a.code} value={a.code}>{a.name}</option>)}</select></label>:<label>自治体<select value={query.areaCode} onChange={e=>setQuery(q=>({...q,areaCode:e.target.value}))} disabled={!ready}>{!ready&&<option value={query.areaCode}>自治体一覧を読込中</option>}{ready&&areas.map(a=><option key={a.code} value={a.code}>{a.name}</option>)}</select></label>}
  {!official&&<label>人口方式<select value={query.basis} onChange={e=>setQuery(q=>({...q,basis:e.target.value}))}><option value="juki">住民基本台帳人口</option><option value="census">国勢調査基準人口</option></select></label>}
  <label>死因<select value={query.datasetCode} onChange={e=>setQuery(q=>({...q,datasetCode:e.target.value,sex:!official&&e.target.value==='Se12'?'女':q.sex}))}>{(official?officialCauses:arbitraryCauses).map(([c,x])=><option key={c} value={c}>{x}</option>)}</select></label>
  <label>性別<select value={query.sex} onChange={e=>setQuery(q=>({...q,sex:e.target.value}))}><option>男</option><option>女</option>{!official&&<option>男女計</option>}</select></label>
  {official?<label>公表期間<select value={query.officialPeriod} onChange={e=>setQuery(q=>({...q,officialPeriod:e.target.value}))}>{officialPeriods.map(p=><option key={p}>{p}</option>)}</select></label>:<><label>開始年<select value={query.startYear} onChange={e=>setStart(+e.target.value)}>{years.map(y=><option key={y}>{y}</option>)}</select></label><label>終了年<select value={query.endYear} onChange={e=>setEnd(+e.target.value)}>{years.map(y=><option key={y}>{y}</option>)}</select></label></>}
 </div>
}
