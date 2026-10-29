(() => {
  "use strict";
  const ROOT = document.body.dataset.dataRoot || "/ndb/standardized-ratio/data",
    PREFECTURE_ONLY = document.body.dataset.prefectureOnly === "true",
    STANDALONE_MODE = document.body.dataset.standalone === "true" || document.body.dataset.measure === "patients",
    COLORS = ["#dceff1", "#abd8dc", "#73bbc1", "#378f99", "#12626d"],
    LABEL = {
      exact: "算出",
      reference: "秘匿影響あり・参考",
      suppressed: "地域値秘匿",
      unavailable: "算出不能",
    };
  const PAGE_SIZE = 100,
    ONLINE_TERM = "情報通信機器";
  const THEMES = {
    online: { label: "オンライン診療", terms: ["情報通信機器"] },
    home: { label: "在宅医療", terms: ["在宅", "訪問診療", "往診", "看取り"] },
    emergency: {
      label: "救急医療",
      terms: ["救急", "救命", "救急車", "時間外", "休日", "深夜"],
    },
    rehab: { label: "リハビリ", terms: ["リハビリ"] },
    surgery: { label: "手術", terms: ["手術"] },
    imaging: {
      label: "画像診断",
      terms: [
        "画像診断",
        "コンピューター断層",
        "磁気共鳴",
        "ＣＴ",
        "ＭＲＩ",
        "CT",
        "MRI",
      ],
    },
    mental: { label: "精神医療", terms: ["精神", "心身医学", "認知療法"] },
    periodontal: { label: "歯周治療", terms: ["歯周"] },
    denture: { label: "義歯", terms: ["義歯", "有床義歯"] },
    extraction: { label: "抜歯", terms: ["抜歯"] },
    homeDental: { label: "訪問歯科", terms: ["訪問歯科", "歯科訪問"] },
  };
  let summaryData = null,
    themeSummary = null;
  const themeItemsCache = new Map();
  const state = {
    scope: "prefecture",
    year: 2024,
    themeYear: 2024,
    root: null,
    index: null,
    geometry: null,
    metric: null,
    trends: [],
    region: "05",
    category: "all",
    subcategory: "all",
    theme: "",
    view: "metric",
    regionRows: [],
    regionRequest: 0,
    page: 1,
    chunks: new Map(),
    indexes: new Map(),
    roots: new Map(),
    request: 0,
  };
  const el = (id) => document.getElementById(id),
    esc = (s) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      ),
    fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("ja-JP")),
    q = (a, p) => {
      const i = (a.length - 1) * p,
        l = Math.floor(i),
        f = i - l;
      return a[l + 1] === undefined ? a[l] : a[l] + f * (a[l + 1] - a[l]);
    };
  async function gz(url) {
    const r = await fetch(url);
    if (!r.ok) throw Error(`${r.status} ${url}`);
    const stream = r.body.pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  const base = () => `${ROOT}/${state.scope}`;
  function syncUrl() {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("scope", state.scope);
    url.searchParams.set("year", state.year);
    url.searchParams.set("region", state.region);
    if (state.view === "region") url.searchParams.set("view", "region");
    if (state.category !== "all") url.searchParams.set("category", state.category);
    if (state.subcategory !== "all") url.searchParams.set("subcategory", state.subcategory);
    if (state.theme) url.searchParams.set("theme", state.theme);
    const query = el("query")?.value.trim();
    if (query) url.searchParams.set("query", query);
    if (state.page > 1) url.searchParams.set("page", state.page);
    if (state.metric?.id.startsWith("summary:")) {
      url.searchParams.set("summary", state.metric.id.slice(8));
      if (state.metric.id.startsWith("summary:theme:"))
        url.searchParams.set("themeYear", state.themeYear);
    } else if (state.metric?.id) {
      url.searchParams.set("metric", state.metric.id);
    }
    history.replaceState(null, "", url);
  }
  const summaryPeriod = (year) => `${year}年4月～${year + 1}年3月`;
  async function scopeRoot() {
    const key = state.scope;
    if (state.roots.has(key)) return state.roots.get(key);
    const root = await gz(`${base()}/index.json.gz`);
    state.roots.set(key, root);
    return root;
  }
  async function yearIndex(year) {
    const key = `${state.scope}:${year}`;
    if (state.indexes.has(key)) return state.indexes.get(key);
    const index = standardizeClassifications(
      await gz(`${base()}/${year}/index.json.gz`),
    );
    state.indexes.set(key, index);
    return index;
  }
  function standardizeClassifications(index) {
    const labels = new Map();
    let pending = null,
      activeKey = "",
      activeCode = "",
      activeLabel = "";
    index.metrics.forEach((metric) => {
      let raw = String(metric.classification || metric.source || "その他").trim();
      const trailingCode = raw
        .normalize("NFKC")
        .match(/^(.+?)\s+([A-Z][0-9][A-Z0-9.-]*)$/);
      if (trailingCode) raw = `${trailingCode[2]} ${trailingCode[1]}`;
      const key = `${metric.id.split(":")[0]}|${metric.source}|${metric.setting}`,
        normalized = raw.normalize("NFKC"),
        codeLike = /^[A-Z][0-9]/.test(normalized);
      if (key !== activeKey) {
        pending = null;
        activeCode = "";
        activeLabel = "";
        activeKey = key;
      }
      if (!codeLike) {
        labels.set(metric.id, raw);
        pending = { id: metric.id, name: raw };
        activeCode = "";
        activeLabel = "";
        return;
      }
      if (pending) {
        activeCode = raw;
        activeLabel = `${raw} ${pending.name}`;
        labels.set(pending.id, activeLabel);
        labels.set(metric.id, activeLabel);
        pending = null;
      } else if (raw === activeCode && activeLabel) {
        labels.set(metric.id, activeLabel);
      } else {
        activeCode = raw;
        activeLabel = raw;
        labels.set(metric.id, raw);
      }
    });
    index.metrics.forEach((metric) => {
      metric.classification = labels.get(metric.id) || metric.classification;
    });
    index.classificationLabels = labels;
    return index;
  }
  async function loadScope() {
    const req = ++state.request;
    state.metric = null;
    state.trends = [];
    state.root = await scopeRoot();
    if (req !== state.request) return;
    state.year = state.root.defaultYear;
    await loadYear();
  }
  async function loadYear() {
    const req = ++state.request;
    state.metric = null;
    state.trends = [];
    state.index = await yearIndex(state.year);
    if (req !== state.request) return;
    state.region = state.scope === "area" ? "0504" : "05";
    renderControls();
    renderResults();
    renderFilters();
    renderEmpty();
    renderMethod();
    if (state.view === "region") queueRegionHighlights();
  }
  function renderControls() {
    el("year").innerHTML = state.root.years
      .map((y) => `<option value="${y.year}">${y.year}年度</option>`)
      .join("");
    el("year").value = state.year;
    el("category").innerHTML =
      '<option value="all">すべて</option>' +
      state.index.categories
        .map(
          (c) =>
            `<option value="${esc(c.id)}">${esc(c.label)}（${fmt(c.count)}）</option>`,
        )
        .join("");
    el("category").value = "all";
    state.category = "all";
    state.subcategory = "all";
    renderSubcategories();
    el("region").innerHTML = state.index.prefectures
      .map(
        (r) =>
          `<option value="${r.code}">${esc(r.name)}${state.scope === "area" ? `（${r.code}）` : ""}</option>`,
      )
      .join("");
    el("region").value = state.region;
    el("region-label").textContent =
      state.scope === "area" ? "二次医療圏" : "都道府県";
    el("period").textContent = `対象期間：${state.index.period}`;
    el("area-note").hidden = state.scope !== "area";
    renderSummaryButtons();
  }
  function categoryRows() {
    return state.index.metrics.filter(
      (m) => state.category === "all" || m.id.startsWith(`${state.category}:`),
    );
  }
  function renderSubcategories() {
    const select = el("subcategory");
    if (state.category === "all") {
      state.subcategory = "all";
      select.innerHTML =
        '<option value="all">先に分野を選択してください</option>';
      select.value = "all";
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const counts = new Map();
    categoryRows().forEach((m) => {
      const label = m.classification || m.source || "その他";
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    select.innerHTML =
      '<option value="all">すべて</option>' +
      [...counts]
        .sort((a, b) => a[0].localeCompare(b[0], "ja"))
        .map(
          ([label, count]) =>
            `<option value="${esc(label)}">${esc(label)}（${fmt(count)}）</option>`,
        )
        .join("");
    select.value = state.subcategory;
  }
  const onlinePsychiatryPresetActive = () =>
    state.year === 2024 &&
    state.category === "I" &&
    state.subcategory === "通院・在宅精神療法" &&
    el("query")?.value.trim() === "情報通信機器";
  async function applyOnlinePsychiatryPreset() {
    state.theme = "";
    state.metric = null;
    state.trends = [];
    if (state.year !== 2024) {
      state.year = 2024;
      renderEmpty(
        "2024年度のオンライン精神療法を読み込んでいます",
        "この診療行為は2024年度の公表表に収録されています。",
      );
      await loadYear();
    }
    const category = state.index.categories.find((row) => row.id === "I");
    if (!category)
      return renderEmpty(
        "オンライン精神療法を表示できません",
        "2024年度の精神科専門療法を読み込めませんでした。",
      );
    state.category = category.id;
    el("category").value = category.id;
    state.subcategory = "all";
    renderSubcategories();
    const target = [...el("subcategory").options].find(
      (option) => option.value === "通院・在宅精神療法",
    );
    if (!target)
      return renderEmpty(
        "オンライン精神療法を表示できません",
        "通院・在宅精神療法の小分類を読み込めませんでした。",
      );
    state.subcategory = target.value;
    el("subcategory").value = target.value;
    el("query").value = "情報通信機器";
    state.page = 1;
    renderResults();
    renderFilters();
    renderEmpty(
      "オンライン精神療法を2項目に絞り込みました",
      "検索結果から選ぶと、地図と全国順位を表示します。",
    );
    syncUrl();
  }
  function metricText(m) {
    return `${m.name} ${m.code} ${m.classification} ${m.source} ${m.setting}`;
  }
  function matchingRows() {
    const query = el("query").value.trim().toLowerCase(),
      theme = THEMES[state.theme];
    return categoryRows().filter(
      (m) =>
        (state.subcategory === "all" ||
          (m.classification || m.source || "その他") === state.subcategory) &&
        (!theme || theme.terms.some((term) => metricText(m).includes(term))) &&
        (!query || metricText(m).toLowerCase().includes(query)),
    );
  }
  function renderFilters() {
    document
      .querySelectorAll("[data-preset]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.preset === "online-psychiatry" && onlinePsychiatryPresetActive()),
        ),
      );
    document
      .querySelectorAll("[data-theme]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.theme === state.theme),
        ),
      );
    const labels = [];
    if (state.theme) labels.push(THEMES[state.theme].label);
    if (state.category !== "all")
      labels.push(
        el("category").selectedOptions[0]?.textContent.replace(
          /（[\d,]+）$/,
          "",
        ),
      );
    if (state.subcategory !== "all") labels.push(state.subcategory);
    const query = el("query").value.trim();
    if (query) labels.push(`検索：${query}`);
    el("active-filters").innerHTML = labels.length
      ? labels.map((label) => `<span>${esc(label)}</span>`).join("")
      : '<span class="guide">テーマ・分野・小分類・名称から探せます</span>';
    el("clear-filters").hidden = !labels.length;
  }
  function renderResults() {
    const matches = matchingRows(),
      pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE)),
      selectedFilteredOut =
        state.metric &&
        !state.metric.id.startsWith("summary:") &&
        !matches.some((m) => m.id === state.metric.id);
    if (selectedFilteredOut) {
      state.request++;
      state.metric = null;
      state.trends = [];
      renderEmpty(
        "選択中の診療行為は現在の条件に該当しません",
        "条件を変更するか、すべての条件をクリアしてください。",
      );
    }
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * PAGE_SIZE,
      list = matches.slice(start, start + PAGE_SIZE),
      first = matches.length ? start + 1 : 0,
      last = start + list.length;
    el("result-count").textContent =
      `${fmt(matches.length)}件中${fmt(first)}～${fmt(last)}件`;
    el("page-count").textContent = `${state.page}／${pages}ページ`;
    el("prev-page").disabled = state.page === 1;
    el("next-page").disabled = state.page === pages;
    el("results").innerHTML = matches.length
      ? list
          .map(
            (m) =>
              `<button data-id="${esc(m.id)}" class="${state.metric?.id === m.id ? "active" : ""}"><span>${esc(m.classification || m.source)}</span><strong>${esc(m.name)}</strong><small>${esc(m.code)}　${esc(m.setting)}</small></button>`,
          )
          .join("")
      : `<div class="no-results"><strong>条件に一致する診療行為がありません</strong><p>条件を変更するか、すべての条件をクリアしてください。</p><button type="button" id="no-results-clear">すべての条件をクリア</button></div>`;
    el("results")
      .querySelectorAll("button[data-id]")
      .forEach((b) => (b.onclick = () => selectMetric(b.dataset.id)));
    const noResultsClear = el("no-results-clear");
    if (noResultsClear) noResultsClear.onclick = clearAllFilters;
  }
  function ensureRegionExplorer() {
    if (el("region-explorer")) return;
    const workspace = document.querySelector(".workspace"),
      measureLabel = document.body.dataset.measure === "patients" ? "患者数" : "算定回数";
    workspace.insertAdjacentHTML(
      "beforebegin",
      `<section class="view-switch card" aria-label="探し方"><div><strong>探し方を選ぶ</strong><p>診療行為から地域差を見るほか、選択した地域で標準化比が高い項目を一覧にできます。</p></div><div class="view-tabs" role="tablist" aria-label="標準化比の探し方"><button id="metric-view-tab" type="button" role="tab" aria-selected="true">項目から地域を見る</button><button id="region-view-tab" type="button" role="tab" aria-selected="false">地域から高い項目を見る</button></div></section><section id="region-explorer" class="region-explorer card" hidden><div class="region-explorer-head"><div><strong id="region-explorer-title">選択地域で標準化比が高い項目</strong><p>全国＝100を上回る項目を、現在の年度・分野・小分類・検索条件で比較します。</p></div><div class="region-explorer-options"><label>並び順<select id="region-sort"><option value="ratio">標準化比が高い順</option><option value="rank">全国順位が高い順</option></select></label><label class="check"><input id="exact-only" type="checkbox" checked> 算出値のみ</label><label class="check"><input id="coverage-only" type="checkbox" checked> 公表地域80％以上</label></div></div><div class="region-explorer-note"><strong>一覧の読み方</strong><p>比が高い項目を探索するための一覧です。${measureLabel}、医療の質、必要性の高さは示しません。期待値が少ない項目では比が大きく変動することがあります。</p></div><p id="region-explorer-status" aria-live="polite"></p><div id="region-explorer-results" class="region-explorer-results"></div></section>`,
    );
  }
  function resetResults() {
    state.page = 1;
    renderResults();
    renderFilters();
    syncUrl();
    if (state.view === "region") queueRegionHighlights();
  }

  function setView(view) {
    state.view = view === "region" ? "region" : "metric";
    const regionMode = state.view === "region";
    el("metric-view-tab").setAttribute("aria-selected", String(!regionMode));
    el("region-view-tab").setAttribute("aria-selected", String(regionMode));
    el("region-explorer").hidden = !regionMode;
    document.querySelector(".workspace").hidden = regionMode;
    syncUrl();
    if (regionMode) queueRegionHighlights();
  }

  function queueRegionHighlights() {
    void loadRegionHighlights().catch((error) => {
      console.error(error);
      if (state.view !== "region") return;
      el("region-explorer-status").textContent = "一覧を読み込めませんでした";
      el("region-explorer-results").innerHTML =
        '<div class="region-no-results"><strong>データの読み込みに失敗しました</strong><p>通信状態を確認して、もう一度「地域から高い項目を見る」を選択してください。</p></div>';
    });
  }

  async function loadRegionHighlights() {
    const request = ++state.regionRequest,
      regionIndex = state.index.prefectures.findIndex((row) => row.code === state.region),
      region = state.index.prefectures[regionIndex],
      matches = matchingRows();
    if (regionIndex < 0 || !region) return;
    el("region-explorer-title").textContent = `${region.name}で標準化比が高い項目`;
    el("region-explorer-status").textContent = `${fmt(matches.length)}項目を確認しています…`;
    el("region-explorer-results").innerHTML = '<div class="region-loading">選択した条件のデータを読み込んでいます。</div>';
    const wanted = new Set(matches.map((row) => row.id)),
      jobs = [];
    state.index.categories.forEach((category) => {
      const rows = state.index.metrics.filter((metric) => metric.id.startsWith(`${category.id}:`)),
        chunkSize = STANDALONE_MODE ? 200 : 400;
      category.files.forEach((file, fileIndex) => {
        const slice = rows.slice(fileIndex * chunkSize, (fileIndex + 1) * chunkSize);
        if (slice.some((metric) => wanted.has(metric.id))) jobs.push({ file });
      });
    });
    const loaded = [];
    for (let start = 0; start < jobs.length; start += 4) {
      if (request !== state.regionRequest || state.view !== "region") return;
      const batch = await Promise.all(
        jobs.slice(start, start + 4).map(async ({ file }) => {
          const key = `${state.scope}:${state.year}:${file}`;
          if (state.chunks.has(key)) return state.chunks.get(key);
          const part = await gz(`${base()}/${state.year}/${file}`),
            chunk = {
              metrics: part.metrics.map((metric) => ({
                ...normalizeMetric(metric),
                classification:
                  state.index.classificationLabels?.get(metric.id) || metric.classification,
              })),
            };
          state.chunks.set(key, chunk);
          return chunk;
        }),
      );
      loaded.push(...batch.flatMap((chunk) => chunk.metrics));
      el("region-explorer-status").textContent = `${Math.min(start + 4, jobs.length)}／${jobs.length}データを確認しています…`;
    }
    if (request !== state.regionRequest || state.view !== "region") return;
    state.regionRows = loaded
      .filter((metric) => wanted.has(metric.id) && metric.values?.[regionIndex] != null)
      .map((metric) => {
        const published = metric.values.filter((value) => value != null).length,
          ranked = metric.values
            .map((value, index) => ({ value, index }))
            .filter((row) => row.value != null)
            .sort((a, b) => b.value - a.value),
          rank = ranked.findIndex((row) => row.index === regionIndex) + 1;
        return {
          ...metric,
          value: metric.values[regionIndex],
          status: metric.statuses?.[regionIndex] || "unavailable",
          rank,
          published,
          coverage: published / state.index.prefectures.length,
        };
      });
    renderRegionHighlights();
  }

  function renderRegionHighlights() {
    const exactOnly = el("exact-only").checked,
      coverageOnly = el("coverage-only").checked,
      sort = el("region-sort").value,
      eligible = state.regionRows
        .filter(
          (row) =>
            row.value > 100 &&
            (!exactOnly || row.status === "exact") &&
            (!coverageOnly || row.coverage >= 0.8),
        )
        .sort((a, b) =>
          sort === "rank"
            ? a.rank - b.rank || b.value - a.value
            : b.value - a.value || a.rank - b.rank,
        ),
      shown = eligible.slice(0, 50),
      region = state.index.prefectures.find((row) => row.code === state.region);
    el("region-explorer-status").textContent =
      `${region?.name || "選択地域"}：条件に該当する${fmt(eligible.length)}項目のうち上位${fmt(shown.length)}項目`;
    el("region-explorer-results").innerHTML = shown.length
      ? shown
          .map(
            (row, index) =>
              `<button type="button" data-region-metric="${esc(row.id)}"><span class="region-row-rank">${index + 1}</span><span class="region-row-name"><small>${esc(row.classification || row.source)}／${esc(row.setting)}</small><strong>${esc(row.name)}</strong><small>${esc(row.code)}　公表 ${fmt(row.published)}／${fmt(state.index.prefectures.length)}地域</small></span><span class="region-row-value"><strong>${fmt(row.value)}</strong><small>全国 ${fmt(row.rank)}位</small></span></button>`,
          )
          .join("")
      : '<div class="region-no-results"><strong>現在の条件に該当する項目がありません</strong><p>「算出値のみ」または「公表地域80％以上」を外すか、分野・検索条件を変更してください。</p></div>';
    el("region-explorer-results")
      .querySelectorAll("[data-region-metric]")
      .forEach(
        (button) =>
          (button.onclick = async () => {
            setView("metric");
            await selectMetric(button.dataset.regionMetric);
          }),
      );
  }
  function renderEmpty(
    message = "診療行為を選択してください",
    note = "検索結果から選ぶと、地図と全国順位を表示します。",
  ) {
    el("detail").innerHTML =
      `<div class="empty"><strong>${esc(message)}</strong><p>${esc(note)}</p></div>`;
  }
  function clearAllFilters() {
    state.request++;
    state.theme = "";
    state.category = "all";
    state.subcategory = "all";
    state.metric = null;
    state.trends = [];
    el("category").value = "all";
    renderSubcategories();
    el("query").value = "";
    resetResults();
    renderEmpty();
    renderSummaryButtons();
    renderMethod();
  }
  function normalizeMetric(metric) {
    if (metric.statuses?.length) return metric;
    const suppressed = new Set(metric.suppressed || []),
      unavailable = new Set(metric.unavailable || []);
    return {
      ...metric,
      statuses: metric.values.map((_, i) =>
        suppressed.has(i)
          ? "suppressed"
          : unavailable.has(i)
            ? "unavailable"
            : metric.ageSuppressedCells
              ? "reference"
              : "exact",
      ),
    };
  }
  async function metricChunk(year, index, category, id) {
    const rows = index.metrics.filter((m) =>
        m.id.startsWith(`${category.id}:`),
      ),
      position = rows.findIndex((m) => m.id === id);
    if (position < 0) return { metrics: [] };
    const chunkSize = STANDALONE_MODE ? 200 : 400,
      file = category.files[Math.floor(position / chunkSize)];
    if (!file) return { metrics: [] };
    const key = `${state.scope}:${year}:${file}`;
    if (state.chunks.has(key)) return state.chunks.get(key);
    const part = await gz(`${base()}/${year}/${file}`),
      chunk = {
        metrics: part.metrics.map((metric) => ({
          ...normalizeMetric(metric),
          classification:
            index.classificationLabels?.get(metric.id) || metric.classification,
        })),
      };
    state.chunks.set(key, chunk);
    return chunk;
  }
  async function loadMetricTrends(req, meta, categoryId) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (req !== state.request || state.scope !== "prefecture") return;
    try {
      const trends = await Promise.all(
        state.root.years.map(async (y) => {
          const idx =
              y.year === state.year ? state.index : await yearIndex(y.year),
            target = idx.metrics.find(
              (m) =>
                m.code === meta.code &&
                m.setting === meta.setting &&
                m.source === meta.source,
            ),
            cat = target && idx.categories.find((c) => c.id === categoryId);
          if (!target || !cat) return { year: y.year, metric: null };
          const data = await metricChunk(y.year, idx, cat, target.id);
          return {
            year: y.year,
            metric: data.metrics.find((m) => m.id === target.id) || null,
          };
        }),
      );
      if (req === state.request) {
        state.trends = trends;
        renderDetail();
      }
    } catch (error) {
      console.warn("年度比較を読み込めませんでした", error);
    }
  }
  async function selectMetric(id) {
    const req = ++state.request,
      meta = state.index.metrics.find((m) => m.id === id),
      category = state.index.categories.find((c) => id.startsWith(`${c.id}:`));
    if (!meta || !category) return;
    state.trends = [];
    renderEmpty(
      `${state.year}年度の診療行為を読み込んでいます`,
      "選択年度の数値を先に表示します。年度比較はその後に読み込みます。",
    );
    try {
      const chunk = await metricChunk(state.year, state.index, category, id);
      if (req !== state.request) return;
      state.metric = chunk.metrics.find((m) => m.id === id) || null;
      if (!state.metric) throw Error(`metric not found: ${id}`);
      renderResults();
      renderSummaryButtons();
      renderMethod();
      syncUrl();
      renderDetail();
      if (state.scope === "prefecture")
        void loadMetricTrends(req, meta, category.id);
    } catch (error) {
      console.error(error);
      if (req === state.request)
        renderEmpty(
          "読み込みに失敗しました",
          "通信状態を確認して、もう一度選択してください。",
        );
    }
  }
  function renderSummaryButtons() {
    document.querySelectorAll("[data-summary]").forEach((button) => {
      const prefectureOnly = !button.dataset.summary.startsWith("theme:"),
        disabled = prefectureOnly && state.scope !== "prefecture";
      button.disabled = disabled;
      button.title = disabled ? "都道府県に切り替えると表示できます" : "";
      button.setAttribute(
        "aria-pressed",
        String(state.metric?.id === `summary:${button.dataset.summary}`),
      );
    });
  }
  function selectSummary(id) {
    const themed = id.startsWith("theme:"),
      summary = themed
        ? themeSummary?.metrics.find((m) => m.id === id.slice(6))
        : summaryData?.metrics.find((m) => m.id === id);
    if (!summary)
      return renderEmpty(
        "まとめ指標を読み込めませんでした",
        "時間をおいて再度お試しください。",
      );
    if (!themed && state.scope !== "prefecture")
      return renderEmpty(
        "このまとめ指標は都道府県版で表示できます",
        "地域単位を「都道府県」に切り替えてください。",
      );
    const selectedYear = themed ? state.themeYear : state.year,
      current = summary.years.find((y) => y.year === selectedYear),
      scopeData = themed ? current?.scopes[state.scope] : current;
    if (!scopeData)
      return renderEmpty(
        "この年度・地域単位の集計値がありません",
        "条件を変更してください。",
      );
    const records = scopeData.records,
      byCode = new Map(records.map((r) => [r.code, r])),
      group = themed
        ? "医療テーマ"
        : summaryData.groups.find((g) => g.id === summary.group)?.label ||
          "まとめ指標",
      rows = state.index.prefectures.map((r) => byCode.get(r.code));
    state.metric = {
      id: `summary:${id}`,
      code: "複数の診療行為コード",
      name: summary.label,
      classification: `${group}・${selectedYear}年度・合計`,
      source: group,
      setting: "算定回数合計",
      summaryDefinition: summary.definition,
      summaryMeta: `対象：${selectedYear}年度・${state.scope === "area" ? "二次医療圏" : "都道府県"}${scopeData.itemCount ? `／合計した診療行為 ${fmt(scopeData.itemCount)}項目` : ""}`,
      summaryMethod: themed ? themeSummary.method : summaryData.method,
      summaryPeriod: summaryPeriod(selectedYear),
      summaryYear: selectedYear,
      summaryItems: null,
      summaryItemsLoading: themed,
      summaryItemsError: false,
      summaryItemCount: themed ? scopeData.itemCount : null,
      summaryChanges: themed ? current.changes || null : null,
      summaryTargetScope: themed ? summary.targetScope : null,
      summarySelectionRule: themed ? summary.selectionRule : null,
      values: rows.map((r) => r?.value ?? null),
      statuses: rows.map(
        (r) => r?.status || (scopeData.isComplete ? "exact" : "reference"),
      ),
    };
    state.trends = summary.years.map((y) => {
      const data = themed ? y.scopes[state.scope] : y,
        values = new Map((data?.records || []).map((r) => [r.code, r]));
      return {
        year: y.year,
        metric: data
          ? {
              values: state.index.prefectures.map(
                (r) => values.get(r.code)?.value ?? null,
              ),
              statuses: state.index.prefectures.map(
                (r) =>
                  values.get(r.code)?.status ||
                  (data.isComplete ? "exact" : "reference"),
              ),
            }
          : null,
      };
    });
    renderResults();
    renderSummaryButtons();
    renderMethod();
    syncUrl();
    renderDetail();
    if (themed)
      void hydrateThemeItems(selectedYear, summary.id, state.metric.id);
  }
  async function hydrateThemeItems(year, theme, metricId) {
    try {
      if (!themeItemsCache.has(year)) {
        const promise = fetch(
          `/ndb/standardized-ratio/data/theme-items-${year}.json?v=1`,
        ).then((response) => {
          if (!response.ok) throw Error(response.status);
          return response.json();
        });
        themeItemsCache.set(year, promise);
      }
      const payload = await themeItemsCache.get(year),
        details = payload.metrics?.[theme];
      if (state.metric?.id !== metricId || state.themeYear !== year) return;
      state.metric.summaryItems = details?.items || [];
      state.metric.summaryChanges = {
        ...state.metric.summaryChanges,
        removedItems: details?.removedItems || [],
      };
      state.metric.summaryItemsLoading = false;
      renderDetail();
    } catch (error) {
      console.warn("医療テーマの対象項目を読み込めませんでした", error);
      if (state.metric?.id !== metricId) return;
      state.metric.summaryItemsLoading = false;
      state.metric.summaryItemsError = true;
      renderDetail();
    }
  }
  function mapRows() {
    return state.index.prefectures.map((r, i) => ({
      ...r,
      value: state.metric.values[i],
      status: state.metric.statuses?.[i] || "unavailable",
    }));
  }
  function renderDetail() {
    if (!state.metric) return;
    const trends = state.trends,
      entries = mapRows(),
      selectedIndex = Math.max(
        0,
        entries.findIndex((r) => r.code === state.region),
      ),
      selected = entries[selectedIndex],
      ranked = entries
        .filter((r) => r.value != null)
        .sort((a, b) => b.value - a.value),
      rank = ranked.findIndex((r) => r.code === state.region) + 1,
      values = ranked.map((r) => r.value).sort((a, b) => a - b),
      cuts = values.length
        ? [0.2, 0.4, 0.6, 0.8].map((p) => q(values, p))
        : [0, 0, 0, 0],
      color = (value) => {
        let band = 0;
        while (band < cuts.length && value > cuts[band]) band++;
        return COLORS[band];
      };
    el("detail").innerHTML =
      `<div class="metric-head"><span>${esc(state.metric.classification || state.metric.source)}</span><h2>${esc(state.metric.name)}</h2><p>${state.metric.id.startsWith("summary:") ? "対象コード" : "診療行為コード"} ${esc(state.metric.code)}／${esc(state.metric.setting)}</p>${state.metric.summaryMeta ? `<p><strong>${esc(state.metric.summaryMeta)}</strong></p>` : ""}${state.metric.summaryDefinition ? `<p class="summary-definition">${esc(state.metric.summaryDefinition)}</p>` : ""}</div><div class="score"><p>${esc(selected.name)}</p><strong>${fmt(selected.value)}</strong><span>${esc(state.index.unit)}</span>${rank ? `<p>全国 ${rank}位／${ranked.length}${state.scope === "area" ? "医療圏" : "都道府県"}（数値公表分）</p>` : ""}<em>${esc(LABEL[selected.status])}</em></div><div class="map-layout"><div><svg id="map" class="map" viewBox="${state.geometry.viewBox.join(" ")}" role="img"><defs><pattern id="missing" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e3e6e6"/><line x1="0" y1="0" x2="0" y2="6" stroke="#a7aeae" stroke-width="2"/></pattern></defs></svg><div class="legend">${COLORS.map((c, i) => `<span><i style="background:${c}"></i>${i === 0 ? `${cuts[0].toFixed(1)}以下` : i === 4 ? `${cuts[3].toFixed(1)}超` : `${cuts[i - 1].toFixed(1)}超～${cuts[i].toFixed(1)}以下`}</span>`).join("")}</div><p>数値を公表できる地域を五分位で色分けしています。</p></div><aside><h3>全国順位</h3><div class="ranking">${ranked.map((r, i) => `<button data-code="${r.code}" class="${r.code === state.region ? "active" : ""}"><span>${i + 1}</span><strong>${esc(r.name)}</strong><b>${fmt(r.value)}</b></button>`).join("")}</div></aside></div>${themeItemsHtml()}${state.scope === "prefecture" ? trendHtml(trends, selectedIndex) : ""}`;
    const byCode = new Map(entries.map((r) => [r.code, r]));
    state.geometry.areas.forEach((area) => {
      const code = state.scope === "area" ? area.code : area.code.slice(0, 2),
        row = byCode.get(code),
        path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", area.path);
      path.setAttribute(
        "fill",
        row?.value == null ? "url(#missing)" : color(row.value),
      );
      path.setAttribute(
        "class",
        `region${code === state.region ? " selected" : ""}`,
      );
      path.onclick = () => chooseRegion(code);
      const title = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "title",
      );
      title.textContent = `${state.scope === "area" ? `${area.prefecture} ${area.name}医療圏` : area.prefecture}：${fmt(row?.value)}`;
      path.append(title);
      el("map").append(path);
    });
    el("detail")
      .querySelectorAll("[data-code]")
      .forEach((b) => (b.onclick = () => chooseRegion(b.dataset.code)));
    bindThemeItems();
  }
  function themeItemsHtml() {
    const items = state.metric?.summaryItems;
    if (state.metric?.summaryItemsLoading)
      return `<div class="theme-items-loading">対象項目の内訳（${fmt(state.metric.summaryItemCount)}項目）を読み込んでいます…</div>`;
    if (state.metric?.summaryItemsError)
      return '<div class="theme-items-loading">対象項目の内訳を読み込めませんでした。時間をおいて再度お試しください。</div>';
    if (!items) return "";
    const changes = state.metric.summaryChanges,
      changeText =
        state.metric.summaryYear > 2022 && changes
          ? `前年から追加 ${fmt(changes.addedCount)}項目・対象外 ${fmt(changes.removedCount)}項目`
          : "初年度のため前年度との項目比較はありません";
    return `<details class="theme-items"><summary>対象項目の内訳を見る（${fmt(items.length)}項目）</summary><div class="theme-rule"><strong>対象範囲</strong><p>${esc(state.metric.summaryTargetScope)}</p><strong>固定した採用条件</strong><p>${esc(state.metric.summarySelectionRule)}</p><p class="theme-change">${esc(changeText)}</p></div><div class="theme-item-filters"><label>項目名・コード<input id="theme-item-query" type="search" placeholder="例：CT、救急、170000410"></label><label>小分類<select id="theme-item-subcategory"></select></label></div><p id="theme-item-count"></p><div id="theme-item-list" class="theme-item-list"></div><div class="theme-item-pages"><button type="button" id="theme-item-prev">前へ</button><span id="theme-item-page"></span><button type="button" id="theme-item-next">次へ</button></div>${changes?.removedItems?.length ? `<details class="removed-items"><summary>前年から対象外になった項目（${fmt(changes.removedItems.length)}項目）</summary><ul>${changes.removedItems.map((item) => `<li><strong>${esc(item.name)}</strong><small>${esc(item.code)}／${esc(item.setting)}／${esc(item.subcategory)}</small></li>`).join("")}</ul></details>` : ""}</details>`;
  }
  function bindThemeItems() {
    const items = state.metric?.summaryItems,
      list = el("theme-item-list");
    if (!items || !list) return;
    const query = el("theme-item-query"),
      category = el("theme-item-subcategory"),
      categories = [...new Set(items.map((item) => item.subcategory))].sort(
        (a, b) => a.localeCompare(b, "ja"),
      );
    let page = 1;
    category.innerHTML =
      '<option value="all">すべて</option>' +
      categories
        .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
        .join("");
    const render = () => {
      const term = query.value.trim().normalize("NFKC").toLowerCase(),
        filtered = items.filter(
          (item) =>
            (category.value === "all" || item.subcategory === category.value) &&
            (!term ||
              `${item.name} ${item.code} ${item.setting} ${item.subcategory}`
                .normalize("NFKC")
                .toLowerCase()
                .includes(term)),
        ),
        pages = Math.max(1, Math.ceil(filtered.length / 100));
      page = Math.min(page, pages);
      const shown = filtered.slice((page - 1) * 100, page * 100);
      el("theme-item-count").textContent = `${fmt(filtered.length)}項目が該当`;
      el("theme-item-page").textContent = `${page}／${pages}ページ`;
      el("theme-item-prev").disabled = page === 1;
      el("theme-item-next").disabled = page === pages;
      list.innerHTML =
        shown
          .map(
            (item) =>
              `<article><div><strong>${esc(item.name)}</strong>${item.change === "added" ? "<span>前年差：追加</span>" : ""}</div><small>${esc(item.code)}／${esc(item.section)}／${esc(item.setting)}／${esc(item.subcategory)}</small></article>`,
          )
          .join("") || "<p>該当する項目はありません。</p>";
    };
    query.oninput = () => {
      page = 1;
      render();
    };
    category.onchange = () => {
      page = 1;
      render();
    };
    el("theme-item-prev").onclick = () => {
      if (page > 1) {
        page--;
        render();
      }
    };
    el("theme-item-next").onclick = () => {
      page++;
      render();
    };
    render();
  }
  function trendHtml(trends, index) {
    if (!trends.length)
      return '<div class="trend"><h3>年度比較を読み込んでいます…</h3></div>';
    const summary = state.metric?.id.startsWith("summary:");
    return `<div class="trend"><h3>${summary ? "同じまとめ指標" : "同一コード"}の年度比較</h3><p>${summary ? "各年度の公式表に収録された対象項目を年度ごとに再集計しています。" : "コード・外来／入院区分・出典表が一致する年度のみ表示"}</p><div class="trend-grid">${trends
      .sort((a, b) => a.year - b.year)
      .map(
        (t) =>
          `<div><strong>${t.year}年度</strong><b>${fmt(t.metric?.values[index])}</b><small>${t.metric ? LABEL[t.metric.statuses?.[index] || "unavailable"] : "該当コードなし"}</small></div>`,
      )
      .join("")}</div></div>`;
  }
  function chooseRegion(code) {
    state.region = code;
    el("region").value = code;
    syncUrl();
    renderDetail();
  }
  function renderMethod() {
    el("period").textContent =
      `対象期間：${state.metric?.summaryPeriod || state.index.period}`;
    el("caveat").textContent =
      `${state.index.caveat} 地域値が秘匿された${state.scope === "area" ? "医療圏" : "都道府県"}は表示しません。`;
    el("method-note").textContent =
      state.metric?.summaryMethod || state.index.method;
  }
  async function init() {
    try {
      ensureRegionExplorer();
      const params = new URLSearchParams(location.search),
        desiredScope = params.get("scope"),
        desiredYear = Number(params.get("year")),
        desiredRegion = params.get("region"),
        desiredSummary = params.get("summary"),
        desiredMetric = params.get("metric"),
        desiredCategory = params.get("category"),
        desiredSubcategory = params.get("subcategory"),
        desiredTheme = params.get("theme"),
        desiredQuery = params.get("query") || "",
        desiredPage = Math.max(1, Number(params.get("page")) || 1),
        desiredThemeYear = Number(params.get("themeYear"));
      state.view = params.get("view") === "region" ? "region" : "metric";
      if (STANDALONE_MODE) {
        summaryData = { groups: [], metrics: [] };
        themeSummary = { years: [], metrics: [] };
      } else {
        summaryData = await fetch(
          "/ndb/standardized-ratio/data/summary-metrics.json",
        ).then((r) => {
          if (!r.ok) throw Error(r.status);
          return r.json();
        });
        try {
          themeSummary = await fetch(
            "/ndb/standardized-ratio/data/theme-summary.json?v=2",
          ).then((r) => {
            if (!r.ok) throw Error(r.status);
            return r.json();
          });
        } catch (error) {
          console.warn("医療テーマ集計を読み込めませんでした", error);
          themeSummary = { years: [], metrics: [] };
        }
      }
      const themeYears = themeSummary.years || [];
      if (!STANDALONE_MODE)
        el("theme-year").innerHTML = themeYears
          .map((year) => `<option value="${year}">${year}年度</option>`)
          .join("");
      state.themeYear = themeYears.includes(desiredThemeYear)
        ? desiredThemeYear
        : themeSummary.defaultYear || themeYears.at(-1) || 2024;
      if (!STANDALONE_MODE) el("theme-year").value = state.themeYear;
      if (!PREFECTURE_ONLY && ["prefecture", "area"].includes(desiredScope))
        state.scope = desiredScope;
      else if (PREFECTURE_ONLY)
        state.scope = "prefecture";
      el("scope").value = state.scope;
      if (matchMedia("(max-width:800px)").matches)
        document.querySelector(".theme-summary-group")?.removeAttribute("open");
      state.geometry = await gz(
        "/ndb/service-volume/data/medical-areas.json.gz",
      );
      document
        .querySelectorAll("[data-summary]")
        .forEach(
          (button) =>
            (button.onclick = () => selectSummary(button.dataset.summary)),
        );
      if (!STANDALONE_MODE)
        el("theme-year").onchange = (e) => {
          state.themeYear = Number(e.target.value);
          const active = state.metric?.id?.match(/^summary:theme:(.+)$/);
          if (active) selectSummary(`theme:${active[1]}`);
          else syncUrl();
        };
      el("scope").onchange = async (e) => {
        state.scope = e.target.value;
        await loadScope();
        syncUrl();
      };
      el("year").onchange = async (e) => {
        state.year = Number(e.target.value);
        renderEmpty(
          `${state.year}年度の一覧を読み込んでいます`,
          "一度読み込んだ年度は、この画面を閉じるまで再利用します。",
        );
        await loadYear();
        syncUrl();
      };
      el("category").onchange = (e) => {
        state.category = e.target.value;
        state.subcategory = "all";
        renderSubcategories();
        resetResults();
      };
      el("subcategory").onchange = (e) => {
        state.subcategory = e.target.value;
        resetResults();
      };
      el("query").oninput = resetResults;
      document.querySelectorAll("[data-theme]").forEach(
        (button) =>
          (button.onclick = () => {
            state.theme =
              state.theme === button.dataset.theme ? "" : button.dataset.theme;
            resetResults();
          }),
      );
      document.querySelectorAll("[data-preset]").forEach(
        (button) =>
          (button.onclick = () => {
            if (button.dataset.preset === "online-psychiatry")
              void applyOnlinePsychiatryPreset();
          }),
      );
      el("clear-filters").onclick = clearAllFilters;
      el("prev-page").onclick = () => {
        if (state.page > 1) {
          state.page--;
          renderResults();
          syncUrl();
          el("results").scrollTop = 0;
        }
      };
      el("next-page").onclick = () => {
        state.page++;
        renderResults();
        syncUrl();
        el("results").scrollTop = 0;
      };
      el("region").onchange = (e) => {
        state.region = e.target.value;
        if (state.metric) renderDetail();
        syncUrl();
        if (state.view === "region") queueRegionHighlights();
      };
      el("metric-view-tab").onclick = () => setView("metric");
      el("region-view-tab").onclick = () => setView("region");
      el("region-sort").onchange = renderRegionHighlights;
      el("exact-only").onchange = renderRegionHighlights;
      el("coverage-only").onchange = renderRegionHighlights;
      await loadScope();
      if (
        state.root.years.some((year) => year.year === desiredYear) &&
        desiredYear !== state.year
      ) {
        state.year = desiredYear;
        await loadYear();
      }
      if (
        desiredRegion &&
        state.index.prefectures.some((region) => region.code === desiredRegion)
      ) {
        state.region = desiredRegion;
        renderControls();
      }
      if (state.index.categories.some((category) => category.id === desiredCategory)) {
        state.category = desiredCategory;
        el("category").value = desiredCategory;
        renderSubcategories();
      }
      if ([...el("subcategory").options].some((option) => option.value === desiredSubcategory)) {
        state.subcategory = desiredSubcategory;
        el("subcategory").value = desiredSubcategory;
      }
      if (desiredTheme && THEMES[desiredTheme]) state.theme = desiredTheme;
      el("query").value = desiredQuery;
      state.page = desiredPage;
      renderResults();
      renderFilters();
      if (desiredSummary) selectSummary(desiredSummary);
      else if (desiredMetric && state.index.metrics.some((metric) => metric.id === desiredMetric))
        await selectMetric(desiredMetric);
      else syncUrl();
      setView(state.view);
    } catch (error) {
      console.error(error);
      renderEmpty(
        "データを読み込めませんでした",
        "時間をおいて再度お試しください。",
      );
    }
  }
  init();
})();
