import copy
import base64
import gzip
import json
import unittest
import dpc_generation as dpc


class ScopeTests(unittest.TestCase):
    def test_json_bytes_are_stricter_than_semantic_equality(self):
        def encode(raw, stamp=0): return base64.b64encode(gzip.compress(raw, mtime=stamp))
        original = encode(b'{"a":1}', 123)
        rebuilt = encode(b'{"a":1}')
        self.assertNotEqual(original, rebuilt)
        self.assertEqual(dpc.compare(original, rebuilt, rebuilt), b'{"a":1}')
        for changed in [encode(b'{"a":2}'), encode(b'{ "a":1}')]:
            with self.assertRaises(ValueError): dpc.compare(original, changed, changed)
        with self.assertRaises(ValueError): dpc.compare(original, rebuilt, original)

    def test_exact_public_input_set(self):
        data = dpc.validate(json.loads(dpc.MANIFEST.read_bytes()))
        self.assertEqual(len(data['inputs']), 52)
        for path in ['private/original.xlsx', 'dpc/raw/source.xlsx', '../secret', 'smr-json/data.json']:
            bad = copy.deepcopy(data)
            bad['inputs'][0]['path'] = path
            with self.assertRaises(ValueError):
                dpc.validate(bad)

    def test_missing_duplicate_and_false_full_migration(self):
        data = json.loads(dpc.MANIFEST.read_bytes())
        for change in ['missing', 'duplicate', 'full']:
            bad = copy.deepcopy(data)
            if change == 'missing': bad['inputs'].pop()
            elif change == 'duplicate': bad['inputs'].append(bad['inputs'][0])
            else: bad['upstream_originals'] = 'migrated'
            with self.assertRaises(ValueError):
                dpc.validate(bad)


if __name__ == '__main__':
    unittest.main()
