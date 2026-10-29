import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root='dist',textExtensions=new Set(['.html','.js','.css','.json','.svg','.xml','.txt']);
async function files(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())out.push(...await files(path));
    else if(textExtensions.has(extname(entry.name)))out.push(path);
  }
  return out;
}
const checks=[
  ['external script',/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi],
  ['external stylesheet',/<link\b(?=[^>]*\brel\s*=\s*["'][^"']*stylesheet)[^>]*\bhref\s*=\s*["']https?:\/\//gi],
  ['external image',/<img\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi],
  ['external frame',/<iframe\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi],
  ['external fetch',/\bfetch\s*\(\s*["']https?:\/\//g],
  ['external websocket',/\bnew\s+(?:WebSocket|EventSource)\s*\(\s*["']https?:\/\//g]
];
const violations=[],absoluteOrigins=new Set();
for(const path of await files(root)){
  const text=await readFile(path,'utf8'),name=relative(root,path);
  for(const [kind,re] of checks)for(const match of text.matchAll(re))violations.push({file:name,kind,sample:match[0].slice(0,160)});
  for(const match of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi))absoluteOrigins.add(match[1].toLowerCase());
}
if(violations.length)throw new Error(JSON.stringify({pass:false,violations},null,2));
console.log(JSON.stringify({pass:true,filesScanned:(await files(root)).length,runtimeExternalReferences:0,absoluteOrigins:[...absoluteOrigins].sort()}));
