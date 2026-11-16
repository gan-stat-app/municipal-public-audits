"""Select complete whole-register workbooks, never code lists or recent filings."""
from __future__ import annotations
import hashlib
import io
from pathlib import Path
import tempfile
import unicodedata
import openpyxl

BUREAU_CODES = {
    'hokkaido': [1], 'tohoku': list(range(2, 8)),
    'kanto-shinetsu': [8, 9, 10, 11, 12, 13, 14, 15, 19, 20],
    'tokai-hokuriku': [16, 17, 21, 22, 23, 24],
    'kinki': [18, 25, 26, 27, 28, 29, 30],
    'chugoku': [31, 32, 33, 34, 35], 'shikoku': [36, 37, 38, 39],
    'kyushu': list(range(40, 48)),
}
CATEGORIES = {'医科', '歯科', '薬局'}
FULL_REGISTER_COLUMNS = {
    '項番', '都道府県コード', '都道府県名', '区分', '医療機関番号',
    '医療機関名称', '受理届出名称', '受理記号',
}
NON_REGISTER_LABELS = ('コード内容', '直近届出', '保険外併用', '訪問看護')


class SelectionError(ValueError):
    """Stable diagnostic code without changing fail-closed selection."""
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def normalized_text(value):
    return ''.join(unicodedata.normalize('NFKC', str(value)).split())


def whole_register(raw, diagnostics=None, member=''):
    workbook = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    try:
        # The bureaus now publish the same 24-column whole-register schema
        # without the legacy "全医療機関出力" label.  Accept either positive
        # identifier, but still reject code lists, recent filings and mixed
        # workbooks before the coverage gate.
        for sheet in workbook.worksheets:
            rows = list(sheet.iter_rows(max_row=10, values_only=True))
            text = ''.join(normalized_text(v) for row in rows[:5] for v in row if v is not None)
            full_schema = any(
                FULL_REGISTER_COLUMNS <= {
                    normalized_text(value) for value in row if value is not None
                }
                for row in rows
            )
            legacy_marker = '全医療機関出力' in text
            excluded = next(
                (label for label in NON_REGISTER_LABELS
                 if label in text or label in normalized_text(member)),
                None,
            )
            identified = (legacy_marker or full_schema) and excluded is None
            if diagnostics is not None:
                diagnostics.append({'sheet': sheet.title,
                                    'whole_register': identified,
                                    'legacy_marker': legacy_marker,
                                    'full_register_schema': full_schema,
                                    'excluded_label': excluded})
            if not identified:
                return False
        return bool(workbook.worksheets)
    finally:
        workbook.close()


def normalize_whole_register(work, bureau, normal, diagnostics=None):
    diagnostics = diagnostics if diagnostics is not None else {}
    diagnostics.update(stage='workbooks', workbooks=[])
    candidates = []
    for member, raw in normal.input_workbooks(work):
        detail = {'member': member, 'sha256': hashlib.sha256(raw).hexdigest(),
                  'bytes': len(raw), 'stage': 'heading', 'sheets': []}
        diagnostics['workbooks'].append(detail)
        if not whole_register(raw, detail['sheets'], member):
            detail['status'] = 'excluded_heading'
            continue
        detail['stage'] = 'reference_month'
        month = normal.workbook_snapshot(raw)
        detail['snapshot'] = month
        if not month:
            raise SelectionError('missing_reference_month', 'Whole-register workbook has no reference month')
        # A code table with a date cannot determine the register month.
        detail['stage'] = 'register_rows'
        if next(normal.workbook_records(raw), None) is None:
            raise SelectionError('no_register_rows', 'Whole-register workbook has no register rows')
        detail['status'] = 'candidate'
        candidates.append((month, member, raw))
    if not candidates:
        raise SelectionError('no_whole_register', 'No identified whole-register workbooks')
    snapshot = max(month for month, _, _ in candidates)
    selected = [(member, raw) for month, member, raw in candidates if month == snapshot]
    diagnostics.update(stage='normalize', snapshot=snapshot,
                       selected_members=[member for member, _ in selected])
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder)
        for i, (_, raw) in enumerate(selected):
            (target / f'{i}.xlsx').write_bytes(raw)
        records, _ = normal.normalize(target, snapshot)
    expected = {(f'{code:02d}', category) for code in BUREAU_CODES[bureau]
                for category in CATEGORIES}
    actual = {(r['prefecture_code'].zfill(2), r['category']) for r in records}
    diagnostics.update(stage='coverage', expected_count=len(expected), actual_count=len(actual),
                       missing=sorted(expected - actual), unexpected=sorted(actual - expected))
    if actual != expected:
        raise SelectionError('coverage_mismatch', 'Incomplete or unexpected whole-register prefecture/category coverage')
    diagnostics['stage'] = 'provenance'
    names = {member.split(':', 1)[0] for member, _ in selected}
    sources = []
    for name in sorted(names):
        raw = (work / name).read_bytes()
        sources.append({'name': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
    members = [{'member': member, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
               for member, raw in selected]
    diagnostics['stage'] = 'complete'
    return snapshot, records, sources, members


