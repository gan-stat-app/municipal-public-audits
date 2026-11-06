"""Focused MDC regressions; synthetic input never downloads another source."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import mdc
import run_mdc

class MDCTests(unittest.TestCase):
    def test_changed_source_rejected_before_write(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                run_mdc.extract(b'changed', Path(d))
            self.assertEqual(list(Path(d).iterdir()), [])

    def test_surgery_suppression_and_facility_area_join(self):
        def row(a, b, name, surgery, values):
            return (a, b, name, surgery, *values, *([None] * (18-len(values))))
        rows = [row(None,None,None,'有り',[999]),
                row(123.0,4,'病院','無し',[12,'-',0]),
                row(None,None,None,'有り',[3,7,'-']),
                row(None,None,None,'対象外',[999]),
                row(9,8,'別病院','無し',['-',None,2.9])]
        class Sheet:
            def iter_rows(self, **kwargs):
                assert kwargs == {'min_row': 4, 'values_only': True}
                return iter(rows)
        facilities = {('00123','00004'): {'municipality':'05001','name':'元名','type':'対象'}}
        with patch.object(mdc, 'load_workbook', return_value={'件数':Sheet()}):
            values = mdc.load_mdc(facilities, {'05001':'0501'})
        self.assertEqual(len(values),2)
        h = values[('00123','00004')]
        self.assertEqual((h['name'],h['area'],h['type']),('病院','0501','対象'))
        self.assertEqual(h['mdc']['01'],dict(published=15,suppressed=0,surgeryPublished=3,surgerySuppressed=0))
        self.assertEqual(h['mdc']['02'],dict(published=7,suppressed=1,surgeryPublished=7,surgerySuppressed=0))
        self.assertEqual(h['mdc']['03'],dict(published=0,suppressed=1,surgeryPublished=0,surgerySuppressed=1))
        self.assertIsNone(values[('00009','00008')]['area'])
        self.assertEqual(values[('00009','00008')]['mdc']['03']['published'],2)
        self.assertEqual(facilities[('00123','00004')]['name'],'元名')

    def test_output_mismatch_rejected_and_raw_restored(self):
        with tempfile.TemporaryDirectory() as d:
            previous = mdc.RAW
            with patch.object(run_mdc, 'SOURCE', {'bytes': 1, 'sha256': run_mdc.hashlib.sha256(b'x').hexdigest()}), patch.object(mdc, 'load_mdc', return_value={}):
                with self.assertRaisesRegex(ValueError, 'extraction differs'):
                    run_mdc.extract(b'x',Path(d))
            self.assertEqual(mdc.RAW, previous)

    def test_original_dictionary_mismatch_rejected(self):
        original = "MDC_NAMES = {}\ndef text(v): return str(v)\ndef code(v): return str(v)\ndef public_number(v): return (0, 0)\ndef load_mdc(a, b): return {'different': 1}\n"
        with tempfile.TemporaryDirectory() as d:
            previous = mdc.RAW
            with patch.object(run_mdc, 'SOURCE', {'bytes': 1, 'sha256': run_mdc.hashlib.sha256(b'x').hexdigest()}), patch.object(mdc, 'load_mdc', return_value={}):
                with self.assertRaisesRegex(ValueError, 'dictionary differs'):
                    run_mdc.extract(b'x', Path(d), original)
            self.assertEqual(mdc.RAW, previous)
