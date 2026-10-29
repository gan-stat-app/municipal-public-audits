(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const initial = new URLSearchParams(location.search);
  let data, filtered = [], limit = 100;
  const sexName = () => $('sex').value === 'male' ? '男性' : '女性';
  const fixed = n => Number(n).toFixed(1) + '年';
  const delta = n => (n > 0 ? '+' : '') + Number(n).toFixed(data.year === 2015 ? 2 : 4) + '年';
  function option(value, label) { const el = document.createElement('option'); el.value = value; el.textContent = label; return el; }
  function localRows() { return data.rows.filter(r => $('pref').value === 'all' || r.pref === $('pref').value); }
  function setAreas(preferred) {
    const rs = localRows();
    $('area').replaceChildren(...rs.map(r => option(r.code, `${data.prefectures[r.pref]} ${r.name}`)));
    $('area').value = rs.some(r => r.code === preferred) ? preferred : rs[0].code;
  }
  function saveURL() {
    const u = new URL(location.href); u.search = '';
    for (const key of ['year', 'pref', 'sex', 'area']) u.searchParams.set(key, $(key).value);
    if ($('search').value) u.searchParams.set('q', $('search').value);
    history.replaceState(null, '', u);
  }
  function renderSelected() {
    const r = data.rows.find(r => r.code === $('area').value), v = r[$('sex').value];
    $('condition').textContent = `${data.year}年 · ${data.prefectures[r.pref]} ${r.name} · ${sexName()} · 独自推計と公式値`;
    $('estimate').textContent = fixed(v.estimate);
    $('official').textContent = fixed(v.official);
    $('difference').textContent = delta(v.difference);
    $('exception').hidden = !v.fallback;
    $('exception').textContent = v.fallback ? 'この値は独自の例外補完の影響を受けます。一部の年齢で通常式に入力できないセルがあるため、地域の推定を補完しています。国と同じ例外処理だとは確認できていません。' + (v.invalidAges.length ? ` この自治体で直接該当する年齢階級の始年齢：${v.invalidAges.join('、')}歳。` : ' この自治体に直接の入力異常があることを意味しません。') : '';
    saveURL();
  }
  function renderTable(reset = false) {
    if (reset) limit = 100;
    const query = $('search').value.trim().normalize('NFKC');
    filtered = localRows().filter(r => `${data.prefectures[r.pref]} ${r.name}`.normalize('NFKC').includes(query));
    const scope = $('pref').value === 'all' ? '全国の市区町村' : data.prefectures[$('pref').value];
    $('tableCondition').textContent = `${data.year}年 · ${scope} · ${sexName()} · 独自推計と公式値`;
    const body = document.createDocumentFragment();
    for (const r of filtered.slice(0, limit)) {
      const v = r[$('sex').value], tr = document.createElement('tr'), td = document.createElement('td'), btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'area-button'; btn.setAttribute('aria-pressed', String(r.code === $('area').value));
      btn.append(document.createTextNode(r.name));
      const small = document.createElement('small'); small.textContent = data.prefectures[r.pref]; btn.append(small);
      btn.addEventListener('click', () => { $('area').value = r.code; renderSelected(); for (const b of $('rows').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn)); });
      td.append(btn); tr.append(td);
      for (const text of [fixed(v.estimate), fixed(v.official), delta(v.difference), v.fallback ? 'あり（独自補完）' : 'なし']) { const cell = document.createElement('td'); cell.textContent = text; tr.append(cell); }
      body.append(tr);
    }
    $('rows').replaceChildren(body);
    $('status').textContent = filtered.length ? `${filtered.length.toLocaleString()}市区町村中 ${Math.min(limit, filtered.length).toLocaleString()}件を表示` : '該当する市区町村はありません。都道府県や検索語を変更してください。';
    $('more').hidden = filtered.length <= limit;
    saveURL();
  }
  const cache = new Map();
  function setLoading(loading) {
    for (const id of ['year','pref','sex','area','search','more']) $(id).disabled = loading;
  }
  async function loadYear(year, preferences) {
    setLoading(true);
    $('status').className = '';
    $('status').textContent = `${year}年のデータを読み込んでいます…`;
    $('rows').replaceChildren();
    for (const id of ['nationalSummary2020','nationalSummary2015']) $(id).hidden = true;
    for (const id of ['csvDownload','kitDownload']) $(id).removeAttribute('href');
    for (const id of ['officialSource','differenceSource','yearNote','tableNote']) $(id).textContent = '';
    for (const id of ['estimate','official','difference']) $(id).textContent = '—';
    $('condition').textContent = `${year}年 · 読み込み中`;
    $('tableCondition').textContent = `${year}年 · 読み込み中`;
    $('exception').hidden = true;
    $('more').hidden = true;
    try {
      if (!cache.has(year)) {
        const res = await fetch(`./data/estimates-${year}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const incoming = await res.json();
        if (incoming.year !== year || incoming.rows.length !== (year === 2020 ? 1887 : 1888)) throw new Error('対象データを確認できませんでした');
        cache.set(year, incoming);
      }
      data = cache.get(year);
      $('year').value = String(year);
      $('pref').replaceChildren(option('all', '全国の市区町村'), ...Object.entries(data.prefectures).sort(([a], [b]) => a.localeCompare(b)).map(([code, name]) => option(code, name)));
      const alias = year === 2015 ? {'04216':'04423','40231':'40305'} : {'04423':'04216','40305':'40231'};
      const preferred = alias[preferences.area] || preferences.area;
      const area = data.rows.find(r => r.code === preferred);
      $('pref').value = preferences.pref === 'all' || data.prefectures[preferences.pref] ? preferences.pref : area?.pref || '05';
      $('sex').value = preferences.sex === 'female' ? 'female' : 'male';
      $('search').value = preferences.q || '';
      setAreas(area?.code || '05201');
      $('officialSource').textContent = year === 2015 ? '2015年参考値（2020年方式・小数1桁）' : '2020年市区町村別生命表';
      $('differenceSource').textContent = year === 2015 ? '独自推計 − 小数1桁の公式参考値' : '独自推計 − 公表T₀/l₀';
      $('yearNote').textContent = year === 2015 ? '2015年の比較対象は2020年方式の公式参考値です。参考値は小数1桁のため最大約±0.05年の丸め幅があり、差を2020年の高精度な比較と同列に扱えません。人口には遡及不詳補完結果を使用しています。地域名・境界は2015年当時で、年をまたぐ同一地域の比較は保証しません。' : '2020年の差は丸め前の独自推計と公表T₀/l₀から計算しています。表示した2値が同じでも、差がゼロとは限りません。地域名・境界は各年当時です。';
      $('tableNote').textContent = year === 2015 ? '自治体コード順。独自推計・公式参考値は小数第1位、差は丸め前の推計と小数1桁の公式参考値から計算し小数第2位で表示しています。差には公式参考値の丸めが含まれます。' : '自治体コード順。独自推計・公式値は小数第1位、差は丸め前の独自推計と公表T₀/l₀から計算しています。';
      $('nationalSummary2020').hidden = year !== 2020;
      $('nationalSummary2015').hidden = year !== 2015;
      $('csvDownload').href = `./data/comparison-${year}.csv`;
      $('kitDownload').href = year === 2015 ? './data/reproduction-kit-2015.zip' : './data/reproduction-kit.zip';
      setLoading(false);
      renderSelected(); renderTable(true);
    } catch (error) {
      $('status').className = 'error';
      $('status').textContent = `${year}年のデータを読み込めませんでした。時間をおいて再読み込みしてください。`;
      $('year').disabled = false;
      console.error(error);
    }
  }
  $('year').addEventListener('change', () => loadYear(Number($('year').value), {pref:$('pref').value, sex:$('sex').value, area:$('area').value, q:$('search').value}));
  $('pref').addEventListener('change', () => { setAreas($('area').value); renderSelected(); renderTable(true); });
  $('sex').addEventListener('change', () => { renderSelected(); renderTable(); });
  $('area').addEventListener('change', () => { renderSelected(); renderTable(); });
  $('search').addEventListener('input', () => renderTable(true));
  $('more').addEventListener('click', () => { limit += 100; renderTable(); });
  loadYear(initial.get('year') === '2015' ? 2015 : 2020, Object.fromEntries(initial));
})();
