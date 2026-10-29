"""Prevent public execution from widening publication or weakening verification."""
import importlib.util
import json
from pathlib import Path
import re
import tempfile
import gzip
import unittest
from unittest.mock import patch
import yaml
import common
import site as python_site


class ContractTests(unittest.TestCase):
    def test_official_attachment_formats_without_a_normal_filename(self):
        from opendata import source_format
        self.assertEqual(source_format('https://i2fas.mhlw.go.jp/page/opendatadownload.jsp?param=01000_food_business_all.csv'), 'csv')
        self.assertEqual(source_format('https://www.city.example.lg.jp/download/.xlsx'), 'xlsx')
        self.assertEqual(source_format('https://www.city.example.lg.jp/data.CSV?version=2'), 'csv')
        with self.assertRaises(ValueError):
            source_format('https://www.city.example.lg.jp/index.html')

    def test_snapshot_is_byte_identical_and_contains_only_selected_code(self):
        data = common.code_check()
        self.assertGreater(len(data['code']), 150)
        paths = [item['path'] for item in data['code']]
        self.assertEqual(len(paths), len(set(paths)))
        for path in paths:
            self.assertFalse(any(part in {'originals', 'archives', 'batches', 'reviews', 'raw'}
                                 for part in Path(path).parts), path)
            self.assertNotIn('MAINTENANCE', path)
            text = (common.SNAPSHOT / path).read_text()
            self.assertNotRegex(text, r'(?:sk-proj-|ghp_|github_pat_)[A-Za-z0-9_]{24,}')
            self.assertNotIn('-----BEGIN PRIVATE KEY-----', text)

    def test_runtime_manifest_never_fetches_private_trees(self):
        data = common.manifest()
        paths = [r['path'] for r in data['assets']]
        self.assertEqual(len(paths), len(set(paths)))
        self.assertGreater(len(paths), 3000)
        for item in data['assets']:
            common.safe_path(common.SNAPSHOT, item['path'])
            self.assertFalse(item['path'].startswith(('source/', 'scripts/', 'tests/', 'docs/', '.')))
            self.assertNotIn('/originals/', item['path'])
            self.assertNotIn('/archive/', item['path'])
            self.assertRegex(item['sha'], r'^[a-f0-9]{40}$')
        original = {r['path']: r['sha'] for r in data['assets']}
        for item in data['aliases']:
            self.assertEqual(original[item['source']], item['sha'])
            self.assertTrue(item['target'].startswith(('source/public/', 'source/food-poisoning/data/')))

    def test_only_original_source_code_can_be_used(self):
        with patch.object(common, 'manifest', return_value={'code': [{'path': 'x', 'sha': '0'*40}]}), \
             tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'x').write_bytes(b'changed code')
            with patch.object(common, 'SNAPSHOT', Path(directory)), self.assertRaises(ValueError):
                common.code_check()

    def test_spa_fallback_or_changed_public_input_is_rejected(self):
        with patch.object(common, 'download', return_value=b'<html>fallback</html>'):
            with self.assertRaises(ValueError):
                common.checked_public({'path': 'data/x.json', 'sha': common.blob(b'{}'), 'size': 2})
        with patch.object(common, 'download', return_value=b'{}'):
            self.assertEqual(common.checked_public({'path': 'data/x.json', 'sha': common.blob(b'{}')}), b'{}')
        with patch.object(common, 'download', return_value=gzip.compress(b'{}')):
            self.assertEqual(common.checked_public({'path': 'data/x.json', 'sha': common.blob(b'{}')}), b'{}')
        with patch.object(common, 'download', return_value=gzip.compress(b'{"changed":true}')):
            with self.assertRaises(ValueError):
                common.checked_public({'path': 'data/x.json', 'sha': common.blob(b'{}')})

    def test_generated_profiles_must_equal_the_reviewed_objects(self):
        spec = importlib.util.spec_from_file_location('public_site', common.ROOT / 'workloads/site.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        name = 'data/cross-cause-profile-v1/juki-19.json.gz'
        raw = gzip.compress(b'fixture', mtime=0)
        data = {'assets': [{'path': name, 'sha': common.blob(raw)}], 'aliases': []}
        with tempfile.TemporaryDirectory() as directory, patch.object(module, 'SNAPSHOT', Path(directory)):
            target = Path(directory) / 'source/public' / name
            target.parent.mkdir(parents=True)
            target.write_bytes(b'wrong')
            with self.assertRaises(ValueError):
                module.complete_generated_assets(data)
            target.write_bytes(raw)
            module.complete_generated_assets(data)
            self.assertEqual((Path(directory) / name).read_bytes(), raw)

    def test_sources_cannot_redirect_to_private_or_credential_urls(self):
        for url in ('http://municipal-smr.jp/data.json', 'https://127.0.0.1/x',
                    'https://user:password@www.pref.akita.lg.jp/x', 'https://evil.example/x',
                    'https://www.pref.akita.lg.jp:444/x'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                common.public_url(url)
        for url in ('https://municipal-smr.jp/data/x.json', 'https://www.pref.akita.lg.jp/x.xlsx',
                    'https://i2fas.mhlw.go.jp/x.csv'):
            self.assertEqual(common.public_url(url), url)

    def test_output_paths_cannot_escape(self):
        with tempfile.TemporaryDirectory() as directory:
            for path in ('../secret', '/tmp/secret', 'x/../../secret'):
                with self.assertRaises(ValueError):
                    common.safe_path(Path(directory), path)

    def test_all_public_jobs_use_standard_runners_read_tokens_and_pinned_actions(self):
        for path in (common.ROOT / '.github/workflows').glob('*.yml'):
            text = path.read_text()
            workflow = yaml.load(text, Loader=yaml.BaseLoader)
            self.assertEqual(workflow['permissions'], {'contents': 'read'}, path.name)
            self.assertNotIn('pull_request_target', workflow['on'])
            self.assertNotIn('workflow_run', workflow['on'])
            self.assertNotRegex(text, r'(?i)secrets\s*[.\[]')
            for job in workflow['jobs'].values():
                self.assertEqual(job['runs-on'], 'ubuntu-latest')
                self.assertNotIn('continue-on-error', job)
                self.assertNotIn('environment', job)
                for step in job['steps']:
                    if 'uses' in step:
                        self.assertRegex(step['uses'], r'^[\w.-]+/[\w.-]+@[a-f0-9]{40}$')
                    if step.get('uses', '').startswith('actions/checkout@'):
                        self.assertEqual(step['with']['persist-credentials'], 'false')
                    if step.get('uses', '').startswith('actions/upload-artifact@'):
                        paths = step['with']['path']
                        self.assertNotIn('original', paths)
                        self.assertNotIn('snapshot/', paths.replace('snapshot/source/article-index-review/*.png', '')
                                         .replace('snapshot/source/map-display-review/*.png', ''))

    def test_heavy_public_jobs_cannot_run_on_prs(self):
        workflow = yaml.load((common.ROOT / '.github/workflows/public-workloads.yml').read_text(), Loader=yaml.BaseLoader)
        for name in ('site-build-and-ui', 'opendata-current-originals'):
            self.assertTrue(workflow['jobs'][name]['if'].startswith("github.event_name != 'pull_request'"))
            self.assertEqual(workflow['jobs'][name]['needs'], 'security-and-contract')
        self.assertNotIn('if', workflow['jobs']['security-and-contract'])
        self.assertIn('opendata_required', workflow['jobs']['security-and-contract']['outputs'])

    def test_existing_monthly_cadence_is_preserved(self):
        workflow = yaml.load((common.ROOT / '.github/workflows/public-collectors.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(workflow['on']['schedule'], [{'cron': '37 21 15,25 * *'}, {'cron': '17 23 19 * *'}])
        self.assertNotIn('pull_request', workflow['on'])
        tohoku = yaml.load((common.ROOT / '.github/workflows/public-tohoku-collector.yml').read_text(), Loader=yaml.BaseLoader)
        self.assertEqual(tohoku['on']['schedule'], [{'cron': '17 21 15 * *'}])


if __name__ == '__main__':
    unittest.main()
