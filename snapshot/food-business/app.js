import { normalize as norm, searchTerms, addressMatches, sourcesForArea, recommendedSource, sortRecords } from './search-logic.js';
const $ = id => document.getElementById(id);
const scopeText = {
  consenting_electronic_permits_and_notifications: '国のシステムで電子申請され、公開に同意した情報。管轄地域の全施設を網羅した名簿ではありません。',
  published_permit_registry: '自治体が公表した許可施設の一覧。公開対象の範囲は公式ページで確認できます。',
  fiscal_year_new_permits_and_notifications: '県型保健所が公表した年度内の新規許可・届出一覧。現在営業中の全施設一覧とは別の資料です。',
};
let catalog, selected, records = [], filtered = [], page = 0, generation = 0;
let areas = [], searchIndex = new Map(), loaded = false, initialBusiness = '';
let changes = null, changesLoading = false, changeLimit = 50;
const params = new URLSearchParams(location.search);
const setStatus = message => { $('status').textContent = message; };
function option(value, label) {
  const item = document.createElement('option'); item.value = value; item.textContent = label; return item;
}
function sourceLabel(source) {
  const type = source.parser === 'ifas' ? '国のシステム' : source.scope === 'published_permit_registry' ? '自治体独自の許可一覧' : '年度内の新規一覧';
  return `${source.publisher}（${type}）`;
}
function sourcePeriod(source) {
  return `${source.as_of ? `基準日：${source.as_of}` : `年度内新規（${source.period_start}以降）`}／保存日：${source.snapshot_id}`;
}
function comparisonButton(source) {
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.sourceId = source.source_id;
  button.setAttribute('aria-label', `${sourceLabel(source)}を選ぶ`);
  button.setAttribute('aria-controls', 'search-results');
  button.addEventListener('click', () => {
    $('source').value = source.source_id;
    chooseSource();
  });
  return button;
}
function markComparisonSelection() {
  for (const button of $('source-comparison').querySelectorAll('button[data-source-id]')) {
    const active = button.dataset.sourceId === selected?.source_id;
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? '選択中' : 'この公表元を選ぶ';
    if (active) button.closest('.source-center-details')?.setAttribute('open', '');
  }
}
function renderComparison(sources) {
  $('source-comparison').hidden = $('prefecture').value !== '05';
  $('comparison-main').replaceChildren(); $('comparison-centers').replaceChildren();
  if ($('source-comparison').hidden) return;
  const groups = [
    ['ifas-05000', '秋田県｜国のシステム', '県型保健所の管轄地域（秋田市を除く）。電子申請され、公開に同意した情報。'],
    ['ifas-05201', '秋田市｜国のシステム', '秋田市の管轄地域。電子申請され、公開に同意した情報。'],
    ['akita-city', '秋田市｜独自の許可一覧', '秋田市が独自に公表した許可一覧。届出は収録対象外。対象業種などは公式資料の範囲に限ります。'],
  ];
  for (const [id, label, scope] of groups) {
    const source = sources.find(s => s.source_id === id);
    if (!source) continue;
    const card = document.createElement('article'); card.className = 'source-card'; card.dataset.sourceId = source.source_id;
    const title = document.createElement('h3'); title.textContent = label;
    const count = document.createElement('p'); count.className = 'source-count';
    count.textContent = `掲載 ${source.record_count.toLocaleString('ja-JP')}件`;
    const kinds = document.createElement('p'); kinds.className = 'source-kinds';
    kinds.textContent = `許可 ${source.permit_count.toLocaleString('ja-JP')}件・届出 ${source.notification_count.toLocaleString('ja-JP')}件${source.scope === 'published_permit_registry' ? '（対象外）' : ''}`;
    const description = document.createElement('p'); description.textContent = scope;
    const period = document.createElement('p'); period.className = 'source-period'; period.textContent = sourcePeriod(source);
    if (catalog.acquisition_failures[source.source_id]) period.textContent += '／今回取得失敗のため前回保存版';
    card.append(title, count, kinds, description, period, comparisonButton(source));
    $('comparison-main').append(card);
  }
  const centers = sources.filter(s => s.scope === 'fiscal_year_new_permits_and_notifications');
  $('comparison-centers-title').textContent = `県型${centers.length}保健所の年度内新規一覧を比較する`;
  for (const source of centers) {
    const item = document.createElement('li'); item.dataset.sourceId = source.source_id;
    const title = document.createElement('h4'); title.textContent = source.publisher;
    const count = document.createElement('p');
    count.textContent = `掲載 ${source.record_count.toLocaleString('ja-JP')}件（許可 ${source.permit_count.toLocaleString('ja-JP')}件・届出 ${source.notification_count.toLocaleString('ja-JP')}件）`;
    const period = document.createElement('p'); period.className = 'source-period'; period.textContent = sourcePeriod(source);
    if (catalog.acquisition_failures[source.source_id]) period.textContent += '／今回取得失敗のため前回保存版';
    const info = document.createElement('div'); info.append(title, count, period);
    item.append(info, comparisonButton(source)); $('comparison-centers').append(item);
  }
}
function updateURL() {
  if (!selected) return;
  const url = new URL(location.href);
  url.searchParams.set('source', selected.source_id);
  for (const [key, id] of [['q','query'],['municipality','municipality'],['business','business'],['sort','sort']]) {
    const value = id === 'business' && !loaded ? $(id).value || initialBusiness : $(id).value;
    if (value && !(key === 'sort' && value === 'published')) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if ($('kind').value !== 'permit') url.searchParams.set('kind', $('kind').value); else url.searchParams.delete('kind');
  history.replaceState(null, '', url);
}
const fields = ['facility_name','facility_address','business_type','valid_from','valid_until','closed_on'];
const fieldLabels = {facility_name:'施設名',facility_address:'施設所在地',business_type:'営業の種類',valid_from:'許可開始日',valid_until:'許可満了日',closed_on:'掲載上の廃業日',permit_number:'許可番号',permit_date:'許可年月日',record_kind:'許可・届出区分',business_detail:'営業の詳細',first_permit_date:'初回許可年月日',application:'申請区分',notification_date:'届出年月日'};
const display = (record, field) => record?.[field] ? (field === 'record_kind' ? record[field] === 'permit' ? '許可' : '届出' : record[field]) : '—';
const pageSize = () => matchMedia('(max-width:650px)').matches ? 10 : 50;
function render() {
  const size = pageSize(), start = page * size;
  $('results').replaceChildren();
  for (const r of filtered.slice(start, start + size)) {
    const tr = document.createElement('tr');
    for (const f of fields) {
      const td = document.createElement('td'); td.dataset.label = fieldLabels[f];
      td.textContent = r[f] || (['facility_name','facility_address'].includes(f) ? '公表値なし' : '—');
      tr.append(td);
    }
    $('results').append(tr);
  }
  $('page').textContent = filtered.length ? `${start + 1}～${Math.min(start + size, filtered.length)}件 / ${filtered.length.toLocaleString('ja-JP')}件` : '該当する掲載情報はありません';
  $('previous').disabled = page === 0;
  $('next').disabled = start + size >= filtered.length;
  $('previous').textContent = `前の${size}件`; $('next').textContent = `次の${size}件`;
  $('download').disabled = filtered.length === 0;
  $('empty-note').hidden = !loaded || filtered.length > 0 || unsupportedKind();
}
function unsupportedKind() {
  return selected?.scope === 'published_permit_registry' && $('kind').value === 'notification';
}
function matchingPredicate() {
  const kind = $('kind').value, business = $('business').value, code = $('municipality').value;
  const terms = searchTerms($('query').value);
  const name = areas.find(([id]) => id === code)?.[1];
  const ambiguous = code && areas.filter(([id,label]) => id.startsWith(code.slice(0,2)) && label === name).length !== 1;
  const pref = $('prefecture').selectedOptions[0]?.textContent;
  return record => {
    if (!record || kind && record.record_kind !== kind || business && record.business_type !== business) return false;
    if (code && (ambiguous || !addressMatches(record.facility_address, name, pref))) return false;
    const text = searchIndex.get(record) ?? norm([record.facility_name,record.facility_address,record.business_type].join(' '));
    return terms.every(term => text.includes(term));
  };
}
function filter() {
  if (!selected || !loaded) return;
  filtered = sortRecords(records.filter(matchingPredicate()), $('sort').value);
  page = 0;
  const kind = $('kind').value;
  setStatus(unsupportedKind() ? `${selected.publisher}：この資料は届出情報を収録していません（対象外）。` : `${selected.publisher}：${kind === 'permit' ? '許可情報' : kind === 'notification' ? '届出情報' : '許可・届出情報'} ${filtered.length.toLocaleString('ja-JP')}件が該当します。`);
  render(); renderKindNote(); renderSourceGuidance(); updateURL(); renderChanges();
}
function renderKindNote() {
  const permitOnly = selected?.scope === 'published_permit_registry';
  $('kind').querySelector('option[value="notification"]').disabled = permitOnly;
  $('kind-note').hidden = !permitOnly;
  $('kind-note').classList.toggle('notice', unsupportedKind());
  $('kind-note').textContent = permitOnly ? 'この資料は許可情報のみ（届出は対象外）です。届出は「公表元と資料」で国のシステムを選んで検索できます。' : '';
}
function renderSourceGuidance() {
  const node = $('source-guidance'); node.replaceChildren();
  if (!selected) return;
  const sources = catalog.sources.filter(s => s.prefecture_code === $('prefecture').value);
  const candidates = sourcesForArea(sources, $('municipality').value, areas);
  const text = document.createElement('p');
  text.textContent = $('municipality').value ? '選んだ地域の資料を切り替える（資料ごとに収録範囲が異なります）' : '公表元を切り替えると、国と自治体独自の資料をそれぞれ検索できます。';
  node.append(text);
  const alternatives = candidates.filter(s => s.source_id !== selected.source_id &&
    ($('municipality').value || s.authority_code === selected.authority_code) &&
    s.scope !== 'fiscal_year_new_permits_and_notifications');
  const group = document.createElement('div'); group.className = 'source-options';
  for (const source of alternatives) {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = sourceLabel(source); button.dataset.sourceId = source.source_id;
    button.addEventListener('click', () => { $('source').value = source.source_id; chooseSource(); }); group.append(button);
  }
  if (group.children.length) node.append(group);
}
function setupChanges() {
  changes = null; changesLoading = false; changeLimit = pageSize();
  $('changes-results').replaceChildren(); $('changes-status').textContent = '';
  $('changes-controls').hidden = true; $('changes-more').hidden = true; $('changes-download').disabled = true;
  const summary = selected?.comparison || {status:'baseline'};
  const labels = {baseline:'初回保存です。次の比較可能な保存版から、掲載追加・掲載消失・記載変更を確認できます。',unchanged:'原本の内容は前回の保存版と一致しています。',incompatible:'基準日・対象年度・収録範囲などの比較条件が一致しないため、通常の掲載差分を表示しません。'};
  $('changes-title').textContent = '前回からの掲載変化';
  $('changes-note').textContent = labels[summary.status] || '';
  if (summary.status === 'compared') {
    const c = summary.counts;
    $('changes-title').textContent += `（追加${c.added.toLocaleString('ja-JP')}・消失${c.removed.toLocaleString('ja-JP')}・変更${c.changed.toLocaleString('ja-JP')}件）`;
    $('changes-note').textContent = `前回：${summary.before_as_of || summary.before_snapshot_id} → 今回：${summary.after_as_of || selected.snapshot_id}。同じ公表元・同じ収録範囲の掲載情報を比較しています。追加・消失は、開店・閉店の確認件数ではありません。`;
    if ($('changes-panel').open) loadChanges();
  }
}
async function loadChanges() {
  if (!selected || selected.comparison?.status !== 'compared' || changes !== null || changesLoading) return;
  const source = selected, ticket = generation; changesLoading = true;
  $('changes-status').textContent = '掲載変化を読み込んでいます。';
  try {
    const response = await fetch(`/analysis/food-business/${source.source_id}/${source.snapshot_id}/changes.json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json(), summary = source.comparison;
    if (ticket !== generation) return;
    if (payload.source_id !== source.source_id || payload.before !== summary.before_as_of || payload.after !== summary.after_as_of ||
        payload.after_count !== source.record_count || !Array.isArray(payload.changes)) throw new Error('比較資料の識別情報が一致しません');
    for (const kind of ['added','removed','changed']) {
      if (payload.changes.filter(c => c.change === kind).length !== summary.counts[kind]) throw new Error('比較資料の件数が一致しません');
    }
    if (payload.changes.some(c => !['added','removed','changed'].includes(c.change) ||
      c.change === 'added' && (!c.after || c.before) || c.change === 'removed' && (!c.before || c.after) ||
      c.change === 'changed' && (!c.before || !c.after))) throw new Error('比較資料の内容を確認できません');
    changes = payload.changes; $('changes-controls').hidden = false; renderChanges();
  } catch (error) {
    if (ticket === generation) $('changes-status').textContent = `掲載変化を読み込めませんでした。${error.message}。この公表元の記録をご確認ください。`;
  } finally { if (ticket === generation) changesLoading = false; }
}
function matchingChanges() {
  const matches = matchingPredicate();
  return (changes || []).filter(c => (!$('change-kind').value || c.change === $('change-kind').value) && (matches(c.before) || matches(c.after)));
}
function renderChanges() {
  if (changes === null) return;
  const rows = matchingChanges(); $('changes-results').replaceChildren();
  $('changes-status').textContent = `現在の検索条件に一致する掲載変化は${rows.length.toLocaleString('ja-JP')}件です。${rows.length > changeLimit ? `先頭${changeLimit}件を表示しています。` : ''}`;
  $('changes-download').disabled = rows.length === 0; $('changes-more').hidden = rows.length <= changeLimit; $('changes-more').textContent = `次の${pageSize()}件を表示`;
  for (const c of rows.slice(0,changeLimit)) {
    const article = document.createElement('article'); article.className = 'change-card';
    const title = document.createElement('h3'); title.textContent = `${{added:'掲載追加',removed:'掲載消失',changed:'記載変更'}[c.change]}：${(c.after || c.before).facility_name || '施設名の公表値なし'}`;
    article.append(title);
    const list = document.createElement('dl');
    const shown = [...new Set(['facility_address','business_type',...(c.fields || fields), 'permit_number'])].filter(f => fieldLabels[f]);
    for (const field of shown) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = fieldLabels[field];
      dd.textContent = `${display(c.before, field)} → ${display(c.after, field)}`; list.append(dt,dd);
    }
    article.append(list);
    if (c.permit_replacement_candidate) { const p = document.createElement('p'); p.textContent = '同名・同所在地・同業種の許可入替候補です。更新や開店・閉店の確認ではありません。'; article.append(p); }
    $('changes-results').append(article);
  }
}
async function chooseSource() {
  const ticket = ++generation; loaded = false;
  selected = catalog.sources.find(s => s.source_id === $('source').value);
  markComparisonSelection(); records = []; filtered = []; searchIndex = new Map(); page = 0; render();
  if (!selected) { setStatus('この地域で検索できる保存資料はありません。'); return; }
  const source = selected; renderKindNote(); renderSourceGuidance(); setupChanges();
  $('official').href = source.page; $('article').href = `/analysis/food-business/${source.source_id}/${source.snapshot_id}/`;
  $('source-note').textContent = `${source.as_of ? `基準日：${source.as_of}` : `年度内新規（${source.period_start}以降）`}／保存日：${source.snapshot_id}。${scopeText[source.scope]} 収録：許可${source.permit_count.toLocaleString('ja-JP')}件・届出${source.notification_count.toLocaleString('ja-JP')}件。`;
  if (catalog.acquisition_failures[source.source_id]) $('source-note').textContent += ' 今回の取得に失敗したため、前回の保存版を表示しています。';
  setStatus(`${source.publisher}の保存資料を読み込んでいます。`); updateURL();
  try {
    const response = await fetch(`/food-business/${source.data}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let body;
    if (bytes[0] === 31 && bytes[1] === 139) {
      if (!globalThis.DecompressionStream) throw new Error('このブラウザは圧縮データの読み込みに対応していません');
      body = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else body = new TextDecoder().decode(bytes);
    const payload = JSON.parse(body);
    if (ticket !== generation) return;
    if (payload.source.source_id !== source.source_id || payload.records.length !== source.record_count) throw new Error('保存資料の識別情報が一致しません');
    records = payload.records; searchIndex = new Map(records.map(r => [r,norm([r.facility_name,r.facility_address,r.business_type].join(' '))]));
    const wanted = $('business').value || initialBusiness; initialBusiness = '';
    const types = [...new Set(records.map(r => r.business_type).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ja'));
    $('business').replaceChildren(option('','すべての営業の種類'),...types.map(v=>option(v,v)));
    if (wanted) {
      if (!types.includes(wanted)) $('business').append(option(wanted,`${wanted}（この資料に掲載なし）`));
      $('business').value = wanted;
    }
    loaded = true; filter();
  } catch (error) {
    if (ticket !== generation) return;
    setStatus(`資料を読み込めませんでした。${error.message}。公式の公開ページ、または静的な記録をご確認ください。`);
  }
}
function choosePrefecture(desired, city = '') {
  const sources = catalog.sources.filter(s => s.prefecture_code === $('prefecture').value);
  $('source').replaceChildren(...sources.map(s => option(s.source_id, sourceLabel(s))));
  const cities = areas.filter(([code]) => code.startsWith($('prefecture').value));
  $('municipality').replaceChildren(option('','市区町村を指定しない'),...cities.map(([code,name]) => option(code,cities.filter(([,n])=>n===name).length>1 ? `${name}（${code}）` : name)));
  if (cities.some(([code]) => code === city)) $('municipality').value = city;
  if (sources.some(s => s.source_id === desired)) $('source').value = desired;
  else { const source = recommendedSource(sourcesForArea(sources, $('municipality').value, areas), $('kind').value); if (source) $('source').value = source.source_id; }
  $('business').replaceChildren(option('','すべての営業の種類'));
  renderComparison(sources); chooseSource();
}
function chooseMunicipality() {
  const sources = catalog.sources.filter(s=>s.prefecture_code === $('prefecture').value);
  const candidates = sourcesForArea(sources, $('municipality').value, areas);
  if (!candidates.some(s=>s.source_id === selected?.source_id)) {
    const source = recommendedSource(candidates,$('kind').value);
    if (source) { $('source').value = source.source_id; chooseSource(); return; }
  }
  filter();
}
function saveCSV(headers, rows, name) {
  const cell = value => { let s = String(value ?? ''); if (/^\s*[=+@-]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"','""')}"`; };
  const csv = '\ufeff' + [headers,...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function download() {
  const fields = ['facility_name','facility_address','business_type','record_kind','permit_number','permit_date','valid_from','valid_until','closed_on','source_row'];
  const headers = ['施設名','施設所在地','営業の種類','許可・届出区分','許可番号','許可年月日','許可開始日','許可満了日','廃業年月日','原表行'];
  saveCSV(headers,filtered.map(r=>fields.map(f=>f === 'record_kind' ? (r[f] === 'permit' ? '許可' : '届出') : r[f])),`food-business-${selected.source_id}-${selected.snapshot_id}.csv`);
}
function downloadChanges() {
  const fs = Object.keys(fieldLabels), summary = selected.comparison;
  const headers = ['公表元','前回保存日','今回保存日','変化',...fs.flatMap(f=>[`${fieldLabels[f]}（前）`,`${fieldLabels[f]}（後）`])];
  saveCSV(headers,matchingChanges().map(c=>[selected.publisher,summary.before_snapshot_id,selected.snapshot_id,{added:'掲載追加',removed:'掲載消失',changed:'記載変更'}[c.change],...fs.flatMap(f=>[c.before ? display(c.before,f) : '',c.after ? display(c.after,f) : ''])]),`food-business-changes-${selected.source_id}-${selected.snapshot_id}.csv`);
}
async function initialize() {
  try {
    const response = await fetch('/food-business/catalog.json',{cache:'no-cache'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
    try { const r = await fetch('/data/area-catalog.json'); if (!r.ok) throw new Error(); areas = await r.json(); }
    catch { $('municipality').disabled = true; $('search-help').textContent += ' 自治体一覧を読み込めないため、市区町村は検索語で指定してください。'; }
    const prefectures = new Map();
    for (const s of catalog.authority_inventory) if (s.publisher_type === 'prefecture') prefectures.set(s.prefecture_code,s.publisher);
    $('prefecture').replaceChildren(...[...prefectures].sort(([a],[b])=>a.localeCompare(b)).map(([v,label])=>option(v,label)));
    const wanted = catalog.sources.find(s=>s.source_id === params.get('source'));
    $('prefecture').value = wanted?.prefecture_code || '05'; $('query').value = params.get('q') || '';
    if (['','permit','notification'].includes(params.get('kind'))) $('kind').value = params.get('kind');
    if (['published','name','newest','expiry'].includes(params.get('sort'))) $('sort').value = params.get('sort');
    initialBusiness = params.get('business') || '';
    $('prefecture').addEventListener('change',()=>choosePrefecture());
    $('municipality').addEventListener('change',chooseMunicipality);
    $('source').addEventListener('change',chooseSource);
    for (const id of ['kind','business','sort']) $(id).addEventListener('change',filter);
    $('query').addEventListener('input',filter);
    $('previous').addEventListener('click',()=>{page--;render();}); $('next').addEventListener('click',()=>{page++;render();});
    $('download').addEventListener('click',download);
    $('clear-filters').addEventListener('click',()=>{ $('query').value = ''; $('municipality').value = ''; $('business').value = ''; filter(); });
    $('changes-panel').addEventListener('toggle',()=>{ if ($('changes-panel').open) loadChanges(); });
    $('change-kind').addEventListener('change',()=>{changeLimit = pageSize();renderChanges();});
    $('changes-more').addEventListener('click',()=>{changeLimit += pageSize();renderChanges();});
    $('changes-download').addEventListener('click',downloadChanges);
    choosePrefecture(wanted?.source_id,params.get('municipality') || '');
  } catch (error) { setStatus(`公表元の一覧を読み込めませんでした。${error.message}`); }
}
initialize();
