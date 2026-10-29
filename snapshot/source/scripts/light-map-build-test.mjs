import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const files=[['dist/data/municipality-map-light.geojson',1800],['dist/data/prefecture-map-light.geojson',47]];
const assets=[];
for(const [path,min] of files){
  const s=await stat(path);
  const geo=JSON.parse(await readFile(path,'utf8'));
  if(geo?.type!=='FeatureCollection'||!Array.isArray(geo.features)||geo.features.length<min)throw new Error(`${path}: invalid features ${geo?.features?.length}`);
  if(path.includes('prefecture')&&geo.features.length!==47)throw new Error(`${path}: expected 47`);
  const codes=new Set(geo.features.map(f=>String(f?.properties?.area_code??f?.properties?.code??f?.properties?.N03_007??'')).filter(Boolean));
  for(const c of path.includes('municipality')?['05201','01101','13101','47201']:[])if(!codes.has(c))throw new Error(`${path}: missing ${c}`);
  assets.push({path,bytes:s.size,features:geo.features.length,codes:codes.size});
}

const learningHtml=await readFile('dist/learning/index.html','utf8');
const learningJs=await stat('dist/assets/learning-app.js');
const learningCss=await stat('dist/assets/index-C3QxqwF7.css');
await stat('dist/favicon.svg');
if(!learningHtml.includes('id="learning-root"'))throw new Error('dist/learning/index.html: learning root missing');
if(!learningHtml.includes('/assets/learning-app.js'))throw new Error('dist/learning/index.html: learning app reference missing');
if(learningJs.size<200000)throw new Error('dist/assets/learning-app.js: unexpectedly small');
if(learningCss.size<40000)throw new Error('dist/assets/index-C3QxqwF7.css: unexpectedly small');

const builtJs=(await readdir('dist/assets')).filter(name=>/^index-.*\.js$/.test(name));
if(!builtJs.length)throw new Error('dist/assets: main application bundle missing');
const appText=(await Promise.all(builtJs.map(name=>readFile(`dist/assets/${name}`,'utf8')))).join('\n');
for(const required of['利用規約','プライバシーポリシー','contact@municipal-smr.jp'])if(!appText.includes(required))throw new Error(`main application: missing ${required}`);
for(const forbidden of['ソース復元・数値照合用画面','正式公開版ではありません','source reconstruction'])if(appText.includes(forbidden))throw new Error(`main application: release-blocking marker remains: ${forbidden}`);
const indexHtml=await readFile('dist/index.html','utf8');
for(const required of['人口ピラミッド × 地域保健データラボ｜任意期間標準化死亡比・地域統計','<link rel="canonical" href="https://municipal-smr.jp/"','property="og:image"','name="twitter:card"','type="application/ld+json"'])if(!indexHtml.includes(required))throw new Error(`dist/index.html: missing production metadata: ${required}`);
for(const forbidden of['source reconstruction','正式公開版ではありません'])if(indexHtml.includes(forbidden))throw new Error(`dist/index.html: release-blocking marker remains: ${forbidden}`);
const homeJsonLd=indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
if(!homeJsonLd)throw new Error('dist/index.html: JSON-LD missing');
const homeJsonLdHash=`sha256-${createHash('sha256').update(homeJsonLd).digest('base64')}`;
const headers=await readFile('dist/_headers','utf8');
for(const required of['X-Content-Type-Options: nosniff','Referrer-Policy: strict-origin-when-cross-origin','Permissions-Policy: camera=(), microphone=(), geolocation=()','X-Frame-Options: SAMEORIGIN'])if(!headers.includes(required))throw new Error(`dist/_headers: missing ${required}`);
if(!headers.includes(`'${homeJsonLdHash}'`))throw new Error(`dist/_headers: homepage JSON-LD CSP hash missing: ${homeJsonLdHash}`);

console.log(JSON.stringify({pass:true,assets,learning:{path:'dist/learning/index.html',appBytes:learningJs.size,cssBytes:learningCss.size},publicInfo:{terms:true,privacy:true,contact:true},productionMetadata:{canonical:true,openGraph:true,twitter:true,jsonLd:true,jsonLdHash:homeJsonLdHash,releaseMarkers:0},securityHeaders:4}));
