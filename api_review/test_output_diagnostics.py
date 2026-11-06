import copy
import json
import unittest

import batch_worker as b
import worker as w
from receive import receive
from test_batch_worker import FakeAPI
from test_worker import bundle, response, MemoryStore


def changed_item(**changes):
    data = response()
    content = data['output'][0]['content'][0]
    parsed = json.loads(content['text'])
    parsed['items'][0].update(changes)
    content['text'] = json.dumps(parsed)
    return data


class DiagnosticTests(unittest.TestCase):
    def cases(self):
        return [
            ({'status': 'incomplete', 'incomplete_details': {'reason': 'max_output_tokens'}}, 'output_token_limit'),
            ({'status': 'incomplete', 'incomplete_details': {'reason': 'untrusted-detail'}}, 'response_not_completed'),
            ({'status': 'completed', 'output': []}, 'output_json'),
            (changed_item(evidence=['untrusted-detail']), 'evidence_mismatch'),
            (changed_item(evidence='untrusted-detail'), 'evidence_shape'),
            (changed_item(evidence=['x' * 181]), 'evidence_shape'),
            (changed_item(evidence=[]), 'verify_without_evidence'),
            (changed_item(assessment='hold'), 'draft_without_verify'),
            (changed_item(id='untrusted-detail'), 'item_identity'),
            (changed_item(extra='untrusted-detail'), 'item_fields'),
            (changed_item(assessment='untrusted-detail'), 'assessment'),
            (changed_item(rationale=17), 'text_shape'),
            ({'status': 'completed', 'output': [None]}, 'output_shape'),
        ]

    def check_record(self, store, code):
        record = next(iter(store.state['requests'].values()))
        self.assertEqual(record['status'], 'invalid_output')
        self.assertEqual(record['diagnostic'], code)
        self.assertEqual(record['report']['body']['items'], [])
        self.assertNotIn('untrusted-detail', json.dumps(store.state))
        # Diagnostics are record metadata; the existing receiver/report contract remains intact.
        self.assertEqual(next(iter(receive(store.state)['requests'].values()))['status'], 'invalid_output')

    def test_sync_persists_safe_reason_without_retry(self):
        queue = {'schema_version': 1, 'entries': [bundle()]}
        for data, code in self.cases():
            with self.subTest(code=code):
                store = MemoryStore()
                calls = []
                def sender(*args, **kwargs):
                    calls.append(1)
                    return copy.deepcopy(data)
                result = w.drain(queue, store, 'sk-test', sender=sender)
                self.assertEqual((result['completed'], result['held']), (0, 1))
                self.check_record(store, code)
                self.assertEqual(w.drain(queue, store, 'sk-test', sender=sender)['attempted'], 0)
                self.assertEqual(len(calls), 1)

    def test_batch_persists_same_reason_and_usage_without_retry(self):
        queue = {'schema_version': 1, 'entries': [bundle()]}
        for data, code in self.cases():
            with self.subTest(code=code):
                store, api = MemoryStore(), FakeAPI()
                b.tick(queue, store, api)
                identity = api.lines[0]['custom_id']
                data = {**data, 'usage': {'input_tokens': 12, 'output_tokens': 1200}}
                api.status = 'completed'
                api.rows = [{'custom_id': identity, 'response': {'status_code': 200, 'body': data}}]
                self.assertEqual(b.tick(queue, store, api)['held'], 1)
                self.check_record(store, code)
                self.assertEqual(store.state['requests'][identity]['usage']['output_tokens'], 1200)
                self.assertEqual(b.tick(queue, store, api)['submitted'], 0)
                self.assertEqual(api.submissions, 1)

    def test_completed_at_token_limit_does_not_imply_truncation(self):
        data = response()
        data['usage']['output_tokens'] = 1200
        store = MemoryStore()
        w.drain({'schema_version': 1, 'entries': [bundle()]}, store, 'sk-test', sender=lambda *a, **k: data)
        record = next(iter(store.state['requests'].values()))
        self.assertEqual(record['status'], 'completed')
        self.assertNotIn('diagnostic', record)
        self.assertFalse(record['report']['body']['items'][0]['publication_approved'])

    def test_three_document_compact_hold_reject_output_is_valid(self):
        source = bundle()
        source['documents'] = [{**source['documents'][0], 'id': str(i)} for i in range(3)]
        items = [{'id': str(i), 'assessment': 'hold' if i == 0 else 'reject',
                  'evidence': [], 'rationale': '抜粋に明白な不一致なし',
                  'draft_title': '', 'draft_fact': '', 'next_check': ''} for i in range(3)]
        data = {'status': 'completed', 'output': [{'type': 'message', 'content': [
            {'type': 'output_text', 'text': json.dumps({'items': items})}]}]}
        validated = w.validate_response(data, source)
        self.assertEqual(len(validated), 3)
        self.assertTrue(all(i['publication_approved'] is False for i in validated))

    def test_unknown_exception_details_are_never_diagnostics(self):
        for exc in [w.Stop('untrusted-detail'), ValueError('untrusted-detail'),
                    w.InvalidOutput('untrusted-detail')]:
            self.assertEqual(w.output_diagnostic(exc), 'output_shape')


if __name__ == '__main__':
    unittest.main()
