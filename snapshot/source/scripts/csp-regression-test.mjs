import assert from'node:assert/strict';
import{createHash}from'node:crypto';
import{readdir,readFile}from'node:fs/promises';
import{extname,join}from'node:path';

async function files(dir,extensions){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await files(p,extensions));else if(extensions.has(extname(e.name)))out.push(p)}return out}
const jsxFiles=await files('src',new Set(['.jsx']));
for(const path of jsxFiles){const text=await readFile(path,'utf8');assert(!text.includes('style='),`${path}: inline React style remains`)}
const transparency=await readFile('public/transparency/index.html','utf8');
assert(!/<style\b/i.test(transparency),'transparency inline style block remains');
assert(!/\sstyle\s*=/i.test(transparency),'transparency inline style attribute remains');
assert(transparency.includes('/transparency/transparency.css'),'transparency stylesheet missing');
const learning=await readFile('public/learning/index.html','utf8');
const jsonLd=learning.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
assert(jsonLd,'learning JSON-LD missing');
const hash=`sha256-${createHash('sha256').update(jsonLd).digest('base64')}`;
const headers=await readFile('public/_headers','utf8'),[rootBlock,learningTail]=headers.split('/learning/*');
assert(rootBlock.includes("style-src 'self';"),'root style-src is not strict');
assert(!rootBlock.includes("'unsafe-inline'"),'root CSP permits unsafe-inline');
assert(rootBlock.includes(`script-src 'self' '${hash}'`),'JSON-LD CSP hash mismatch');
assert(learningTail.includes("style-src 'self' 'unsafe-inline'"),'learning exception missing');
const learningJs=await readFile('public/assets/learning-app.js','utf8');
assert(!learningJs.includes('eval(')&&!learningJs.includes('new Function('),'learning bundle requires unsafe-eval');
console.log(JSON.stringify({pass:true,jsxFiles:jsxFiles.length,inlineReactStyles:0,rootStylePolicy:"self",learningStyleException:true,jsonLdHash:hash,unsafeEval:false}));
