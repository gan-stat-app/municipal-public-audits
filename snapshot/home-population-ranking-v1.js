(function(){
  const target=document.getElementById('home-population-ranking');
  if(!target)return;
  const rankingSection=target.closest('.home-population-ranking');
  function placeBeforePublicInfo(){
    const publicInfo=document.getElementById('public-information');
    if(!rankingSection||!publicInfo||rankingSection.nextElementSibling===publicInfo)return Boolean(publicInfo);
    publicInfo.before(rankingSection);
    return true;
  }
  if(!placeBeforePublicInfo()){
    const root=document.getElementById('root');
    if(root){const placementObserver=new MutationObserver(()=>{if(placeBeforePublicInfo())placementObserver.disconnect()});placementObserver.observe(root,{childList:true,subtree:true})}
  }
  const parts={historical:Array.from({length:9},(_,i)=>`/population/historical-${String(i).padStart(2,'0')}.part`),future:Array.from({length:3},(_,i)=>`/population/future-${String(i).padStart(2,'0')}.part`)};
  let mode='rate',rows=null,started=false;
  async function load(kind){
    const buffers=await Promise.all(parts[kind].map(url=>fetch(url).then(response=>{if(!response.ok)throw Error('人口データを取得できません');return response.arrayBuffer()})));
    const size=buffers.reduce((sum,buffer)=>sum+buffer.byteLength,0),all=new Uint8Array(size);let offset=0;
    for(const buffer of buffers){all.set(new Uint8Array(buffer),offset);offset+=buffer.byteLength}
    const stream=new Blob([all]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  function calculate(historical,future){
    const actual=new Map(),projected=new Map();
    for(const row of historical.rows||[]){if(/^\d{5}$/.test(row[1])&&!row[1].endsWith('000')&&(row[0]===2023||row[0]===2024)){const key=`${row[1]}|${row[0]}`;actual.set(key,(actual.get(key)||0)+(Number(row[3])||0))}}
    for(const row of future.rows||[]){if(/^\d{5}$/.test(row[1])&&!row[1].endsWith('000')&&[2020,2025,2050].includes(row[0])){const key=`${row[1]}|${row[0]}`;projected.set(key,(projected.get(key)||0)+(Number(row[3])||0))}}
    const areas=new Map((historical.areas||future.areas||[]).filter(area=>/^\d{5}$/.test(area[0])&&!area[0].endsWith('000')).map(area=>[area[0],area])),result=[];
    for(const [code,area] of areas){const p23=actual.get(`${code}|2023`),p24=actual.get(`${code}|2024`),o20=projected.get(`${code}|2020`),o25=projected.get(`${code}|2025`),o50=projected.get(`${code}|2050`);if(!p23||p24==null||!o20||!o25||!o50)continue;const annual=(p24-p23)/p23,official=Math.pow(o25/o20,1/5)-1,ratio=(1+annual)/(1+official),revised=o50*Math.pow(ratio,5),difference=revised-o50,rate=difference/o50*100;if(Number.isFinite(rate)&&Number.isFinite(difference))result.push({code,name:`${area[1]} ${area[2]}`,revised,difference,rate})}
    return result;
  }
  const signed=(value,digits=0)=>`${value>0?'+':''}${Number(value).toLocaleString('ja-JP',{minimumFractionDigits:digits,maximumFractionDigits:digits})}`;
  function render(){
    const ordered=positive=>rows.filter(row=>positive?row.difference>0:row.difference<0).sort((a,b)=>positive?b[mode]-a[mode]:a[mode]-b[mode]).slice(0,10);
    const list=items=>`<ol>${items.map(row=>`<li><a href="/population/?area=${row.code}"><span>${row.name}</span><strong>${signed(mode==='rate'?row.rate:row.difference,mode==='rate'?1:0)}${mode==='rate'?'%':'人'}</strong></a><small>割合差 ${signed(row.rate,1)}%／人数差 ${signed(row.difference)}人／補正後 ${Math.round(row.revised).toLocaleString('ja-JP')}人</small></li>`).join('')}</ol>`;
    target.className='';target.innerHTML=`<div class="home-ranking-heading"><div><p class="portal-kicker">全国市区町村の参考比較</p><h2 id="home-population-ranking-title">直近傾向補正後2050年人口ランキング</h2></div><div class="home-ranking-switch" role="group" aria-label="ランキング基準"><button type="button" data-home-ranking="rate" class="${mode==='rate'?'active':''}" aria-pressed="${mode==='rate'}">割合差で見る</button><button type="button" data-home-ranking="difference" class="${mode==='difference'?'active':''}" aria-pressed="${mode==='difference'}">人数差で見る</button></div></div><p class="home-ranking-definition">社人研2050年人口と比べた補正差です。順位基準を切り替えても、割合差と人数差を併記します。</p><div class="home-ranking-columns"><article><h3>上方補正となった自治体</h3>${list(ordered(true))}</article><article><h3>下方補正となった自治体</h3>${list(ordered(false))}</article></div><p class="home-ranking-note">2023～2024年の単年変化と社人研の2020～2025年想定との差を、2025年以降5年間だけ反映した参考順位です。小規模自治体では一時的な変動の影響が大きくなります。</p><a class="home-ranking-detail" href="/population/">人口動態と将来見通しで詳しく見る →</a>`;
  }
  target.addEventListener('click',event=>{const button=event.target.closest('[data-home-ranking]');if(!button||button.dataset.homeRanking===mode)return;mode=button.dataset.homeRanking;render()});
  async function start(){if(started)return;started=true;target.querySelector('p:last-child').textContent='ランキングを読み込んでいます…';try{const [historical,future]=await Promise.all([load('historical'),load('future')]);rows=calculate(historical,future);render()}catch(error){target.querySelector('p:last-child').innerHTML='ランキングを読み込めませんでした。<a href="/population/">人口ページで確認してください。</a>'}}
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();start()}},{rootMargin:'500px'});observer.observe(target)}else start();
})();
