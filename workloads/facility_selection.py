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


class SelectionError(ValueError):
    """Stable diagnostic code without changing fail-closed selection."""
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def whole_register(raw, diagnostics=None):
    workbook = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    try:
        # Every sheet must identify the complete output. A mixed/unknown sheet
        # is not silently accepted as a whole-register source.
        for sheet in workbook.worksheets:
            text = ''.join(str(v) for row in sheet.iter_rows(max_row=5, values_only=True)
                           for v in row if v is not None)
            text = ''.join(unicodedata.normalize('NFKC', text).split())
            if diagnostics is not None:
                diagnostics.append({'sheet': sheet.title,
                                    'whole_register': '全医療機関出力' in text})
            if '全医療機関出力' not in text:
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
        if not whole_register(raw, detail['sheets']):
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

