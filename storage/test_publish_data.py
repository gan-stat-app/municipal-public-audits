import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from unittest.mock import patch
import publish_data as p


def manifest():
    raw=b'{"example":1}'
    return {'schema_version':1,'source_repository':'gan-stat-app/municipal-smr-site',
        'source_commit':'1'*40,'origin':'https://municipal-smr.jp',
        'files':[{'path':'data/example.json','git_blob':p.blob(raw),'bytes':len(raw)}]}, raw


class StorageTests(unittest.TestCase):
    def test_inventory_is_complete_and_only_numeric_public_paths(self):
        data=json.loads(p.INPUT.read_bytes())
        self.assertEqual(len(p.validate(data)),2809)
        self.assertEqual(sum(f['bytes'] for f in data['files']),754755714)

    def test_hashes_archive_and_receipt_preserve_exact_bytes(self):
        m,raw=manifest()
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(io.StringIO()):
            r=p.make_archives(m,tmp,lambda item:raw)
            self.assertEqual(r['files'][0]['sha256'],hashlib.sha256(raw).hexdigest())
            with zipfile.ZipFile(Path(tmp)/r['archives'][0]['name']) as z:
                self.assertEqual(z.namelist(),['files/data/example.json'])
                self.assertEqual(z.read(z.namelist()[0]),raw)

    def test_html_fallback_or_changed_source_cannot_be_published(self):
        m,_=manifest()
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(io.StringIO()):
            with self.assertRaises(AssertionError):
                p.make_archives(m,tmp,lambda item:b'<html>fallback</html>')
            self.assertFalse((Path(tmp)/'manifest.json').exists())

    def test_unknown_private_hidden_and_traversal_paths_fail(self):
        for path in ('private/secret.json','data/../secret.json','/data/a.json',
                     'data/.env.json','data/raw.xlsx','data/a\\b.json'):
            m,_=manifest();m['files'][0]['path']=path
            with self.assertRaises(AssertionError,msg=path):p.validate(m)

    def test_duplicates_and_wrong_origin_fail(self):
        m,_=manifest();m['files']*=2
        with self.assertRaises(AssertionError):p.validate(m)
        m,_=manifest();m['origin']='https://example.com'
        with self.assertRaises(AssertionError):p.validate(m)

    def test_bounded_archives_never_contain_extra_checkout_files(self):
        m,raw=manifest()
        with tempfile.TemporaryDirectory() as tmp,redirect_stdout(io.StringIO()):
            (Path(tmp)/'private.txt').write_text('not public')
            r=p.make_archives(m,tmp,lambda item:raw)
            with zipfile.ZipFile(Path(tmp)/r['archives'][0]['name']) as z:
                self.assertNotIn('private.txt',z.namelist())


if __name__=='__main__':unittest.main()
