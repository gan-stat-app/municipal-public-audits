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


def whole_register(raw):
    workbook = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    try:
        # Every sheet must identify the complete output. A mixed/unknown sheet
        # is not silently accepted as a whole-register source.
        for sheet in workbook.worksheets:
            text = ''.join(str(v) for row in sheet.iter_rows(max_row=5, values_only=True)
                           for v in row if v is not None)
            text = ''.join(unicodedata.normalize('NFKC', text).split())
            if '全医療機関出力' not in text:
                return False
        return bool(workbook.worksheets)
    finally:
        workbook.close()


def normalize_whole_register(work, bureau, normal):
    candidates = []
    for member, raw in normal.input_workbooks(work):
        if not whole_register(raw):
            continue
        month = normal.workbook_snapshot(raw)
        if not month:
            raise ValueError('Whole-register workbook has no reference month')
        # A code table with a date cannot determine the register month.
        if next(normal.workbook_records(raw), None) is None:
            raise ValueError('Whole-register workbook has no register rows')
        candidates.append((month, member, raw))
    if not candidates:
        raise ValueError('No identified whole-register workbooks')
    snapshot = max(month for month, _, _ in candidates)
    selected = [(member, raw) for month, member, raw in candidates if month == snapshot]
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder)
        for i, (_, raw) in enumerate(selected):
            (target / f'{i}.xlsx').write_bytes(raw)
        records, _ = normal.normalize(target, snapshot)
    expected = {(f'{code:02d}', category) for code in BUREAU_CODES[bureau]
                for category in CATEGORIES}
    actual = {(r['prefecture_code'].zfill(2), r['category']) for r in records}
    if actual != expected:
        raise ValueError('Incomplete or unexpected whole-register prefecture/category coverage')
    names = {member.split(':', 1)[0] for member, _ in selected}
    sources = []
    for name in sorted(names):
        raw = (work / name).read_bytes()
        sources.append({'name': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
    members = [{'member': member, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
               for member, raw in selected]
    return snapshot, records, sources, members
