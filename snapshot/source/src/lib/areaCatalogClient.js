import {loadJson} from'./dataClient.js';import{displayAreaName}from'../catalogs/designatedCities.js';import{prefectureName}from'./areaCatalog.js';
export async function loadAreaCatalog(options){const rows=await loadJson('/data/area-catalog.json',options);if(!Array.isArray(rows))throw new Error('Invalid area catalog');return rows.map(([code,name])=>({code,name:displayAreaName(code,name)}));}
export function selectableAreas(catalog,prefCode){return[{code:`${prefCode}000`,name:`${prefectureName(prefCode)}全体`},...catalog.filter(x=>x.code.startsWith(prefCode))];}
