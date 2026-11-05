import unittest
from unittest.mock import patch
import run

class IntegrityTests(unittest.TestCase):
    def test_changed_official_original_rejected(self):
        with self.assertRaises(ValueError):
            run.check_source(b'changed')

    def test_changed_reference_rejected(self):
        with self.assertRaises(ValueError):
            run.compare(b'{}', b'{}')

    def test_numeric_difference_rejected_even_with_valid_reference(self):
        with patch.object(run, 'REFERENCE', {'size': 7, 'sha': run.blob(b'{"a":1}')}):
            with self.assertRaises(ValueError):
                run.compare(b'{"a":2}', b'{"a":1}')

    def test_serialization_difference_rejected(self):
        with patch.object(run, 'REFERENCE', {'size': 7, 'sha': run.blob(b'{"a":1}')}):
            with self.assertRaises(ValueError):
                run.compare(b'{"a": 1}', b'{"a":1}')

if __name__ == '__main__': unittest.main()
