import copy
import json
import unittest
from unittest.mock import patch

import batch_worker as b
import worker as w
from test_worker import bundle, response, MemoryStore


class FakeAPI:
    def __init__(self):
        self.submissions = 0
        self.lines = []
        self.status = 'in_progress'
        self.rows = []
        self.fail = False

    def upload(self, lines):
        self.lines = [json.loads(x) for x in lines.splitlines()]
        return 'file-input'

    def submit(self, file_id):
        self.submissions += 1
        if self.fail:
            raise TimeoutError()
        return 'batch_test'

    def poll(self, batch_id):
        return {'id': batch_id, 'status': self.status, 'output_file_id': 'file-output'}

    def results(self, file_id):
        return '\n'.join(json.dumps(r) for r in self.rows)


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore()
        self.api = FakeAPI()
        self.queue = {'schema_version': 1, 'entries': [bundle()]}

    def tick(self):
        return b.tick(self.queue, self.store, self.api)

    def test_submit_exit_poll_and_validate_result_without_resubmission(self):
        self.assertEqual(self.tick()['submitted'], 1)
        identity = self.api.lines[0]['custom_id']
        self.assertEqual(self.api.lines[0]['body'], w.payload(bundle()))
        self.assertEqual(self.tick()['in_flight'], 1)
        self.assertEqual(self.api.submissions, 1)
        self.api.status = 'completed'
        self.api.rows = [{'custom_id': identity, 'response': {'status_code': 200, 'body': response()}}]
        self.assertEqual(self.tick()['completed'], 1)
        record = self.store.state['requests'][identity]
        self.assertEqual(record['report']['version'], 2)
        self.assertFalse(record['report']['body']['items'][0]['publication_approved'])
        self.assertEqual(record['usage']['input_tokens'], 10)
        self.assertEqual(self.tick()['submitted'], 0)
        self.assertEqual(self.api.submissions, 1)

    def test_prompt_change_collects_old_batch_without_resending_any_source(self):
        self.tick()
        identity = self.api.lines[0]['custom_id']
        self.api.status = 'completed'
        self.api.rows = [{'custom_id': identity, 'response': {'status_code': 200, 'body': response()}}]
        with patch.object(w, 'INSTRUCTIONS', w.INSTRUCTIONS + ' revised'):
            self.assertNotEqual(w.digest(w.payload(bundle())), identity)
            result = self.tick()
            self.assertEqual((result['completed'], result['submitted']), (1, 0))
            self.assertEqual(self.tick()['submitted'], 0)
        self.assertEqual(self.api.submissions, 1)
        self.assertEqual(list(self.store.state['requests']), [identity])

    def test_prompt_change_does_not_resend_held_or_inflight_sources(self):
        self.tick()
        with patch.object(w, 'INSTRUCTIONS', w.INSTRUCTIONS + ' revised'):
            self.assertEqual(self.tick()['submitted'], 0)
            self.api.status = 'completed'
            self.api.rows = [{'custom_id': self.api.lines[0]['custom_id'],
                             'response': {'status_code': 200, 'body': response(evidence=['invented'])}}]
            self.assertEqual(self.tick()['held'], 1)
            self.assertEqual(self.tick()['submitted'], 0)
        self.assertEqual(self.api.submissions, 1)

    def test_reservation_failure_makes_no_upload_or_submission(self):
        self.store.fail_at = 1
        with self.assertRaises(w.Stop):
            self.tick()
        self.assertEqual(self.api.lines, [])
        self.assertEqual(self.api.submissions, 0)

    def test_ambiguous_submission_is_reserved_and_never_resent(self):
        self.api.fail = True
        with self.assertRaises(TimeoutError):
            self.tick()
        self.api.fail = False
        self.assertEqual(self.tick()['submitted'], 0)
        self.assertEqual(self.api.submissions, 1)

    def test_sync_history_blocks_batch_submission(self):
        w.drain(self.queue, self.store, 'sk-test', sender=lambda *a, **k: response())
        self.assertEqual(self.tick()['submitted'], 0)

    def test_upload_failure_keeps_fixed_diagnostic_without_resend(self):
        with patch.object(self.api, 'upload', side_effect=TimeoutError('private detail')):
            with self.assertRaises(TimeoutError):
                self.tick()
        record = next(iter(self.store.state['requests'].values()))
        self.assertEqual(record['submission_stage'], 'file_upload_failed_or_unknown')
        self.assertNotIn('private detail', json.dumps(record))
        self.assertEqual(self.tick()['submitted'], 0)
        self.assertEqual(self.api.submissions, 0)

    def test_submit_failure_keeps_input_id_and_never_retries(self):
        self.api.fail = True
        with self.assertRaises(TimeoutError):
            self.tick()
        record = next(iter(self.store.state['requests'].values()))
        self.assertEqual(record['input_file_id'], 'file-input')
        self.assertEqual(record['submission_stage'], 'batch_submit_failed_or_unknown')
        self.assertEqual(self.tick()['submitted'], 0)
        self.assertEqual(self.api.submissions, 1)

    def test_failed_input_checkpoint_does_not_create_batch(self):
        self.store.fail_at = 2
        with self.assertRaises(w.Stop):
            self.tick()
        self.assertEqual(self.api.submissions, 0)

    def test_http_error_keeps_only_status_not_provider_body(self):
        import urllib.error
        with patch.object(self.api, 'upload', side_effect=urllib.error.HTTPError(
                'https://api.openai.com/v1/files', 429, 'sensitive detail', {}, None)):
            with self.assertRaises(urllib.error.HTTPError):
                self.tick()
        record = next(iter(self.store.state['requests'].values()))
        self.assertEqual(record['submission_http_status'], 429)
        self.assertNotIn('sensitive detail', json.dumps(record))

    def test_batch_reservation_blocks_sync_submission(self):
        self.tick()
        def forbidden(*args, **kwargs):
            self.fail('duplicate synchronous request')
        self.assertEqual(w.drain(self.queue, self.store, 'sk-test', sender=forbidden)['attempted'], 0)

    def test_expiry_partial_results_and_bad_evidence_are_held(self):
        second = copy.deepcopy(bundle())
        second['documents'][0]['text'] += '\nD4=300'
        self.queue['entries'].append(second)
        self.tick()
        self.api.status = 'expired'
        bad = response(evidence=['fabricated'])
        self.api.rows = [{'custom_id': self.api.lines[0]['custom_id'],
                          'response': {'status_code': 200, 'body': bad}}]
        result = self.tick()
        self.assertEqual(result['completed'], 0)
        self.assertEqual(result['held'], 2)
        self.assertEqual(self.tick()['submitted'], 0)

    def test_unknown_or_duplicate_result_ids_cannot_be_imported(self):
        self.tick()
        self.api.status = 'completed'
        self.api.rows = [{'custom_id': 'unknown'}]
        with self.assertRaises(w.Stop):
            self.tick()
        self.assertEqual(next(iter(self.store.state['requests'].values()))['status'], 'batch_submitted')

    def test_entire_queue_is_validated_before_upload(self):
        bad = bundle()
        bad['public_export_approved'] = False
        self.queue['entries'].append(bad)
        with self.assertRaises(w.Stop):
            self.tick()
        self.assertEqual(self.api.submissions, 0)


if __name__ == '__main__':
    unittest.main()

