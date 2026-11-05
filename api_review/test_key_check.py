import contextlib
import io
import unittest
from key_check import IDENTITY, probe

class FakeStore:
    def __init__(self, fail=False):
        self.state = {'requests': {}}
        self.fail = fail
        self.writes = 0
    def read(self): return self.state
    def write(self, state):
        if self.fail: raise RuntimeError('no checkpoint')
        self.writes += 1

class ProbeTest(unittest.TestCase):
    def run_probe(self, store, sender):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            code = probe(store, 'secret-not-for-log', b'x' * 32, sender)
        self.assertNotIn('secret-not-for-log', out.getvalue())
        return code
    def test_reserves_before_send_and_never_retries(self):
        store = FakeStore()
        def sender(*args, **kwargs):
            self.assertEqual(store.writes, 1)
            return {'id': 'resp_test', 'usage': {'total_tokens': 3}}
        self.assertEqual(self.run_probe(store, sender), 0)
        self.assertEqual(self.run_probe(store, lambda *a, **k: self.fail('duplicate')), 2)
    def test_failed_reservation_prevents_api(self):
        with self.assertRaises(RuntimeError):
            self.run_probe(FakeStore(True), lambda *a, **k: self.fail('sent without checkpoint'))
    def test_unknown_failure_is_saved_without_retry(self):
        store = FakeStore()
        def sender(*a, **k): raise OSError('secret-not-for-log')
        self.assertEqual(self.run_probe(store, sender), 2)
        self.assertEqual(store.state['requests'][IDENTITY]['status'], 'transport_failed_or_unknown')
        self.assertEqual(self.run_probe(store, lambda *a, **k: self.fail('duplicate')), 2)

if __name__ == '__main__': unittest.main()
