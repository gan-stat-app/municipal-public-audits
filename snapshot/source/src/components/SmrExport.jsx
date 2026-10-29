import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { buildSmrExport, canExportSmr, downloadSmrExport, readSmrExportRequest, smrExportJson, smrExportLink, smrSelectionKey } from '../lib/smrExport.js';

const SmrBatchExport = lazy(() => import('./SmrBatchExport.jsx'));

export default function SmrExport(props) {
  const { query, initialQuery, areaCatalog, medicalAreas, result, dataset } = props;
  const [message, setMessage] = useState('');
  const [batchOpened, setBatchOpened] = useState(false);
  const request = useRef(readSmrExportRequest(globalThis.location?.search ?? '', initialQuery));
  const requestedDownload = useRef(false);
  const ready = canExportSmr(props);
  const payload = useMemo(() => {
    if (!ready) return null;
    try { return buildSmrExport({ query, result, dataset, areaCatalog, medicalAreas }); }
    catch { return null; }
  }, [ready, query, result, dataset, areaCatalog, medicalAreas]);
  const link = payload ? smrExportLink(query) : '';
  useEffect(() => { setMessage(''); }, [query]);
  useEffect(() => {
    if (!request.current || requestedDownload.current) return;
    if (!request.current.valid) {
      setMessage('取得リンクの条件が不完全です。画面で条件を選び直してから保存してください。');
      requestedDownload.current = true;
      return;
    }
    if (!payload || request.current.key !== smrSelectionKey(query)) return;
    requestedDownload.current = true;
    downloadSmrExport(payload, request.current.format);
    setMessage(`${request.current.format.toUpperCase()}のダウンロードを開始しました。始まらない場合はこの欄の「JSONで保存」または「CSVで保存」をご利用ください。`);
  }, [payload, query]);
  if (query.mode !== 'arbitrary') return null;
  const save = format => {
    if (!payload) return;
    downloadSmrExport(payload, format);
    setMessage(`${format.toUpperCase()}のダウンロードを開始しました。`);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setMessage('JSON取得リンクをコピーしました。'); }
    catch { setMessage('リンク欄を選択してコピーしてください。'); }
  };
  return <div className="smr-export" role="group" aria-labelledby="smr-export-title">
    <h3 id="smr-export-title">選択中の結果を保存</h3>
    <p>選択した地域1件の数値・条件・出典をまとめて保存します。</p>
    <div className="smr-export-actions">
      <button type="button" disabled={!payload} onClick={() => save('csv')}>CSVで保存</button>
      <button type="button" disabled={!payload} onClick={() => save('json')}>JSONで保存</button>
    </div>
    {!payload && <p className="fine-print">現在の条件で計算が完了すると保存できます。算定できない期間は保存できません。</p>}
    {payload && <>
      <p className="fine-print">数値は画面表示の丸め前の値です。CSVはExcelなどで、JSONは分析用のプログラムなどで利用できます。</p>
      <details>
        <summary>同じ結果を取得するリンク・JSONの内容</summary>
        <p>リンクをブラウザーで開くと、条件を復元してJSONのダウンロードを開始します。JavaScript対応のブラウザーが必要です。</p>
        <div className="smr-export-actions"><a href={link}>この条件のJSONを取得</a><button type="button" onClick={copy}>JSON取得リンクをコピー</button></div>
        <label className="smr-export-link-label">JSON取得リンク<input readOnly value={link} onFocus={event => event.target.select()} /></label>
        <pre aria-label="選択中の結果のJSON" data-testid="smr-export-json">{smrExportJson(payload)}</pre>
      </details>
    </>}
    <p className="smr-export-message" role="status" aria-live="polite">{message}</p>
    <details className="smr-batch-details" onToggle={event => { if (event.currentTarget.open) setBatchOpened(true); }}>
      <summary>複数の結果をまとめて保存</summary>
      {batchOpened && <Suspense fallback={<p role="status">一括保存の選択欄を読み込んでいます…</p>}><SmrBatchExport {...props} /></Suspense>}
    </details>
  </div>;
}

