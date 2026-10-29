const state = {
  summary: null,
  currentSummary: null,
  selectedYear: "2024",
  yearPayloads: new Map(),
  areaHistory: null,
  deathAreaHistory: null,
  hospitalHistory: null,
  hospitalHistoryPromise: null,
  geometry: null,
  diagnosis: null,
  diagnoses: new Map(),
  diagnosisListenersBound: false,
  death24h: null,
  surgeryMdc: new Map(),
  surgeryDefinitions: new Map(),
  surgeryNameIndexes: new Map(),
  metric: "published",
  selectedArea: null,
  areaMdc: "",
  areaMdcSummary: new Map(),
  areaMdcLoadToken: 0,
  areaMdcDataset: null,
  areaMdcDatasetPromise: null,
  pref: "",
  prefHospitals: new Map(),
  nationalHospitals: new Map(),
  nationalHospitalPromises: new Map(),
  hospitalLimit: 50,
  selectedHospital: null,
  hospitalGoal: null,
  hospitalDetailMode: "summary",
};
const yearLabels = new Map([
  ["2021", "令和3年度"],
  ["2022", "令和4年度"],
  ["2023", "令和5年度"],
  ["2024", "令和6年度"],
]);
const metricLabels = {
  published: "退院患者数",
  surgeryPublished: "手術あり患者数",
  emergencyPublished: "救急医療入院",
  ambulancePublished: "救急車搬送",
  death24hPublished: "入院後24時間以内死亡",
  hospitalCount: "集計対象施設数",
};
const suppressionKeys = {
  published: "suppressed",
  surgeryPublished: "surgerySuppressed",
  emergencyPublished: "emergencySuppressed",
  ambulancePublished: "ambulanceSuppressed",
  death24hPublished: "death24hSuppressed",
};
const prefectures = [
  ["", "全国"],
  ["01", "北海道"],
  ["02", "青森県"],
  ["03", "岩手県"],
  ["04", "宮城県"],
  ["05", "秋田県"],
  ["06", "山形県"],
  ["07", "福島県"],
  ["08", "茨城県"],
  ["09", "栃木県"],
  ["10", "群馬県"],
  ["11", "埼玉県"],
  ["12", "千葉県"],
  ["13", "東京都"],
  ["14", "神奈川県"],
  ["15", "新潟県"],
  ["16", "富山県"],
  ["17", "石川県"],
  ["18", "福井県"],
  ["19", "山梨県"],
  ["20", "長野県"],
  ["21", "岐阜県"],
  ["22", "静岡県"],
  ["23", "愛知県"],
  ["24", "三重県"],
  ["25", "滋賀県"],
  ["26", "京都府"],
  ["27", "大阪府"],
  ["28", "兵庫県"],
  ["29", "奈良県"],
  ["30", "和歌山県"],
  ["31", "鳥取県"],
  ["32", "島根県"],
  ["33", "岡山県"],
  ["34", "広島県"],
  ["35", "山口県"],
  ["36", "徳島県"],
  ["37", "香川県"],
  ["38", "愛媛県"],
  ["39", "高知県"],
  ["40", "福岡県"],
  ["41", "佐賀県"],
  ["42", "長崎県"],
  ["43", "熊本県"],
  ["44", "大分県"],
  ["45", "宮崎県"],
  ["46", "鹿児島県"],
  ["47", "沖縄県"],
];
const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";
function activeView() {
  return ["area", "hospital", "classification"].find((name) => $(`${name}-tab`)?.classList.contains("active")) || "area";
}
function updateUrl(extra = {}) {
  const params = new URLSearchParams();
  params.set("year", state.selectedYear);
  params.set("view", activeView());
  if (state.selectedArea) params.set("area", state.selectedArea);
  if (state.areaMdc) params.set("areaMdc", state.areaMdc);
  if (activeView() === "hospital") {
    const hospitalPref = $("hospital-prefecture")?.value;
    params.set("hospitalPref", hospitalPref === "" ? "all" : hospitalPref || state.pref || "05");
    if (state.selectedHospital) params.set("hospital", `${state.selectedHospital.notice}:${state.selectedHospital.serial}`);
  }
  if (extra.classification) params.set("classification", extra.classification);
  history.replaceState(null, "", `${location.pathname}?${params}${location.hash}`);
}
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
function exactPercent(part, total, partSuppressed = 0, totalSuppressed = 0) {
  if (partSuppressed || totalSuppressed || !Number.isFinite(Number(part)) || !Number.isFinite(Number(total)) || Number(total) <= 0) return null;
  return (Number(part) / Number(total)) * 100;
}
function percentText(part, total, partSuppressed = 0, totalSuppressed = 0) {
  const value = exactPercent(part, total, partSuppressed, totalSuppressed);
  return value == null ? "秘匿を含むため算出不可" : `${value.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}%`;
}
function perHundredBedsText(cases, beds, suppressed = 0) {
  if (suppressed || !Number.isFinite(Number(cases)) || !Number.isFinite(Number(beds)) || Number(beds) <= 0) return "算出不可";
  return `${((Number(cases) / Number(beds)) * 100).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}件`;
}
function displayed(row, key) {
  const suppressed = row[suppressionKeys[key]] || 0;
  const published = Number(row[key] || 0);
  if (key === "hospitalCount") return `${fmt(published)}施設`;
  if (key === "death24hPublished" && suppressed && published === 0) {
    return `数値公表なし（秘匿セル ${fmt(suppressed)}／0件とは限りません）`;
  }
  return suppressed
    ? `公表分 ${fmt(published)}件以上（秘匿セル ${fmt(suppressed)}）`
    : `${fmt(published)}件`;
}
// Keep the established value/zero/suppression wording; only separate its layout.
function areaValueMarkup(row, key) {
  const text = displayed(row, key);
  const note = text.indexOf("（秘匿セル");
  return note < 0 ? esc(text)
    : `<span class="count-value">${esc(text.slice(0, note))}</span><small class="suppression-note">${esc(text.slice(note))}</small>`;
}
const historicalMetrics = new Set(["published", "surgeryPublished", "emergencyPublished", "ambulancePublished", "death24hPublished", "hospitalCount"]);
function renderAreaTrend(code, current) {
  const metric = historicalMetrics.has(state.metric) ? state.metric : "published";
  const historySource = metric === "death24hPublished" ? state.deathAreaHistory : state.areaHistory;
  const older = (historySource?.rows || []).filter((x) => x.code === code);
  const current2024 = state.currentSummary?.areas.find((x) => x.code === code);
  const rows = [...older, ...(current2024 ? [{...current2024, year: "2024"}] : [])];
  if (!rows.length) return "";
  const max = Math.max(1, ...rows.map((x) => Number(x[metric] || 0)));
  const labels = new Map([["2021","令和3"],["2022","令和4"],["2023","令和5"],["2024","令和6"]]);
  const bars = rows.map((x) => {
    const suppressed = x[suppressionKeys[metric]] || 0;
    const value = Number(x[metric] || 0);
    const label = metric === "hospitalCount" ? `${fmt(value)}施設` : suppressed ? `公表分 ${fmt(value)}件以上` : `${fmt(value)}件`;
    return `<tr><th scope="row">${labels.get(x.year) || esc(x.year)}</th><td><span class="trend-bar"><span style="width:${Math.max(2,(value/max)*100).toFixed(1)}%"></span></span></td><td>${esc(label)}</td><td>${fmt(x.hospitalCount)}施設</td></tr>`;
  }).join("");
  const fallback = metric !== state.metric ? `<p class="subtle">「${esc(metricLabels[state.metric])}」は過年度同一定義データを収録していないため、退院患者数を表示します。</p>` : "";
  return `<section class="area-trend"><h3>令和3～6年度の推移</h3><p class="subtle">${esc(metricLabels[metric])}。現在の表示年度は<strong>${esc(yearLabels.get(state.selectedYear))}</strong>です。病院所在地を現行二次医療圏へ接続した参考比較です。</p>${fallback}<div class="trend-table-wrap"><table class="trend-table"><thead><tr><th>年度</th><th>相対規模</th><th>公表値</th><th>対象施設</th></tr></thead><tbody>${bars}</tbody></table></div><p class="subtle">参加施設、告示番号・通番、診断群定義が年度で変わるため、増減を需要や質の変化と断定できません。「－」は0に置換していません。</p></section>`;
}
function renderAreaMdcTrend(code) {
  const dataset = state.areaMdcDataset;
  if (!dataset) return "";
  const metric = historicalMetrics.has(state.metric) ? state.metric : "published";
  const rows = [...yearLabels.keys()].map((year) => ({year, ...(dataset.years[year]?.[code]?.[state.areaMdc] || aggregateAreas([]))}));
  const max = Math.max(1, ...rows.map((row) => Number(row[metric] || 0)));
  const labels = new Map([["2021","令和3"],["2022","令和4"],["2023","令和5"],["2024","令和6"]]);
  const bars = rows.map((row) => {
    const value = Number(row[metric] || 0), suppressed = Number(row[suppressionKeys[metric]] || 0);
    const label = metric === "hospitalCount" ? `${fmt(value)}施設` : suppressed ? `公表分 ${fmt(value)}件以上` : `${fmt(value)}件`;
    return `<tr class="${row.year === state.selectedYear ? "selected" : ""}"><th scope="row">${labels.get(row.year)}年度</th><td><span class="trend-bar"><span style="width:${Math.max(2,(value/max)*100).toFixed(1)}%"></span></span></td><td>${esc(label)}</td><td>${fmt(row.hospitalCount)}施設</td></tr>`;
  }).join("");
  return `<section class="area-trend area-mdc-trend"><h3>${esc(areaMdcLabel())}・令和3～6年度の推移</h3><p class="subtle">${esc(metricLabels[metric])}。枠線の濃い行が現在の表示年度です。病院所在地を現行二次医療圏へ接続した参考比較です。</p><div class="trend-table-wrap"><table class="trend-table"><thead><tr><th>年度</th><th>相対規模</th><th>公表値</th><th>対象施設</th></tr></thead><tbody>${bars}</tbody></table></div><p class="subtle">参加施設や診断群定義が年度で変わるため、増減を需要や質の変化と断定できません。「－」は0に置換していません。</p></section>`;
}
async function loadJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  let bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] === 31 && bytes[1] === 139) {
    const stream = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function loadBase64GzipJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const encoded = (await r.text()).trim();
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(await new Response(stream).arrayBuffer())));
}
function inflateHistoricalHospital(row, mdcDefinitions) {
  const [notice, serial, municipality, prefecture, name, type, dpcBeds, area,
    published, suppressed, surgeryPublished, surgerySuppressed,
    emergencyPublished, emergencySuppressed, ambulancePublished, ambulanceSuppressed,
    death24hPublished = 0, death24hSuppressed = 0] = row;
  const schemaLength = row.length - mdcDefinitions.length === 18 ? 18 : 16;
  const mdcRows = row.slice(schemaLength);
  const mdc = {};
  mdcDefinitions.forEach((definition, index) => {
    const values = mdcRows[index] || [];
    mdc[definition.code] = {
      published: values[0] || 0,
      suppressed: values[1] || 0,
      surgeryPublished: values[2] || 0,
      surgerySuppressed: values[3] || 0,
      emergencyPublished: values[4] || 0,
      emergencySuppressed: values[5] || 0,
      ambulancePublished: values[6] || 0,
      ambulanceSuppressed: values[7] || 0,
      death24hPublished: values[8] || 0,
      death24hSuppressed: values[9] || 0,
    };
  });
  return {notice, serial, municipality, prefecture, name, type, dpcBeds, area, mdc,
    published, suppressed, surgeryPublished, surgerySuppressed,
    emergencyPublished, emergencySuppressed, ambulancePublished, ambulanceSuppressed,
    death24hPublished, death24hSuppressed};
}
async function loadYearPayload(year) {
  if (state.yearPayloads.has(year)) return state.yearPayloads.get(year);
  if (year === "2024") {
    const payload = {
      meta: {year, label: yearLabels.get(year), unavailable: []},
      summary: state.currentSummary,
    };
    state.yearPayloads.set(year, payload);
    return payload;
  }
  const payload = await loadBase64GzipJson(`/dpc/data/year-${year}.json.gz.b64?v=1`);
  if (["v1-array", "v2-array"].includes(payload.meta.hospitalSchema)) {
    payload.hospitals = payload.hospitals.map((row) =>
      inflateHistoricalHospital(row, payload.summary.mdc),
    );
  }
  state.yearPayloads.set(year, payload);
  return payload;
}
function updateYearControls() {
  const label = yearLabels.get(state.selectedYear);
  $("current-year-status").textContent = `現在表示：${label}`;
  document.querySelectorAll("#year-tabs button").forEach((button) => {
    const active = button.dataset.year === state.selectedYear;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("classification-tab").disabled = false;
  $("classification-tab").setAttribute("aria-disabled", "false");
  $("year-availability-note").textContent = `${label}の地図・医療圏・病院・MDC、全5指標、疾患・手術別、DPC分類別を表示できます。手術名・Kコードも選択年度の定義で詳細展開します。`;
}
async function setYear(year) {
  if (!yearLabels.has(year)) return;
  const buttons = [...document.querySelectorAll("#year-tabs button")];
  buttons.forEach((button) => (button.disabled = true));
  try {
    const payload = await loadYearPayload(year);
    state.selectedYear = year;
    state.summary = payload.summary;
    state.selectedHospital = null;
    if ($("hospital-dialog")?.open) $("hospital-dialog").close();
    updateYearControls();
    $("hospital-detail").innerHTML = `<p>左側の病院カードをクリックすると、この欄に${esc(yearLabels.get(year))}のMDC別公表値・年度推移・疾患別手術を表示します。</p>`;
    state.areaMdcSummary = new Map();
    await refreshAreaMdcData();
    if (!$("hospital-panel").hidden) await renderHospitalList();
    if (!$("classification-panel").hidden) await ensureDiagnosis();
    updateUrl();
  } catch (e) {
    $("year-availability-note").textContent = `年度データを読み込めませんでした。${e.message}`;
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}
async function ensureHospitalHistory() {
  if (state.hospitalHistory) return state.hospitalHistory;
  if (!state.hospitalHistoryPromise) {
    state.hospitalHistoryPromise = loadBase64GzipJson("/dpc/data/hospital-history.json.gz.b64?v=1")
      .then((data) => (state.hospitalHistory = data));
  }
  return state.hospitalHistoryPromise;
}
function hospitalHistoryValue(row, valueIndex, suppressedIndex) {
  const value = Number(row[valueIndex] || 0), suppressed = Number(row[suppressedIndex] || 0);
  return suppressed ? `公表分 ${fmt(value)}件以上` : `${fmt(value)}件`;
}
async function renderHospitalHistory(h) {
  const box = $("hospital-history");
  if (!box) return;
  try {
    const data = await ensureHospitalHistory();
    if (state.selectedHospital !== h) return;
    const direct = data.hospitals[`${h.notice}:${h.serial}`] || [];
    const rows = direct.some((x) => x[0] === state.selectedYear)
      ? direct
      : Object.values(data.hospitals).find((chain) =>
          chain.some((x) => x[0] === state.selectedYear && String(x[1]) === String(h.notice) && String(x[2]) === String(h.serial)),
        ) || [];
    if (rows.length < 2) {
      box.innerHTML = '<h3>病院別の令和3～6年度推移</h3><p class="subtle">告示番号・通番だけでは過年度と安全に接続できませんでした。新規参加、番号変更、合併・分割などの可能性があり、過年度実績がないことを意味しません。</p>';
      return;
    }
    const labels = new Map([["2021","令和3"],["2022","令和4"],["2023","令和5"],["2024","令和6"]]);
    box.innerHTML = `<h3>病院別の令和3～6年度推移</h3><p class="subtle">翌年度の通番と前年度の告示番号が一致し、合併・分割表に掲載されていない接続だけを表示します。</p><div class="hospital-trend-grid">${rows.map((x) => `<article class="hospital-trend-year${x[0] === state.selectedYear ? " selected" : ""}"><header><strong>${labels.get(x[0]) || esc(x[0])}年度</strong><span>${esc(x[3])}</span></header><dl><div><dt>退院患者</dt><dd>${esc(hospitalHistoryValue(x,4,5))}</dd></div><div><dt>手術あり</dt><dd>${esc(hospitalHistoryValue(x,6,7))}</dd></div><div><dt>救急医療入院</dt><dd>${esc(hospitalHistoryValue(x,8,9))}</dd></div><div><dt>救急車搬送</dt><dd>${esc(hospitalHistoryValue(x,10,11))}</dd></div></dl></article>`).join("")}</div><p class="subtle">枠線の濃い年度がページ全体の表示年度です。名称が変わっている場合は年度ごとの原表名を表示します。参加状況・診断群定義・秘匿セルが年度で異なるため、増減を医療需要や質の変化と断定できません。「－」は0に置換していません。</p>`;
  } catch (e) {
    box.innerHTML = `<h3>病院別の令和3～6年度推移</h3><p class="caution">経年データを読み込めませんでした。${esc(e.message)}</p>`;
  }
}
function fillSelect(el, rows, selected = "") {
  el.textContent = "";
  for (const [value, label] of rows) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    o.selected = value === selected;
    el.append(o);
  }
}
function quantiles(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  return [0, 0.25, 0.5, 0.75, 1].map(
    (q) => a[Math.min(a.length - 1, Math.floor((a.length - 1) * q))] || 0,
  );
}
function classFor(v, q) {
  if (!Number.isFinite(v)) return "no-data";
  if (v <= q[1]) return "c0";
  if (v <= q[2]) return "c1";
  if (v <= q[3]) return "c2";
  if (v < q[4]) return "c3";
  return "c4";
}
async function ensureAreaMdcDataset() {
  if (state.areaMdcDataset) return state.areaMdcDataset;
  if (!state.areaMdcDatasetPromise) state.areaMdcDatasetPromise = loadBase64GzipJson("/dpc/data/area-mdc-summary.json.gz.b64?v=1").then((data) => (state.areaMdcDataset = data));
  return state.areaMdcDatasetPromise;
}
function areaMdcLabel() {
  const mdc = state.summary.mdc.find((row) => row.code === state.areaMdc);
  return mdc ? `${mdc.code} ${mdc.name}` : "";
}
function areaRowsForDisplay() {
  if (!state.areaMdc) return state.summary.areas;
  return state.summary.areas.map((area) => ({...area, ...(state.areaMdcSummary.get(area.code) || {
    published: 0, suppressed: 0, surgeryPublished: 0, surgerySuppressed: 0,
    emergencyPublished: 0, emergencySuppressed: 0, ambulancePublished: 0, ambulanceSuppressed: 0,
    death24hPublished: 0, death24hSuppressed: 0, hospitalCount: 0,
  })}));
}
function renderMap() {
  const year = yearLabels.get(state.selectedYear), mdcLabel = areaMdcLabel();
  $("map-caption").textContent =
    state.metric === "death24hPublished"
      ? `${year}${mdcLabel ? `・${mdcLabel}` : ""}。色は数値として公表された件数を示します。秘匿セルがある地域の0は、実際の0件を意味しません。`
      : `${year}${mdcLabel ? `・${mdcLabel}` : ""}。色が濃いほど公表分件数が多い医療圏です。`;
  const displayRows = areaRowsForDisplay(), svg = $("area-map"),
    areaMap = new Map(displayRows.map((x) => [x.code, x]));
  svg.textContent = "";
  svg.setAttribute(
    "viewBox",
    (state.geometry.viewBox || [0, 0, 1000, 720]).join(" "),
  );
  const visible = displayRows.filter(
    (a) => !state.pref || a.code.startsWith(state.pref),
  );
  const q = quantiles(visible.map((a) => Number(a[state.metric])));
  for (const geo of state.geometry.areas) {
    if (state.pref && !geo.code.startsWith(state.pref)) continue;
    const row = areaMap.get(geo.code),
      p = document.createElementNS(svgNS, "path");
    p.setAttribute("d", geo.path);
    p.setAttribute("vector-effect", "non-scaling-stroke");
    p.setAttribute("fill-rule", "evenodd");
    p.setAttribute(
      "class",
      `region ${classFor(Number(row?.[state.metric]), q)}${geo.code === state.selectedArea ? " selected" : ""}`,
    );
    p.setAttribute("tabindex", "0");
    p.setAttribute("role", "button");
    p.setAttribute(
      "aria-label",
      `${geo.prefecture} ${geo.name} ${row ? displayed(row, state.metric) : "データなし"}`,
    );
    const title = document.createElementNS(svgNS, "title");
    title.textContent = p.getAttribute("aria-label");
    p.append(title);
    p.addEventListener("click", () => selectArea(geo.code));
    p.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectArea(geo.code);
      }
    });
    svg.append(p);
  }
  renderLegend(q);
  requestAnimationFrame(() => fitPrefecture(svg));
}
function fitPrefecture(svg) {
  dpcMapView.fit();
}
function renderLegend(q) {
  $("legend").innerHTML =
    `<div class="legend-title">${esc(yearLabels.get(state.selectedYear))}${state.areaMdc ? `・${esc(areaMdcLabel())}` : ""}・${esc(metricLabels[state.metric])}：薄い水色 → 濃い青緑</div><div class="legend-scale">${q.map((v, i) => `<div class="legend-item"><span class="swatch c${i}"></span><span>${i === 0 ? "～" : i === 4 ? "最大 " : ""}${fmt(v)}</span></div>`).join("")}</div>`;
}
async function loadPref(pref) {
  const year = state.selectedYear, cacheKey = `${year}:${pref}`;
  if (!state.prefHospitals.has(cacheKey)) {
    let rows;
    if (year === "2024") {
      rows = await loadJson(`/dpc/data/pref/${pref}.json.gz`);
      for (const h of rows) {
        const extra = state.death24h.hospitals[`${h.notice}:${h.serial}`] || {};
        for (const m of state.summary.mdc) Object.assign(h.mdc[m.code], extra[m.code] || {death24hPublished: 0, death24hSuppressed: 0});
        h.death24hPublished = Object.values(h.mdc).reduce((n, x) => n + x.death24hPublished, 0);
        h.death24hSuppressed = Object.values(h.mdc).reduce((n, x) => n + x.death24hSuppressed, 0);
      }
    } else {
      const payload = await loadYearPayload(year);
      rows = payload.hospitals.filter((h) => h.municipality.startsWith(pref));
    }
    state.prefHospitals.set(cacheKey, rows);
  }
  return state.prefHospitals.get(cacheKey);
}
async function loadHospitalSearchRows(pref) {
  if (pref) return loadPref(pref);
  const year = state.selectedYear;
  if (state.nationalHospitals.has(year)) return state.nationalHospitals.get(year);
  if (state.nationalHospitalPromises.has(year)) return state.nationalHospitalPromises.get(year);
  const promise = (async () => {
    $("hospital-result-count").textContent = `${yearLabels.get(year)}・全国の病院データを読み込み中…`;
    let rows;
    if (year !== "2024") {
      rows = (await loadYearPayload(year)).hospitals;
    } else {
      rows = [];
      const codes = prefectures.slice(1).map(([code]) => code);
      for (let i = 0; i < codes.length; i += 6) {
        const batch = await Promise.all(codes.slice(i, i + 6).map((code) => loadPref(code)));
        rows.push(...batch.flat());
        $("hospital-result-count").textContent = `${yearLabels.get(year)}・全国の病院データを読み込み中（${Math.min(i + 6, codes.length)}／${codes.length}都道府県）…`;
      }
    }
    state.nationalHospitals.set(year, rows);
    return rows;
  })();
  state.nationalHospitalPromises.set(year, promise);
  try {
    return await promise;
  } finally {
    state.nationalHospitalPromises.delete(year);
  }
}
function aggregateAreas(rows) {
  return rows.reduce((total, row) => {
    for (const key of ["published", "suppressed", "surgeryPublished", "surgerySuppressed", "emergencyPublished", "emergencySuppressed", "ambulancePublished", "ambulanceSuppressed", "death24hPublished", "death24hSuppressed", "hospitalCount"]) {
      total[key] += Number(row[key] || 0);
    }
    return total;
  }, {
    published: 0, suppressed: 0,
    surgeryPublished: 0, surgerySuppressed: 0,
    emergencyPublished: 0, emergencySuppressed: 0,
    ambulancePublished: 0, ambulanceSuppressed: 0,
    death24hPublished: 0, death24hSuppressed: 0,
    hospitalCount: 0,
  });
}
function renderPrefectureAreaDetail(pref) {
  const rows = areaRowsForDisplay().filter((area) => area.code.startsWith(pref));
  const total = aggregateAreas(rows);
  const name = prefectures.find(([code]) => code === pref)?.[1] || "選択都道府県";
  $("area-detail").innerHTML =
    `<p>${esc(yearLabels.get(state.selectedYear))}／都道府県全体${state.areaMdc ? `／${esc(areaMdcLabel())}` : ""}</p><h2>${esc(name)}全体</h2><p class="big-value">${areaValueMarkup(total, state.metric)}</p><p class="subtle">${esc(metricLabels[state.metric])}。病院所在地基準で、都道府県内の二次医療圏を合算しています。</p><ul class="stat-list"><li>退院患者数：${areaValueMarkup(total, "published")}</li><li>手術あり：${areaValueMarkup(total, "surgeryPublished")}</li><li>救急医療入院：${areaValueMarkup(total, "emergencyPublished")}</li><li>救急車搬送：${areaValueMarkup(total, "ambulancePublished")}</li><li>入院後24時間以内死亡：${areaValueMarkup(total, "death24hPublished")}</li><li>集計対象：${fmt(total.hospitalCount)}施設</li></ul><h3>二次医療圏を詳しく見る</h3><p class="subtle">左の地図から二次医療圏を選ぶと、その医療圏の数値${state.areaMdc ? "・主な施設" : "・年度推移・主な施設"}へ切り替わります。公表された数値の合計です。「－」の病院がある場合、実際の件数は表示値以上となる可能性があります。</p>`;
}
function renderNationalAreaPrompt() {
  $("area-detail").innerHTML =
    `<p>${esc(yearLabels.get(state.selectedYear))}／全国表示${state.areaMdc ? `／${esc(areaMdcLabel())}` : ""}</p><h2>全国の二次医療圏</h2><p>都道府県を選ぶと、その都道府県全体の集計値を表示します。全国地図から二次医療圏を直接選ぶこともできます。</p><p class="subtle">右側には、選択した都道府県または二次医療圏の数値を表示します。</p>`;
}
function aggregateAreaMdcHospitals(rows, mdc) {
  const grouped = new Map();
  for (const h of rows) {
    if (!h.area) continue;
    const x = h.mdc?.[mdc];
    if (!x) continue;
    if (!grouped.has(h.area)) grouped.set(h.area, aggregateAreas([]));
    const total = grouped.get(h.area);
    for (const key of ["published", "suppressed", "surgeryPublished", "surgerySuppressed", "emergencyPublished", "emergencySuppressed", "ambulancePublished", "ambulanceSuppressed", "death24hPublished", "death24hSuppressed"]) total[key] += Number(x[key] || 0);
    if (Object.values(x).some((value) => Number(value || 0) > 0)) total.hospitalCount += 1;
  }
  return grouped;
}
async function refreshAreaMdcData() {
  const token = ++state.areaMdcLoadToken;
  if (state.areaMdc) {
    $("area-detail").innerHTML = `<p>${esc(yearLabels.get(state.selectedYear))}／${esc(areaMdcLabel())}</p><h2>診療分野別データを読み込み中…</h2>`;
    const data = await ensureAreaMdcDataset();
    if (token !== state.areaMdcLoadToken) return;
    state.areaMdcSummary = new Map(Object.entries(data.years[state.selectedYear] || {}).map(([area, mdcs]) => [area, mdcs[state.areaMdc] || aggregateAreas([])]));
  } else state.areaMdcSummary = new Map();
  renderMap();
  if (state.selectedArea) await selectArea(state.selectedArea);
  else if (state.pref) renderPrefectureAreaDetail(state.pref);
  else renderNationalAreaPrompt();
  updateUrl();
}
async function selectPrefectureAreaScope(pref) {
  state.pref = pref;
  state.selectedArea = null;
  await refreshAreaMdcData();
}
async function selectArea(code) {
  if (!state.summary.areas.some((area) => area.code === code)) code = state.summary.areas[0]?.code;
  state.selectedArea = code;
  state.pref = code.slice(0, 2);
  $("prefecture-select").value = state.pref;
  renderMap();
  const row = areaRowsForDisplay().find((a) => a.code === code);
  const hospitals = (await loadPref(state.pref))
    .filter((h) => h.area === code && (!state.areaMdc || Object.values(h.mdc?.[state.areaMdc] || {}).some((value) => Number(value || 0) > 0)))
    .sort((a, b) => Number((state.areaMdc ? b.mdc?.[state.areaMdc] : b)?.published || 0) - Number((state.areaMdc ? a.mdc?.[state.areaMdc] : a)?.published || 0));
  $("area-detail").innerHTML =
    `<p>${esc(yearLabels.get(state.selectedYear))}／${esc(row.prefecture)}・二次医療圏${state.areaMdc ? `／${esc(areaMdcLabel())}` : ""}</p><h2>${esc(row.name)}</h2><p class="big-value">${areaValueMarkup(row, state.metric)}</p><p class="subtle">${esc(metricLabels[state.metric])}。病院所在地基準です。</p><ul class="stat-list"><li>退院患者数：${areaValueMarkup(row, "published")}</li><li>手術あり：${areaValueMarkup(row, "surgeryPublished")}</li><li>救急医療入院：${areaValueMarkup(row, "emergencyPublished")}</li><li>救急車搬送：${areaValueMarkup(row, "ambulancePublished")}</li><li>入院後24時間以内死亡：${areaValueMarkup(row, "death24hPublished")}</li><li>集計対象：${fmt(row.hospitalCount)}施設</li></ul>${state.areaMdc ? renderAreaMdcTrend(code) : renderAreaTrend(code, row)}<h3>${esc(yearLabels.get(state.selectedYear))}${state.areaMdc ? `・${esc(areaMdcLabel())}` : ""}・退院患者数の多い施設</h3><table class="area-hospitals"><thead><tr><th>病院</th><th>公表分</th></tr></thead><tbody>${hospitals
      .slice(0, 8)
      .map(
        (h) =>
          `<tr><td>${esc(h.name)}</td><td>${esc(displayed(state.areaMdc ? h.mdc?.[state.areaMdc] || {} : h, "published"))}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table><p class="subtle">秘匿値がある施設間の厳密な順位ではありません。</p>`;
  updateUrl();
}
async function switchTab(tab) {
  if (tab !== "hospital" && $("hospital-dialog")?.open) $("hospital-dialog").close();
  for (const name of ["area", "hospital", "classification"]) {
    const active = name === tab;
    $(`${name}-tab`).classList.toggle("active", active);
    $(`${name}-tab`).setAttribute("aria-selected", active);
    $(`${name}-panel`).hidden = !active;
  }
  if (tab === "hospital") renderHospitalList();
  if (tab === "classification") await ensureDiagnosis();
  updateUrl();
}
function hospitalAreaName(h) {
  return h.area ? state.summary.areas.find((a) => a.code === h.area)?.name || "医療圏未対応" : "医療圏未対応";
}
function updateHospitalAreaOptions(rows, pref) {
  const el = $("hospital-area"), current = el.value;
  if (!pref) {
    fillSelect(el, [["", "すべて"]], "");
    el.disabled = true;
    el.title = "都道府県を選ぶと二次医療圏で絞り込めます";
    return;
  }
  el.disabled = false;
  el.title = "";
  const options = [...new Map(rows.map((h) => [h.area || "", hospitalAreaName(h)])).entries()]
    .filter(([code]) => code)
    .sort((a, b) => a[1].localeCompare(b[1], "ja"));
  fillSelect(el, [["", "すべて"], ...options], options.some(([code]) => code === current) ? current : "");
}
function setHospitalFinderHelp(text) {
  $("hospital-finder-help").textContent = text;
}
async function activateHospitalGoal(goal) {
  state.hospitalGoal = goal;
  document.querySelectorAll("[data-hospital-goal]").forEach((button) =>
    button.classList.toggle("active", button.dataset.hospitalGoal === goal),
  );
  await switchTab("hospital");
  if (goal === "region") {
    setHospitalFinderHelp("都道府県と二次医療圏から、病院別の公表値を探します。");
    $("hospital-prefecture").focus();
  } else if (goal === "mdc") {
    setHospitalFinderHelp("MDCを選ぶと、その診療分野の退院患者数をカードの主表示にして、件数が多い順に並べます。病院機能の指標も比較できます。");
    $("hospital-mdc").focus();
  } else if (goal === "emergency") {
    $("hospital-metric").value = "emergencyPublished";
    setHospitalFinderHelp("救急医療入院などの指標をカードに表示し、公表分件数の多い順に確認します。件数は質の順位ではありません。");
    await renderHospitalList();
    $("hospital-metric").focus();
  } else {
    $("hospital-metric").value = "surgeryPublished";
    setHospitalFinderHelp("①診療分野（MDC）を選ぶ　②病院カードの「疾患・手術を見る」を押すと、選択したMDCの疾患名・手術名・Kコード検索をすぐに表示します。");
    await renderHospitalList();
    $("hospital-mdc").focus();
  }
  $("hospital-panel").scrollIntoView({behavior: "smooth", block: "start"});
}
async function renderHospitalList() {
  const pref = $("hospital-prefecture").value;
  const rows = await loadHospitalSearchRows(pref);
  updateHospitalAreaOptions(rows, pref);
  const query = $("hospital-search").value.trim().toLocaleLowerCase("ja"),
    area = $("hospital-area").value,
    mdc = $("hospital-mdc").value,
    metric = $("hospital-metric").value || "published";
  const mdcDefinition = mdc ? state.summary.mdc.find((row) => row.code === mdc) : null;
  const mdcLabel = mdcDefinition ? `${mdcDefinition.code} ${mdcDefinition.name}` : "";
  const filtered = rows.filter((h) => {
    const mdcRow = mdc ? h.mdc?.[mdc] : null;
    return (!query || [h.name, h.type, hospitalAreaName(h)].join(" ").toLocaleLowerCase("ja").includes(query))
      && (!area || h.area === area)
      && (!mdc || Number(mdcRow?.published || 0) > 0 || Number(mdcRow?.suppressed || 0) > 0);
  }).sort((a, b) => {
    const aValue = mdc ? Number(a.mdc?.[mdc]?.published || 0) : Number(a[metric] || 0);
    const bValue = mdc ? Number(b.mdc?.[mdc]?.published || 0) : Number(b[metric] || 0);
    return bValue - aValue || a.name.localeCompare(b.name, "ja");
  });
  $("hospital-metric-label").textContent = mdc ? "比較する病院機能" : "カードの主表示・並び順";
  $("hospital-result-count").textContent = mdc
    ? `${yearLabels.get(state.selectedYear)}・${fmt(filtered.length)}施設／${mdcLabel}の退院患者数が多い順／比較：${metricLabels[metric]}`
    : `${yearLabels.get(state.selectedYear)}・${fmt(filtered.length)}施設／表示：${metricLabels[metric]}が多い順`;
  const box = $("hospital-results");
  box.innerHTML = filtered
    .slice(0, state.hospitalLimit)
    .map((h) => {
      const key = `${h.notice}:${h.serial}`, active = state.selectedHospital && `${state.selectedHospital.notice}:${state.selectedHospital.serial}` === key;
      const mdcRow = mdc ? h.mdc?.[mdc] : null;
      const valueMarkup = mdc
        ? `<div class="hospital-card-value hospital-card-mdc-value"><span>${esc(mdcLabel)}の退院患者数</span><strong>${esc(displayed(mdcRow || {}, "published"))}</strong><small>この件数が多い順に表示</small></div><div class="hospital-card-compare"><span>比較：${esc(metricLabels[metric])}</span><strong>${esc(displayed(h, metric))}</strong></div>`
        : `<div class="hospital-card-value"><span>${esc(metricLabels[metric])}</span><strong>${esc(displayed(h, metric))}</strong></div><div class="hospital-card-mini"><span>手術あり<b>${esc(displayed(h, "surgeryPublished"))}</b></span><span>救急入院<b>${esc(displayed(h, "emergencyPublished"))}</b></span><span>救急車搬送<b>${esc(displayed(h, "ambulancePublished"))}</b></span></div>`;
      const needsMdc = state.hospitalGoal === "surgery" && !mdc;
      return `<article class="hospital-card${active ? " active" : ""}"><div><p>${esc(hospitalAreaName(h))}</p><h3>${esc(h.name)}</h3><small>${esc(h.type || "病院区分未記載")}${h.dpcBeds == null ? "" : ` ／ DPC算定病床 ${fmt(h.dpcBeds)}床`}</small></div>${valueMarkup}<div class="hospital-card-actions"><button class="hospital-card-open-button" type="button" data-key="${esc(key)}" data-action="summary">詳しく見る</button><button class="hospital-card-open-button hospital-card-surgery-button" type="button" data-key="${esc(key)}" data-action="surgery"${needsMdc ? " disabled" : ""}>${needsMdc ? "先に診療分野を選択" : "疾患・手術を見る"}</button></div></article>`;
    })
    .join("");
  $("hospital-more").hidden = state.hospitalLimit >= filtered.length;
  const openHospital = (button) => {
    const hospital = rows.find((h) => `${h.notice}:${h.serial}` === button.dataset.key);
    if (hospital) {
      state.hospitalDetailMode = button.dataset.action === "surgery" ? "surgery" : "summary";
      selectHospital(hospital);
      renderHospitalList();
      const dialog = $("hospital-dialog");
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
      if (state.hospitalDetailMode === "surgery") {
        requestAnimationFrame(() => {
          const section = $("hospital-detail").querySelector(".surgery-browser");
          if (section) {
            dialog.scrollTop = Math.max(0, section.offsetTop - 12);
            $("surgery-search")?.focus({preventScroll: true});
          }
        });
      }
    }
  };
  box.querySelectorAll(".hospital-card-open-button").forEach((button) =>
    button.addEventListener("click", () => openHospital(button)),
  );
}

function selectHospital(h) {
  state.selectedHospital = h;
  updateUrl();
  const year = yearLabels.get(state.selectedYear);
  const max = Math.max(1, ...Object.values(h.mdc).map((x) => x.published));
  const surgeryMode = state.hospitalDetailMode === "surgery";
  const selectedFinderMdc = $("hospital-mdc").value;
  const surgeryStatus = selectedFinderMdc ? "病院検索で選択した診療分野を引き継いでいます。" : "MDCを選ぶと、疾患名・手術名・Kコードで検索できます。";
  const surgerySection = `<section class="surgery-browser${surgeryMode ? " surgery-browser-priority" : ""}">${surgeryMode ? `<p class="surgery-flow-status"><strong>疾患・手術を見る</strong><span>${esc(surgeryStatus)}</span></p>` : ""}<h3>疾患・手術別（数値公表分）</h3><p class="subtle">MDCを選ぶと、${esc(year)}の分類だけを読み込みます。数値が公表された疾患のみ表示し、非表示や「－」は0件を意味しません。</p><div class="surgery-controls"><label>MDC<select id="surgery-mdc"></select></label><label>疾患・手術・Kコード検索<input id="surgery-search" type="search" placeholder="例：脳腫瘍、010010、脳腫瘍摘出術、K169"></label></div><div id="surgery-results" aria-live="polite"><p>読み込み中…</p></div></section>`;
  $("hospital-detail").innerHTML =
    `<p>${esc(year)}／${esc(h.prefecture)}／${esc(state.summary.areas.find((a) => a.code === h.area)?.name || "医療圏未対応")}</p><h2>${esc(h.name)}</h2><p class="subtle">${esc(h.type || "")} ${h.dpcBeds == null ? "" : `／ DPC算定病床 ${fmt(h.dpcBeds)}床`}</p><div class="summary-grid"><div><span>退院患者数</span><strong>${esc(displayed(h, "published"))}</strong></div><div><span>手術あり</span><strong>${esc(displayed(h, "surgeryPublished"))}</strong><small>${esc(percentText(h.surgeryPublished,h.published,h.surgerySuppressed,h.suppressed))}</small></div><div><span>救急医療入院</span><strong>${esc(displayed(h, "emergencyPublished"))}</strong><small>${esc(percentText(h.emergencyPublished,h.published,h.emergencySuppressed,h.suppressed))}</small></div><div><span>救急車搬送</span><strong>${esc(displayed(h, "ambulancePublished"))}</strong><small>${esc(percentText(h.ambulancePublished,h.published,h.ambulanceSuppressed,h.suppressed))}</small></div><div><span>入院後24時間以内死亡</span><strong>${esc(displayed(h, "death24hPublished"))}</strong><small>質の順位には使用できません</small></div><div><span>DPC病床100床当たり退院患者</span><strong>${esc(perHundredBedsText(h.published,h.dpcBeds,h.suppressed))}</strong><small>病床規模を考慮した参考値</small></div></div><section id="hospital-history" class="area-trend" aria-live="polite"><h3>病院別の令和3～6年度推移</h3><p>読み込み中…</p></section><h3>${esc(year)}・MDC別</h3><div class="trend-table-wrap"><table class="mdc-table"><thead><tr><th>MDC</th><th>退院患者数</th><th>構成</th><th>手術あり</th><th>救急医療入院</th><th>救急車搬送</th><th>入院後24時間以内死亡</th></tr></thead><tbody>${state.summary.mdc
      .map((m) => {
        const x = h.mdc[m.code];
        return `<tr><td>${esc(m.code)} ${esc(m.name)}</td><td>${esc(displayed(x, "published"))}</td><td><progress value="${x.published}" max="${max}">${x.published}</progress><small class="composition-value">${esc(percentText(x.published,h.published,x.suppressed,h.suppressed))}</small></td><td>${esc(displayed(x, "surgeryPublished"))}</td><td>${esc(displayed(x, "emergencyPublished"))}</td><td>${esc(displayed(x, "ambulancePublished"))}</td><td>${esc(displayed(x, "death24hPublished"))}</td></tr>`;
      })
      .join(
        "",
      )}</tbody></table></div><p class="subtle">「－」を0にしていないため、秘匿がある欄は公表分下限値です。病院の質・治療成績の順位ではありません。</p>${surgerySection}`;
  if (surgeryMode) {
    const detail = $("hospital-detail");
    const section = detail.querySelector(".surgery-browser");
    const summary = detail.querySelector(".summary-grid");
    if (section && summary) detail.insertBefore(section, summary);
  }
  renderHospitalHistory(h);
  const selectedSearchMdc = surgeryMode && $("hospital-mdc").value ? $("hospital-mdc").value : "01";
  fillSelect($("surgery-mdc"), state.summary.mdc.filter(m => m.code !== "17").map(m => [m.code, `${m.code} ${m.name}`]), selectedSearchMdc);
  $("surgery-mdc").addEventListener("change", renderHospitalSurgery);
  $("surgery-search").addEventListener("input", renderHospitalSurgery);
  renderHospitalSurgery();
}
async function loadSurgeryMdc(mdc) {
  const year = state.selectedYear, key = `${year}:${mdc}`;
  if (!state.surgeryMdc.has(key)) {
    const data = year === "2024"
      ? await loadJson(`/dpc/data/surgery/mdc${mdc}.json.gz`)
      : await loadBase64GzipJson(`/dpc/data/surgery/${year}/mdc${mdc}.json.gz.b64?v=1`);
    state.surgeryMdc.set(key, data);
  }
  return state.surgeryMdc.get(key);
}
async function loadSurgeryDefinitions(year = state.selectedYear) {
  if (!state.surgeryDefinitions.has(year)) {
    const url = year === "2024"
      ? "/dpc/data/surgery-definitions.json"
      : `/dpc/data/surgery-definitions-${year}.json`;
    state.surgeryDefinitions.set(year, await loadJson(url));
  }
  return state.surgeryDefinitions.get(year);
}
function surgeryCategory(label, diseaseCode) {
  const raw = String(label ?? "").trim();
  if (raw === "99") {
    return {
      code: "99",
      title: "手術なし",
      note: "この入院では、DPC上の手術あり区分に該当しません。",
    };
  }
  if (raw === "97") {
    return {
      code: "97",
      title: "その他の手術あり",
      note: "01～06の指定手術には該当しない、その他の手術がある入院です。",
    };
  }
  if (raw.startsWith("97") && raw.includes("輸血以外")) {
    return {
      code: "97",
      title: "その他の手術あり（輸血だけの症例を除く・再掲）",
      note: "97の内数です。97とは別に足しません。",
      subset: true,
    };
  }
  if (/^0[1-6]$/.test(raw)) {
    const definition = state.surgeryDefinitions
      .get(state.selectedYear)?.diseases?.[diseaseCode]?.[raw];
    return {
      code: raw,
      title: definition?.title || `指定手術グループ ${raw}`,
      note: definition
        ? `${yearLabels.get(state.selectedYear)}DPC定義表の名称です。`
        : `この疾患について${yearLabels.get(state.selectedYear)}DPC定義表で指定された手術です。`,
      procedures: definition?.procedures || [],
    };
  }
  return {
    code: raw,
    title: "DPC上の手術区分",
    note: "具体的な内容は、この疾患のDPC定義表で決まります。",
  };
}
function readableKCode(code) {
  return String(code || "").replaceAll("$", "系").replaceAll("+", "＋");
}
function surgeryProcedureDetails(procedures) {
  if (!procedures?.length) return "";
  return `<details class="surgery-procedures"><summary>含まれる手術・Kコードを見る（${fmt(procedures.length)}種類）</summary><ul>${procedures
    .map(
      ([name, kCode]) =>
        `<li><span>${esc(name)}</span>${kCode ? `<code>${esc(readableKCode(kCode))}</code>` : ""}</li>`,
    )
    .join("")}</ul></details>`;
}
function surgeryCategoryCell(label, diseaseCode) {
  const item = surgeryCategory(label, diseaseCode);
  return `<div class="surgery-category"><span class="surgery-code">${esc(item.code)}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.note)}</small>${item.subset ? '<em>97の内数</em>' : ""}${surgeryProcedureDetails(item.procedures)}</span></div>`;
}
function surgeryDefinitionHaystack(definitions, diseaseCode) {
  const groups = definitions?.diseases?.[diseaseCode] || {};
  return Object.entries(groups)
    .flatMap(([groupCode, group]) => [
      groupCode,
      group.title,
      ...(group.procedures || []).flatMap(([name, kCode]) => [name, readableKCode(kCode)]),
    ])
    .join(" ")
    .toLocaleUpperCase("ja");
}
function matchingSurgeryDefinitions(definitions, diseaseCode, query) {
  if (!query) return "";
  const groups = definitions?.diseases?.[diseaseCode] || {};
  const matches = [];
  for (const [groupCode, group] of Object.entries(groups)) {
    for (const [name, kCode] of group.procedures || []) {
      const readable = readableKCode(kCode);
      if (`${groupCode} ${group.title} ${name} ${readable}`.toLocaleUpperCase("ja").includes(query)) {
        matches.push([groupCode, name, readable]);
      }
    }
  }
  if (!matches.length) return "";
  return `<aside class="surgery-search-match"><strong>検索語に一致した手術定義</strong><ul>${matches
    .slice(0, 30)
    .map(([groupCode, name, kCode]) => `<li><span>区分${esc(groupCode)}　${esc(name)}</span>${kCode ? `<code>${esc(kCode)}</code>` : ""}</li>`)
    .join("")}</ul>${matches.length > 30 ? `<p class="subtle">ほか${fmt(matches.length - 30)}件</p>` : ""}</aside>`;
}
async function renderHospitalSurgery() {
  const box = $("surgery-results");
  if (!box || !state.selectedHospital) return;
  const mdc = $("surgery-mdc").value, query = $("surgery-search").value.trim().toLocaleUpperCase("ja");
  box.innerHTML = "<p>読み込み中…</p>";
  try {
    const data = await loadSurgeryMdc(mdc);
    const definitions = await loadSurgeryDefinitions();
    const key = `${state.selectedHospital.notice}:${state.selectedHospital.serial}`;
    const items = (data.hospitals[key] || []).filter(x => {
      const d = data.diseases[x[0]];
      const haystack = `${d.code} ${d.name} ${surgeryDefinitionHaystack(definitions, d.code)}`
        .toLocaleUpperCase("ja");
      return !query || haystack.includes(query);
    });
    if (!items.length) { box.innerHTML = '<p class="subtle">この条件で数値が公表された疾患はありません。0件とは限りません。</p>'; return; }
    const definitionNote = `手術名とKコードは${yearLabels.get(state.selectedYear)}に適用された厚生労働省DPC定義表（${definitions.meta.effective}時点）に基づきます。`;
    box.innerHTML = `<aside class="surgery-guide"><strong>手術区分の見方</strong><ul><li><b>99</b>は手術なし、<b>97</b>はその他の手術ありです。</li><li><b>01～06</b>は疾患ごとの指定手術区分です。数字の大小は、重症度・難易度・治療成績を表しません。</li><li><b>98</b>は現行のDPC手術区分には割り当てられていません。</li><li><b>「輸血以外の再掲」</b>は97に含まれる参考値です。97と足し算しないでください。</li></ul></aside>` + items.map(x => { const d=data.diseases[x[0]], counts=x[1], los=x[2], matched=matchingSurgeryDefinitions(definitions,d.code,query); return `<article class="surgery-disease"><h4><code>${esc(d.code)}</code> ${esc(d.name)}</h4>${matched}<table class="mdc-table surgery-table"><thead><tr><th>DPC上の手術区分</th><th>件数</th><th>平均在院日数</th></tr></thead><tbody>${d.labels.map((label,i)=>`<tr><td>${surgeryCategoryCell(label,d.code)}</td><td>${counts[i]==null?"－":fmt(counts[i])+"件"}</td><td>${los[i]==null?"－":Number(los[i]).toLocaleString("ja-JP")+"日"}</td></tr>`).join("")}</tbody></table><p class="surgery-footnote">${esc(definitionNote)}件数や在院日数だけで病院の質・治療成績は判断できません。</p></article>`; }).join("");
  } catch (e) { box.innerHTML = `<p class="caution">疾患・手術別データを読み込めませんでした。${esc(e.message)}</p>`; }
}
const metricValue = (v) => (typeof v === "number" ? `${fmt(v)}件` : "－");
function inflateDiagnosisRow(row) {
  const [code, name, inclusive, mdc, mdcName, cases, targetCases, prepCases,
    male, female, ages, referral, outpatient, ambulance, unplanned, emergency,
    homeDischarge, transfer, death, losMean, losMedian, los90, icd, surgery,
    ventilator, dialysis, centralLine, transfusion] = row;
  return {code, name, inclusive, mdc, mdcName, cases, targetCases, prepCases,
    male, female, ages, referral, outpatient, ambulance, unplanned, emergency,
    homeDischarge, transfer, death, losMean, losMedian, los90,
    icd: (icd || []).map(([itemCode, itemCases]) => ({code: itemCode, cases: itemCases})),
    surgery: (surgery || []).map(([itemCode, itemCases]) => ({code: itemCode, cases: itemCases})),
    ventilator, dialysis, centralLine, transfusion};
}
async function ensureDiagnosis() {
  const year = state.selectedYear;
  if (!state.diagnoses.has(year)) {
    const data = year === "2024"
      ? await loadJson("/dpc/data/diagnosis-groups.json.gz")
      : await loadBase64GzipJson(`/dpc/data/diagnosis/${year}.json.gz.b64?v=1`);
    if (data.meta.rowSchema === "v1-array") data.rows = data.rows.map(inflateDiagnosisRow);
    state.diagnoses.set(year, data);
  }
  state.diagnosis = state.diagnoses.get(year);
  await loadSurgeryDefinitions();
  const selectedMdc = $("classification-mdc").value;
  fillSelect($("classification-mdc"), [
    ["", "すべて"],
    ...state.summary.mdc.map((m) => [m.code, `${m.code} ${m.name}`]),
  ], state.summary.mdc.some((m) => m.code === selectedMdc) ? selectedMdc : "");
  if (!state.diagnosisListenersBound) {
    $("classification-mdc").addEventListener("change", renderClassifications);
    $("classification-search").addEventListener("input", renderClassifications);
    state.diagnosisListenersBound = true;
  }
  $("classification-detail").innerHTML = `<p>${esc(yearLabels.get(year))}の診断群分類を選択すると、全国集計の詳細を表示します。</p>`;
  renderClassifications();
}
function classificationHaystack(r) {
  return [
    r.code,
    r.name,
    r.mdcName,
    ...r.icd.map((x) => x.code),
    ...r.surgery.flatMap((x) => [x.code, ...surgeryNamesForCode(x.code)]),
  ]
    .join(" ")
    .toLocaleUpperCase("ja");
}
function renderClassifications() {
  const q = $("classification-search").value.trim().toLocaleUpperCase("ja"),
    mdc = $("classification-mdc").value;
  const rows = state.diagnosis.rows.filter(
    (r) =>
      (!mdc || r.mdc === mdc) && (!q || classificationHaystack(r).includes(q)),
  );
  $("classification-result-count").textContent =
    `${yearLabels.get(state.selectedYear)}・${fmt(rows.length)}分類（全国集計）${rows.length > 500 ? "／先頭500件を表示。検索で絞り込んでください" : ""}`;
  const box = $("classification-results");
  box.innerHTML = rows
    .slice(0, 500)
    .map(
      (r) =>
        `<button type="button" data-code="${esc(r.code)}"><span>${esc(r.name)}</span><small>${esc(r.code)} ／ ${esc(r.mdcName)} ／ ${metricValue(r.cases)}</small></button>`,
    )
    .join("");
  box
    .querySelectorAll("button")
    .forEach((b) =>
      b.addEventListener("click", () =>
        selectClassification(
          state.diagnosis.rows.find((r) => r.code === b.dataset.code),
        ),
      ),
    );
}
function codeList(rows) {
  return rows.length
    ? rows
        .map(
          (x) =>
            `<tr><td>${esc(x.code)}</td><td>${metricValue(x.cases)}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="2">公表なし</td></tr>';
}
function kCodeMatches(publishedCode, definitionCode) {
  const published = String(publishedCode || "").toLocaleUpperCase("ja");
  const base = String(definitionCode || "").split("+")[0].toLocaleUpperCase("ja");
  return base.endsWith("$") ? published.startsWith(base.slice(0, -1)) : published === base;
}
function surgeryNameIndex() {
  if (state.surgeryNameIndexes.has(state.selectedYear)) return state.surgeryNameIndexes.get(state.selectedYear);
  const definitions = state.surgeryDefinitions.get(state.selectedYear);
  const index = {exact: new Map(), wildcard: []};
  for (const groups of Object.values(definitions?.diseases || {})) {
    for (const group of Object.values(groups || {})) {
      for (const [name, definitionCode] of group.procedures || []) {
        const base = String(definitionCode || "").split("+")[0].toLocaleUpperCase("ja");
        if (!base) continue;
        if (base.endsWith("$")) {
          const prefix = base.slice(0, -1);
          let item = index.wildcard.find((x) => x.prefix === prefix);
          if (!item) index.wildcard.push(item = {prefix, names: []});
          if (!item.names.includes(name)) item.names.push(name);
        } else {
          const names = index.exact.get(base) || [];
          if (!names.includes(name)) names.push(name);
          index.exact.set(base, names);
        }
      }
    }
  }
  state.surgeryNameIndexes.set(state.selectedYear, index);
  return index;
}
function surgeryNamesForCode(code) {
  const published = String(code || "").toLocaleUpperCase("ja");
  const index = surgeryNameIndex();
  return [...new Set([
    ...(index.exact.get(published) || []),
    ...index.wildcard.filter((x) => published.startsWith(x.prefix)).flatMap((x) => x.names),
  ])];
}
function surgeryNameFallback(code) {
  const published = String(code || "").trim().toLocaleUpperCase("ja");
  return /^K[0-9]{3}/.test(published)
    ? '<span title="このKコードは全国集計に掲載されていますが、選択年度のDPC定義表に手術名称が収録されていません。">DPC年度定義表の名称収録対象外</span>'
    : '<span title="選択年度のDPC定義表で名称とコード表記を確認できません。">コード表記を確認できません</span>';
}
function surgeryCodeList(rows) {
  return rows.length
    ? rows.map((x) => {
        const names = surgeryNamesForCode(x.code);
        return `<tr><td>${esc(x.code)}</td><td>${names.length ? names.map(esc).join("／") : surgeryNameFallback(x.code)}</td><td>${metricValue(x.cases)}</td></tr>`;
      }).join("")
    : '<tr><td colspan="3">公表なし</td></tr>';
}
async function selectClassification(r) {
  updateUrl({classification: r.code});
  await loadSurgeryDefinitions();
  const ageLabels = [
    "0～2歳",
    "3～5歳",
    "6～15歳",
    "16～20歳",
    "21～40歳",
    "41～60歳",
    "61～79歳",
    "80歳以上",
  ];
  $("classification-detail").innerHTML =
    `<p>${esc(r.mdc)} ${esc(r.mdcName)} ／ ${r.inclusive ? "包括評価" : "包括欄の印なし"}</p><h2>${esc(r.name)}</h2><p><code>${esc(r.code)}</code></p><div class="summary-grid"><div><span>全施設区分</span><strong>${metricValue(r.cases)}</strong></div><div><span>DPC対象病院</span><strong>${metricValue(r.targetCases)}</strong></div><div><span>準備＋出来高病院</span><strong>${metricValue(r.prepCases)}</strong></div><div><span>平均在院日数</span><strong>${typeof r.losMean === "number" ? `${r.losMean.toLocaleString("ja-JP")}日` : "－"}</strong></div></div><h3>患者・入退院の構成</h3><table class="mdc-table"><tbody><tr><th>男性</th><td>${metricValue(r.male)}</td><th>女性</th><td>${metricValue(r.female)}</td></tr><tr><th>救急車搬送</th><td>${metricValue(r.ambulance)}</td><th>救急医療入院</th><td>${metricValue(r.emergency)}</td></tr><tr><th>予定外入院</th><td>${metricValue(r.unplanned)}</td><th>他院紹介</th><td>${metricValue(r.referral)}</td></tr><tr><th>家庭へ退院</th><td>${metricValue(r.homeDischarge)}</td><th>転院</th><td>${metricValue(r.transfer)}</td></tr><tr><th>死亡</th><td>${metricValue(r.death)}</td><th>在院日数中央値</th><td>${typeof r.losMedian === "number" ? `${r.losMedian}日` : "－"}</td></tr></tbody></table><h3>年齢分布</h3><div class="age-grid">${ageLabels.map((x, i) => `<div><span>${x}</span><strong>${metricValue(r.ages[i])}</strong></div>`).join("")}</div><div class="code-columns"><section><h3>主な傷病 ICD-10</h3><table class="mdc-table"><thead><tr><th>コード</th><th>件数</th></tr></thead><tbody>${codeList(r.icd)}</tbody></table></section><section><h3>主な手術 Kコード・手術名</h3><table class="mdc-table"><thead><tr><th>コード</th><th>選択年度の手術名</th><th>件数</th></tr></thead><tbody>${surgeryCodeList(r.surgery)}</tbody></table></section></div><h3>主要処置等</h3><p>人工呼吸 ${metricValue(r.ventilator)} ／ 人工腎臓 ${metricValue(r.dialysis)} ／ 中心静脈注射 ${metricValue(r.centralLine)} ／ 輸血 ${metricValue(r.transfusion)}</p><p class="subtle">全国集計です。件数は治療成績や推奨治療を示すものではありません。</p>`;
}
async function init() {
  try {
    const initial = new URLSearchParams(location.search);
    [state.summary, state.geometry, state.death24h, state.areaHistory, state.deathAreaHistory] = await Promise.all([
      loadJson("/dpc/data/summary.json"),
      loadJson("/ndb/service-volume/data/medical-areas.json"),
      loadJson("/dpc/data/death24h.json.gz?v=2"),
      loadJson("/dpc/data/area-history.json?v=1"),
      loadJson("/dpc/data/death24h-area-history.json?v=1"),
    ]);
    for (const area of state.summary.areas) Object.assign(area, state.death24h.areas[area.code] || {death24hPublished: 0, death24hSuppressed: 0});
    state.currentSummary = state.summary;
    state.yearPayloads.set("2024", {
      meta: {year: "2024", label: yearLabels.get("2024"), unavailable: []},
      summary: state.currentSummary,
    });
    fillSelect($("prefecture-select"), prefectures, "");
    fillSelect($("hospital-prefecture"), prefectures, "");
    fillSelect($("hospital-mdc"), [["", "すべて"], ...state.summary.mdc.filter((m) => m.code !== "17").map((m) => [m.code, `${m.code} ${m.name}`])], "");
    fillSelect($("area-mdc-select"), state.summary.mdc.filter((m) => m.code !== "17").map((m) => [m.code, `${m.code} ${m.name}`]), "01");
    $("metric-select").addEventListener("change", (e) => {
      state.metric = e.target.value;
      renderMap();
      if (state.selectedArea) selectArea(state.selectedArea);
      else if (state.pref) renderPrefectureAreaDetail(state.pref);
      else renderNationalAreaPrompt();
    });
    document.querySelectorAll("[data-area-scope]").forEach((button) => button.addEventListener("click", async () => {
      const mdcMode = button.dataset.areaScope === "mdc";
      state.areaMdc = mdcMode ? ($("area-mdc-select").value || "01") : "";
      $("area-mdc-select").hidden = !mdcMode;
      document.querySelectorAll("[data-area-scope]").forEach((item) => item.classList.toggle("active", item === button));
      await refreshAreaMdcData();
    }));
    $("area-mdc-select").addEventListener("change", async (e) => {
      state.areaMdc = e.target.value;
      await refreshAreaMdcData();
    });
    $("prefecture-select").addEventListener("change", (e) => {
      selectPrefectureAreaScope(e.target.value);
    });
    $("national-button").addEventListener("click", () => {
      $("prefecture-select").value = "";
      selectPrefectureAreaScope("");
    });
    $("area-tab").addEventListener("click", () => switchTab("area"));
    $("hospital-tab").addEventListener("click", () => switchTab("hospital"));
    $("classification-tab").addEventListener("click", () =>
      switchTab("classification"),
    );
    document.querySelectorAll("#year-tabs button").forEach((button) =>
      button.addEventListener("click", () => setYear(button.dataset.year)),
    );
    $("hospital-prefecture").addEventListener("change", () => {
      $("hospital-area").value = "";
      state.selectedHospital = null;
      state.hospitalLimit = 50;
      renderHospitalList();
    });
    for (const id of ["hospital-area", "hospital-mdc", "hospital-metric"]) {
      $(id).addEventListener("change", () => {
        state.hospitalLimit = 50;
        renderHospitalList();
      });
    }
    $("hospital-search").addEventListener("input", () => {
      state.hospitalLimit = 50;
      renderHospitalList();
    });
    $("hospital-more").addEventListener("click", () => {
      state.hospitalLimit += 50;
      renderHospitalList();
    });
    $("hospital-reset").addEventListener("click", async () => {
      $("hospital-prefecture").value = "";
      $("hospital-area").value = "";
      $("hospital-mdc").value = "";
      $("hospital-metric").value = "published";
      $("hospital-search").value = "";
      state.selectedHospital = null;
      state.hospitalGoal = null;
      document.querySelectorAll("[data-hospital-goal]").forEach((button) => button.classList.remove("active"));
      if ($("hospital-dialog").open) $("hospital-dialog").close();
      state.hospitalLimit = 50;
      setHospitalFinderHelp("地域や病院名から、選択年度の病院別公表値を探します。");
      await renderHospitalList();
      updateUrl();
    });
    document.querySelectorAll("[data-hospital-goal]").forEach((button) =>
      button.addEventListener("click", () => activateHospitalGoal(button.dataset.hospitalGoal)),
    );
    $("hospital-dialog-close").addEventListener("click", () => $("hospital-dialog").close());
    $("hospital-dialog").addEventListener("click", (event) => {
      if (event.target === $("hospital-dialog")) $("hospital-dialog").close();
    });
    const initialArea = initial.get("area");
    if (/^\d{4}$/.test(initialArea || "")) state.selectedArea = initialArea;
    const initialAreaMdc = initial.get("areaMdc");
    if (state.summary.mdc.some((row) => row.code === initialAreaMdc)) {
      state.areaMdc = initialAreaMdc;
      $("area-mdc-select").value = initialAreaMdc;
      $("area-mdc-select").hidden = false;
      document.querySelectorAll("[data-area-scope]").forEach((button) => button.classList.toggle("active", button.dataset.areaScope === "mdc"));
    }
    const initialPref = initial.get("hospitalPref");
    if (initialPref === "all") $("hospital-prefecture").value = "";
    else if (/^\d{2}$/.test(initialPref || "")) $("hospital-prefecture").value = initialPref;
    await setYear(yearLabels.has(initial.get("year")) ? initial.get("year") : "2024");
    const view = ["area", "hospital", "classification"].includes(initial.get("view")) ? initial.get("view") : "area";
    await switchTab(view);
    if (view === "hospital") {
      const rows = await loadHospitalSearchRows($("hospital-prefecture").value);
      const hospital = rows.find((h) => `${h.notice}:${h.serial}` === initial.get("hospital"));
      if (hospital) selectHospital(hospital);
    } else if (view === "classification" && initial.get("classification")) {
      const classification = state.diagnosis.rows.find((row) => row.code === initial.get("classification"));
      if (classification) selectClassification(classification);
    }
  } catch (e) {
    $("main").insertAdjacentHTML(
      "afterbegin",
      `<p class="caution">DPCデータを読み込めませんでした。${esc(e.message)}</p>`,
    );
    console.error(e);
  }
}
const dpcMapView = window.createMapView($("area-map"), $("map-tools"));
init();

