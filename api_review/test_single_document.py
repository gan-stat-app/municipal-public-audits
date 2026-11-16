import copy
import hashlib
import unittest
from unittest.mock import Mock

import batch_worker as b
import worker as w
from supply import refill
from test_supply import candidate
from test_worker import bundle, MemoryStore
from test_batch_worker import FakeAPI


def multiple():
    source = bundle()
    source['documents'].append({**source['documents'][0], 'id': 'two',
                                'text': 'C1=another source', 'source_sha256': 'b' * 64})
    return source


class SingleDocumentTests(unittest.TestCase):
    def test_supply_keeps_legacy_approval_for_collection_but_cannot_send_multiple(self):
        row = candidate()
        row['bundle'] = multiple()
        row['approval']['bundle_sha256'] = w.digest(row['bundle'])
        first = row['approval']['documents'][0]
        second = row['bundle']['documents'][1]
        row['approval']['documents'].append({**first, 'id': second['id'], 'source_sha256': second['source_sha256'],
            'text_sha256': hashlib.sha256(second['text'].encode()).hexdigest()})
        queue, result = refill({'schema_version': 1, 'entries': []},
                               {'schema_version': 1, 'candidates': [row]})
        self.assertEqual(queue['entries'], [row['bundle']])
        store, api = MemoryStore(), FakeAPI()
        self.assertEqual(b.tick(queue, store, api)['multi_document_pending'], 1)
        self.assertEqual(api.submissions, 0)
        self.assertEqual(store.writes, 0)
        existing = {'schema_version': 1, 'entries': [row['bundle']]}
        self.assertEqual(refill(existing, {'schema_version': 1, 'candidates': [row]})[0], existing)

    def test_new_multi_document_batch_is_not_reserved_or_submitted(self):
        store, api = MemoryStore(), FakeAPI()
        queue = {'schema_version': 1, 'entries': [multiple(), bundle()]}
        # Distinct reviewed sources; the one-document request still progresses.
        queue['entries'][1]['documents'][0]['text'] += ' independent'
        result = b.tick(queue, store, api)
        self.assertEqual((result['submitted'], result['multi_document_pending']), (1, 1))
        self.assertEqual(len(store.state['requests']), 1)
        self.assertEqual(len(__import__('json').loads(api.lines[0]['body']['input'])), 1)

    def test_manual_sync_cannot_bypass_single_document_policy(self):
        sender, store = Mock(), MemoryStore()
        result = w.drain({'schema_version': 1, 'entries': [multiple()]}, store,
                         'sk-test', sender=sender)
        self.assertEqual(result['multi_document_pending'], 1)
        self.assertEqual(store.writes, 0)
        sender.assert_not_called()

    def test_historical_multi_document_failure_is_unchanged_and_never_split(self):
        source = multiple()
        identity = w.digest(w.payload(source))
        store, api = MemoryStore(), FakeAPI()
        original = {'status': 'invalid_output', 'diagnostic': 'output_token_limit',
                    'source_keys': [w.digest({'model': w.MODEL, 'source': d['source_sha256'],
                                             'text': d['text']}) for d in source['documents']]}
        store.state['requests'][identity] = copy.deepcopy(original)
        result = b.tick({'schema_version': 1, 'entries': [source]}, store, api)
        self.assertEqual(result['submitted'], 0)
        self.assertEqual(result['multi_document_pending'], 0)
        self.assertEqual(store.state['requests'], {identity: original})
        self.assertEqual(store.writes, 0)

