import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from openpyxl import Workbook
from facility_selection import BUREAU_CODES, CATEGORIES, SelectionError, normalize_whole_register

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('normal', ROOT / 'snapshot/scripts/normalize-facility-standards.py')
normal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normal)


def workbook(month=10, scopes=None, marker='全医療機関出力', full_schema=False):
    book = Workbook()
    sheet = book.active
    sheet.append([f'[令和８年{month}月１日 現在]令和８年１１月２日作成 {marker}'])
    if full_schema:
        sheet.append([
            '項番', '都道府県コード', '都道府県名', '区分', '医療機関番号',
            '併設医療機関番号', '医療機関記号番号', '医療機関名称', '郵便番号',
            '所在地', '電話番号', 'FAX番号', '許可病床数', '受理届出名称',
            '受理記号', '受理番号', '算定開始年月日', '個別算定開始年月日',
            '備考見出し', '備考内容', '市町村コード', '市町村名',
        ])
    for code, category in scopes or []:
        row = [''] * 22
        row[1], row[3], row[4], row[7], row[13] = f'{code:02d}', category, '1234567', '架空病院', '架空届出'
        sheet.append(row)
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


class SelectionTests(unittest.TestCase):
    def test_failure_codes_and_stages(self):
        cases = [
            (workbook(marker='コード内容一覧'), 'no_whole_register', 'heading'),
            (workbook(), 'no_register_rows', 'register_rows'),
            (workbook(scopes=[(1, '医科')]), 'coverage_mismatch', 'register_rows'),
        ]
        from openpyxl import load_workbook
        book = load_workbook(io.BytesIO(workbook(scopes=[(1, '医科')])))
        book.active['A1'] = '全医療機関出力 日付なし'
        out = io.BytesIO()
        book.save(out)
        cases.append((out.getvalue(), 'missing_reference_month', 'reference_month'))
        for raw, code, stage in cases:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / 'input.xlsx').write_bytes(raw)
                diagnostic = {}
                with self.assertRaises(SelectionError) as error:
                    normalize_whole_register(root, 'hokkaido', normal, diagnostic)
                self.assertEqual(error.exception.code, code)
                detail = diagnostic['workbooks'][0]
                self.assertEqual(detail['stage'], stage)
                self.assertEqual(detail['member'], 'input.xlsx')
                import hashlib
                self.assertEqual(detail['sha256'], hashlib.sha256(raw).hexdigest())
                if code == 'coverage_mismatch':
                    self.assertEqual(diagnostic['snapshot'], '2026-10')
                    self.assertEqual(set(diagnostic['missing']), {('01', '歯科'), ('01', '薬局')})
                    self.assertEqual(diagnostic['unexpected'], [])

    def test_blank_sheet_identified_without_relaxing_heading_gate(self):
        from openpyxl import load_workbook
        book = load_workbook(io.BytesIO(workbook(scopes=[(1, c) for c in CATEGORIES])))
        book.create_sheet('空白シート')
        out = io.BytesIO()
        book.save(out)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'input.xlsx').write_bytes(out.getvalue())
            diagnostic = {}
            with self.assertRaises(SelectionError) as error:
                normalize_whole_register(root, 'hokkaido', normal, diagnostic)
            self.assertEqual(error.exception.code, 'no_whole_register')
            self.assertEqual(diagnostic['workbooks'][0]['sheets'][-1], {
                'sheet': '空白シート', 'whole_register': False,
                'legacy_marker': False, 'full_register_schema': False,
                'excluded_label': None,
            })

    def test_current_full_register_schema_without_legacy_marker(self):
        scopes = [(1, category) for category in CATEGORIES]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'current.xlsx').write_bytes(
                workbook(scopes=scopes, marker='届出受理医療機関名簿', full_schema=True))
            month, records, sources, members = normalize_whole_register(
                root, 'hokkaido', normal)
        self.assertEqual(month, '2026-10')
        self.assertEqual(len(records), 3)
        self.assertEqual([source['name'] for source in sources], ['current.xlsx'])
        self.assertEqual([member['member'] for member in members], ['current.xlsx'])

    def test_full_schema_does_not_accept_recent_or_non_register_lists(self):
        for marker in ('直近届出分', '保険外併用療養費医療機関名簿', '訪問看護事業所名簿'):
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                raw = workbook(
                    scopes=[(1, category) for category in CATEGORIES],
                    marker=marker,
                    full_schema=True,
                )
                (root / 'input.xlsx').write_bytes(raw)
                with self.assertRaises(SelectionError) as error:
                    normalize_whole_register(root, 'hokkaido', normal)
                self.assertEqual(error.exception.code, 'no_whole_register')

    def test_collector_preserves_failure_diagnostics_and_continues(self):
        import collectors
        import types
        import json
        failed = workbook(scopes=[(1, '医科')])
        valid = workbook(scopes=[(c, k) for c in range(2, 8) for k in CATEGORIES])
        archive = types.SimpleNamespace(discover=lambda b: (b'', [{'url': b['id']}]),
                                        safe_name=lambda url, digest: url + '.xlsx')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'data/facility-standards/source-registry.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'bureaus': [{'id': 'hokkaido'}, {'id': 'tohoku'}]}))
            with patch.object(collectors, 'SNAPSHOT', root), \
                 patch.object(collectors, 'module', side_effect=[archive, normal]), \
                 patch.object(collectors, 'download', side_effect=[failed, valid]), \
                 patch.object(collectors, 'write_normalized', return_value={'path': 'fixture'}) as writer:
                result = collectors.facilities()
            self.assertEqual(result['status'], 'review_required')
            row, success = result['rows']
            self.assertEqual(row['error_type'], 'ValueError')
            self.assertEqual(row['error_code'], 'coverage_mismatch')
            self.assertEqual(row['error_stage'], 'selection')
            self.assertEqual(row['selection_diagnostics']['stage'], 'coverage')
            self.assertEqual(len(row['originals']), 1)
            self.assertNotIn('output', row)
            self.assertEqual(success['status'], 'normalized')
            self.assertEqual(writer.call_count, 1)
            json.dumps(result)  # Public receipt remains serializable.

    def test_unexpected_exception_goes_to_log_and_retains_stage(self):
        import collectors
        import types
        import json
        archive = types.SimpleNamespace(discover=lambda b: (b'', [{'url': 'fixture'}]),
                                        safe_name=lambda url, digest: 'input.xlsx')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'data/facility-standards/source-registry.json'
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({'bureaus': [{'id': 'hokkaido'}]}))
            with patch.object(collectors, 'SNAPSHOT', root), \
                 patch.object(collectors, 'module', side_effect=[archive, normal]), \
                 patch.object(collectors, 'download', return_value=b'invalid xlsx'), \
                 patch.object(collectors.traceback, 'print_exc') as log:
                result = collectors.facilities()
            row = result['rows'][0]
            self.assertEqual(row['status'], 'unavailable')
            self.assertEqual(row['error_stage'], 'selection')
            self.assertEqual(row['selection_diagnostics']['workbooks'][0]['stage'], 'heading')
            self.assertNotIn('error_message', row)
            log.assert_called_once_with()

    def test_collector_receipt_binds_only_selected_originals(self):
        import collectors
        registry = {'bureaus': [{'id': 'hokkaido'}]}
        full = workbook(scopes=[(1, category) for category in CATEGORIES])
        code = workbook(11, marker='コード内容一覧')
        import types
        archive = types.SimpleNamespace(discover=lambda b: (b'', [{'url': 'full'}, {'url': 'code'}]),
                                        safe_name=lambda url, digest: url + '.xlsx')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'data/facility-standards/source-registry.json'
            path.parent.mkdir(parents=True)
            import json
            path.write_text(json.dumps(registry))
            with patch.object(collectors, 'SNAPSHOT', root), \
                 patch.object(collectors, 'module', side_effect=[archive, normal]), \
                 patch.object(collectors, 'download', side_effect=[full, code]), \
                 patch.object(collectors, 'write_normalized', return_value={'path': 'fixture'}):
                result = collectors.facilities()
        row = result['rows'][0]
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(row['snapshot'], '2026-10')
        self.assertEqual([x['url'] for x in row['originals']], ['full'])
        self.assertEqual(row['selected_members'][0]['member'], 'full.xlsx')

    def test_all_eight_bureaus_cover_141_scopes(self):
        total = 0
        for bureau, codes in BUREAU_CODES.items():
            with self.subTest(bureau=bureau), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                scopes = [(code, category) for code in codes for category in CATEGORIES]
                (root / 'full.xlsx').write_bytes(workbook(scopes=scopes))
                month, records, sources, members = normalize_whole_register(root, bureau, normal)
                self.assertEqual(month, '2026-10')
                self.assertEqual(len(records), len(scopes))
                self.assertEqual(len(sources), 1)
                self.assertEqual(len(members), 1)
                total += len(records)
        self.assertEqual(total, 141)

    def test_newer_code_and_recent_filing_cannot_select_month(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            scopes = [(1, category) for category in CATEGORIES]
            (root / 'full.xlsx').write_bytes(workbook(scopes=scopes))
            (root / 'code.xlsx').write_bytes(workbook(11, marker='コード内容一覧'))
            (root / 'recent.xlsx').write_bytes(workbook(11, scopes=scopes, marker='直近届出分'))
            month, records, sources, members = normalize_whole_register(root, 'hokkaido', normal)
            self.assertEqual(month, '2026-10')
            self.assertEqual(len(records), 3)
            self.assertEqual([x['name'] for x in sources], ['full.xlsx'])

    def test_partial_newest_month_does_not_fall_back(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'old.xlsx').write_bytes(workbook(scopes=[(1, x) for x in CATEGORIES]))
            (root / 'new.xlsx').write_bytes(workbook(11, scopes=[(1, '医科')]))
            with self.assertRaisesRegex(ValueError, 'coverage'):
                normalize_whole_register(root, 'hokkaido', normal)

    def test_missing_prefecture_or_unexpected_prefecture_is_rejected(self):
        for scopes in ([(2, x) for x in CATEGORIES], [(2, x) for x in CATEGORIES] + [(1, x) for x in CATEGORIES]):
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / 'full.xlsx').write_bytes(workbook(scopes=scopes))
                with self.assertRaisesRegex(ValueError, 'coverage'):
                    normalize_whole_register(root, 'tohoku', normal)

    def test_zip_old_members_excluded_and_original_hash_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with zipfile.ZipFile(root / 'full.zip', 'w') as archive:
                archive.writestr('old.xlsx', workbook(9, [(1, x) for x in CATEGORIES]))
                archive.writestr('new.xlsx', workbook(10, [(1, x) for x in CATEGORIES]))
                archive.writestr('code.xlsx', workbook(11, marker='コード内容一覧'))
            month, records, sources, members = normalize_whole_register(root, 'hokkaido', normal)
            import hashlib
            self.assertEqual(month, '2026-10')
            self.assertEqual(len(records), 3)
            self.assertEqual(sources[0]['sha256'], hashlib.sha256((root / 'full.zip').read_bytes()).hexdigest())
            self.assertEqual([x['member'] for x in members], ['full.zip:new.xlsx'])

    def test_unidentified_or_empty_register_cannot_pass(self):
        for raw in (workbook(11, marker='コード内容一覧'), workbook(10)):
            with tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / 'input.xlsx').write_bytes(raw)
                with self.assertRaises(ValueError):
                    normalize_whole_register(root, 'hokkaido', normal)


if __name__ == '__main__':
    unittest.main()


