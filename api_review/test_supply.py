import copy
import hashlib
import unittest
import supply
import worker as w
from test_worker import bundle, MemoryStore
from test_batch_worker import FakeAPI
import batch_worker


def candidate():
    b = bundle()
    return {'bundle': b, 'approval': {'bundle_sha256': w.digest(b), 'review_commit': 'a'*40,
        'exclusive_public_ownership': {'private_state_commit': 'b'*40, 'reserved': True, 'no_prior_attempt': True},
        'documents': [dict(id=d['id'], source_url=d['url'], original_url=d['url'],
            source_sha256=d['source_sha256'], text_sha256=hashlib.sha256(d['text'].encode()).hexdigest(),
            terms_url='https://example.lg.jp/terms', license='CC BY 4.0', checked_at_jst='2026-11-06T23:00:00+09:00',
            public_scope='visible cells A1:B2', visible_only=True, no_personal_information=True,
            redistribution_approved=True) for d in b['documents']]}}


class SupplyTests(unittest.TestCase):
    def refill(self, rows, entries=None):
        return supply.refill({'schema_version': 1, 'entries': entries or []}, {'schema_version': 1, 'candidates': rows})

    def test_missing_approval_or_private_ownership_never_uploads(self):
        for field in ('bundle_sha256', 'review_commit', 'documents', 'exclusive_public_ownership'):
            row = candidate()
            del row['approval'][field]
            queue, result = self.refill([row])
            api = FakeAPI()
            batch_worker.tick(queue, MemoryStore(), api)
            self.assertEqual(api.submissions, 0)
            self.assertEqual(result['supply_confirmation_required'], 1)

    def test_changed_text_source_scope_or_privacy_requires_confirmation(self):
        for change in ('text', 'source', 'privacy', 'scope', 'prior'):
            row = candidate()
            if change == 'text': row['bundle']['documents'][0]['text'] += ' changed'
            if change == 'source': row['approval']['documents'][0]['source_sha256'] = '0'*64
            if change == 'privacy': row['approval']['documents'][0]['no_personal_information'] = False
            if change == 'scope': row['approval']['documents'][0]['public_scope'] = ''
            if change == 'prior': row['approval']['exclusive_public_ownership']['no_prior_attempt'] = False
            self.assertEqual(self.refill([row])[0]['entries'], [])

    def test_repeat_refill_and_ledger_history_do_not_resubmit(self):
        row = candidate()
        queue, status = self.refill([row, copy.deepcopy(row)])
        self.assertEqual(status['supply_added'], 1)
        self.assertEqual(status['supply_duplicates'], 1)
        store, api = MemoryStore(), FakeAPI()
        batch_worker.tick(queue, store, api)
        queue, status = self.refill([row], queue['entries'])
        batch_worker.tick(queue, store, api)
        self.assertEqual(api.submissions, 1)
        self.assertEqual(status['supply_added'], 0)

    def test_new_id_or_excerpt_of_same_original_does_not_bypass_dedup(self):
        first, second = candidate(), candidate()
        second['bundle']['id'] += '-new'
        second['bundle']['documents'][0]['text'] += 'new excerpt'
        second['approval']['bundle_sha256'] = w.digest(second['bundle'])
        second['approval']['documents'][0]['text_sha256'] = hashlib.sha256(second['bundle']['documents'][0]['text'].encode()).hexdigest()
        queue, status = self.refill([first, second])
        self.assertEqual(len(queue['entries']), 1)
        self.assertEqual(status['supply_duplicates'], 1)

    def test_unknown_fields_cannot_smuggle_private_metadata(self):
        row = candidate()
        row['approval']['private_ledger'] = 'not permitted'
        self.assertEqual(self.refill([row])[0]['entries'], [])


if __name__ == '__main__':
    unittest.main()
