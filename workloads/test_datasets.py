import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import common
import datasets
import publish


class DatasetTests(unittest.TestCase):
    def test_registry_contains_no_smr_or_originals(self):
        data = datasets.load_registry()
        self.assertEqual(len(data['groups']), 19)
        self.assertEqual(sum(len(g['commands']) for g in data['groups'].values()), 8)
        bad = copy.deepcopy(data)
        bad['groups']['welfare']['assets'][0]['path'] = 'data/juki-Se00-2024-boundary.json.gz'
        with self.assertRaises(ValueError):
            datasets.validate_registry(bad)

    def test_one_domain_change_does_not_invalidate_others(self):
        data = datasets.load_registry()
        before = {k:datasets.fingerprint(v) for k,v in data['groups'].items()}
        data['groups']['welfare']['assets'][0]['sha'] = '0'*40
        after = {k:datasets.fingerprint(v) for k,v in data['groups'].items()}
        self.assertEqual([k for k in before if before[k]!=after[k]], ['welfare'])

    def test_publisher_rejects_extra_or_changed_bytes_and_false_coverage(self):
        data = datasets.load_registry()
        raw = b'{"fixture":true}'
        group = {'assets':[{'path':'welfare/data.json','sha':common.blob(raw)}],
                 'commands':[], 'coverage':'byte-identity-only','generation':'not-migrated'}
        data['groups']={'welfare':group}
        report = {'domain':'welfare','status':'passed','fingerprint':datasets.fingerprint(group),
                  'coverage':group['coverage'],'generation':group['generation'],'commands':[],
                  'files':[{'path':'welfare/data.json','git_blob':common.blob(raw),
                            'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}]}
        def archive(value=raw, extra=False):
            stream=io.BytesIO()
            with zipfile.ZipFile(stream,'w') as z:
                z.writestr('receipt.json',json.dumps(report))
                z.writestr('files/welfare/data.json',value)
                if extra:z.writestr('files/private.txt','hidden')
            return stream.getvalue()
        with patch.object(datasets,'load_registry',return_value=data):
            publish.validate(archive(),'public-dataset-welfare')
            for content in [archive(b'changed'),archive(extra=True)]:
                with self.assertRaises(ValueError):publish.validate(content,'public-dataset-welfare')
            report['coverage']='full-original-reconstruction'
            with self.assertRaises(ValueError):publish.validate(archive(),'public-dataset-welfare')


if __name__ == '__main__':
    unittest.main()
