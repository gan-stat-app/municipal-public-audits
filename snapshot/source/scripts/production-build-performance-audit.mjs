import{readFile}from'node:fs/promises';
import{gzipSync}from'node:zlib';
import{resolve}from'node:path';

const production='https://municipal-smr.jp/';
const htmlResponse=await fetch(production,{headers:{'cache-control':'no-cache'}});
if(!htmlResponse.ok)throw new Error(`production index: ${htmlResponse.status}`);
const productionHtml=await htmlResponse.text();

function assets(html){
  const script=html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1]
    ??html.match(/<script[^>]+src=["']([^"']+\.js)["']/i)?.[1];
  const style=html.match(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/i)?.[1]
    ??html.match(/<link[^>]+href=["']([^"']+\.css)["'][^>]+rel=["']stylesheet["']/i)?.[1];
  if(!script||!style)throw new Error('main script or stylesheet not found');
  return{script,style};
}
const productionAssets=assets(productionHtml);
const fetchBytes=async path=>{
  const response=await fetch(new URL(path,production));
  if(!response.ok)throw new Error(`${path}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const [productionJs,productionCss]=await Promise.all([
  fetchBytes(productionAssets.script),fetchBytes(productionAssets.style)
]);

const dist=resolve('dist');
const reconstructedHtml=await readFile(resolve(dist,'index.html'),'utf8');
const reconstructedAssets=assets(reconstructedHtml);
const localBytes=path=>readFile(resolve(dist,new URL(path,production).pathname.replace(/^\//,'')));
const [reconstructedJs,reconstructedCss]=await Promise.all([
  localBytes(reconstructedAssets.script),localBytes(reconstructedAssets.style)
]);

const measure=(html,js,css)=>{
  const files={html:Buffer.byteLength(html),js:js.length,css:css.length};
  const gzip={html:gzipSync(html,{level:9}).length,js:gzipSync(js,{level:9}).length,css:gzipSync(css,{level:9}).length};
  return{files,gzip,totalBytes:Object.values(files).reduce((a,b)=>a+b,0),totalGzipBytes:Object.values(gzip).reduce((a,b)=>a+b,0)};
};
const oldBuild=measure(productionHtml,productionJs,productionCss);
const newBuild=measure(reconstructedHtml,reconstructedJs,reconstructedCss);
const ratio=+(newBuild.totalGzipBytes/oldBuild.totalGzipBytes).toFixed(4);
const baseline=productionAssets.script.includes('/assets/formal-app-')?'legacy-production':'reconstructed-production';
if(baseline==='legacy-production'&&ratio>=1)throw new Error(`reconstructed initial app gzip ratio must be below legacy production, got ${ratio}`);
if(baseline==='reconstructed-production'&&ratio>1.1)throw new Error(`initial app gzip regressed more than 10% from reconstructed production, got ${ratio}`);
console.log(JSON.stringify({
  pass:true,
  baseline,
  scope:'initial HTML + main module + main stylesheet; lazy data and learning assets excluded',
  production:{assets:productionAssets,...oldBuild},
  reconstructed:{assets:reconstructedAssets,...newBuild},
  ratios:{total:+(newBuild.totalBytes/oldBuild.totalBytes).toFixed(4),gzip:ratio},
  caveat:'This build-transfer audit does not replace browser measurements of paint, interaction latency, or long tasks.'
}));
