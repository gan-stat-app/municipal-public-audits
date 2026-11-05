import copy
import json
import unittest
from unittest.mock import patch

import worker as w
from receive import receive


def bundle():
    return {'id': 'official-1', 'executor': 'public', 'public_export_approved': True,
            'documents': [{'id': 'one', 'title': '公式資料', 'text': 'A1=見出し\nB2=100\nC3=200',
                           'url': 'https://www.pref.akita.lg.jp/pages/archive/1',
                           'source_sha256': 'a' * 64}]}


def response(assessment='verify', evidence=None):
    item = {'id': 'one', 'assessment': assessment, 'evidence': evidence or ['B2=100'],
            'rationale': '理由', 'draft_title': '候補', 'draft_fact': '記事案：候補。X案：候補。',
            'next_check': '原本照合'}
    return {'status': 'completed', 'usage': {'input_tokens': 10, 'output_tokens': 5},
            'output': [{'type': 'message', 'content': [{'type': 'output_text',
                                                      'text': json.dumps({'items': [item]})}]}]}


class MemoryStore:
    def __init__(self, fail_at=None):
        self.state = {'schema_version': 1, 'requests': {}}
        self.writes = 0
        self.fail_at = fail_at

    def read(self):
        return copy.deepcopy(self.state)

    def write(self, state):
        self.writes += 1
        if self.writes == self.fail_at:
            raise w.Stop()
        self.state = copy.deepcopy(state)


