(function(){
  const population=document.getElementById('portal-population-link'),populationPage=document.getElementById('portal-population-page-link'),smr=document.getElementById('portal-smr-link');
  if(!population||!smr)return;
  function syncLinks(){
    const current=new URLSearchParams(location.search).get('area'),selected=/^\d{5}$/.test(current||'')?current:null,query=selected?`?area=${encodeURIComponent(selected)}`:'';
    population.href=`/${query}#population-pyramid`;
    if(populationPage)populationPage.href=`/population/${query}`;
    smr.href=`/${query}#standardized-mortality`;
  }
  syncLinks();
  function moveToSection(hash,{updateUrl=true,behavior}={}){
    const id=String(hash||'').replace(/^#/,'');
    if(!['population-pyramid','standardized-mortality'].includes(id))return false;
    let target=document.getElementById(id);
    if(!target&&id==='population-pyramid'){
      const heading=[...document.querySelectorAll('.app-shell h2')].find(node=>node.textContent.trim()==='人口ピラミッド'||node.textContent.includes('　2024年'));
      target=heading?.closest('section')||null;
      if(target){target.id='population-pyramid';target.tabIndex=-1}
    }
    if(!target)return false;
    if(updateUrl)history.pushState(null,'',`${location.pathname}${location.search}#${id}`);
    target.scrollIntoView({behavior:behavior||(matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'),block:'start'});
    target.focus({preventScroll:true});
    target.classList.remove('portal-arrival');
    requestAnimationFrame(()=>target.classList.add('portal-arrival'));
    setTimeout(()=>target.classList.remove('portal-arrival'),1800);
    return true;
  }
  function activatePortalLink(event){
    syncLinks();
    const link=event.currentTarget,url=new URL(link.href,location.href);
    if(url.pathname!==location.pathname)return;
    event.preventDefault();
    const selectedUrlArea=url.searchParams.get('area'),currentArea=new URLSearchParams(location.search).get('area');
    const scroll=()=>moveToSection(url.hash);
    if(selectedUrlArea&&selectedUrlArea!==currentArea){
      history.pushState(null,'',`${url.pathname}${url.search}${url.hash}`);
      location.reload();
      return;
    }
    if(!scroll()){
      let attempts=0;
      const timer=setInterval(()=>{attempts+=1;if(scroll()||attempts>=40)clearInterval(timer)},50);
    }
  }
  [population,smr].forEach(link=>link.addEventListener('click',activatePortalLink));
  if(populationPage)populationPage.addEventListener('click',syncLinks);
  addEventListener('popstate',syncLinks);
  document.querySelectorAll('.portal-nav a[href^="#"]').forEach(link=>link.addEventListener('click',activatePortalLink));
  if(location.hash==='#population-pyramid'||location.hash==='#standardized-mortality'){
    const initialHash=location.hash;
    let interrupted=false;
    // Initial deep links may need to wait for lazy content, but must not move focus after use begins.
    const interrupt=()=>{interrupted=true};
    ['pointerdown','keydown','wheel','touchstart'].forEach(type=>addEventListener(type,interrupt,{capture:true,once:true,passive:true}));
    [0,100,300,700,1400,2800,4500].forEach((delay,index)=>setTimeout(()=>{
      const active=document.activeElement,target=document.getElementById(initialHash.slice(1));
      if(interrupted||location.hash!==initialHash||(active&&active!==document.body&&active!==document.documentElement&&active!==target))return;
      moveToSection(initialHash,{updateUrl:false,behavior:index===0?'smooth':'auto'});
    },delay));
  }
})();
