(async function(){
 const $=id=>document.getElementById(id), yen=new Intl.NumberFormat('ja-JP',{maximumFractionDigits:0});
 const els={scheme:$('scheme'),year:$('year'),pref:$('pref'),city:$('city'),category:$('category')};
 const meta=await fetch('/medical-cost/data/medical-cost-meta.json').then(r=>{if(!r.ok)throw Error('医療費データの索引を読み込めませんでした');return r.json()});
 const history={meta,series:{nhi:{},elderly:{}}}, loadedHistory=new Set();
 const labels=meta.categories, state={scheme:'nhi',year:2023,category:0,pref:'秋田県',code:'05201',name:'秋田市'}, cache={}, pct=n=>`${n>=0?'+':''}${n.toFixed(1)}%`;
 let annual=null, loadId=0;
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function years(){return meta.schemeYears[state.scheme]}
 function setYears(){const ys=years().slice().reverse();if(!ys.includes(state.year))state.year=ys[0];els.year.innerHTML=ys.map(y=>`<option value="${y}"${y===state.year?' selected':''}>${y}年度</option>`).join('')}
 async function compressedJson(path){const t=await fetch(path).then(r=>{if(!r.ok)throw Error('圧縮データを読み込めませんでした');return r.text()}),bytes=Uint8Array.from(atob(t.trim()),c=>c.charCodeAt(0)),stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return new Response(stream).json()}
 async function loadYear(){const id=++loadId;annual=cache[state.year]||(cache[state.year]=await compressedJson(`/medical-cost/data/medical-cost-${state.year}.json.gz.b64`));if(id!==loadId)return false;return true}
 async function loadHistory(scheme){if(loadedHistory.has(scheme))return;const parts=scheme==='nhi'?['2008-2011','2012-2015','2016-2019','2020-2023']:['2015-2019','2020-2023'];const ds=await Promise.all(parts.map(p=>compressedJson(`/medical-cost/data/medical-cost-history-${scheme}-${p}.json.gz.b64`)));for(const d of ds)for(const [k,v] of Object.entries(d.series))history.series[scheme][k]=(history.series[scheme][k]||[]).concat(v);loadedHistory.add(scheme)}
 function rows(){return annual.records[state.scheme]||[]}
 function setPrefs(){const ps=[...new Set(rows().map(r=>r.pref))];if(!ps.includes(state.pref))state.pref=ps[0];els.pref.innerHTML=ps.map(p=>`<option${p===state.pref?' selected':''}>${esc(p)}</option>`).join('')}
 function setCities(){const rs=rows().filter(r=>r.pref===state.pref);let hit=rs.find(r=>r.code&&r.code===state.code)||rs.find(r=>r.name===state.name);if(!hit)hit=rs[0];state.code=hit?.code||'';state.name=hit?.name||'';els.city.innerHTML=rs.map((r,i)=>`<option value="${i}"${r===hit?' selected':''}>${esc(r.name)}</option>`).join('')}
 function selected(){const rs=rows().filter(r=>r.pref===state.pref);return rs[Number(els.city.value)]||rs.find(r=>(r.code&&r.code===state.code)||r.name===state.name)||rs[0]}
 function ranking(){return rows().filter(r=>r.index[state.category]!=null).slice().sort((a,b)=>b.index[state.category]-a.index[state.category])}
 function rankList(target,rs){target.innerHTML=rs.map((r,i)=>`<li><span class="rank-num">${i+1}</span><span class="rank-place"><b>${esc(r.name)}</b><small>${esc(r.pref)}</small></span><span class="rank-value">${r.index[state.category].toFixed(3)}</span></li>`).join('')}
 function dotplot(row){
  const vals=row.index.filter(Number.isFinite), lo=Math.min(.8,...vals)-.02, hi=Math.max(1.2,...vals)+.02, x=v=>125+(v-lo)/(hi-lo)*520;
  const ticks=Array.from({length:5},(_,i)=>lo+(hi-lo)*i/4);
  const axis=ticks.map(v=>`<line x1="${x(v)}" y1="24" x2="${x(v)}" y2="188" stroke="#dce7e4"/><text x="${x(v)}" y="210" text-anchor="middle" font-size="11" fill="#61777b">${v.toFixed(2)}</text>`).join('');
  const marks=labels.map((lab,i)=>{const y=48+i*39,v=row.index[i],active=i===state.category;return `<text x="8" y="${y+4}" font-size="13" font-weight="800" fill="#17313a">${lab}</text><line x1="125" y1="${y}" x2="645" y2="${y}" stroke="#e7efed"/><circle cx="${x(v)}" cy="${y}" r="${active?8:6}" fill="${active?'#d17b27':'#287d91'}"/><text x="665" y="${y+4}" font-size="12" font-weight="800" fill="#17313a">${v.toFixed(3)}（${pct((v-1)*100)}）</text>`}).join('');
  $('index-dotplot').innerHTML=`<svg viewBox="0 0 790 220" role="img" aria-label="診療区分別の年齢調整後地域差指数">${axis}<line x1="${x(1)}" y1="20" x2="${x(1)}" y2="190" stroke="#176b5d" stroke-width="2"/><text x="${x(1)}" y="15" text-anchor="middle" font-size="11" font-weight="800" fill="#176b5d">全国=1</text>${marks}</svg>`;
  $('cost-table').innerHTML=labels.map((lab,i)=>`<div class="cost-cell"><span>${lab}</span><b>${yen.format(row.cost[i])}円／人</b><small>${row.ratio[i]==null?'対全国比：当該表に未収録':`実額の全国比 ${row.ratio[i].toFixed(3)}`}</small></div>`).join('')
 }
 function seriesFor(row){const byCode=row.code&&history.series[state.scheme][row.code];return byCode||history.series[state.scheme][`${row.pref}|${row.name}`]||[]}
 function lineChart(target,points,valueIndex,kind){
  if(!points.length){target.innerHTML='<p class="chart-note">同一地域として接続できる経年値がありません。</p>';return}
  const W=600,H=270,L=62,R=18,T=22,B=42, allYears=years(), minY=Math.min(...allYears),maxY=Math.max(...allYears), vals=points.map(p=>p[valueIndex]).filter(Number.isFinite);
  let lo=Math.min(...vals),hi=Math.max(...vals);if(kind==='index'){lo=Math.min(lo,1);hi=Math.max(hi,1)}const pad=(hi-lo||1)*.15;lo-=pad;hi+=pad;
  const x=y=>L+(y-minY)/(maxY-minY)*(W-L-R), y=v=>T+(hi-v)/(hi-lo)*(H-T-B);
  let d='';points.forEach((p,i)=>{const gap=i&&p[0]-points[i-1][0]>1;d+=`${i===0||gap?'M':'L'}${x(p[0]).toFixed(1)},${y(p[valueIndex]).toFixed(1)} `});
  const yt=Array.from({length:4},(_,i)=>lo+(hi-lo)*i/3).map(v=>`<line x1="${L}" y1="${y(v)}" x2="${W-R}" y2="${y(v)}" stroke="#e3ebe9"/><text x="${L-7}" y="${y(v)+4}" text-anchor="end" font-size="10" fill="#61777b">${kind==='cost'?yen.format(v):v.toFixed(2)}</text>`).join('');
  const xt=allYears.filter((_,i)=>i%3===0||i===allYears.length-1).map(v=>`<text x="${x(v)}" y="${H-15}" text-anchor="middle" font-size="10" fill="#61777b">${v}</text>`).join('');
  const base=kind==='index'?`<line x1="${L}" y1="${y(1)}" x2="${W-R}" y2="${y(1)}" stroke="#176b5d" stroke-width="2"/>`:'';
  const dots=points.map(p=>`<circle cx="${x(p[0])}" cy="${y(p[valueIndex])}" r="3.5" fill="#287d91"><title>${p[0]}年度 ${kind==='cost'?yen.format(p[valueIndex])+'円':p[valueIndex].toFixed(3)}</title></circle>`).join('');
  target.innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${kind==='cost'?'1人当たり実績医療費':'地域差指数'}の経年推移">${yt}${base}<path d="${d}" fill="none" stroke="#287d91" stroke-width="3"/>${dots}${xt}</svg>`
 }
 function render(){
  const row=selected();if(!row)return;state.code=row.code||'';state.name=row.name;const idx=row.index[state.category],sorted=ranking(),rank=sorted.findIndex(r=>(r.code&&r.code===row.code)||r===row)+1;
  $('year-badge').textContent=`${state.year}年度`;$('selection-label').textContent=`${row.pref} ${row.name}｜${meta.schemes[state.scheme]}｜${labels[state.category]}｜${state.year}年度`;
  $('metric-index').textContent=idx.toFixed(3);$('metric-index-note').textContent=idx>1?'全国平均より高い':idx<1?'全国平均より低い':'全国平均と同じ';$('metric-diff').textContent=pct((idx-1)*100);$('metric-cost').textContent=`${yen.format(row.cost[state.category])}円`;$('metric-rank').textContent=`${rank}位`;$('metric-rank-note').textContent=`高い順／${sorted.length}公表単位`;
  dotplot(row);$('ranking-context').textContent=`${state.year}年度・${meta.schemes[state.scheme]}・${labels[state.category]}`;rankList($('rank-high'),sorted.slice(0,5));rankList($('rank-low'),sorted.slice(-5).reverse());
  const ser=seriesFor(row), relevant=ser.filter(p=>Number.isFinite(p[5+state.category]));lineChart($('index-trend'),relevant,5+state.category,'index');lineChart($('cost-trend'),relevant,1+state.category,'cost');$('trend-period').textContent=relevant.length?`${relevant[0][0]}～${relevant.at(-1)[0]}年度・${relevant.length}点`:'経年値なし';$('trend-note').textContent=`${row.pref} ${row.name}の公表名称・行政コードが確認できた年度だけを表示します。欠測年は線を結びません。実績医療費は名目額です。`;
  const u=new URL(location.href);u.searchParams.set('scheme',state.scheme);u.searchParams.set('year',state.year);if(row.code)u.searchParams.set('area',row.code);else u.searchParams.delete('area');u.searchParams.set('category',state.category);window.history.replaceState(null,'',u)
 }
 async function refresh(keepArea=true){if(!keepArea){state.code='';state.name=''}await loadHistory(state.scheme);if(!await loadYear())return;if(state.code){const hit=rows().find(r=>r.code===state.code);if(hit){state.pref=hit.pref;state.name=hit.name}}setPrefs();setCities();render()}
 const q=new URLSearchParams(location.search);if(['nhi','elderly'].includes(q.get('scheme')))state.scheme=q.get('scheme');const qy=Number(q.get('year'));if(years().includes(qy))state.year=qy;if(/^[0-9]{5}$/.test(q.get('area')||''))state.code=q.get('area');if(['0','1','2','3'].includes(q.get('category')))state.category=Number(q.get('category'));
 els.scheme.value=state.scheme;els.category.value=state.category;setYears();await refresh();
 els.scheme.addEventListener('change',async()=>{state.scheme=els.scheme.value;setYears();await refresh()});els.year.addEventListener('change',async()=>{state.year=Number(els.year.value);await refresh()});els.pref.addEventListener('change',()=>{state.pref=els.pref.value;setCities();render()});els.city.addEventListener('change',()=>render());els.category.addEventListener('change',()=>{state.category=Number(els.category.value);render()});
})().catch(err=>document.querySelector('main').insertAdjacentHTML('afterbegin',`<p class="availability">${err.message}</p>`));
