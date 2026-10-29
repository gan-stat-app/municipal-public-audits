import base64
import copy
import json
from pathlib import Path
import tempfile
import unittest
import site_sync as s

BASE = Path(__file__).resolve().parents[1]
SHA = 'a' * 40

class GateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.responses = {
            'actions/runs/1': dict(id=1, head_sha=SHA, head_branch='main', event='push', status='completed', conclusion='success', path=s.WORKFLOW, repository=dict(id=s.REPO_ID, full_name=s.REPO), head_repository=dict(id=s.REPO_ID), run_attempt=1),
            'actions/runs/1/attempts/1/jobs?per_page=100': dict(total_count=1, jobs=[dict(name='verify', status='completed', conclusion='success')]),
        }
        for path in ['manifest.json'] + ['records/' + p for p in sorted(s.ALLOWLIST)]:
            raw = (BASE / path).read_bytes()
            self.responses[f'contents/{path}?ref={SHA}'] = dict(type='file', encoding='base64', content=base64.b64encode(raw).decode())
            if path.startswith('records/'):
                for prefix in ['', 'source/public/']:
                    dest = self.root / (prefix + path.removeprefix('records/'))
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(raw)

    def check(self):
        return s.check(self.root, SHA, 1, lambda p: copy.deepcopy(self.responses[p]))

    def test_no_change_no_writes(self):
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(self.check()['status'], 'unchanged')
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_one_mirror_changed(self):
        p = 'source/public/' + sorted(s.ALLOWLIST)[0]
        (self.root / p).write_bytes(b'changed')
        self.assertEqual(self.check()['differences'], [p])

    def test_missing_mirror(self):
        (self.root / sorted(s.ALLOWLIST)[0]).unlink()
        self.assertEqual(self.check()['status'], 'review_required')

    def test_invalid_success_evidence(self):
        for key, value in [('head_sha', 'b'*40), ('event', 'pull_request'), ('conclusion', 'failure'), ('repository', dict(id=0)), ('path', 'other.yml')]:
            with self.subTest(key=key):
                old = self.responses['actions/runs/1'][key]
                self.responses['actions/runs/1'][key] = value
                with self.assertRaises(ValueError): self.check()
                self.responses['actions/runs/1'][key] = old

    def test_skipped_job(self):
        self.responses['actions/runs/1/attempts/1/jobs?per_page=100']['jobs'][0]['conclusion'] = 'skipped'
        with self.assertRaises(ValueError): self.check()

    def test_tampering(self):
        self.responses[f'contents/records/{sorted(s.ALLOWLIST)[0]}?ref={SHA}']['content'] = base64.b64encode(b'tampered').decode()
        with self.assertRaises(ValueError): self.check()

    def test_unreviewed_path(self):
        key = f'contents/manifest.json?ref={SHA}'
        manifest = json.loads(base64.b64decode(self.responses[key]['content']))
        manifest['files'][0]['path'] = '../private.txt'
        self.responses[key]['content'] = base64.b64encode(json.dumps(manifest).encode()).decode()
        with self.assertRaises(ValueError): self.check()

    def test_symlink(self):
        p = self.root / sorted(s.ALLOWLIST)[0]
        p.unlink()
        p.symlink_to(self.root / 'source/public' / sorted(s.ALLOWLIST)[0])
        with self.assertRaises(ValueError): self.check()

if __name__ == '__main__': unittest.main()
