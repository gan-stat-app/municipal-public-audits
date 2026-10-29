import React, { useEffect, useMemo, useRef, useState } from 'react';
import { arbitraryCauses } from '../catalogs/causes.js';
import { prefectures, prefectureName } from '../lib/areaCatalog.js';
import { loadMedicalAreas } from '../lib/medicalAreas.js';
import { batchRegionChoices, buildSmrBatchExport, downloadSmrBatchExport, SMR_BATCH_LIMIT, smrBatchSelectionKey } from '../lib/smrBatchExport.js';

const initialUnit = query => query.regionUnit === 'medical-area' ? 'medical-area' : query.areaCode.endsWith('000') ? 'prefecture' : 'municipality';
const initialCode = query => query.regionUnit === 'medical-area' ? query.medicalAreaCode : query.areaCode;
const sexLabels = { 男: '男性', 女: '女性', 男女計: '男女計' };
const toggle = (values, value) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];

export default function SmrBatchExport({ query, areaCatalog, medicalAreas, dataset, datasetQuery }) {
  const [unit, setUnit] = useState(() => initialUnit(query));
  const [regionCodes, setRegionCodes] = useState(() => [initialCode(query)]);
  const [causeCodes, setCauseCodes] = useState(() => [query.datasetCode]);
  const [sexes, setSexes] = useState(() => [query.sex]);
  const [pref, setPref] = useState(() => initialCode(query).slice(0, 2));
  const [search, setSearch] = useState('');
  const [loadedAreas, setLoadedAreas] = useState(medicalAreas);
  const [catalogError, setCatalogError] = useState('');
  const [progress, setProgress] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [message, setMessage] = useState('');
  const controller = useRef(null);
  const areas = medicalAreas.length ? medicalAreas : loadedAreas;
  const choices = useMemo(() => batchRegionChoices(unit, areaCatalog, areas), [unit, areaCatalog, areas]);
  const shown = choices.filter(area => (unit === 'prefecture' || area.code.startsWith(pref))
    && `${prefectureName(area.code.slice(0, 2))}${area.name}${area.code}`.includes(search.trim()));
  const options = { query, unit, regionCodes, causeCodes, sexes, areaCatalog, medicalAreas: areas, currentDataset: dataset, currentDatasetQuery: datasetQuery };
  const key = smrBatchSelectionKey(options);
  const payload = prepared?.key === key ? prepared.payload : null;
  const count = regionCodes.length * causeCodes.length * sexes.length;
  const ready = count > 0 && count <= SMR_BATCH_LIMIT && regionCodes.every(code => choices.some(area => area.code === code));
  const busy = progress?.key === key;
  useEffect(() => {
    controller.current?.abort(); setProgress(null); setPrepared(null); setMessage('');
    return () => controller.current?.abort();
  }, [key]);
  useEffect(() => {
    if (unit !== 'medical-area' || areas.length) return;
    let active = true;
    setCatalogError('');
    loadMedicalAreas().then(value => { if (active) setLoadedAreas(value); }).catch(() => {
      if (active) setCatalogError('二次医療圏一覧を読み込めませんでした。地域単位を選び直してください。');
    });
    return () => { active = false; };
  }, [unit, areas.length]);
  const changeUnit = value => {
    setUnit(value); setRegionCodes([]); setSearch(''); setPrepared(null);
  };
  const useScreen = () => {
    setUnit(initialUnit(query)); setRegionCodes([initialCode(query)]); setCauseCodes([query.datasetCode]);
    setSexes([query.sex]); setPref(initialCode(query).slice(0, 2)); setSearch('');
  };
  const prepare = async () => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setPrepared(null); setMessage(''); setProgress({ key, completed: 0, total: count });
    try {
      const value = await buildSmrBatchExport(options, { signal: current.signal,
        onProgress: update => { if (!current.signal.aborted) setProgress({ ...update, key }); } });
      if (!current.signal.aborted) {
        setPrepared({ key, payload: value });
        setMessage(`${value.counts.requested}件を準備しました。算定済み${value.counts.complete}件、算定不可${value.counts.unavailable}件です。`);
      }
    } catch (error) {
      if (!current.signal.aborted) setMessage('結果を準備できませんでした。通信を確認して再度お試しください。');
    } finally { if (controller.current === current) setProgress(null); }
  };
  const save = format => {
    if (!payload) return;
    downloadSmrBatchExport(payload, format); setMessage(`${payload.counts.requested}件の${format.toUpperCase()}のダウンロードを開始しました。`);
  };
  return <div className="smr-batch" role="group" aria-label="複数結果の保存条件">
    <p>地域・死因・性別の組み合わせを1つのファイルに保存します。</p>
    <p className="smr-batch-condition"><strong>共通条件：</strong>{query.startYear}～{query.endYear}年 ／ {query.basis === 'juki' ? '住民基本台帳人口' : '国勢調査基準人口'}（日本人）<br /><span>期間・人口方式は上の選択欄で変更できます。</span></p>
    <button type="button" onClick={useScreen}>画面の地域・死因・性別を選択</button>
    <fieldset><legend>1. 地域を選ぶ（{regionCodes.length}地域）</legend>
      <div className="smr-batch-controls">
        <label>一括保存の地域単位<select value={unit} onChange={event => changeUnit(event.target.value)}>
          <option value="municipality">市区町村・政令市・区</option><option value="prefecture">都道府県全体</option><option value="medical-area">二次医療圏</option>
        </select></label>
        {unit !== 'prefecture' && <label>地域一覧の都道府県<select value={pref} onChange={event => { setPref(event.target.value); setSearch(''); }}>
          {prefectures.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select></label>}
        <label>地域名・コードで絞り込み<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="例：秋田市、05201" /></label>
      </div>
      {catalogError && <p role="alert">{catalogError}</p>}
      <div className="smr-export-actions"><button type="button" disabled={!shown.length} onClick={() => setRegionCodes([...new Set([...regionCodes, ...shown.map(area => area.code)])])}>表示中の地域をすべて選択</button>
        <button type="button" disabled={!regionCodes.length} onClick={() => setRegionCodes([])}>地域の選択を解除</button></div>
      <div className="smr-batch-options" role="group" aria-label="保存する地域">
        {shown.map(area => <label key={area.code}><input type="checkbox" checked={regionCodes.includes(area.code)} onChange={() => setRegionCodes(values => toggle(values, area.code))} /><span>{area.name}</span></label>)}
        {!shown.length && <p>{unit === 'medical-area' && !areas.length ? '二次医療圏一覧を読み込んでいます…' : '該当する地域がありません。'}</p>}
      </div>
      {!!regionCodes.length && <details className="smr-batch-selected"><summary>選択した地域を確認・解除（{regionCodes.length}地域）</summary>
        <div className="smr-batch-options">{choices.filter(area => regionCodes.includes(area.code)).map(area => <label key={area.code}><input type="checkbox" checked onChange={() => setRegionCodes(values => toggle(values, area.code))} /><span>{area.name.startsWith(prefectureName(area.code.slice(0, 2))) ? area.name : `${prefectureName(area.code.slice(0, 2))}${area.name}`}</span></label>)}</div>
      </details>}
    </fieldset>
    <fieldset><legend>2. 死因を選ぶ（{causeCodes.length}死因）</legend>
      <div className="smr-export-actions"><button type="button" onClick={() => setCauseCodes(arbitraryCauses.map(([code]) => code))}>すべての死因を選択</button><button type="button" onClick={() => setCauseCodes([])}>死因の選択を解除</button></div>
      <div className="smr-batch-options" role="group" aria-label="保存する死因">{arbitraryCauses.map(([code, name]) => <label key={code}><input type="checkbox" checked={causeCodes.includes(code)} onChange={() => setCauseCodes(values => toggle(values, code))} /><span>{name}</span></label>)}</div>
    </fieldset>
    <fieldset><legend>3. 性別を選ぶ</legend><div className="smr-batch-sex" role="group" aria-label="保存する性別">{Object.entries(sexLabels).map(([sex, name]) => <label key={sex}><input type="checkbox" checked={sexes.includes(sex)} onChange={() => setSexes(values => toggle(values, sex))} /><span>{name}</span></label>)}</div></fieldset>
    <p className="smr-batch-count"><strong>{regionCodes.length}地域 × {causeCodes.length}死因 × {sexes.length}区分 ＝ {count.toLocaleString('ja-JP')}件</strong></p>
    {count > SMR_BATCH_LIMIT && <p role="alert">1回の保存は{SMR_BATCH_LIMIT.toLocaleString('ja-JP')}件までです。地域または死因を減らしてください。</p>}
    <div className="smr-export-actions"><button type="button" disabled={!ready || busy} onClick={prepare}>選んだ結果を準備</button>
      {busy && <button type="button" onClick={() => { controller.current?.abort(); setProgress(null); setMessage('準備を中止しました。'); }}>準備を中止</button>}
      <button type="button" disabled={!payload || busy} onClick={() => save('csv')}>まとめてCSVで保存</button><button type="button" disabled={!payload || busy} onClick={() => save('json')}>まとめてJSONで保存</button></div>
    {busy && <p role="status">結果を準備しています… {progress.completed.toLocaleString('ja-JP')} / {progress.total.toLocaleString('ja-JP')}件</p>}
    {!payload && !busy && <p className="fine-print">チェックを選び「選んだ結果を準備」を押すと保存できます。条件を変えたら、再度準備してください。</p>}
    <p className="fine-print">算定できない組み合わせも記録します。CSVは数値欄が空欄、JSONはnullとなり、算定不可の理由が付きます。各行の条件・出典・結果確認URLを含みます。</p>
    {payload?.counts.unavailable > 0 && <details><summary>算定できない組み合わせ（{payload.counts.unavailable}件）</summary><ul className="smr-batch-missing">{payload.records.filter(record => record.result.status !== 'complete').map((record, index) => <li key={index}>{record.selection.region.name} ／ {record.selection.cause_name} ／ {record.selection.sex_label}：{record.result.reason}</li>)}</ul></details>}
    <p className="smr-export-message" role="status" aria-live="polite">{message}</p>
  </div>;
}