class WorkerTests(unittest.TestCase):
    key = b'x' * 32

    def run_queue(self, entries, store=None, sender=None, **kwargs):
        return w.drain({'schema_version': 1, 'entries': entries}, store or MemoryStore(),
                       'sk-test-key', self.key, sender=sender or (lambda *a, **k: response()), **kwargs)

    def test_manual_document_mode_is_bounded_and_other_events_rejected(self):
        self.assertEqual(w.execution_limit('workflow_dispatch', 'document-once'), 1)
        self.assertIsNone(w.execution_limit('schedule', None))
        self.assertIsNone(w.execution_limit('push', None))
        for event, mode in [('pull_request', 'document-once'), ('workflow_dispatch', 'key-check'), ('workflow_dispatch', '')]:
            with self.assertRaises(w.Stop):
                w.execution_limit(event, mode)

    def test_manual_limit_preserves_remaining_queue_and_uses_existing_reservations(self):
        second = bundle()
        second['documents'][0]['text'] += '\\nD4=300'
        store = MemoryStore()
        result = self.run_queue([bundle(), second], store, max_requests=1)
        self.assertEqual(result['attempted'], 1)
        self.assertEqual(len(store.state['requests']), 1)
        self.assertEqual(self.run_queue([bundle()], store, max_requests=1)['attempted'], 0)
        with self.assertRaises(w.Stop):
            self.run_queue([bundle()], max_requests=0)

    def test_payload_is_bounded_and_does_not_store_at_provider(self):
        p = w.payload(bundle())
        self.assertFalse(p['store'])
        self.assertEqual(p['max_output_tokens'], 1200)
        self.assertLess(len(w.raw(p)), 16000)

    def test_nonofficial_and_credential_urls_rejected(self):
        for url in ['http://www.pref.akita.lg.jp/x', 'https://evil.example/x',
                    'https://u:p@www.pref.akita.lg.jp/x', 'https://127.0.0.1/x',
                    'https://www.pref.akita.lg.jp/x?token=secret',
                    'https://www.pref.akita.lg.jp:444/x']:
            b = bundle()
            b['documents'][0]['url'] = url
            with self.subTest(url=url), self.assertRaises(w.Stop):
                w.payload(b)

    def test_public_export_requires_explicit_review(self):
        b = bundle()
        b['public_export_approved'] = False
        with self.assertRaises(w.Stop):
            w.payload(b)
        b = bundle()
        b['documents'][0]['hidden_cells'] = 'private'
        with self.assertRaises(w.Stop):
            w.payload(b)

    def test_secret_like_input_rejected(self):
        b = bundle()
        b['documents'][0]['text'] = 'sk-proj-abcdefghijklm'
        with self.assertRaises(w.Stop):
            w.payload(b)

    def test_noncontiguous_and_missing_evidence_rejected(self):
        for evidence in [['B2=100 C3=200 A1=見出し'], ['100200'], [' '], ['x' * 181]]:
            with self.subTest(evidence=evidence), self.assertRaises(w.Stop):
                w.validate_response(response(evidence=evidence), bundle())

    def test_success_does_not_approve_publication(self):
        item = w.validate_response(response(), bundle())[0]
        self.assertIs(item['publication_approved'], False)
        self.assertIs(item['fact_confirmed'], False)

    def test_encrypted_round_trip_and_tampering(self):
        report = {'items': ['unreviewed finding']}
        envelope = w.seal(report, self.key, 'request-a')
        self.assertNotIn('unreviewed', json.dumps(envelope))
        self.assertEqual(w.unseal(envelope, self.key, 'request-a'), report)
        for key, identity in [(b'y' * 32, 'request-a'), (self.key, 'request-b')]:
            with self.assertRaises(Exception):
                w.unseal(envelope, key, identity)

    def test_reservation_is_durable_before_network(self):
        store = MemoryStore()
        def send(*args, **kwargs):
            self.assertEqual(store.writes, 1)
            self.assertEqual(next(iter(store.state['requests'].values()))['status'], 'reserved_or_interrupted')
            return response()
        self.assertEqual(self.run_queue([bundle()], store, send)['completed'], 1)
        result = receive(store.state)
        self.assertEqual(next(iter(result['requests'].values()))['items'][0]['id'], 'one')

    def test_new_results_need_no_key_and_remain_unapproved(self):
        store = MemoryStore()
        result = w.drain({'schema_version': 1, 'entries': [bundle()]}, store,
                         'sk-test-key', sender=lambda *a, **k: response())
        self.assertEqual(result['completed'], 1)
        report = next(iter(receive(store.state)['requests'].values()))
        self.assertFalse(report['items'][0]['publication_approved'])
        self.assertFalse(report['items'][0]['fact_confirmed'])
        with patch('worker.fetch') as send:
            self.assertEqual(w.drain({'schema_version': 1, 'entries': [bundle()]},
                                    store, 'sk-test-key', sender=send)['attempted'], 0)
            send.assert_not_called()

    def test_legacy_migration_retains_ciphertext_without_resending(self):
        store = MemoryStore()
        self.run_queue([bundle()], store)
        identity, record = next(iter(store.state['requests'].items()))
        original = w.seal(record['report']['body'], self.key, identity)
        record['report'] = original
        with patch('worker.fetch') as send:
            result = self.run_queue([bundle()], store, send)
            send.assert_not_called()
        self.assertEqual(result['legacy_migrated'], 1)
        self.assertEqual(result['attempted'], 0)
        self.assertEqual(store.state['requests'][identity]['legacy_encrypted_report'], original)
        self.assertEqual(len(receive(store.state)['requests']), 1)

    def test_unreadable_legacy_does_not_block_independent_new_work(self):
        store = MemoryStore()
        self.run_queue([bundle()], store)
        identity, record = next(iter(store.state['requests'].items()))
        record['report'] = w.seal(record['report']['body'], self.key, identity)
        second = bundle()
        second['documents'][0]['text'] += '\nD4=300'
        result = w.drain({'schema_version': 1, 'entries': [bundle(), second]}, store,
                         'sk-test-key', sender=lambda *a, **k: response())
        self.assertEqual((result['completed'], result['legacy_held']), (1, 1))
        self.assertEqual(receive(store.state)['legacy_held'], 1)

    def test_reservation_failure_never_calls_api(self):
        with patch('worker.fetch') as send, self.assertRaises(w.Stop):
            self.run_queue([bundle()], MemoryStore(fail_at=1), send)
        send.assert_not_called()

    def test_unconfirmed_result_save_is_never_resent(self):
        store = MemoryStore(fail_at=2)
        with self.assertRaises(w.Stop):
            self.run_queue([bundle()], store)
        store.fail_at = None
        self.assertEqual(self.run_queue([bundle()], store)['attempted'], 0)

    def test_relabeling_ids_does_not_repeat_source(self):
        store = MemoryStore()
        self.run_queue([bundle()], store)
        b = bundle()
        b['id'], b['documents'][0]['id'] = 'renamed', 'renamed'
        self.assertEqual(self.run_queue([b], store)['attempted'], 0)

    def test_invalid_output_is_held_but_independent_work_continues(self):
        second = bundle()
        second['id'] = 'second'
        second['documents'][0]['text'] += '\nD4=300'
        calls = []
        def send(*args, **kwargs):
            calls.append(1)
            return response(evidence=['not in source']) if len(calls) == 1 else response()
        result = self.run_queue([bundle(), second], sender=send)
        self.assertEqual(result, {'attempted': 2, 'completed': 1, 'held': 1,
                                  'legacy_migrated': 0, 'legacy_held': 0})

    def test_transport_failure_stops_run_without_resend(self):
        second = bundle()
        second['documents'][0]['text'] += '\nD4=300'
        def send(*args, **kwargs):
            raise OSError('sensitive response must not be logged')
        store = MemoryStore()
        result = self.run_queue([bundle(), second], store, send)
        self.assertEqual(result['attempted'], 1)
        self.assertNotIn('sensitive', json.dumps(store.state))
        self.assertEqual(self.run_queue([bundle()], store)['attempted'], 0)

    def test_empty_queue_exits_without_calls(self):
        with patch('worker.fetch') as send:
            self.assertEqual(self.run_queue([], sender=send)['attempted'], 0)
            send.assert_not_called()

    def test_runtime_budget_leaves_pending_for_next_run(self):
        self.assertEqual(self.run_queue([bundle()], seconds=90)['attempted'], 0)

    def test_entire_queue_is_checked_before_any_call(self):
        bad = bundle()
        bad['public_export_approved'] = False
        with patch('worker.fetch') as send, self.assertRaises(w.Stop):
            self.run_queue([bundle(), bad], sender=send)
        send.assert_not_called()


if __name__ == '__main__':
    unittest.main()

