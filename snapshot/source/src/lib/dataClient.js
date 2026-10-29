const inflight=new Map(),resolved=new Map();
function assertSameOriginPath(path){if(typeof path!=='string'||!path.startsWith('/'))throw new Error('Data path must be same-origin and absolute');if(!path.startsWith('/data/')&&!path.startsWith('/population/'))throw new Error(`Unexpected data path: ${path}`)}
async function decodeResponse(response,path){if(!response.ok)throw new Error(`${response.status} ${response.statusText}: ${path}`);const bytes=new Uint8Array(await response.arrayBuffer()),gzipped=bytes[0]===0x1f&&bytes[1]===0x8b;if(!gzipped)return JSON.parse(new TextDecoder().decode(bytes));if(typeof DecompressionStream!=='function')throw new Error(`Gzip decompression is unavailable: ${path}`);const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(stream).text())}
export function causeDataPath({basis,datasetCode,boundary='2024-boundary',dataRevision}){if(!['juki','census'].includes(basis))throw new Error(`Unknown basis: ${basis}`);if(!/^Se(?:\d{2}|CO|IH)$/.test(datasetCode))throw new Error(`Unexpected dataset code: ${datasetCode}`);if(dataRevision!=null&&dataRevision!=='rebuilt')throw new Error('Unknown data revision');return `/data/${dataRevision==='rebuilt'?'selected-cause-rebuild-v1/':''}${basis}-${datasetCode}-${boundary}.json.gz`}
export function resolveDataUrl(path,origin){assertSameOriginPath(path);if(origin==null)return path;const u=new URL(path,origin);if(u.origin!==new URL(origin).origin)throw new Error('CI data URL must remain on the configured origin');return u.href}
export function loadJson(path,{signal,origin,cache=true}={}){assertSameOriginPath(path);const url=resolveDataUrl(path,origin),key=url;if(cache&&resolved.has(key))return Promise.resolve(resolved.get(key));if(cache&&inflight.has(key)&&!signal)return inflight.get(key);const request=fetch(url,{signal,credentials:origin?'omit':'same-origin'}).then(r=>decodeResponse(r,path)).then(v=>{if(cache)resolved.set(key,v);return v}).finally(()=>{if(inflight.get(key)===request)inflight.delete(key)});if(cache&&!signal)inflight.set(key,request);return request}
export function applyMethodAcceptance(dataset,policy){
 if(policy.decision!=='accepted'||policy.source_version!==dataset.source_version)throw new Error('Verified method policy does not match the data');
 const accepted=dataset.basis===policy.basis;
 if(dataset.rows.some(row=>row[7]==='REBUILT_REFERENCE'&&(!accepted||row[0]<policy.years[0]||row[0]>policy.years[1])))throw new Error('Unverified reference years in dataset');
 return {...dataset,method_revision:policy.version,method_status:'SOURCE_VERIFIED',storage_reference_years:dataset.reference_years,reference_years:[],rows:dataset.rows.map(row=>accepted&&row[7]==='REBUILT_REFERENCE'&&row[0]>=policy.years[0]&&row[0]<=policy.years[1]?[...row.slice(0,7),'SOURCE_VERIFIED']:row)};
}
export async function loadCauseData(options,requestOptions){
 const dataset=await loadJson(causeDataPath(options),requestOptions);
 if(options.dataRevision!=='rebuilt')return dataset;
 const policy=await loadJson('/data/selected-cause-rebuild-v1/acceptance.json',{...requestOptions,cache:true});
 return applyMethodAcceptance(dataset,policy);
}
export function clearMemoryDataCache(){inflight.clear();resolved.clear()}


