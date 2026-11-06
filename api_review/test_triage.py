import json
import unittest

import batch_worker as b
import worker as w
from test_batch_worker import FakeAPI
from test_worker import bundle, MemoryStore


def triage(items):
    return {'status': 'completed', 'output': [{'type': 'message', 'content': [
        {'type': 'output_text', 'text': json.dumps({'items': items})}]}]}


def item(identity, assessment):
    return {'id': identity, 'assessment': assessment,
            'evidence': ['B2=100'] if assessment == 'verify' else [],
            'rationale': '確認理由', 'next_check': ''}


class TriageTests(unittest.TestCase):
    def test_new_requests_ask_for_triage_only(self):
        fields = w.payload(bundle())['text']['format']['schema']['properties']['items']['items']
        self.assertEqual(set(fields['required']), {'id', 'assessment', 'evidence', 'rationale', 'next_check'})
        self.assertNotIn('draft_fact', fields['properties'])
        self.assertEqual(w.payload(bundle())['max_output_tokens'], 1200)

    def test_mixed_results_finish_once_and_only_findings_get_candidates(self):
        source = bundle()
        source['documents'] = [{**source['documents'][0], 'id': str(i),
                                'text': source['documents'][0]['text'] + str(i)} for i in range(3)]
        queue = {'schema_version': 1, 'entries': [source]}
        store, api = MemoryStore(), FakeAPI()
        b.tick(queue, store, api)
        identity = api.lines[0]['custom_id']
        api.status = 'completed'
        api.rows = [{'custom_id': identity, 'response': {'status_code': 200, 'body': triage([
            item('0', 'reject'), item('1', 'hold'), item('2', 'verify')])}}]
        result = b.tick(queue, store, api)
        self.assertEqual((result['completed'], result['submitted']), (1, 0))
        self.assertEqual([result[k] for k in ('triage_no_finding', 'triage_needs_evidence', 'triage_candidates')], [1, 1, 1])
        items = store.state['requests'][identity]['report']['body']['items']
        self.assertEqual([x['draft_fact'] for x in items[:2]], ['', ''])
        self.assertIn('B2=100', items[2]['draft_fact'])
        self.assertIn('確認理由', items[2]['draft_fact'])
        self.assertTrue(all(x['publication_approved'] is False for x in items))
        self.assertTrue(all(x['fact_confirmed'] is False for x in items))
        self.assertEqual(b.tick(queue, store, api)['submitted'], 0)
        self.assertEqual(api.submissions, 1)

    def test_bad_compact_evidence_never_creates_candidate(self):
        for evidence in [[], ['invented'], ['x' * 181], ['B2=100 C3=200 A1=見出し']]:
            candidate = item('one', 'verify')
            candidate['evidence'] = evidence
            with self.subTest(evidence=evidence), self.assertRaises(w.InvalidOutput):
                w.validate_response(triage([candidate]), bundle())

    def test_compact_rationale_is_bounded(self):
        candidate = item('one', 'verify')
        candidate['rationale'] = 'x' * 101
        with self.assertRaises(w.InvalidOutput):
            w.validate_response(triage([candidate]), bundle())

    def test_approval_is_still_required_before_any_submission(self):
        source = bundle()
        source['public_export_approved'] = False
        api = FakeAPI()
        with self.assertRaises(w.Stop):
            b.tick({'schema_version': 1, 'entries': [source]}, MemoryStore(), api)
        self.assertEqual(api.submissions, 0)
