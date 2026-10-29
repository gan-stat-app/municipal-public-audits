(() => {
  const $ = (id) => document.getElementById(id);
  const pref = $("vision-prefecture"),
    area = $("vision-area"),
    status = $("selected-region");
  const links = {
    population: $("vision-population-link"),
    dpc: $("vision-dpc-link"),
    ndb: $("vision-ndb-link"),
    care: $("vision-care-link"),
    flow: $("vision-flow-link"),
  };
  const metricLabels = {
    emergency_management: "救急医療管理",
    stroke_hyperacute: "超急性期脳卒中診療",
    ami_pci: "急性心筋梗塞PCI",
    cancer_outpatient_chemo: "外来がん薬物療法",
    stroke_rehabilitation: "脳血管疾患等リハビリ",
    convalescent_rehab_ward: "回復期リハビリ病棟",
  };
  let dpc,
    ndb,
    future,
    areaMap,
    cancer,
    officialDemand,
    officialBeds,
    areaCare,
    officialFlowCapacity,
    medicalAreaMap,
    facilityDetails,
    bedFunctionFacilities,
    fullCancerPromise,
    surgeryDefsPromise,
    flowType = "acute",
    flowDirection = "both",
    cooperationType = "acute",
    cooperationDirection = "both";
  const mdcLabels = {
    "01": "神経系",
    "02": "眼科系",
    "03": "耳鼻咽喉科系",
    "04": "呼吸器系",
    "05": "循環器系",
    "06": "消化器系",
    "07": "筋骨格系",
    "08": "皮膚・皮下組織",
    "09": "乳房",
    10: "内分泌・代謝",
    11: "腎・尿路系",
    12: "女性生殖器・産褥",
    13: "血液・免疫",
    14: "新生児",
    15: "小児",
    16: "外傷・熱傷・中毒",
    17: "精神",
    18: "その他",
  };
  const hospitalCache = new Map();
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>\"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const fmt = (value) =>
    Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
  const surgeryClassLabel = (label, diseaseCode, defs) => {
    const s = String(label || "");
    if (/^99(?:\s|$)/.test(s)) return `${s}（手術なし）`;
    if (/^97（輸血以外の再掲）/.test(s))
      return `${s}（手術ありのうち、輸血のみの症例を除いた再掲）`;
    if (/^97(?:\s|$)/.test(s)) return `${s}（手術あり・指定手術以外を含む）`;
    const code = s.match(/^\d{2}/)?.[0],
      title = code && defs?.diseases?.[diseaseCode]?.[code]?.title;
    if (title) return `${code}（${title}）`;
    if (code) return `${s}（この疾患で定められた指定手術グループ）`;
    return s;
  };
  const shortCancerLabel = (label) => {
    const parts = String(label || "")
      .split(/\s+-\s+/)
      .map((x) => x.trim())
      .filter(Boolean);
    return parts.at(-1) || String(label || "");
  };
  const pct = (value, total) =>
    total ? `${((value / total) * 100).toFixed(1)}%` : "—";
  const gzipJson = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`データ取得エラー ${r.status}`);
    const s = r.body.pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(s).text());
  };
  const gzipPartsJson = async (urls) => {
    const parts = await Promise.all(
      urls.map(async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`データ取得エラー ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      }),
    );
    const merged = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
    let offset = 0;
    parts.forEach((part) => {
      merged.set(part, offset);
      offset += part.length;
    });
    const stream = new Blob([merged])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  };
  async function loadFuture() {
    const bs = await Promise.all(
      [0, 1, 2].map(async (i) => {
        const r = await fetch(`/population/future-0${i}.part`);
        if (!r.ok) throw new Error(`人口データ取得エラー ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      }),
    );
    const merged = new Uint8Array(bs.reduce((n, b) => n + b.length, 0));
    let o = 0;
    bs.forEach((b) => {
      merged.set(b, o);
      o += b.length;
    });
    return JSON.parse(
      await new Response(
        new Blob([merged])
          .stream()
          .pipeThrough(new DecompressionStream("gzip")),
      ).text(),
    );
  }
  const card = (label, value, note) =>
    `<article class="metric-card"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`;
  const ageSum = (ages, from, to = 20) =>
    ages.slice(from, to).reduce((a, b) => a + (Number(b) || 0), 0);
  function populationSummary(areaCode) {
    const mapping = areaMap.areas.find((a) => a.code === areaCode);
    if (!mapping) return null;
    const codes = new Set(mapping.municipalities.map((m) => m[0])),
      unavailable = areaCode === "0706" || areaCode === "0707";
    const at = (year) => {
      const rows = future.rows.filter((r) => r[0] === year && codes.has(r[1]));
      if (!rows.length || unavailable) return null;
      const ages = Array(20).fill(0);
      rows.forEach((r) => r[4].forEach((v, i) => (ages[i] += Number(v) || 0)));
      return {
        total: rows.reduce((s, r) => s + (Number(r[3]) || 0), 0),
        young: ageSum(ages, 0, 3),
        working: ageSum(ages, 3, 13),
        old: ageSum(ages, 13),
        over75: ageSum(ages, 15),
        over85: ageSum(ages, 17),
      };
    };
    return {
      p2020: at(2020),
      p2040: at(2040),
      municipalities: mapping.municipalities,
    };
  }
  function publicValue(label, value, suppressed, unit = "件") {
    const hidden = Number(suppressed) || 0;
    return card(
      label,
      `${fmt(value)}${unit}`,
      hidden ? `非公表セル ${hidden}件あり（数値に含まず）` : "非公表セルなし",
    );
  }
  const indexCard = (label, a, b) =>
    `<div><span>${esc(label)}</span><strong>${a ? Math.round((b / a) * 100) : "—"}</strong><small>2020年＝100</small></div>`;
  async function areaHospitals(pc, areaCode) {
    if (!hospitalCache.has(pc))
      hospitalCache.set(pc, gzipJson(`/dpc/data/pref/${pc}.json.gz`));
    return (await hospitalCache.get(pc)).filter((h) => h.area === areaCode);
  }
  function hospitalCard(h, muniNames) {
    const muni =
      muniNames.get(h.municipality) || h.municipality || "所在地未収録";
    const top = Object.entries(h.mdc || {})
      .sort((a, b) => (b[1].published || 0) - (a[1].published || 0))
      .slice(0, 3);
    return `<article class="facility-card" data-search="${esc(`${h.name} ${muni}`.toLowerCase())}"><div><h5>${esc(h.name)}</h5><p>${esc(muni)}・${esc(h.type || "DPC調査参加施設")}</p></div><dl class="wide-metrics"><div><dt>退院患者</dt><dd>${fmt(h.published)}件</dd></div><div><dt>手術あり</dt><dd>${fmt(h.surgeryPublished)}件</dd></div><div><dt>救急医療入院</dt><dd>${fmt(h.emergencyPublished)}件</dd></div><div><dt>救急車搬送</dt><dd>${fmt(h.ambulancePublished)}件</dd></div><div><dt>DPC病床</dt><dd>${fmt(h.dpcBeds || 0)}床</dd></div></dl><p class="top-services"><b>退院患者が多い診療分野</b>${top.map(([id, v]) => `<span>${esc(mdcLabels[id] || id)} ${fmt(v.published)}件</span>`).join("")}</p><small>${h.suppressed || h.surgerySuppressed || h.emergencySuppressed || h.ambulanceSuppressed ? `非公表セルあり（退院 ${h.suppressed || 0}、手術 ${h.surgerySuppressed || 0}、救急入院 ${h.emergencySuppressed || 0}、救急車 ${h.ambulanceSuppressed || 0}）` : "表示項目に非公表セルなし"}</small><button class="detail-button" type="button" data-dpc-detail="${esc(`${h.notice}:${h.serial}`)}">この画面でMDC別・手術別を見る</button></article>`;
  }
  function cancerCard(f) {
    const m = f.metrics || {};
    return `<article class="facility-card cancer-facility"><div><h5>${esc(f.name)}</h5><p>${esc(f.designation)}</p></div><p class="address">${esc(f.address)}</p><dl class="cancer-metrics"><div><dt>院内がん登録</dt><dd>${m.registry == null ? "—" : fmt(m.registry) + "件"}</dd></div><div><dt>悪性腫瘍手術</dt><dd>${m.surgery == null ? "—" : fmt(m.surgery) + "件"}</dd></div><div><dt>薬物療法</dt><dd>${m.drug == null ? "—" : fmt(m.drug) + "人"}</dd></div><div><dt>放射線治療</dt><dd>${m.radiation == null ? "—" : fmt(m.radiation) + "人"}</dd></div><div><dt>緩和ケア新規介入</dt><dd>${m.palliative == null ? "—" : fmt(m.palliative) + "人"}</dd></div></dl>${f.features?.length ? `<p class="tags">${f.features.map((x) => `<span>${esc(x)}</span>`).join("")}</p>` : ""}<div class="card-links"><button class="detail-button" type="button" data-cancer-detail="${esc(f.id)}">この画面で全診療実績を見る</button>${f.url ? `<a href="${esc(f.url)}" rel="noopener">病院ウェブサイト</a>` : ""}</div></article>`;
  }
  async function loadFullCancer() {
    if (!fullCancerPromise)
      fullCancerPromise = (async () => {
        const m = await fetch("/cancer-care/data-parts/manifest.json").then(
            (r) => r.json(),
          ),
          parts = await Promise.all(
            m.files.map((f) =>
              fetch(`/cancer-care/data-parts/${f}`).then((r) =>
                r.arrayBuffer(),
              ),
            ),
          ),
          size = parts.reduce((s, b) => s + b.byteLength, 0),
          all = new Uint8Array(size);
        let o = 0;
        parts.forEach((b) => {
          all.set(new Uint8Array(b), o);
          o += b.byteLength;
        });
        return JSON.parse(new TextDecoder().decode(all));
      })();
    return fullCancerPromise;
  }
  async function loadSurgeryDefs() {
    if (!surgeryDefsPromise)
      surgeryDefsPromise = fetch("/dpc/data/surgery-definitions.json").then(
        (r) => {
          if (!r.ok) throw new Error(`手術定義取得エラー ${r.status}`);
          return r.json();
        },
      );
    return surgeryDefsPromise;
  }
  function openDialog(html) {
    $("regional-detail-body").innerHTML = html;
    $("regional-detail-dialog").showModal();
  }
  async function openDpcDetail(h) {
    const rows = Object.entries(h.mdc || {});
    openDialog(
      `<h2>${esc(h.name)}</h2><p>${fmt(h.dpcBeds || 0)} DPC算定病床</p><h3>MDC別実績</h3><div class="dialog-table"><table><thead><tr><th>診療分野</th><th>退院</th><th>手術</th><th>救急入院</th><th>救急車</th></tr></thead><tbody>${rows.map(([id, x]) => `<tr><td>${id} ${esc(mdcLabels[id] || id)}</td><td>${fmt(x.published)}</td><td>${fmt(x.surgeryPublished)}</td><td>${fmt(x.emergencyPublished)}</td><td>${fmt(x.ambulancePublished)}</td></tr>`).join("")}</tbody></table></div><h3>疾患・手術別</h3><label>MDC<select id="dialog-mdc">${rows
        .filter(([id]) => id !== "17")
        .map(
          ([id]) =>
            `<option value="${id}">${id} ${esc(mdcLabels[id] || id)}</option>`,
        )
        .join(
          "",
        )}</select></label><p class="classification-note">区分99は手術なし、97は手術あり（指定手術以外を含む）、97（輸血以外の再掲）は輸血のみの症例を除いた再掲です。01～は疾患ごとに定められた具体的な手術グループ名を表示します。</p><div id="dialog-surgery"><p>読み込み中…</p></div>`,
    );
    const mdcSelect = $("dialog-mdc");
    if ([...mdcSelect.options].some((o) => o.value === "05"))
      mdcSelect.value = "05";
    const render = async () => {
      const id = mdcSelect.value,
        [data, defs] = await Promise.all([
          gzipJson(`/dpc/data/surgery/mdc${id}.json.gz`),
          loadSurgeryDefs(),
        ]),
        items = data.hospitals[`${h.notice}:${h.serial}`] || [];
      $("dialog-surgery").innerHTML = items.length
        ? items
            .map(([di, counts, los]) => {
              const d = data.diseases[di];
              return `<details class="surgery-item"><summary><code>${esc(d.code)}</code> ${esc(d.name)}</summary><table><thead><tr><th>DPC手術区分と内容</th><th>件数</th><th>平均在院日数</th></tr></thead><tbody>${d.labels.map((label, i) => `<tr><td>${esc(surgeryClassLabel(label, d.code, defs))}</td><td>${counts[i] == null ? "－" : fmt(counts[i]) + "件"}</td><td>${los[i] == null ? "－" : fmt(los[i]) + "日"}</td></tr>`).join("")}</tbody></table></details>`;
            })
            .join("")
        : "<p>このMDCに公表された疾患・手術別実績はありません。非公表は0件を意味しません。</p>";
    };
    mdcSelect.onchange = () =>
      render().catch(() => {
        $("dialog-surgery").textContent = "読み込めませんでした。";
      });
    await render();
  }
  async function openCancerDetail(id) {
    openDialog("<p>全診療実績を読み込んでいます…</p>");
    const data = await loadFullCancer(),
      f = data.facilities.find((x) => x.id === id),
      defs = new Map(data.metricDefs.map((x) => [x.id, x])),
      values = f.m.map(([mid, v]) => [defs.get(mid), v]).filter(([d]) => d);
    openDialog(
      `<h2>${esc(f.name)}</h2><p>${esc(f.designation)}・${esc(f.address)}</p><label>診療実績を絞り込み<input id="cancer-detail-search" type="search" placeholder="例：手術、薬物療法、相談支援"></label><p>${values.length}項目を収録。長い調査項目名は短く表示し、カーソルを合わせると原文を確認できます。</p><div id="cancer-detail-list" class="cancer-detail-list"></div>`,
    );
    const draw = () => {
      const q = $("cancer-detail-search").value.trim().toLowerCase(),
        rows = values.filter(([d]) => !q || d.label.toLowerCase().includes(q));
      $("cancer-detail-list").innerHTML =
        rows
          .map(
            ([d, v]) =>
              `<div><span title="${esc(d.label)}">${esc(shortCancerLabel(d.label))}</span><b>${fmt(v)}</b></div>`,
          )
          .join("") || "<p>該当する項目がありません。</p>";
    };
    $("cancer-detail-search").oninput = draw;
    draw();
  }
  const flowPartnerList = (title, items) =>
    `<article><h4>${esc(title)}</h4>${items?.length ? `<ul>${items.map((x) => `<li>${esc(x.prefecture)} ${esc(x.name)}：${(x.share * 100).toFixed(1)}%</li>`).join("")}</ul>` : "<p>一定数以上の公表対象となる相手区域はありません。</p>"}</article>`;
  const flowTypeLabel = () =>
    ({ acute: "高度急性期＋急性期", inclusive: "包括期", chronic: "慢性期" })[
      flowType
    ];
  function renderFlowMap(prefCode, selectedCode) {
    const host = $("flow-map"),
      features = medicalAreaMap.features.filter(
        (f) => f.properties.pref_code === prefCode,
      );
    if (!features.length) {
      host.innerHTML =
        '<p class="empty">この都道府県の境界を表示できません。</p>';
      return;
    }
    const points = [];
    const walk = (c) =>
      typeof c?.[0] === "number" ? points.push(c) : c?.forEach(walk);
    features.forEach((f) => walk(f.geometry.coordinates));
    const w = 760,
      h = 420,
      pad = 20,
      isTokyo = prefCode === "13",
      isIsland = (p) => isTokyo && p[1] < 35.3;
    const fit = (ps, x0, y0, x1, y1) => {
      const xs = ps.map((p) => p[0]),
        ys = ps.map((p) => p[1]),
        minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys),
        scale = Math.min(
          (x1 - x0) / (maxX - minX || 1),
          (y1 - y0) / (maxY - minY || 1),
        );
      return (p) => [x0 + (p[0] - minX) * scale, y1 - (p[1] - minY) * scale];
    };
    let project,
      insetLabel = "";
    if (isTokyo) {
      const main = points.filter((p) => !isIsland(p)),
        islands = points.filter(isIsland),
        mainProject = fit(main, pad, pad, 565, h - pad),
        islandProject = fit(islands, 610, 65, w - pad, h - pad);
      project = (p) => (isIsland(p) ? islandProject(p) : mainProject(p));
      insetLabel =
        '<text class="map-inset-label" x="610" y="45">島しょ部（別枠）</text><rect x="595" y="25" width="160" height="380" rx="8" fill="none" stroke="#9eb1ae" stroke-dasharray="4 4"/>';
    } else project = fit(points, pad, pad, w - pad, h - pad);
    const ringPath = (ring) =>
      ring
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${project(p)
              .map((n) => n.toFixed(1))
              .join(",")}`,
        )
        .join("") + "Z";
    const geomPath = (g) =>
      g.type === "Polygon"
        ? g.coordinates.map(ringPath).join("")
        : g.coordinates.map((poly) => poly.map(ringPath).join("")).join("");
    const centers = new Map(
      features.map((f) => {
        const ps = [];
        const add = (c) =>
          typeof c?.[0] === "number" ? ps.push(project(c)) : c?.forEach(add);
        add(f.geometry.coordinates);
        return [
          f.properties.code,
          [
            ps.reduce((s, p) => s + p[0], 0) / ps.length,
            ps.reduce((s, p) => s + p[1], 0) / ps.length,
          ],
        ];
      }),
    );
    const flowByCode = new Map(
      officialFlowCapacity.areas.map((x) => [x.code, x]),
    );
    const color = (v) =>
        v == null
          ? "#e5e9e8"
          : v < 0.05
            ? "#d9eef2"
            : v < 0.1
              ? "#9ccbd4"
              : v < 0.2
                ? "#5294a7"
                : "#0d4f65",
      selected = flowByCode.get(selectedCode),
      selectedCenter = centers.get(selectedCode);
    const arrow = (item, direction) => {
      const other = centers.get(item.code);
      if (!selectedCenter || !other) return "";
      const a = direction === "out" ? selectedCenter : other,
        b = direction === "out" ? other : selectedCenter,
        label = direction === "out" ? `${item.name}へ` : `${item.name}から`;
      return `<path class="flow-arrow ${direction}" d="M${a[0]},${a[1]} L${b[0]},${b[1]}"><title>${esc(label)} ${(item.share * 100).toFixed(1)}%</title></path>`;
    };
    const outItems = selected?.outflow?.partners?.[flowType] || [],
      inItems = selected?.inflow?.partners?.[flowType] || [],
      outArrows =
        flowDirection === "in"
          ? ""
          : outItems.map((x) => arrow(x, "out")).join(""),
      inArrows =
        flowDirection === "out"
          ? ""
          : inItems.map((x) => arrow(x, "in")).join(""),
      labelCodes = new Set([
        selectedCode,
        ...(flowDirection === "in" ? [] : outItems.map((x) => x.code)),
        ...(flowDirection === "out" ? [] : inItems.map((x) => x.code)),
      ]);
    host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" aria-labelledby="flow-map-title"><defs><marker id="flow-arrowhead-out" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#d87821"/></marker><marker id="flow-arrowhead-in" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#7b2cbf"/></marker></defs>${insetLabel}${features
      .map((f) => {
        const x = flowByCode.get(f.properties.code),
          v = x?.outflow?.overall,
          c = centers.get(f.properties.code);
        return `<path tabindex="0" class="flow-area${f.properties.code === selectedCode ? " selected" : ""}" data-flow-area="${f.properties.code}" fill="${color(v)}" d="${geomPath(f.geometry)}"><title>${esc(f.properties.name)}：流出率 ${v == null ? "—" : (v * 100).toFixed(1) + "%"}</title></path>${c && labelCodes.has(f.properties.code) ? `<text class="flow-label ${f.properties.code === selectedCode ? "selected-label" : "partner-label"}" x="${c[0]}" y="${c[1]}">${esc(f.properties.name)}</text>` : ""}`;
      })
      .join("")}${outArrows}${inArrows}</svg>`;
    host.querySelectorAll("[data-flow-area]").forEach((el) => {
      const choose = () => {
        area.value = el.dataset.flowArea;
        render().catch(showError);
      };
      el.onclick = choose;
      el.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          choose();
        }
      };
    });
    $("flow-map-note").textContent =
      `色は2024年度NDBの全入院の流出率。オレンジ実線は「${flowTypeLabel()}」の主な流出先、紫の破線は主な流入元です。都道府県外の相手区域は地図外のため矢印を表示しません。矢印がない場合も流入・流出0とは限りません。`;
  }
  function renderNationalFlowMap(selectedCode) {
    const host = $("flow-national-map"),
      features = medicalAreaMap.features,
      selected = officialFlowCapacity.areas.find(
        (x) => x.code === selectedCode,
      ),
      prefCode = selectedCode.slice(0, 2),
      outItems = (selected?.outflow?.partners?.[flowType] || []).filter(
        (x) => x.code.slice(0, 2) !== prefCode,
      ),
      inItems = (selected?.inflow?.partners?.[flowType] || []).filter(
        (x) => x.code.slice(0, 2) !== prefCode,
      ),
      featureCodes = new Set(features.map((f) => f.properties.code)),
      visibleOut = outItems.filter((x) => featureCodes.has(x.code)),
      visibleIn = inItems.filter((x) => featureCodes.has(x.code)),
      externalCodes = new Set([...visibleOut, ...visibleIn].map((x) => x.code));
    const pointsOf = (f) => {
        const ps = [];
        const collect = (c) =>
          typeof c?.[0] === "number" ? ps.push(c) : c?.forEach(collect);
        collect(f.geometry.coordinates);
        return ps;
      },
      relevantCodes = new Set([
        selectedCode,
        ...visibleOut.map((x) => x.code),
        ...visibleIn.map((x) => x.code),
      ]),
      relevantFeatures = features.filter((f) =>
        relevantCodes.has(f.properties.code),
      ),
      focusPoints = relevantFeatures.flatMap(pointsOf),
      allMainland = features.flatMap(pointsOf).filter((p) => p[1] >= 30.5),
      fit = (ps, x0, y0, x1, y1) => {
        const xs = ps.map((p) => p[0]),
          ys = ps.map((p) => p[1]),
          minX = Math.min(...xs),
          maxX = Math.max(...xs),
          minY = Math.min(...ys),
          maxY = Math.max(...ys),
          dx = maxX - minX || 1,
          dy = maxY - minY || 1,
          padding = Math.max(dx, dy) * 0.18,
          scale = Math.min(
            (x1 - x0) / (dx + padding * 2),
            (y1 - y0) / (dy + padding * 2),
          );
        return (p) => [
          x0 + (p[0] - minX + padding) * scale,
          y1 - (p[1] - minY + padding) * scale,
        ];
      };
    const project = fit(focusPoints, 20, 20, 740, 450),
      overviewProject = fit(allMainland, 585, 20, 745, 135),
      pathWith = (g, projection) => {
        const ring = (xs) =>
          xs
            .map(
              (p, i) =>
                `${i ? "L" : "M"}${projection(p)
                  .map((n) => n.toFixed(1))
                  .join(",")}`,
            )
            .join("") + "Z";
        return g.type === "Polygon"
          ? g.coordinates.map(ring).join("")
          : g.coordinates.map((poly) => poly.map(ring).join("")).join("");
      },
      centers = new Map(
        relevantFeatures.map((f) => {
          const ps = pointsOf(f).map(project);
          return [
            f.properties.code,
            [
              ps.reduce((s, p) => s + p[0], 0) / ps.length,
              ps.reduce((s, p) => s + p[1], 0) / ps.length,
            ],
          ];
        }),
      ),
      selectedCenter = centers.get(selectedCode);
    const arrow = (item, direction, index) => {
        const other = centers.get(item.code);
        if (!selectedCenter || !other) return "";
        const a = direction === "out" ? selectedCenter : other,
          b = direction === "out" ? other : selectedCenter,
          label =
            direction === "out"
              ? `${item.prefecture} ${item.name}へ`
              : `${item.prefecture} ${item.name}から`,
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          length = Math.hypot(dx, dy) || 1,
          side = (direction === "out" ? 1 : -1) * (index % 2 ? -1 : 1),
          bend = (42 + Math.floor(index / 2) * 28) * side,
          mx = (a[0] + b[0]) / 2 - (dy / length) * bend,
          my = (a[1] + b[1]) / 2 + (dx / length) * bend;
        return `<path class="national-flow-arrow ${direction}" d="M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}"><title>${esc(label)} ${(item.share * 100).toFixed(1)}%</title></path><text class="national-rate ${direction}" x="${mx}" y="${my - 7}">${(item.share * 100).toFixed(1)}%</text>`;
      },
      outArrows =
        flowDirection === "in"
          ? ""
          : visibleOut.map((x, i) => arrow(x, "out", i)).join(""),
      inArrows =
        flowDirection === "out"
          ? ""
          : visibleIn.map((x, i) => arrow(x, "in", i)).join(""),
      labelCodes = new Set([
        selectedCode,
        ...(flowDirection === "in" ? [] : visibleOut.map((x) => x.code)),
        ...(flowDirection === "out" ? [] : visibleIn.map((x) => x.code)),
      ]),
      labelPositions = new Map(),
      placed = [];
    [...labelCodes]
      .sort((a, b) => (centers.get(a)?.[1] || 0) - (centers.get(b)?.[1] || 0))
      .forEach((code, index) => {
        const origin = centers.get(code);
        if (!origin) return;
        let x = origin[0],
          y = origin[1],
          attempt = 0;
        while (
          placed.some(
            (p) => Math.abs(p[0] - x) < 105 && Math.abs(p[1] - y) < 28,
          ) &&
          attempt < 8
        ) {
          x = Math.max(
            55,
            Math.min(705, x + (attempt % 2 ? -1 : 1) * (55 + attempt * 8)),
          );
          y = Math.max(35, Math.min(435, y + 28));
          attempt++;
        }
        labelPositions.set(code, [x, y]);
        placed.push([x, y]);
      });
    const selectedFeature = features.find(
        (f) => f.properties.code === selectedCode,
      ),
      selectedOverview =
        selectedFeature && pointsOf(selectedFeature).some((p) => p[1] >= 30.5)
          ? pathWith(selectedFeature.geometry, overviewProject)
          : "";
    host.innerHTML = `<svg viewBox="0 0 760 470" aria-labelledby="national-flow-map-title"><defs><clipPath id="national-focus-clip"><rect x="8" y="8" width="744" height="454" rx="8"/></clipPath><marker id="national-arrowhead-out" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#d87821"/></marker><marker id="national-arrowhead-in" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#7b2cbf"/></marker></defs><g clip-path="url(#national-focus-clip)">${features.map((f) => `<path class="national-area context" d="${pathWith(f.geometry, project)}"/>`).join("")}${relevantFeatures
      .map((f) => {
        const code = f.properties.code,
          c = centers.get(code),
          lp = labelPositions.get(code),
          cls =
            code === selectedCode
              ? " selected"
              : externalCodes.has(code)
                ? " external"
                : "";
        return `<path class="national-area${cls}" d="${pathWith(f.geometry, project)}"><title>${esc(f.properties.name)}</title></path>${c && lp && Math.hypot(lp[0] - c[0], lp[1] - c[1]) > 8 ? `<path class="national-label-leader" d="M${c[0]},${c[1]} L${lp[0]},${lp[1]}"/>` : ""}${lp && labelCodes.has(code) ? `<text class="national-label" x="${lp[0]}" y="${lp[1]}">${esc(f.properties.name)}</text>` : ""}`;
      })
      .join(
        "",
      )}${outArrows}${inArrows}</g><g class="national-overview"><rect x="575" y="10" width="177" height="136" rx="8"/><text x="586" y="29">全国での位置</text>${features
      .filter((f) => pointsOf(f).some((p) => p[1] >= 30.5))
      .map((f) => `<path d="${pathWith(f.geometry, overviewProject)}"/>`)
      .join(
        "",
      )}${selectedOverview ? `<path class="overview-selected" d="${selectedOverview}"/>` : ""}</g></svg>`;
    const hiddenOut = outItems.length - visibleOut.length,
      hiddenIn = inItems.length - visibleIn.length;
    $("flow-national-map-note").textContent =
      visibleOut.length || visibleIn.length
        ? `県外の公表対象のうち、全国地図に対応できる流出先 ${visibleOut.length}区域、流入元 ${visibleIn.length}区域を表示。${hiddenOut + hiddenIn ? `区域再編等で境界対応できない相手 ${hiddenOut + hiddenIn}区域は一覧のみ表示します。` : ""}`
        : "この機能区分では、県外の公表対象となる主な流入元・流出先はありません。0を意味するものではありません。";
  }
  const bedFunctionLabels = {
    highAcute: "高度急性期",
    acute: "急性期",
    recovery: "回復期",
    chronic: "慢性期",
    suspendedReopen: "休棟中（再開予定）",
    suspendedClose: "休棟中（廃止予定）",
    other: "その他・未報告",
  };
  const bedFunctionClasses = {
    highAcute: "bed-high-acute",
    acute: "bed-acute",
    recovery: "bed-recovery",
    chronic: "bed-chronic",
    suspendedReopen: "bed-other",
    suspendedClose: "bed-other",
    other: "bed-other",
  };
  const functionText = (value) => value || "—";
  function renderBedFunctionFacilities(areaCode, areaName) {
    const host = $("bed-function-facilities");
    const count = $("bed-function-count");
    const input = $("bed-function-search");
    const areaData = bedFunctionFacilities.areas.find((x) => x.code === areaCode);
    const facilities = areaData?.facilities || [];
    if (!facilities.length) {
      host.innerHTML =
        '<p class="empty">現在の構想区域との対応を確認できないため、医療機関別の病床機能を表示していません。</p>';
      count.textContent = "対応確認中";
      input.value = "";
      input.disabled = true;
      return;
    }
    input.disabled = false;
    const reportedYear = String(
      bedFunctionFacilities.reportedAt || bedFunctionFacilities.fiscalYear || "—",
    ).slice(0, 4);
    const plannedYear = String(
      bedFunctionFacilities.plannedAt || "—",
    ).slice(0, 4);
    const facilityHtml = (facility) => {
      const total = facility.totalBeds || 0;
      let segmentOffset = 0;
      const segments = Object.entries(bedFunctionLabels)
        .map(([key, label]) => {
          const value = facility.functions[key] || 0;
          if (!value || !total) return "";
          const width = (value / total) * 100;
          const rect = `<rect class="bed-function-segment ${bedFunctionClasses[key]}" x="${segmentOffset}" y="0" width="${width}" height="10"><title>${esc(label)} ${fmt(value)}床（${width.toFixed(1)}%）</title></rect>`;
          segmentOffset += width;
          return rect;
        })
        .join("");
      const totals = ["highAcute", "acute", "recovery", "chronic"]
        .map(
          (key) =>
            `<div><dt><i class="${bedFunctionClasses[key]}" aria-hidden="true"></i>${bedFunctionLabels[key]}</dt><dd>${fmt(facility.functions[key] || 0)}床</dd></div>`,
        )
        .join("");
      const wards = facility.wards
        .map((ward) => {
          const fees = ward.admissionFees?.length
            ? ward.admissionFees
                .map(
                  (fee) =>
                    `${esc(fee.name)}${fee.beds ? `（${fmt(fee.beds)}床）` : ""}`,
                )
                .join("<br>")
            : "—";
          const plannedChanged =
            ward.current && ward.planned && ward.current !== ward.planned;
          return `<tr><td><strong>${esc(ward.name)}</strong>${ward.mainDepartment ? `<small>主な診療科：${esc(ward.mainDepartment)}</small>` : ""}</td><td>${esc(functionText(ward.current))}</td><td class="${plannedChanged ? "function-change" : ""}">${esc(functionText(ward.planned))}${plannedChanged ? "<small>機能変更予定</small>" : ""}</td><td>${ward.beds == null ? "—" : fmt(ward.beds) + "床"}${ward.maxUsedBeds == null ? "" : `<small>最大使用 ${fmt(ward.maxUsedBeds)}床</small>`}</td><td>${fees}</td></tr>`;
        })
        .join("");
      return `<article class="bed-function-facility" data-search="${esc(`${facility.name} ${facility.municipality || ""}`.toLowerCase())}"><div class="bed-function-facility-head"><div><h5>${esc(facility.name)}</h5><p>${esc(facility.municipality || "所在地未収録")}・報告 ${fmt(total)}床</p></div></div><div class="bed-function-bar" role="img" aria-label="${esc(facility.name)}の病床機能別病床数"><svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">${segments}</svg></div><dl class="bed-function-totals">${totals}</dl><details><summary>病棟別の詳細を見る（${facility.wards.length}病棟）</summary><div class="bed-ward-table-wrap"><table class="bed-ward-table"><thead><tr><th>病棟</th><th>${esc(reportedYear)}年報告機能</th><th>${esc(plannedYear)}年予定機能</th><th>病床数</th><th>入院基本料・特定入院料</th></tr></thead><tbody>${wards}</tbody></table></div></details></article>`;
    };
    const update = () => {
      const q = input.value.trim().toLowerCase();
      const shown = facilities.filter((facility) =>
        `${facility.name} ${facility.municipality || ""}`.toLowerCase().includes(q),
      );
      host.innerHTML = shown.map(facilityHtml).join("");
      count.textContent = `${areaName}区域：${shown.length}施設（全${facilities.length}施設）`;
    };
    input.value = "";
    input.oninput = update;
    update();
  }

  const detailValue = (v, unit = "") => (v == null ? "—" : `${fmt(v)}${unit}`);
  const yesNo = (v) =>
    v == null ? "—" : /有|あり|yes|true/i.test(String(v)) ? "あり" : "なし";
  function capacityFacilityCard(f, detail) {
    const flags = [
        f.tertiary_emergency && "三次救急",
        f.secondary_emergency && "二次救急",
        f.home_support && "在宅療養支援",
      ].filter(Boolean),
      d = detail || {};
    return `<article class="facility-card capacity-facility" data-search="${esc(`${f.name} ${f.municipality || ""}`.toLowerCase())}"><div><h5>${esc(f.name)}</h5><p>${esc(f.municipality || "所在地未収録")}</p></div><dl><div><dt>救急車受入</dt><dd>${f.ambulance == null ? "—" : fmt(f.ambulance) + "件"}</dd></div><div><dt>全身麻酔手術</dt><dd>${f.general_anesthesia == null ? "—" : fmt(f.general_anesthesia) + "件"}</dd></div><div><dt>常勤医師</dt><dd>${f.doctors_fulltime == null ? "—" : fmt(f.doctors_fulltime) + "人"}</dd></div><div><dt>病床</dt><dd>${f.beds == null ? "—" : fmt(f.beds) + "床"}</dd></div></dl>${flags.length ? `<p class="capacity-flags">${flags.map((x) => `<span>${x}</span>`).join("")}</p>` : ""}${detail ? `<details class="facility-report-detail"><summary>外来・人員・設備・退院支援を見る</summary><div class="report-detail-grid"><section><h6>外来機能</h6><p class="metric-explanation"><strong>紹介率・逆紹介率とは？</strong> 紹介率は、初診患者のうち他の医療機関から紹介されて受診した患者の割合です。逆紹介率は、病院での専門的な診療後などに、地域の診療所や他院へ紹介した患者の割合です。いずれも外来機能報告の公表値で、地域の医療機関との連携状況を見る参考指標です。救急受入や地域の医療体制にも左右され、高低だけで病院の優劣や医療の質は判断できません。</p><dl><div><dt>初診患者数</dt><dd>${detailValue(d.first_visits, "人/年")}</dd></div><div><dt>紹介率</dt><dd>${detailValue(d.referral_rate, "%")}</dd></div><div><dt>逆紹介率</dt><dd>${detailValue(d.reverse_referral_rate, "%")}</dd></div><div><dt>外来常勤医師</dt><dd>${detailValue(d.outpatient_doctors_ft, "人")}</dd></div><div><dt>外来常勤看護師</dt><dd>${detailValue(d.outpatient_nurses_ft, "人")}</dd></div></dl></section><section><h6>施設全体の人員</h6><dl><div><dt>看護師</dt><dd>${detailValue(d.staff_nurses_ft, "人")}</dd></div><div><dt>看護補助者</dt><dd>${detailValue(d.staff_aides_ft, "人")}</dd></div><div><dt>理学療法士</dt><dd>${detailValue(d.staff_pt_ft, "人")}</dd></div><div><dt>作業療法士</dt><dd>${detailValue(d.staff_ot_ft, "人")}</dd></div><div><dt>言語聴覚士</dt><dd>${detailValue(d.staff_st_ft, "人")}</dd></div><div><dt>薬剤師</dt><dd>${detailValue(d.staff_pharmacists_ft, "人")}</dd></div></dl></section><section><h6>設備</h6><dl><div><dt>64列以上CT</dt><dd>${detailValue(d.ct64_beds ?? d.ct64, "台")}</dd></div><div><dt>3T以上MRI</dt><dd>${detailValue(d.mri3_beds ?? d.mri3, "台")}</dd></div><div><dt>PET/CT</dt><dd>${detailValue(d.pet_beds ?? d.petct, "台")}</dd></div></dl></section><section><h6>退院支援</h6><dl><div><dt>退院調整部門</dt><dd>${yesNo(d.discharge_unit)}</dd></div><div><dt>専従看護職員</dt><dd>${detailValue(d.discharge_nurses_dedicated, "人")}</dd></div><div><dt>専任看護職員</dt><dd>${detailValue(d.discharge_nurses_assigned, "人")}</dd></div></dl></section></div><p class="detail-note">「—」は未報告、データ不備、任意項目の無回答、または対象外を含みます。0とは異なります。</p></details>` : ""}</article>`;
  }
  function renderOfficialResources(areaCode, pn, areaName, pop) {
    const x = officialFlowCapacity.areas.find((a) => a.code === areaCode);
    const areaDetails = facilityDetails.areas.find(
      (a) => a.code === areaCode,
    );
    const detailRows = areaDetails?.facilities || [];
    const normalizeName = (name) =>
      String(name || "")
        .replace(/[\s　・]/g, "")
        .replace(/^(医療法人|社会医療法人|公益財団法人|独立行政法人)/, "");
    const facilityKey = (f) =>
      `${normalizeName(f.name)}|${normalizeName(f.municipality)}`;
    const detailByFacility = new Map(
      detailRows.map((f) => [facilityKey(f), f]),
    );
    const detailByName = new Map();
    detailRows.forEach((f) => {
      const name = normalizeName(f.name);
      const matches = detailByName.get(name) || [];
      matches.push(f);
      detailByName.set(name, matches);
    });
    const facilityDetail = (f) => {
      const exact = detailByFacility.get(facilityKey(f));
      if (exact) return exact;
      const sameName = detailByName.get(normalizeName(f.name)) || [];
      return sameName.length === 1 ? sameName[0] : undefined;
    };
    $("flow-scope").textContent =
      `構想区域単位・${pn} ${areaName}・2024年度NDB`;
    $("flow-title").textContent = `5. ${areaName}区域の実際の患者流出入`;
    $("capacity-scope").textContent =
      `構想区域・医療機関単位・${pn} ${areaName}・令和7年度病床機能報告等`;
    $("capacity-title").textContent =
      `6. ${areaName}区域の急性期・人材・在宅の受け皿`;
    if (!x) {
      $("flow-cards").innerHTML = card(
        "患者流出入",
        "対応確認中",
        "構想区域再編のため旧医療圏へ按分していません",
      );
      $("flow-partners").innerHTML = "";
      $("flow-reading").textContent =
        "現在の構想区域と、この画面のDPC・NDB医療圏が一致しないため表示していません。";
      $("capacity-cards").innerHTML = card(
        "医療資源",
        "対応確認中",
        "構想区域再編のため旧医療圏へ按分していません",
      );
      $("capacity-facilities").innerHTML = "";
      $("outpatient-summary").innerHTML = card(
        "外来機能報告",
        "対応確認中",
        "構想区域対応を確認中",
      );
      $("capacity-reading").textContent =
        "現在の構想区域との対応確認が必要です。";
      return;
    }
    const inflow = x.inflow?.overall,
      outflow = x.outflow?.overall,
      density = x.area_km2 && x.population ? x.population / x.area_km2 : null;
    $("flow-cards").innerHTML = [
      card(
        "区域外からの流入率",
        inflow == null ? "—" : `${(inflow * 100).toFixed(1)}%`,
        "自区域の医療機関に入院した患者",
      ),
      card(
        "区域外への流出率",
        outflow == null ? "—" : `${(outflow * 100).toFixed(1)}%`,
        "自区域に住む入院患者",
      ),
      card(
        "区域内完結率",
        outflow == null ? "—" : `${((1 - outflow) * 100).toFixed(1)}%`,
        "流出率から算出",
      ),
      card(
        "人口密度",
        density == null ? "—" : `${fmt(density)}人/km²`,
        "アクセス検討の基礎情報",
      ),
    ].join("");
    const typeLabel = flowTypeLabel();
    $("flow-partners").innerHTML =
      flowPartnerList(
        `主な流入元（${typeLabel}）`,
        x.inflow?.partners?.[flowType],
      ) +
      flowPartnerList(
        `主な流出先（${typeLabel}）`,
        x.outflow?.partners?.[flowType],
      );
    const externalIn = (x.inflow?.partners?.[flowType] || []).filter(
        (p) => p.code.slice(0, 2) !== areaCode.slice(0, 2),
      ),
      externalOut = (x.outflow?.partners?.[flowType] || []).filter(
        (p) => p.code.slice(0, 2) !== areaCode.slice(0, 2),
      );
    $("flow-external").innerHTML =
      flowPartnerList(`県外からの主な流入元（${typeLabel}）`, externalIn) +
      flowPartnerList(`県外への主な流出先（${typeLabel}）`, externalOut);
    renderFlowMap(areaCode.slice(0, 2), areaCode);
    renderNationalFlowMap(areaCode);
    $("flow-reading").textContent =
      "流入・流出は厚生労働省が2024年度NDBから算出した値です。機能区分別の相手区域は一定数以上の患者がいる場合のみ公表されます。人口密度は移動時間そのものではなく、全国共通の公式移動時間データは本原表に収録されていません。";
    $("capacity-cards").innerHTML = [
      card(
        "常勤医師",
        x.doctors_fulltime == null ? "—" : `${fmt(x.doctors_fulltime)}人`,
        x.doctors_per_100_beds == null
          ? "病床当たり未収録"
          : `${fmt(x.doctors_per_100_beds)}人／100床`,
      ),
      card(
        "救急車受入",
        x.activity.ambulance == null ? "—" : `${fmt(x.activity.ambulance)}件`,
        "区域内医療機関の合計",
      ),
      card(
        "全身麻酔手術",
        x.activity.general_anesthesia == null
          ? "—"
          : `${fmt(x.activity.general_anesthesia)}件`,
        "区域内医療機関の合計",
      ),
      card(
        "全身麻酔／救急車",
        x.activity.ambulance && x.activity.general_anesthesia
          ? `${((x.activity.general_anesthesia / x.activity.ambulance) * 100).toFixed(1)}%`
          : "—",
        "件数の比・質の評価ではない",
      ),
      card(
        "二次・三次救急",
        `${fmt((x.functions.secondary_emergency || 0) + (x.functions.tertiary_emergency || 0))}施設`,
        `二次 ${fmt(x.functions.secondary_emergency || 0)}／三次 ${fmt(x.functions.tertiary_emergency || 0)}`,
      ),
      card(
        "在宅療養支援",
        `${fmt(x.functions.home_support || 0)}施設`,
        "病床機能報告上の医療機関",
      ),
      card(
        "人口10万人当たり救急受入",
        x.population && x.activity.ambulance
          ? `${fmt((x.activity.ambulance / x.population) * 100000)}件`
          : "—",
        "2020年人口を分母にした参考値",
      ),
      card(
        "75歳以上1万人当たり在宅支援",
        pop?.p2020?.over75
          ? `${fmt(((x.functions.home_support || 0) / pop.p2020.over75) * 10000)}施設`
          : "—",
        "2020年人口を分母にした参考値",
      ),
    ].join("");
    const reported = detailRows.filter(
      (f) => f.first_visits != null || f.referrals != null,
    );
    const sum = (key) =>
      reported.reduce((total, f) => total + (Number(f[key]) || 0), 0);
    const firstVisits = sum("first_visits");
    const referrals = sum("referrals");
    const reverseReferrals = sum("reverse_referrals");
    const deviceSum = (keys) =>
      detailRows.reduce(
        (total, f) =>
          total + Math.max(...keys.map((key) => Number(f[key]) || 0)),
        0,
      );
    $("outpatient-summary").innerHTML = [
      card(
        "外来機能報告施設",
        `${fmt(reported.length)}施設`,
        "初診・紹介のいずれかを報告",
      ),
      card("初診患者", `${fmt(firstVisits)}人/年`, "区域内の報告値合計"),
      card(
        "紹介患者割合",
        firstVisits ? `${((referrals / firstVisits) * 100).toFixed(1)}%` : "—",
        "紹介患者数÷初診患者数の参考値",
      ),
      card("逆紹介患者", `${fmt(reverseReferrals)}人/年`, "区域内の報告値合計"),
      card(
        "64列以上CT",
        `${fmt(deviceSum(["ct64_beds", "ct64"]))}台`,
        "医療機関別報告の合計",
      ),
      card(
        "3T以上MRI",
        `${fmt(deviceSum(["mri3_beds", "mri3"]))}台`,
        "医療機関別報告の合計",
      ),
    ].join("");
    const list = $("capacity-facilities"),
      input = $("capacity-search"),
      sort = $("capacity-sort"),
      facilities = x.facilities || [];
    const filter = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      list.querySelectorAll(".facility-card").forEach((el) => {
        el.hidden = Boolean(q && !el.dataset.search.includes(q));
        if (!el.hidden) shown++;
      });
      $("capacity-facility-count").textContent =
        `${facilities.length}施設中 ${shown}施設を表示`;
    };
    const draw = () => {
      const key = sort.value,
        rows = [...facilities].sort((a, b) =>
          key === "name"
            ? a.name.localeCompare(b.name, "ja")
            : (Number(b[key]) || 0) - (Number(a[key]) || 0) ||
              a.name.localeCompare(b.name, "ja"),
        );
      list.innerHTML =
        rows
          .map((f) =>
            capacityFacilityCard(f, facilityDetail(f)),
          )
          .join("") || '<p class="empty">収録施設はありません。</p>';
      filter();
    };
    input.value = "";
    sort.value = "ambulance";
    input.oninput = filter;
    sort.onchange = draw;
    draw();
    $("capacity-reading").textContent =
      "急性期拠点の指定や病院の優劣を示すものではありません。病床機能報告と外来機能報告は対象・必須条件・欠測の扱いが異なるため、同名項目でも単純に合算・比較しません。";
  }
  const changeSign = (ratio) =>
    `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;
  function renderGuidelinePanels(
    areaCode,
    pn,
    areaName,
    pop,
    od,
    bed,
    care,
    na,
  ) {
    const x = officialFlowCapacity.areas.find((a) => a.code === areaCode),
      p2040 = pop?.p2040?.total,
      workingChange =
        pop?.p2020 && pop?.p2040
          ? (pop.p2040.working / pop.p2020.working - 1) * 100
          : null;
    const raw = x
        ? [
            ...(cooperationDirection === "in"
              ? []
              : (x.outflow?.partners?.[cooperationType] || []).map((v) => ({
                  ...v,
                  direction: "流出先",
                }))),
            ...(cooperationDirection === "out"
              ? []
              : (x.inflow?.partners?.[cooperationType] || []).map((v) => ({
                  ...v,
                  direction: "流入元",
                }))),
          ]
        : [],
      merged = new Map();
    raw.forEach((v) => {
      const old = merged.get(v.code);
      if (!old) merged.set(v.code, { ...v, directions: [v.direction] });
      else {
        old.share = Math.max(old.share, v.share);
        if (!old.directions.includes(v.direction))
          old.directions.push(v.direction);
      }
    });
    const candidates = [...merged.values()]
        .sort((a, b) => b.share - a.share)
        .slice(0, 3),
      partner = candidates[0],
      typeName = {
        acute: "高度急性期＋急性期",
        inclusive: "包括期",
        chronic: "慢性期",
      }[cooperationType];
    const combinedRow = (c) => {
        const r = officialFlowCapacity.areas.find((a) => a.code === c.code),
          p = populationSummary(c.code);
        return {
          candidate: c,
          resource: r,
          pop: p,
          values: {
            population: p2040 && p?.p2040?.total ? p2040 + p.p2040.total : null,
            over85:
              pop?.p2040?.over85 != null && p?.p2040?.over85 != null
                ? pop.p2040.over85 + p.p2040.over85
                : null,
            beds:
              x?.beds?.total != null && r?.beds?.total != null
                ? x.beds.total + r.beds.total
                : null,
            doctors:
              x && r
                ? (x.doctors_fulltime || 0) + (r.doctors_fulltime || 0)
                : null,
            ambulance:
              x && r
                ? (x.activity?.ambulance || 0) + (r.activity?.ambulance || 0)
                : null,
            home:
              x && r
                ? (x.functions?.home_support || 0) +
                  (r.functions?.home_support || 0)
                : null,
          },
        };
      },
      rows = candidates.map(combinedRow),
      value = (v, u = "") => (v == null ? "—" : fmt(v) + u);
    $("scale-title").textContent = `9. ${areaName}区域の規模と広域連携`;
    $("regional-scale-cards").innerHTML = [
      card(
        "2040年人口",
        p2040 ? `${fmt(p2040)}人` : "—",
        "社人研推計の構成市区町村合算",
      ),
      card(
        "20万人基準",
        p2040 == null
          ? "判定不可"
          : p2040 >= 200000
            ? "20万人以上"
            : "20万人未満",
        "ガイドラインの区域検討目安",
      ),
      card(
        "公表された連携候補",
        `${candidates.length}区域`,
        `上位3区域・${typeName}`,
      ),
      card(
        "最大の患者流動",
        partner ? `${(partner.share * 100).toFixed(1)}%` : "—",
        partner ? partner.directions.join("・") : "患者移動0を意味しない",
      ),
    ].join("");
    $("regional-partners").innerHTML = candidates.length
      ? `<h4>広域連携の協議候補（上位${candidates.length}区域）</h4><div class="candidate-grid">${candidates.map((c, i) => `<article><b>${i + 1}</b><div><strong>${esc(c.prefecture)} ${esc(c.name)}</strong><span>${esc(c.directions.join("・"))} ${(c.share * 100).toFixed(1)}%</span></div></article>`).join("")}</div><p>${esc(typeName)}の公表患者流動から抽出しました。割合は候補の優先順位を自動決定するものではありません。</p>`
      : "<h4>広域連携の協議候補</h4><p>選択条件では相手区域が公表基準未満のため、患者流動から候補を特定できません。0を意味するものではありません。</p>";
    const current = {
        population: p2040,
        over85: pop?.p2040?.over85,
        beds: x?.beds?.total,
        doctors: x?.doctors_fulltime,
        ambulance: x?.activity?.ambulance,
        home: x?.functions?.home_support,
      },
      metricRows = [
        ["2040年人口", "population", "人"],
        ["2040年85歳以上", "over85", "人"],
        ["現在病床", "beds", "床"],
        ["常勤医師", "doctors", "人"],
        ["救急車受入", "ambulance", "件"],
        ["在宅療養支援", "home", "施設"],
      ];
    $("regional-comparison").innerHTML =
      `<h4>現在の区域と連携時の単純合算</h4><div class="table-wrap"><table><thead><tr><th>指標</th><th>${esc(areaName)}単独</th>${rows.map((r) => `<th>＋ ${esc(r.candidate.name)}</th>`).join("")}</tr></thead><tbody>${metricRows.map(([label, key, unit]) => `<tr><th>${label}</th><td>${value(current[key], unit)}</td>${rows.map((r) => `<td>${value(r.values[key], unit)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p>患者や医療資源を実際に移す想定値ではなく、協議範囲を比較するための単純合算です。</p>`;
    $("regional-scale-reading").textContent =
      "20万人は構想区域を機械的に統合する基準ではありません。上位候補ごとに、2040年人口、患者流動、医療資源、実際の移動時間を併せて区域の維持・広域連携・見直しを協議してください。";
    const metric = (id) => na?.metrics?.[id],
      mv = (id) =>
        metric(id)
          ? `${fmt(metric(id).published_lower_bound)}${metric(id).unit}`
          : "—";
    $("care-pathway").innerHTML = [
      [
        "1 救急受入",
        x?.activity?.ambulance == null ? "—" : `${fmt(x.activity.ambulance)}件`,
        "救急車受入",
      ],
      [
        "2 急性期治療",
        x?.activity?.general_anesthesia == null
          ? "—"
          : `${fmt(x.activity.general_anesthesia)}件`,
        "全身麻酔手術",
      ],
      [
        "3 リハビリ",
        `${mv("stroke_rehabilitation")}／${mv("convalescent_rehab_ward")}`,
        "脳血管／回復期病棟",
      ],
      [
        "4 退院・在宅",
        od?.home?.["2040"] == null ? "—" : `${fmt(od.home["2040"])}件/月`,
        "2040年訪問診療需要",
      ],
      [
        "5 介護・生活支援",
        care?.adjusted_rate_pct == null
          ? "—"
          : `${care.adjusted_rate_pct.toFixed(1)}%`,
        "調整済み認定率",
      ],
    ]
      .map(
        ([a, b, c]) =>
          `<article><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></article>`,
      )
      .join('<i aria-hidden="true">→</i>');
    $("pathway-title").textContent =
      `10. ${areaName}の高齢者救急から在宅・介護まで`;
    $("pathway-reading").textContent =
      "異なる統計の現状値・推計値で、同じ患者を追跡した経路ではありません。退院調整日数、訪問看護人員、介護施設定員は地域資料で補完が必要です。";
    const apd =
        x?.doctors_fulltime && x.activity?.ambulance
          ? x.activity.ambulance / x.doctors_fulltime
          : null,
      spd =
        x?.doctors_fulltime && x.activity?.general_anesthesia
          ? x.activity.general_anesthesia / x.doctors_fulltime
          : null;
    $("workforce-title").textContent = `11. ${areaName}の人材とアクセス`;
    $("workforce-cards").innerHTML = [
      card(
        "常勤医師",
        x?.doctors_fulltime == null ? "—" : `${fmt(x.doctors_fulltime)}人`,
        "病床機能報告等",
      ),
      card(
        "非常勤医師換算",
        x?.doctors_parttime_fte == null
          ? "—"
          : `${fmt(x.doctors_parttime_fte)}人`,
        "常勤換算",
      ),
      card(
        "100床当たり医師",
        x?.doctors_per_100_beds == null
          ? "—"
          : `${fmt(x.doctors_per_100_beds)}人`,
        "現在の病床を分母",
      ),
      card(
        "医師1人当たり救急受入",
        apd == null ? "—" : `${fmt(apd)}件`,
        "負荷の参考・質評価ではない",
      ),
      card(
        "医師1人当たり全身麻酔",
        spd == null ? "—" : `${fmt(spd)}件`,
        "負荷の参考・質評価ではない",
      ),
      card(
        "2040年 生産年齢人口",
        workingChange == null
          ? "—"
          : `${workingChange >= 0 ? "+" : ""}${workingChange.toFixed(1)}%`,
        "2020年比・人材供給の背景",
      ),
    ].join("");
    $("workforce-reading").textContent =
      "看護師、薬剤師、リハビリ職、介護職の区域別現員・2040年必要数は現在の全国原表にないため推計していません。職種別・診療科別・勤務時間別の地域データを追加してください。";
    const density =
        x?.area_km2 && x.population ? x.population / x.area_km2 : null,
      external = x
        ? [
            ...(x.inflow?.partners?.acute || []),
            ...(x.outflow?.partners?.acute || []),
          ].filter((v) => v.code.slice(0, 2) !== areaCode.slice(0, 2)).length
        : 0;
    $("access-cards").innerHTML = [
      card(
        "区域面積",
        x?.area_km2 == null ? "—" : `${fmt(x.area_km2)}km²`,
        "地理的な広がり",
      ),
      card(
        "人口密度",
        density == null ? "—" : `${fmt(density)}人/km²`,
        "2020年人口による参考値",
      ),
      card(
        "区域内完結率",
        x?.outflow?.overall == null
          ? "—"
          : `${((1 - x.outflow.overall) * 100).toFixed(1)}%`,
        "2024年度NDB",
      ),
      card("県外の主な相手", `${external}区域`, "高度急性期＋急性期・重複含む"),
    ].join("");
    $("access-reading").textContent =
      "人口密度や直線距離は救急搬送時間の代替ではありません。道路、船便、積雪、公共交通を反映した30分・60分到達圏と実搬送時間は、都道府県・消防・医療機関の資料で追加確認してください。";
    $("future-function-status").innerHTML =
      '<h4>新たな医療機関機能の検討状況</h4><div class="function-grid">' +
      [
        ["急性期拠点機能", "救急・手術・医師"],
        ["高齢者救急・地域急性期機能", "救急受入・リハビリ"],
        ["在宅医療等連携機能", "在宅需要・支援施設"],
        ["専門等機能", "DPC・NDB・がん実績"],
      ]
        .map(
          ([a, b]) =>
            `<article><strong>${a}</strong><span>現状指標あり</span><small>${b}を確認</small></article>`,
        )
        .join("") +
      "</div><p>2040年の機能報告は未公表です。現在の実績だけで機能を自動指定しません。</p>";
    const bedNeed = bed?.beds?.total?.["2025_need"],
      lines = [
        `${pn} ${areaName} 地域協議用サマリー`,
        `2040年人口：${p2040 ? fmt(p2040) + "人" : "確認不能"}${pop?.p2020 && p2040 ? `（2020年比 ${changeSign(p2040 / pop.p2020.total - 1)}）` : ""}`,
        `構想区域：${p2040 == null ? "判定不能" : p2040 >= 200000 ? "20万人以上" : "20万人未満"}。${partner ? `主な協議候補 ${partner.prefecture} ${partner.name}（${partner.direction} ${(partner.share * 100).toFixed(1)}%）` : "公表流動から相手区域を特定できない"}`,
        `病床：現行構想の2025年必要病床数 ${bedNeed == null ? "未収録" : fmt(bedNeed) + "床"}。2040年必要病床数は全国一括未公表。`,
        `在宅：2040年訪問診療需要 ${od?.home?.["2040"] == null ? "未収録" : fmt(od.home["2040"]) + "件/月"}。`,
        `確認課題：実移動時間、受入余力、退院調整、訪問看護・介護施設定員、職種別人材を地域資料で補完。`,
        `PDCA指標例：救急受入、全身麻酔手術、リハビリ、在宅需要、流出入、医師数を毎年度確認。`,
      ],
      pdcaText = lines.join("\n");
    $("pdca-title").textContent = `12. ${areaName}の地域協議用サマリー`;
    $("pdca-summary").innerHTML = `<ul>${lines
      .slice(1)
      .map((v) => `<li>${esc(v)}</li>`)
      .join("")}</ul>`;
    $("pdca-copy").onclick = async () => {
      await navigator.clipboard.writeText(pdcaText);
      $("pdca-copy").textContent = "コピーしました";
      setTimeout(() => ($("pdca-copy").textContent = "文章をコピー"), 1600);
    };
    $("pdca-download").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([pdcaText], { type: "text/plain;charset=utf-8" }),
      );
      a.download = `地域協議サマリー_${areaCode}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $("pdca-print").onclick = () => window.print();
  }
  async function renderFacilities(pc, areaCode, pop, dpcArea) {
    const hospitals = await areaHospitals(pc, areaCode),
      muniNames = new Map(pop?.municipalities || []),
      list = $("dpc-facilities"),
      input = $("dpc-facility-search"),
      sort = $("dpc-facility-sort");
    const draw = () => {
      const key = sort.value,
        rows = [...hospitals].sort((a, b) =>
          key === "name"
            ? a.name.localeCompare(b.name, "ja")
            : (Number(b[key]) || 0) - (Number(a[key]) || 0) ||
              a.name.localeCompare(b.name, "ja"),
        );
      list.innerHTML = rows.length
        ? rows.map((h) => hospitalCard(h, muniNames)).join("")
        : '<p class="empty">この医療圏のDPC調査参加施設は収録されていません。</p>';
      list
        .querySelectorAll("[data-dpc-detail]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              openDpcDetail(
                hospitals.find(
                  (h) => `${h.notice}:${h.serial}` === b.dataset.dpcDetail,
                ),
              ).catch(() => openDialog("<p>詳細を読み込めませんでした。</p>"))),
        );
      filter();
    };
    const filter = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      list.querySelectorAll(".facility-card").forEach((el) => {
        el.hidden = Boolean(q && !el.dataset.search.includes(q));
        if (!el.hidden) shown++;
      });
      $("dpc-facility-count").textContent =
        `${hospitals.length}施設中 ${shown}施設を表示`;
    };
    input.value = "";
    sort.value = "published";
    input.oninput = filter;
    sort.onchange = draw;
    draw();
    const facilities = cancer.facilities.filter((f) => f.area === areaCode);
    $("cancer-facilities").innerHTML = facilities.length
      ? facilities.map(cancerCard).join("")
      : '<p class="empty">現況報告に収録された圏内施設はありません。</p>';
    $("cancer-facilities")
      .querySelectorAll("[data-cancer-detail]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            openCancerDetail(b.dataset.cancerDetail).catch(() =>
              openDialog("<p>詳細を読み込めませんでした。</p>"),
            )),
      );
    $("cancer-reading").textContent =
      `${dpcArea.name}医療圏の現況報告収録施設 ${facilities.length}施設です。指定状況は更新されるため、厚生労働省の最新一覧も併せて確認してください。`;
  }
  async function render() {
    const pc = pref.value,
      pn = pref.options[pref.selectedIndex]?.textContent || "",
      areaCode = area.value,
      da = dpc.areas.find((x) => x.code === areaCode),
      na = ndb.areas.find((x) => x.code === areaCode);
    if (!da || !na) throw new Error("選択地域のデータを確認できません");
    const pop = populationSummary(areaCode),
      change =
        pop?.p2020 && pop?.p2040
          ? (pop.p2040.total / pop.p2020.total - 1) * 100
          : null;
    history.replaceState(
      null,
      "",
      `${location.pathname}?pref=${pc}&area=${areaCode}`,
    );
    links.population.href = `/population/?area=${pc}000`;
    links.dpc.href = `/dpc/?year=2024&view=area&area=${areaCode}`;
    links.ndb.href = `/ndb/service-volume/?year=2024&pref=${encodeURIComponent(pn)}&area=${areaCode}`;
    links.care.href = `/care/?pref=${encodeURIComponent(pn)}`;
    links.flow.href = `/ndb/patient-flow/?pref=${pc}&area=${areaCode}`;
    status.innerHTML = `<strong>現在の選択</strong><span class="selection-area">${esc(pn)} ${esc(da.name)}医療圏</span>`;
    $("population-scope").textContent =
      `二次医療圏単位・${pn} ${da.name}医療圏・社人研令和5年推計`;
    $("population-title").textContent = `1. ${da.name}医療圏の2040年人口構造`;
    $("dpc-scope").textContent =
      `二次医療圏単位・${pn} ${da.name}医療圏・令和6年度DPC調査`;
    $("dpc-title").textContent = `2. ${da.name}医療圏の急性期入院・救急・手術`;
    $("cancer-scope").textContent =
      `二次医療圏単位・${pn} ${da.name}医療圏・がん診療連携拠点病院等`;
    $("cancer-title").textContent = `3. ${da.name}医療圏のがん拠点病院`;
    $("beds-scope").textContent =
      `構想区域単位・${pn} ${da.name}・病床機能報告等`;
    $("beds-title").textContent = `4. ${da.name}区域の病床数・予定数・必要数`;
    $("care-scope").textContent =
      `構成市区町村・${pn} ${da.name}医療圏・2024年度介護保険`;
    $("care-title").textContent = `7. ${da.name}医療圏の介護の受け皿`;
    $("ndb-scope").textContent =
      `二次医療圏単位・${pn} ${da.name}医療圏・第11回NDBオープンデータ`;
    $("ndb-title").textContent =
      `8. ${da.name}医療圏の救急・専門医療・リハビリ`;
    if (pop?.p2020 && pop?.p2040) {
      $("population-cards").innerHTML = [
        card(
          "2040年人口",
          `${fmt(pop.p2040.total)}人`,
          `${change >= 0 ? "+" : ""}${change.toFixed(1)}%（2020年比）`,
        ),
        card(
          "0～14歳",
          `${fmt(pop.p2040.young)}人`,
          pct(pop.p2040.young, pop.p2040.total),
        ),
        card(
          "15～64歳",
          `${fmt(pop.p2040.working)}人`,
          pct(pop.p2040.working, pop.p2040.total),
        ),
        card(
          "65歳以上",
          `${fmt(pop.p2040.old)}人`,
          pct(pop.p2040.old, pop.p2040.total),
        ),
        card(
          "75歳以上",
          `${fmt(pop.p2040.over75)}人`,
          pct(pop.p2040.over75, pop.p2040.total),
        ),
        card(
          "85歳以上",
          `${fmt(pop.p2040.over85)}人`,
          pct(pop.p2040.over85, pop.p2040.total),
        ),
      ].join("");
      $("population-reading").textContent =
        `構成${pop.municipalities.length}市区町村の推計値を合算。2020年から2040年に総人口は${Math.abs(change).toFixed(1)}%${change < 0 ? "減少" : "増加"}する推計です。`;
      $("demand-index").innerHTML = [
        indexCard("総人口", pop.p2020.total, pop.p2040.total),
        indexCard("65歳以上", pop.p2020.old, pop.p2040.old),
        indexCard("75歳以上", pop.p2020.over75, pop.p2040.over75),
        indexCard("85歳以上", pop.p2020.over85, pop.p2040.over85),
      ].join("");
    } else {
      $("population-cards").innerHTML = card(
        "2040年人口",
        "算出できません",
        "将来人口が浜通り地域として一括公表",
      );
      $("population-reading").textContent =
        "相双・いわき医療圏は、将来人口が「浜通り地域」として一括公表され、医療圏別に分けられないため按分していません。";
      $("demand-index").innerHTML =
        '<p class="empty">医療圏別人口を再現できないため表示しません。</p>';
    }
    const od = officialDemand.areas.find((x) => x.code === areaCode);
    if (od) {
      const demandRow = (label, values) => {
        const years = Object.keys(values).sort((a, b) => Number(a) - Number(b));
        const peakYear = years.reduce(
          (best, year) =>
            Number(values[year]) > Number(values[best]) ? year : best,
          years[0],
        );
        const latest = years.at(-1);
        const change = values["2024"]
          ? ((values[latest] / values["2024"] - 1) * 100).toFixed(1)
          : null;
        return `<article class="demand-series"><h5>${esc(label)}</h5><div class="demand-year-grid">${years.map((year) => `<div><span>${year}年度</span><b>${fmt(values[year])}件/月</b></div>`).join("")}</div><p><strong>ピーク：${peakYear}年度 ${fmt(values[peakYear])}件/月</strong><span>${change == null ? "増減率を算出できません" : `2024→${latest}年度 ${Number(change) >= 0 ? "+" : ""}${change}%`}</span></p></article>`;
      };
      $("official-demand").innerHTML =
        demandRow("外来需要", od.outpatient) +
        demandRow("在宅（訪問診療）需要", od.home);
      $("demand-note").textContent =
        "厚生労働省公式推計の全収録年（2024・2030・2035・2040・2045・2050年度）を表示しています。2024年度の受療率に将来推計人口を乗じた現状投影で、必要病床数や供給目標そのものではありません。";
    } else {
      $("official-demand").innerHTML =
        '<p class="empty">現在の構想区域との対応を確認できないため表示していません。</p>';
      $("demand-note").textContent =
        "三重県は構想区域が再編され、当サイトのDPC・NDB医療圏と一致しないため、公式推計を旧医療圏へ按分していません。";
    }
    const bed = officialBeds.areas.find((x) => x.code === areaCode);
    if (bed) {
      const labels = {
        total: "病床合計",
        highAcute: "高度急性期",
        acute: "急性期",
        recovery: "回復期",
        chronic: "慢性期",
      };
      $("beds-cards").innerHTML = Object.entries(labels)
        .map(([k, label]) => {
          const x = bed.beds[k];
          return `<article class="metric-card bed-card"><span>${esc(label)}</span><strong>${x?.["2024"] == null ? "—" : fmt(x["2024"]) + "床"}</strong><small>2024年報告</small><dl><div><dt>2026年予定</dt><dd>${x?.["2026_plan"] == null ? "—" : fmt(x["2026_plan"]) + "床"}</dd></div><div><dt>2025年必要数</dt><dd>${x?.["2025_need"] == null ? "—" : fmt(x["2025_need"]) + "床"}</dd></div></dl></article>`;
        })
        .join("");
      $("beds-reading").textContent =
        "2024年報告、2026年予定、現行構想の2025年必要病床数を併記しています。新ガイドラインは2040年の高度急性期・急性期・包括期・慢性期の必要病床数を都道府県が推計するとしていますが、全国一括の構想区域別2040年値はまだ公表されていません。報告病床数と必要病床数は計算方法が異なり、差だけで過不足や削減数を判断できません。";
    } else {
      $("beds-cards").innerHTML = card(
        "病床数",
        "対応確認中",
        "構想区域再編のため旧医療圏へ按分していません",
      );
      $("beds-reading").textContent =
        "現在の構想区域と、この画面のDPC・NDB医療圏が一致しないため表示していません。";
    }
    renderBedFunctionFacilities(areaCode, da.name);
    renderOfficialResources(areaCode, pn, da.name, pop);
    const care = areaCare.areas.find((x) => x.code === areaCode);
    if (care?.matched_insurers) {
      const composition = care.service_composition,
        isInsurerReference = care.insurer_scope === "reference";
      $("care-cards").innerHTML = [
        card(
          "調整済み認定率",
          care.adjusted_rate_pct == null
            ? "—"
            : `${care.adjusted_rate_pct.toFixed(1)}%`,
          isInsurerReference ? "保険者全体の参考値" : "性・年齢構成を調整",
        ),
        card(
          "1人当たり年間給付費",
          care.benefit_per_insured_annual_yen == null
            ? "—"
            : `${fmt(Math.round(care.benefit_per_insured_annual_yen))}円`,
          isInsurerReference ? "保険者全体の参考値" : "第1号被保険者1人当たり",
        ),
        card(
          "集計保険者",
          `${care.matched_insurers}保険者`,
          `${care.municipality_count}市区町村中`,
        ),
        card(
          "2040年 85歳以上",
          pop?.p2040 ? `${fmt(pop.p2040.over85)}人` : "—",
          pop?.p2040 && pop?.p2020
            ? `${((pop.p2040.over85 / pop.p2020.over85) * 100).toFixed(0)}（2020年=100）`
            : "将来推計なし",
        ),
      ].join("");
      if (composition?.matched_insurers) {
        const services = [
            ["居宅", composition.home_share_pct, "care-home"],
            ["地域密着型", composition.community_share_pct, "care-community"],
            ["施設", composition.facility_share_pct, "care-facility"],
          ],
          segments = [];
        let offset = 0;
        services.forEach(([label, value, cls]) => {
          const width = Number(value) || 0;
          segments.push(
            `<rect class="${cls}" x="${offset.toFixed(3)}" y="0" width="${width.toFixed(3)}" height="8"><title>${label} ${width.toFixed(1)}%</title></rect>${width >= 28 ? `<text x="${(offset + width / 2).toFixed(3)}" y="5.3">${label} ${width.toFixed(1)}%</text>` : ""}`,
          );
          offset += width;
        });
        $("care-composition").innerHTML = `<section class="care-composition${isInsurerReference ? " care-composition-reference" : ""}" aria-labelledby="care-composition-title"><div class="care-composition-head"><h4 id="care-composition-title">${isInsurerReference ? "参考：保険者全体の介護給付費構成" : "介護給付費のサービス構成"}</h4><span>${isInsurerReference ? esc(care.insurer_scope_note) : `医療圏内の${composition.matched_insurers}保険者を集計`}</span></div><svg viewBox="0 0 100 8" role="img" aria-label="${services.map(([label, value]) => `${label} ${Number(value).toFixed(1)}%`).join("、")}">${segments.join("")}</svg><div class="care-composition-legend">${services.map(([label, value, cls]) => `<span><i class="${cls}"></i><b>${label}</b> ${Number(value).toFixed(1)}%</span>`).join("")}</div></section>`;
      } else $("care-composition").innerHTML = "";
      $("care-insurers").innerHTML =
        `<details><summary>集計した保険者を見る</summary><ul>${care.insurers.map((x) => `<li>${esc(x.name)}：調整済み認定率 ${x.adjusted_rate_pct == null ? "—" : x.adjusted_rate_pct.toFixed(1) + "%"}／1人当たり給付費 ${x.benefit_per_insured_annual_yen == null ? "—" : fmt(Math.round(x.benefit_per_insured_annual_yen)) + "円"}</li>`).join("")}</ul></details>`;
      $("care-reading").textContent = isInsurerReference
        ? `この保険者は複数の医療圏にまたがるため、${care.insurer_scope_note}の値を参考表示しています。選択した医療圏だけの値ではありません。この割合は、施設の定員や空き状況、サービスの受入余力を示すものではありません。`
        : "医療圏内の各市町村について、介護給付費を「居宅・地域密着型・施設」に分けて合計し、医療圏全体に占める割合を表示しています。この割合は、施設の定員や空き状況、サービスの受入余力を示すものではありません。";
    } else {
      $("care-cards").innerHTML = card(
        "介護保険",
        "集計対象なし",
        "同名の市区町村保険者を確認できません",
      );
      $("care-insurers").innerHTML = "";
      $("care-composition").innerHTML = "";
      $("care-reading").textContent =
        "広域保険者など、医療圏構成市区町村との対応確認が必要です。";
    }
    $("dpc-cards").innerHTML = [
      card(
        "DPC調査参加施設",
        `${fmt(da.hospitalCount)}施設`,
        "令和6年度の公表対象",
      ),
      publicValue("退院患者", da.published, da.suppressed),
      publicValue("手術あり", da.surgeryPublished, da.surgerySuppressed),
      publicValue(
        "救急医療入院",
        da.emergencyPublished,
        da.emergencySuppressed,
      ),
      publicValue("救急車搬送", da.ambulancePublished, da.ambulanceSuppressed),
    ].join("");
    $("dpc-reading").textContent =
      "非公表セルがある場合は件数を数値の下に示します。件数は診療実績であり、病床の過不足や医療の質を直接示しません。";
    $("ndb-cards").innerHTML = Object.entries(metricLabels)
      .map(([id, label]) => {
        const m = na.metrics[id];
        if (!m) return card(label, "未収録", "この年度の対象外");
        const note = m.is_complete
          ? "非公表項目なし"
          : `非公表項目 ${m.suppressed_component_count}件あり（数値に含まず）`;
        let scenario = "";
        if (m.is_complete && pop?.p2020 && pop?.p2040) {
          const low = Math.round(
              m.published_lower_bound *
                Math.min(
                  pop.p2040.total / pop.p2020.total,
                  pop.p2040.over75 / pop.p2020.over75,
                ),
            ),
            high = Math.round(
              m.published_lower_bound *
                Math.max(
                  pop.p2040.total / pop.p2020.total,
                  pop.p2040.over75 / pop.p2020.over75,
                ),
            );
          scenario = `<div class="scenario-value"><span>2040人口シナリオ</span><b>${fmt(low)}～${fmt(high)}${esc(m.unit)}</b></div>`;
        }
        return `<article class="metric-card ndb-metric-card"><span>${esc(label)}</span><strong>${fmt(m.published_lower_bound)}${esc(m.unit)}</strong><small>${esc(note)}</small>${scenario}</article>`;
      })
      .join("");
    const incomplete = Object.keys(metricLabels).filter(
      (id) => na.metrics[id] && !na.metrics[id].is_complete,
    ).length;
    $("ndb-reading").textContent =
      `2040人口シナリオは、総人口比例と75歳以上人口比例の間を参考幅として示したもので、年齢別受療率を用いた必要量推計ではありません。患者流出入、提供体制、技術変化も反映していません。${incomplete ? `主要6指標のうち${incomplete}指標は非公表項目があるため参考幅を表示していません。` : ""}`;
    renderGuidelinePanels(areaCode, pn, da.name, pop, od, bed, care, na);
    await renderFacilities(pc, areaCode, pop, da);
    $("discussion-list").innerHTML = [
      "2040年の75歳以上・85歳以上人口と、公式の外来・在宅需要推計を照合する",
      "住所地に基づく患者流入・流出と、流出先・流入元の構想区域を確認する",
      "施設別の救急搬送・全身麻酔手術・病床・医師数から、圏内の役割分担と受入余力を協議する",
      "在宅療養支援病院・診療所と介護保険実績を確認し、未収載の訪問看護人員・介護施設定員を自治体資料で補う",
      "20万人基準、連携候補、実移動時間を確認し、区域維持・広域連携・見直しを協議する",
    ]
      .map((x) => `<li>${esc(x)}</li>`)
      .join("");
    $("diagnosis-loading").hidden = true;
    $("diagnosis-content").hidden = false;
  }
  function setAreas(wanted) {
    const rows = dpc.areas.filter((x) => x.code.slice(0, 2) === pref.value);
    area.innerHTML = rows
      .map((x) => `<option value="${x.code}">${esc(x.name)}</option>`)
      .join("");
    area.value = rows.some((x) => x.code === wanted)
      ? wanted
      : rows[0]?.code || "";
  }
  async function init() {
    [
      dpc,
      ndb,
      future,
      areaMap,
      cancer,
      officialDemand,
      officialBeds,
      areaCare,
      officialFlowCapacity,
      medicalAreaMap,
      facilityDetails,
      bedFunctionFacilities,
    ] = await Promise.all([
      fetch("/dpc/data/summary.json").then((r) => r.json()),
      gzipJson("/ndb/service-volume/data/medical-areas.json.gz"),
      loadFuture(),
      fetch(
        "/regional-healthcare-vision/data/medical-area-municipalities.json",
      ).then((r) => r.json()),
      fetch(
        "/regional-healthcare-vision/data/cancer-facilities-enriched.json",
      ).then((r) => r.json()),
      fetch(
        "/regional-healthcare-vision/data/official-medical-demand.json",
      ).then((r) => r.json()),
      fetch("/regional-healthcare-vision/data/official-beds.json").then((r) =>
        r.json(),
      ),
      fetch("/regional-healthcare-vision/data/area-care-summary-v3.json").then(
        (r) => r.json(),
      ),
      gzipJson(
        "/regional-healthcare-vision/data/official-flow-capacity.json.gz",
      ),
      gzipJson("/regional-healthcare-vision/data/medical-areas-map.geojson.gz"),
      gzipJson("/regional-healthcare-vision/data/facility-details-v3.json.gz"),
      gzipPartsJson(
        [
          "/regional-healthcare-vision/data/bed-function-facilities-v4.json.gz.0",
          "/regional-healthcare-vision/data/bed-function-facilities-v4.json.gz.1",
        ],
      ),
    ]);
    dpc.areas = dpc.areas.filter((x) => /^\d{4}$/.test(x.code));
    const names = new Map(
      dpc.areas.map((x) => [x.code.slice(0, 2), x.prefecture]),
    );
    pref.innerHTML = [...names]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([c, n]) => `<option value="${c}">${esc(n)}</option>`)
      .join("");
    const q = new URLSearchParams(location.search),
      ra = q.get("area"),
      rp = q.get("pref"),
      initial = /^\d{4}$/.test(ra || "")
        ? ra.slice(0, 2)
        : /^\d{2}$/.test(rp || "")
          ? rp
          : "05";
    pref.value = names.has(initial) ? initial : pref.options[0].value;
    setAreas(ra);
    pref.onchange = () => {
      setAreas("");
      render().catch(showError);
    };
    area.onchange = () => render().catch(showError);
    $("regional-detail-close").onclick = () =>
      $("regional-detail-dialog").close();
    document.querySelectorAll("[data-flow-type]").forEach(
      (b) =>
        (b.onclick = () => {
          flowType = b.dataset.flowType;
          document
            .querySelectorAll("[data-flow-type]")
            .forEach((x) => x.classList.toggle("active", x === b));
          render().catch(showError);
        }),
    );
    document.querySelectorAll("[data-flow-direction]").forEach(
      (b) =>
        (b.onclick = () => {
          flowDirection = b.dataset.flowDirection;
          document
            .querySelectorAll("[data-flow-direction]")
            .forEach((x) => x.classList.toggle("active", x === b));
          render().catch(showError);
        }),
    );
    $("cooperation-type").onchange = (e) => {
      cooperationType = e.target.value;
      render().catch(showError);
    };
    $("cooperation-direction").onchange = (e) => {
      cooperationDirection = e.target.value;
      render().catch(showError);
    };
    await render();
  }
  function showError(error) {
    status.textContent = error.message;
    status.classList.add("error");
    $("diagnosis-loading").textContent =
      "地域診断を読み込めませんでした。時間をおいて再読み込みしてください。";
  }
  init().catch(showError);
})();
