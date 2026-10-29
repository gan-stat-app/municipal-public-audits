import { gunzipSync } from 'node:zlib';
const geometryUrl='https://municipal-smr.jp/data/smr-juki-2024-male-all.geojson.gz';
const dataUrl='https://municipal-smr.jp/data/juki-Se00-2024-boundary.json.gz';
async function json(url){const r=await fetch(url);if(!r.ok)throw new Error(`${url}: ${r.status}`);const b=Buffer.from(await r.arrayBuffer());try{return JSON.parse(b.toString('utf8'))}catch{return JSON.parse(gunzipSync(b).toString('utf8'))}}
const [geo,data]=await Promise.all([json(geometryUrl),json(dataUrl)]);
if(geo?.type!=='FeatureCollection'||!Array.isArray(geo.features)||geo.features.length<1000)throw new Error(`invalid geometry features=${geo?.features?.length}`);
const codes=new Set(geo.features.map(f=>f?.properties?.area_code).filter(Boolean));
for(const code of ['05201','01101','13101','47201'])if(!codes.has(code))throw new Error(`geometry missing ${code}`);
if(!Array.isArray(data?.rows)||!data.rows.length)throw new Error('SMR rows missing');
const rowCodes=new Set(data.rows.map(r=>r[1]));let joined=0;for(const code of codes)if(rowCodes.has(code))joined++;
if(joined<1000)throw new Error(`geometry/data join too small ${joined}`);
console.log(JSON.stringify({pass:true,features:geo.features.length,joined,samples:['05201','01101','13101','47201']}));
