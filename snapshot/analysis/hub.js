/* Progressive enhancement: the existing HTML remains the article registry. */
(() => {
  const main = document.querySelector('main');
  const controls = document.querySelector('.hub-controls');
  if (!main || !controls) return;
  const pref = document.getElementById('prefecture-cause-title')?.closest('section');
  const links = [...main.querySelectorAll('.articlelist > a')].filter(a => !pref?.contains(a));
  const labels = ['すべて', '死亡・寿命', '医療・病院', '介護・福祉', '生活習慣', '学校保健', '人口・その他'];
  const classify = a => {
    const t = a.textContent;
    if (a.getAttribute('href') === '/analysis/site-overview/') return labels[6];
    if (/むし歯|洗口|学校/.test(t)) return labels[5];
    if (/生活保護|介護給付|介護保険|認定率/.test(t)) return labels[3];
    if (/LDL|HDL|eGFR|中性脂肪|歩数|野菜|食塩|喫煙|飲酒/.test(t)) return labels[4];
    if (/NDB|DPC|医療|病院|病床|診療|算定|患者|精神保健|通報|手術|歯科|薬局|施設基準/.test(t)) return labels[2];
    if (/死亡|死因|寿命|SMR/.test(t)) return labels[1];
    return labels[6];
  };
  const grid = document.createElement('div'); grid.className = 'articlelist hub-results'; grid.id = 'hub-results';
  const seen = new Set();
  const records = links.filter(a => {
    const key = a.getAttribute('href'); if(seen.has(key)) { a.remove(); return false; }
    seen.add(key); return true;
  }).map(a => {
    const category = classify(a), text = (a.textContent + ' ' + (a.dataset.keywords || '')).normalize('NFKC').toLowerCase();
    const badge = document.createElement('small'); badge.className = 'hub-tag'; badge.textContent = category;
    a.prepend(badge); grid.append(a); return {a, category, text};
  });
  // Remove emptied registry wrappers, leaving other content and generator markers intact.
  main.querySelectorAll('.articlelist').forEach(el => { if (!el.children.length) {
    const section = el.closest('section'); if(section && section !== pref) section.remove(); else el.remove();
  }});
  if(pref) {
    pref.classList.add('hub-pref');
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = '47都道府県から選ぶ'; details.append(summary);
    const list = pref.querySelector('.articlelist'); details.append(list); pref.append(details);
    main.querySelector('#hub-search').after(pref);
  }
  const anchor = pref || main.querySelector('#hub-search'); anchor.after(grid);
  const empty = document.createElement('p'); empty.className='hub-empty'; empty.textContent='一致する記事がありません。キーワードを短くするか、条件をクリアしてください。'; grid.after(empty);
  const input = document.getElementById('article-query'), filters = document.getElementById('hub-filters');
  let selected = labels[0];
  const buttons = labels.map(label => {
    const b = document.createElement('button'); b.type='button'; b.textContent=label;
    b.setAttribute('aria-controls','hub-results'); b.addEventListener('click',() => {selected=label; render();}); filters.append(b); return b;
  });
  function render() {
    const words = input.value.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
    let count=0;
    for(const r of records) {r.a.hidden=!(selected===labels[0] || r.category===selected) || !words.every(w=>r.text.includes(w)); if(!r.a.hidden) count++;}
    buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.textContent===selected)));
    empty.hidden=count!==0;
    document.getElementById('hub-count').textContent=`${count}件の記事${words.length?'（検索結果）':''} ／ 全${records.length}件 · 都道府県別記事は上の地域選択から`;
    if(pref) {
      const prefLinks=[...pref.querySelectorAll('.articlelist a')];
      const allow=selected===labels[0] || selected===labels[1];
      prefLinks.forEach(a=>a.hidden=!allow || !words.every(w=>a.textContent.normalize('NFKC').toLowerCase().includes(w)));
      pref.hidden=!prefLinks.some(a=>!a.hidden);
      if(words.length && !pref.hidden) pref.querySelector('details').open=true;
      if(!pref.hidden) empty.hidden=true;
    }
  }
  input.addEventListener('input',render);
  document.getElementById('hub-reset').addEventListener('click',()=>{input.value='';selected=labels[0];if(pref)pref.querySelector('details').open=false;render();input.focus();});
  controls.hidden=false; render();
})();

