(() => {
  const IDS = [
    "emergency_management",
    "cancer_outpatient_chemo",
    "cancer_radiotherapy_management",
    "stroke_hyperacute",
    "ami_pci",
    "mental_specialized_therapy",
    "stroke_rehabilitation",
    "convalescent_rehab_ward",
    "long_term_care_ward",
  ];
  const YEARS = [2024, 2023, 2022, 2021, 2020, 2019];
  const METRIC_COUNTS = { 2024: 13544, 2023: 12388, 2022: 12273, 2021: 11392, 2020: 11162, 2019: 10555 };
  const ERA_YEARS = { 2024: "令和6年度", 2023: "令和5年度", 2022: "令和4年度", 2021: "令和3年度", 2020: "令和2年度", 2019: "令和元年度" };
  const NDB_RELEASES = { 2024: 11, 2023: 10, 2022: 9, 2021: 8, 2020: 7, 2019: 6 };
  const METHODS = {
    emergency_management: [
      "救急",
      "救急医療管理",
      "「救急医療管理加算」で始まる診療行為を合計。乳幼児・小児固有加算は除外。",
      "救急入院の医療提供量の代理指標。",
    ],
    cancer_outpatient_chemo: [
      "がん",
      "外来がん薬物療法",
      "外来腫瘍化学療法診療料のうち、抗悪性腫瘍剤を投与した場合を合計。",
      "外来がん薬物療法の提供量。",
    ],
    cancer_radiotherapy_management: [
      "がん",
      "放射線治療管理",
      "「放射線治療管理料」で始まる診療行為を合計。",
      "放射線治療機能の地域的集中を見る指標。",
    ],
    stroke_hyperacute: [
      "脳卒中",
      "超急性期脳卒中診療",
      "「超急性期脳卒中加算」で始まる診療行為を合計。",
      "超急性期脳卒中治療の提供実績。",
    ],
    ami_pci: [
      "心疾患",
      "急性心筋梗塞PCI",
      "急性心筋梗塞に対する経皮的冠動脈形成術とステント留置術を合計。",
      "急性心筋梗塞に対するPCI実績。",
    ],
    mental_specialized_therapy: [
      "精神",
      "精神科専門療法",
      "精神科専門療法料のうち、加算表を除く外来・入院の診療行為を合計。",
      "異なる精神科療法を合算した提供量。",
    ],
    stroke_rehabilitation: [
      "リハビリ",
      "脳血管疾患等リハビリ",
      "「脳血管疾患等リハビリテーション料」で始まる診療行為を合計。",
      "脳血管疾患等へのリハビリ提供量の概算。",
    ],
    convalescent_rehab_ward: [
      "リハビリ",
      "回復期リハビリ病棟",
      "「回復期リハビリテーション病棟入院料」で始まる診療行為を合計。",
      "回復期リハビリ病棟の入院医療提供量。",
    ],
    long_term_care_ward: [
      "療養",
      "療養病棟",
      "「療養病棟入院料」で始まる診療行為を合計。",
      "療養病棟の入院医療提供量。",
    ],
  };
  const COLORS = ["#dceff1", "#abd8dc", "#73bbc1", "#378f99", "#12626d"],
    PROXY = ["#b76b63", "#e6aaa1", "#eee9df", "#90c3bd", "#287b78"],
    EL = (id) => document.getElementById(id);
  const state = {
    data: null,
    year: 2024,
    catalog: null,
    surface: "featured",
    scope: "area",
    mode: "count",
    metric: "stroke_hyperacute",
    area: "0504",
    pref: "秋田県",
    allMetric: null,
    chunks: new Map(),
  };
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>\"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const gzjson = async (url) => {
    const r = await fetch(url + ".gz");
    if (!r.ok) throw new Error(`データ取得エラー ${r.status}`);
    const stream = r.body.pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  };
  const dataRoot = () => state.year === 2024 ? "/ndb/service-volume/data" : `/ndb/service-volume/data/years/${state.year}`;
  const availableIds = () => IDS.filter((id) => state.data?.metrics?.[id]);
  const q = (a, p) => {
    const i = (a.length - 1) * p,
      l = Math.floor(i),
      f = i - l;
    return a[l + 1] === undefined ? a[l] : a[l] + f * (a[l + 1] - a[l]);
  };
  const bounds = (entities) => {
    const n = entities.flatMap((e) =>
        e.paths.flatMap((p) => (p.match(/-?\d+(?:\.\d+)?/g) || []).map(Number)),
      ),
      x = n.filter((_, i) => i % 2 === 0),
      y = n.filter((_, i) => i % 2);
    const a = Math.min(...x),
      b = Math.max(...x),
      c = Math.min(...y),
      d = Math.max(...y),
      px = Math.max(2, (b - a) * 0.1),
      py = Math.max(2, (d - c) * 0.1);
    return [a - px, c - py, b - a + 2 * px, d - c + 2 * py];
  };
  const fmt = (n) =>
    Number(n).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const legend = (palette, cuts, proxy = false) =>
    `<div class="legend-title">${proxy ? "参考指数" : "算定回数（公表分下限値）"}による5段階</div><div class="legend-scale">${palette.map((c, i) => `<span class="legend-item"><i class="swatch swatch-${proxy ? "proxy" : "count"}-${i}"></i><small>${i === 0 ? `${fmt(cuts[0])}以下` : i === 4 ? `${fmt(cuts[3])}超` : `${fmt(cuts[i - 1])}超～${fmt(cuts[i])}以下`}</small></span>`).join("")}</div><p class="legend-note">表示中の地域を20・40・60・80パーセンタイルで区切った相対的な色分けです。色だけで指標間の大きさは比較できません。</p>`;
  const aggregate = (areas) => {
    const metrics = {};
    availableIds().forEach((id) => {
      const v = areas.map((a) => a.metrics[id]);
      metrics[id] = {
        value: v.reduce((s, x) => s + (x.value || 0), 0),
        published_lower_bound: v.reduce(
          (s, x) => s + x.published_lower_bound,
          0,
        ),
        is_complete: v.every((x) => x.is_complete),
        suppressed_component_count: v.reduce(
          (s, x) => s + x.suppressed_component_count,
          0,
        ),
        unit: v[0].unit,
      };
    });
    return metrics;
  };
  function entities() {
    if (state.scope === "area")
      return state.data.areas.map((a) => ({ ...a, paths: [a.path] }));
    if (state.scope === "detail")
      return state.data.areas
        .filter((a) => a.prefecture === state.pref)
        .map((a) => ({ ...a, paths: [a.path] }));
    const m = new Map();
    state.data.areas.forEach((a) =>
      m.set(a.code.slice(0, 2), [...(m.get(a.code.slice(0, 2)) || []), a]),
    );
    return [...m].map(([code, a]) => ({
      code,
      name: a[0].prefecture,
      prefecture: a[0].prefecture,
      paths: a.map((x) => x.path),
      metrics: aggregate(a),
    }));
  }
  function setupRegions() {
    const prefs = [...new Set(state.data.areas.map((a) => a.prefecture))];
    EL("prefecture").innerHTML = prefs
      .map((p) => `<option>${p}</option>`)
      .join("");
    EL("prefecture").value = state.pref;
    updateAreas();
    const ids = availableIds();
    if (!ids.includes(state.metric)) state.metric = ids[0];
    EL("metric").innerHTML = ids.map(
      (id) => `<option value="${id}">${METHODS[id][1]}</option>`,
    ).join("");
    EL("metric").value = state.metric;
  }
  function updateAreas() {
    const a = state.data.areas.filter((x) => x.prefecture === state.pref);
    EL("area").innerHTML = a
      .map((x) => `<option value="${x.code}">${x.name}医療圏</option>`)
      .join("");
    if (!a.some((x) => x.code === state.area)) state.area = a[0].code;
    EL("area").value = state.area;
  }
  function measure(e) {
    const v = e.metrics[state.metric];
    if (state.mode === "count") return v.value;
    const n = state.data.areas.reduce(
        (s, a) => s + (a.metrics[state.metric].value || 0),
        0,
      ),
      b = state.data.areas.reduce(
        (s, a) => s + (a.metrics.emergency_management.value || 0),
        0,
      ),
      base = e.metrics.emergency_management.value;
    if (
      !["stroke_hyperacute", "ami_pci"].includes(state.metric) ||
      !v.value ||
      !base
    )
      return null;
    return v.value / n / (base / b);
  }
  function choose(e) {
    state.area =
      state.scope === "prefecture"
        ? (
            state.data.areas.find((a) => a.prefecture === e.prefecture) ||
            state.data.areas[0]
          ).code
        : e.code;
    state.pref = e.prefecture;
    EL("prefecture").value = state.pref;
    updateAreas();
    render();
  }
  function svg(el, ents, valueFn, selectedCode) {
    const vals = ents
        .map(valueFn)
        .filter((v) => v !== null)
        .sort((a, b) => a - b),
      cuts = [0.2, 0.4, 0.6, 0.8].map((p) => q(vals, p)),
      palette = state.mode === "proxy" ? PROXY : COLORS,
      tokyo = state.scope === "detail" && state.pref === "東京都",
      main = tokyo ? ents.filter((e) => e.code !== "1313") : ents,
      island = tokyo ? ents.find((e) => e.code === "1313") : null;
    el.setAttribute(
      "viewBox",
      (state.scope === "detail" ? bounds(main) : state.data.viewBox).join(" "),
    );
    el.innerHTML = `<defs><pattern id="suppressed" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#e6e8e8"/><line x1="0" y1="0" x2="0" y2="8" stroke="#a5acad" stroke-width="2"/></pattern></defs>`;
    main.forEach((e) =>
      e.paths.forEach((p) => {
        const v = valueFn(e),
          path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        let b = 0;
        while (v !== null && b < cuts.length && v > cuts[b]) b++;
        path.setAttribute("d", p);
        path.setAttribute("fill", v === null ? "url(#suppressed)" : palette[b]);
        path.setAttribute(
          "class",
          `region${e.code === selectedCode ? " selected" : ""}`,
        );
        path.innerHTML = `<title>${esc(e.name)}</title>`;
        path.addEventListener("click", () => choose(e));
        el.append(path);
      }),
    );
    const pane = el.parentElement;
    pane.querySelector(".tokyo-inset")?.remove();
    if (island) {
      const box = document.createElement("div");
      box.className = "tokyo-inset";
      box.innerHTML = `<strong>島しょ</strong><svg viewBox="${bounds([island]).join(" ")}" role="img" aria-label="東京都 島しょ医療圏"></svg>`;
      const inset = box.querySelector("svg");
      island.paths.forEach((p) => {
        const path = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path",
          ),
          v = valueFn(island);
        let b = 0;
        while (v !== null && b < cuts.length && v > cuts[b]) b++;
        path.setAttribute("d", p);
        path.setAttribute("fill", v === null ? "#e6e8e8" : palette[b]);
        path.setAttribute(
          "class",
          `region${island.code === selectedCode ? " selected" : ""}`,
        );
        path.addEventListener("click", () => choose(island));
        inset.append(path);
      });
      pane.append(box);
    }
    return { palette, cuts };
  }
  function renderFeatured() {
    const ents = entities(),
      selected =
        ents.find(
          (e) =>
            e.code ===
            (state.scope === "prefecture"
              ? state.area.slice(0, 2)
              : state.area),
        ) || ents[0],
      v = selected.metrics[state.metric],
      m = measure(selected),
      ranked = ents
        .filter((e) => measure(e) !== null)
        .sort((a, b) => measure(b) - measure(a)),
      rank = ranked.findIndex((e) => e.code === selected.code) + 1,
      map = svg(EL("featured-map"), ents, measure, selected.code);
    EL("featured-legend").innerHTML = legend(
      map.palette,
      map.cuts,
      state.mode === "proxy",
    );
    const scope = state.scope === "detail" ? `${state.pref}内` : "全国";
    EL("featured-detail").innerHTML =
      `<p>${esc(selected.prefecture)}</p><h2>${esc(selected.name)}${state.scope === "prefecture" ? "" : "医療圏"}</h2><p>${esc(METHODS[state.metric][1])}</p>${m === null ? "<p>算定回数を表示できません</p>" : state.mode === "count" ? `<div class="value">${Number(v.value).toLocaleString()}${v.is_complete ? "" : "以上"}<small>${esc(v.unit)}</small></div>${v.is_complete ? "" : `<p class="lower">秘匿${v.suppressed_component_count}項目を含む公表分下限値</p>`}` : `<div class="value">${m.toFixed(2)}<small>全国=1</small></div><p><strong>${m >= 1.1 ? "広域集患の可能性" : m <= 0.9 ? "域外依存の可能性" : "おおむね均衡"}</strong></p>`}<p class="rank">${scope} 参考 <strong>${rank}</strong> 位／${ranked.length}${state.scope === "prefecture" ? "都道府県" : "医療圏"}</p><p>地図上の地域を選ぶと表示が変わります。</p>`;
    EL("reading").innerHTML =
      state.mode === "proxy"
        ? "<strong>広域集患可能性指数：</strong>専門医療の全国シェアを救急医療管理の全国シェアで割った相対指標です。患者移動の実測値ではありません。"
        : "<strong>概算表示：</strong>秘匿を含む地域も公表部分の合計（下限値）で色分けします。正確な患者数ではありません。";
  }
  function renderDetails() {
    const ents = entities(),
      s =
        ents.find(
          (e) =>
            e.code ===
            (state.scope === "prefecture"
              ? state.area.slice(0, 2)
              : state.area),
        ) || ents[0],
      query = EL("detail-query").value.toLowerCase();
    EL("detail-table").innerHTML =
      `<table class="metric-table"><thead><tr><th>指標</th><th>公表分</th><th>参考順位</th><th>計算方法・読み方</th></tr></thead><tbody>${availableIds().filter(
        (id) => METHODS[id].join(" ").toLowerCase().includes(query),
      )
        .map((id) => {
          const v = s.metrics[id],
            rank =
              [...ents]
                .sort(
                  (a, b) =>
                    (b.metrics[id].value || 0) - (a.metrics[id].value || 0),
                )
                .findIndex((e) => e.code === s.code) + 1;
          return `<tr><td><small>${METHODS[id][0]}</small><br><strong>${METHODS[id][1]}</strong></td><td>${Number(v.value).toLocaleString()}${v.is_complete ? "" : "以上"}<br><small>${v.is_complete ? "完全値" : `下限値（秘匿${v.suppressed_component_count}項目）`}</small></td><td>参考${rank}位／${ents.length}</td><td>${METHODS[id][2]}<br><small>${METHODS[id][3]}</small></td></tr>`;
        })
        .join("")}</tbody></table>`;
  }
  async function loadCatalog() {
    if (state.catalog) return;
    state.catalog = await gzjson(`${dataRoot()}/all-metrics/index.json`);
    EL("catalog-status").textContent =
      `${state.catalog.total.toLocaleString()}指標を収録`;
    EL("category").innerHTML = '<option value="all">すべての分野</option>' + state.catalog.categories
      .map(
        (c) =>
          `<option value="${c.id}">${c.label}（${c.count.toLocaleString()}）</option>`,
      )
      .join("");
    renderResults();
  }
  function renderResults() {
    if (!state.catalog) return;
    const cat = EL("category").value,
      query = EL("query").value.trim().toLowerCase(),
      rows = state.catalog.metrics
        .filter(
          (m) =>
            (cat === "all" || m.category === cat) &&
            (!query ||
              `${m.name} ${m.code} ${m.context}`.toLowerCase().includes(query)),
        )
        .slice(0, 200);
    EL("result-count").textContent = `${rows.length}件を表示（最大200件）`;
    EL("results").innerHTML = rows
      .map(
        (m) =>
          `<button data-id="${m.id}" data-cat="${m.category}" class="${state.allMetric?.id === m.id ? "active" : ""}"><span>${esc(state.catalog.categories.find((c) => c.id === m.category)?.label)}</span><strong>${esc(m.name)}</strong><small>${esc(m.code)}　${esc(m.context)}</small></button>`,
      )
      .join("");
    EL("results")
      .querySelectorAll("button")
      .forEach(
        (b) => (b.onclick = () => selectAll(b.dataset.cat, b.dataset.id)),
      );
  }
  async function selectAll(cat, id) {
    let chunk = state.chunks.get(cat);
    if (!chunk) {
      const meta = state.catalog.categories.find((c) => c.id === cat),
        files = meta.files || [meta.file],
        parts = await Promise.all(
          files.map((f) => gzjson(`${dataRoot()}/all-metrics/${f}`)),
        );
      chunk = { metrics: parts.flatMap((p) => p.metrics) };
      state.chunks.set(cat, chunk);
    }
    state.allMetric = chunk.metrics.find((m) => m.id === id);
    renderResults();
    renderAllMap();
  }
  function renderAllMap() {
    const m = state.allMetric;
    if (!m) return;
    const rows = state.data.areas.map((area, index) => ({ area, index }));
    let ents;
    if (state.scope === "prefecture") {
      const groups = new Map();
      rows.forEach((x) =>
        groups.set(x.area.code.slice(0, 2), [
          ...(groups.get(x.area.code.slice(0, 2)) || []),
          x,
        ]),
      );
      ents = [...groups].map(([code, x]) => ({
        code,
        name: x[0].area.prefecture,
        prefecture: x[0].area.prefecture,
        paths: x.map((y) => y.area.path),
        value: x.reduce((s, y) => s + m.values[y.index], 0),
        suppressed: x.some((y) => m.suppressed.includes(y.index)),
      }));
    } else
      ents = rows
        .filter(
          (x) => state.scope !== "detail" || x.area.prefecture === state.pref,
        )
        .map((x) => ({
          ...x.area,
          paths: [x.area.path],
          value: m.values[x.index],
          suppressed: m.suppressed.includes(x.index),
        }));
    const selectedCode =
        state.scope === "prefecture" ? state.area.slice(0, 2) : state.area,
      selected = ents.find((e) => e.code === selectedCode) || ents[0],
      vals = ents.map((e) => e.value).sort((a, b) => a - b),
      cuts = [0.2, 0.4, 0.6, 0.8].map((p) => q(vals, p)),
      color = (e) => {
        let b = 0;
        while (b < cuts.length && e.value > cuts[b]) b++;
        return COLORS[b];
      },
      rank =
        vals
          .slice()
          .sort((a, b) => b - a)
          .findIndex((v) => v === selected.value) + 1,
      unit = state.scope === "prefecture" ? "都道府県" : "医療圏",
      scope = state.scope === "detail" ? state.pref + "内" : "全国",
      tokyo = state.scope === "detail" && state.pref === "東京都",
      main = tokyo ? ents.filter((e) => e.code !== "1313") : ents,
      island = tokyo ? ents.find((e) => e.code === "1313") : null;
    EL("all-map-card").innerHTML =
      `<h2>${esc(m.name)}</h2><p>${esc(m.code)}　${esc(m.context)}</p><div class="map-layout"><div class="map-pane"><svg id="all-map" class="map"></svg><div class="legend">${legend(COLORS, cuts)}</div></div><aside class="detail"><p>${esc(selected.prefecture)}</p><h2>${esc(selected.name)}${state.scope === "prefecture" ? "" : "医療圏"}</h2><div class="value">${Number(selected.value).toLocaleString()}${selected.suppressed ? "以上" : ""}<small>算定回数</small></div><p class="rank">${scope} 参考 <strong>${rank}</strong> 位／${ents.length}${unit}</p>${selected.suppressed ? '<p class="lower">秘匿値を含む公表分下限値</p>' : ""}</aside></div>`;
    const el = EL("all-map");
    el.setAttribute(
      "viewBox",
      (state.scope === "detail" ? bounds(main) : state.data.viewBox).join(" "),
    );
    main.forEach((e) =>
      e.paths.forEach((path) => {
        const p = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        p.setAttribute("d", path);
        p.setAttribute("fill", color(e));
        p.setAttribute(
          "class",
          `region${e.code === selected.code ? " selected" : ""}`,
        );
        p.addEventListener("click", () => choose(e));
        el.append(p);
      }),
    );
    if (island) {
      const box = document.createElement("div");
      box.className = "tokyo-inset";
      box.innerHTML = `<strong>島しょ</strong><svg viewBox="${bounds([island]).join(" ")}" role="img" aria-label="東京都 島しょ医療圏"></svg>`;
      const inset = box.querySelector("svg");
      island.paths.forEach((path) => {
        const p = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        p.setAttribute("d", path);
        p.setAttribute("fill", color(island));
        p.setAttribute(
          "class",
          `region${island.code === selected.code ? " selected" : ""}`,
        );
        p.addEventListener("click", () => choose(island));
        inset.append(p);
      });
      el.parentElement.append(box);
    }
  }
  function render() {
    document
      .querySelectorAll("[data-scope]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.scope === state.scope),
      );
    document
      .querySelectorAll("[data-mode]")
      .forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === state.mode),
      );
    const proxy = document.querySelector('[data-mode="proxy"]');
    proxy.disabled = !["stroke_hyperacute", "ami_pci"].includes(state.metric);
    if (proxy.disabled && state.mode === "proxy") state.mode = "count";
    renderFeatured();
    renderDetails();
    renderAllMap();
  }
  function syncYearUrl() {
    const url = new URL(location.href);
    url.searchParams.set("year", state.year);
    url.searchParams.set("pref", state.pref);
    url.searchParams.set("area", state.area);
    history.replaceState(null, "", url);
  }
  function renderYearTabs() {
    document.querySelectorAll("#year-tabs [data-year]").forEach((button) => {
      const selected = Number(button.dataset.year) === state.year;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.onclick = () => {
        if (!selected) switchYear(Number(button.dataset.year));
      };
    });
    const era = ERA_YEARS[state.year];
    const featuredCount = availableIds().length;
    EL("current-year-status").textContent = `${era}レセプト（${state.data.period}）`;
    EL("year-note").textContent = `第${NDB_RELEASES[state.year]}回NDBオープンデータ。年度固有のコード・名称と秘匿を保持しています。${featuredCount < 9 ? "外来腫瘍化学療法診療料は当時未収載のため、代表指標は8項目です。" : ""}`;
    EL("featured-count").textContent = `代表${featuredCount}指標`;
    EL("all-metric-count").textContent = `${METRIC_COUNTS[state.year].toLocaleString()}指標を検索・地図化`;
  }
  async function switchYear(year) {
    if (!YEARS.includes(year)) return;
    state.year = year;
    state.catalog = null;
    state.chunks = new Map();
    state.allMetric = null;
    EL("catalog-status").textContent = "指標索引を読み込んでいます…";
    EL("results").innerHTML = "";
    EL("result-count").textContent = "";
    EL("all-map-card").innerHTML = '<div class="empty"><strong>指標を選択してください</strong><p>検索結果から診療行為を選ぶと地図を表示します。</p></div>';
    state.data = await gzjson(`${dataRoot()}/medical-areas.json`);
    setupRegions();
    renderYearTabs();
    syncYearUrl();
    if (state.surface === "all") await loadCatalog();
    render();
  }
  async function init() {
    const query = new URLSearchParams(location.search), requested = Number(query.get("year")), requestedPref = query.get("pref"), requestedArea = query.get("area");
    state.year = YEARS.includes(requested) ? requested : 2024;
    state.data = await gzjson(`${dataRoot()}/medical-areas.json`);
    if (requestedPref && state.data.areas.some(item => item.prefecture === requestedPref)) state.pref = requestedPref;
    if (/^\\d{4}$/.test(requestedArea || "") && state.data.areas.some(item => item.code === requestedArea && item.prefecture === state.pref)) state.area = requestedArea;
    if (requestedPref || requestedArea) state.scope = "detail";
    setupRegions();
    renderYearTabs();
    syncYearUrl();
    document.querySelectorAll("[data-surface]").forEach(
      (b) =>
        (b.onclick = () => {
          state.surface = b.dataset.surface;
          document
            .querySelectorAll("[data-surface]")
            .forEach((x) => x.classList.toggle("active", x === b));
          EL("featured").hidden = state.surface !== "featured";
          EL("all").hidden = state.surface !== "all";
          EL("metric-wrap").hidden = state.surface === "all";
          if (state.surface === "all") loadCatalog();
        }),
    );
    document.querySelectorAll("[data-scope]").forEach(
      (b) =>
        (b.onclick = () => {
          state.scope = b.dataset.scope;
          render();
        }),
    );
    document.querySelectorAll("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          state.mode = b.dataset.mode;
          render();
        }),
    );
    EL("prefecture").onchange = (e) => {
      state.pref = e.target.value;
      state.scope = "detail";
      updateAreas();
      syncYearUrl();
      render();
    };
    EL("area").onchange = (e) => {
      state.area = e.target.value;
      state.scope = "detail";
      syncYearUrl();
      render();
    };
    EL("metric").onchange = (e) => {
      state.metric = e.target.value;
      render();
    };
    EL("query").oninput = renderResults;
    EL("category").onchange = renderResults;
    EL("details-open").onclick = () => {
      renderDetails();
      EL("details").showModal();
    };
    EL("detail-query").oninput = renderDetails;
    render();
  }
  init().catch((e) => {
    document.querySelector("main").innerHTML =
      `<section class="caution"><strong>データを読み込めませんでした</strong><p>${esc(e.message)}</p></section>`;
  });
})();
