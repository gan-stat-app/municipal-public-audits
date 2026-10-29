import{loadJson}from'./dataClient.js';
export const officialPeriods=['1998-2002','2003-2007','2008-2012','2013-2017','2018-2022'];
export const officialSexes=['男','女'];
export async function loadOfficialData(datasetCode,{signal}={}){const data=await loadJson(`/data/official-${datasetCode}.json.gz`,{signal});if(!data||!Array.isArray(data.rows))throw new Error('Invalid official SMR data');return data}
export function officialRows(data,{period,sex}){const[start,end]=period.split('-').map(Number);return(data?.rows??[]).filter(r=>r[0]===start&&r[1]===end&&r[4]===sex)}
export function officialValue(row){if(!row)return null;return{areaCode:String(row[2]),areaName:row[3],sex:row[4],observed:row[7]??null,smr:row[8]??null,ebSmr:row[9]??null,source:row[11]??'',rankingValue:row[9]??row[8]??null}}
export function officialAreas(data,{period,sex,prefCode}){const seen=new Map();for(const row of officialRows(data,{period,sex})){const code=String(row[2]);if(!code.startsWith(prefCode))continue;const value=officialValue(row);if(value?.areaName&&!seen.has(code))seen.set(code,{code,name:value.areaName})}return[...seen.values()].sort((a,b)=>a.code.localeCompare(b.code,'ja'))}
