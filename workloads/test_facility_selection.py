import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from openpyxl import Workbook
from facility_selection import BUREAU_CODES, CATEGORIES, normalize_whole_register

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('normal', ROOT / 'snapshot/scripts/normalize-facility-standards.py')
normal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(normal)


def workbook(month=10, scopes=None, marker='全医療機関出力'):
    book = Workbook()
    sheet = book.active
    sheet.append([f'[令和８年{month}月１日 現在]令和８年１１月２日作成 {marker}'])
    for code, category in scopes or []:
        row = [''] * 22
        row[1], row[3], row[4], row[7], row[13] = f'{code:02d}', category, '1234567', '架空病院', '架空届出'
        sheet.append(row)
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


class SelectionTests(unittest.TestCase):
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
