import{gunzipSync,gzipSync}from'node:zlib';
import{mkdtemp,writeFile,readFile,rm,mkdir}from'node:fs/promises';
import{tmpdir}from'node:os';
import{join}from'node:path';
import{execFileSync}from'node:child_process';

const base='https://municipal-smr.jp';
const parts=['/data/prefecture-boundaries-00.part','/data/prefecture-boundaries-01.part'];
const bs=await Promise.all(parts.map(async p=>{
  const r=await fetch(base+p);
  if(!r.ok)throw new Error(`${p}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}));
const raw=gunzipSync(Buffer.concat(bs)),baseline=JSON.parse(raw);
if(baseline?.features?.length!==47)throw new Error('baseline feature count');

const code=f=>String(f?.properties?.area_code??f?.properties?.code??f?.properties?.N03_007??'').padStart(2,'0').slice(0,2);
const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
const ringArea=ring=>{
  let sum=0;
  for(let i=0;i<ring.length-1;i++)sum+=ring[i][0]*ring[i+1][1]-ring[i+1][0]*ring[i][1];
  return Math.abs(sum)/2;
};
const geometryArea=g=>polygons(g).reduce((total,poly)=>total+(poly.length?ringArea(poly[0])-poly.slice(1).reduce((n,ring)=>n+ringArea(ring),0):0),0);
const geometryStats=g=>{
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,coordinatePairs=0,rings=0,closed=true,finite=true;
  for(const poly of polygons(g))for(const ring of poly){
    rings++;
    if(ring.length<4)closed=false;
    const first=ring[0],last=ring.at(-1);
    if(!first||!last||first[0]!==last[0]||first[1]!==last[1])closed=false;
    for(const point of ring){
      coordinatePairs++;
      if(!Array.isArray(point)||point.length<2||!point.every(Number.isFinite)){finite=false;continue}
      minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);minY=Math.min(minY,point[1]);maxY=Math.max(maxY,point[1]);
    }
  }
  return{bbox:[minX,minY,maxX,maxY],center:[(minX+maxX)/2,(minY+maxY)/2],area:geometryArea(g),coordinatePairs,rings,closed,finite,multipart:polygons(g).length};
};
for(const feature of baseline.features)feature.properties={...feature.properties,area_code:code(feature)};
const baselineByCode=new Map(baseline.features.map(f=>[code(f),geometryStats(f.geometry)]));
const dir=await mkdtemp(join(tmpdir(),'pref-map-'));
try{
  const input=join(dir,'baseline.geojson'),output=join(dir,'candidate.geojson');
  await writeFile(input,JSON.stringify(baseline));
  execFileSync(process.platform==='win32'?'npx.cmd':'npx',[
    'mapshaper',input,'-explode','-simplify','resolution=24000','keep-shapes',
    '-o','format=geojson','precision=0.00001',output
  ],{stdio:'pipe'});
  const exploded=JSON.parse(await readFile(output));
  const grouped=new Map();
  for(const feature of exploded.features){
    const pref=code(feature),entry=grouped.get(pref)??{properties:{...feature.properties,area_code:pref},coordinates:[]};
    const parts=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
    entry.coordinates.push(...parts);grouped.set(pref,entry);
  }
  const candidate={type:'FeatureCollection',features:[...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,entry])=>({type:'Feature',properties:entry.properties,geometry:{type:'MultiPolygon',coordinates:entry.coordinates}}))};
  const out=Buffer.from(JSON.stringify(candidate));
  if(candidate.features.length!==47)throw new Error(`candidate features=${candidate.features.length}`);
  const baselineCodes=[...baseline.features.map(code)].sort(),candidateCodes=[...candidate.features.map(code)].sort();
  if(JSON.stringify(baselineCodes)!==JSON.stringify(candidateCodes))throw new Error('prefecture code set changed');

  const deviations=[];
  let coordinatePairs=0;
  for(const feature of candidate.features){
    const pref=code(feature),before=baselineByCode.get(pref),after=geometryStats(feature.geometry);
    if(!before||!after.finite||!after.closed||!after.coordinatePairs)throw new Error(`invalid candidate geometry: ${pref}`);
    const multipartRetention=after.multipart/before.multipart;
    const areaRelative=Math.abs(after.area-before.area)/Math.max(before.area,Number.EPSILON);
    const centerDegrees=Math.hypot(after.center[0]-before.center[0],after.center[1]-before.center[1]);
    const bboxDegrees=Math.max(...after.bbox.map((v,i)=>Math.abs(v-before.bbox[i])));
    deviations.push({pref,areaRelative,centerDegrees,bboxDegrees,multipartBefore:before.multipart,multipartAfter:after.multipart,multipartRetention,coordinatePairs:after.coordinatePairs});
    coordinatePairs+=after.coordinatePairs;
  }
  const worst=(key)=>[...deviations].sort((a,b)=>b[key]-a[key])[0];
  const limits={areaRelative:0.005,centerDegrees:0.002,bboxDegrees:0.002};
  for(const[key,limit]of Object.entries(limits)){
    const item=worst(key);
    if(item[key]>limit)throw new Error(`${key} exceeds limit: ${item.pref} ${item[key]} > ${limit}`);
  }
  const gz=gzipSync(out,{level:9}),baselineCompressed=bs.reduce((n,x)=>n+x.length,0);
  await writeFile('prefecture-map-candidate-B.geojson',out);
  await mkdir(join(process.cwd(),'public','data'),{recursive:true});
  await writeFile(join(process.cwd(),'public','data','prefecture-map-light.geojson'),out);
  console.log(JSON.stringify({
    pass:true,candidate:'B-resolution24000',features:47,
    uncompressedBytes:out.length,compressedBytes:gz.length,coordinateNumbers:coordinatePairs*2,
    baseline:{uncompressedBytes:raw.length,compressedBytes:baselineCompressed,coordinateNumbers:666722},
    ratios:{uncompressed:+(out.length/raw.length).toFixed(4),compressed:+(gz.length/baselineCompressed).toFixed(4),coordinates:+(coordinatePairs*2/666722).toFixed(4)},
    geometryAudit:{limits,worstAreaRelative:worst('areaRelative'),worstCenterDegrees:worst('centerDegrees'),worstBboxDegrees:worst('bboxDegrees'),lowestMultipartRetention:[...deviations].sort((a,b)=>a.multipartRetention-b.multipartRetention)[0],closed:47,finite:47},
    published:'public/data/prefecture-map-light.geojson'
  }));
}finally{
  await rm(dir,{recursive:true,force:true});
}
