import tempfile
import unittest
from pathlib import Path
import facilities
import run_facilities

class FacilityTests(unittest.TestCase):
    def test_changed_source_rejected_before_write(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                run_facilities.extract(b'changed', Path(d))
            self.assertEqual(list(Path(d).iterdir()), [])

    def test_code_preserves_original_padding(self):
        self.assertEqual(facilities.code(123.0), '00123')
        self.assertEqual(facilities.code(None), '')
