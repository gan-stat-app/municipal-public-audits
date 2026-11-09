import unittest

import metrics
import worker as w
from test_worker import bundle


class MetricsTests(unittest.TestCase):
    def test_current_payload_and_legacy_failure_are_separate_and_not_available(self):
        source = bundle()
        key = w.digest({'model': w.MODEL, 'source': source['documents'][0]['source_sha256'],
                        'text': source['documents'][0]['text']})
        record = {'status': 'batch_submitted', 'source_keys': [key], 'usage': {}}
        state = {'requests': {w.digest(w.payload(source)): record}}
        queue = {'schema_version': 1, 'entries': [source]}
        catalog = {'schema_version': 1, 'candidates': []}
        result = metrics.summarize(queue, catalog, state)
        self.assertEqual(result['supply']['unattempted_requests'], 0)
        self.assertIsNone(result['cohorts']['triage-concise-v2']['validation_success_rate'])
        state['requests'] = {'old-payload': {**record, 'status': 'invalid_output',
            'diagnostic': 'output_token_limit',
            'usage': {'input_tokens': 10, 'output_tokens': 1200, 'total_tokens': 1210}}}
        result = metrics.summarize(queue, catalog, state)
        self.assertNotIn('triage-v1', result['cohorts'])
        self.assertEqual(result['supply']['unattempted_requests'], 0)
        self.assertEqual(result['cohorts']['legacy_or_unknown']['validation_success_rate'], 0)
        self.assertIsNone(result['cohorts']['legacy_or_unknown']['actual_work_reviews'])

    def test_reservation_and_mixed_history_never_become_unattempted(self):
        source = bundle()
        key = w.digest({'model': w.MODEL, 'source': source['documents'][0]['source_sha256'],
                        'text': source['documents'][0]['text']})
        queue = {'schema_version': 1, 'entries': [source]}
        catalog = {'schema_version': 1, 'candidates': []}
        for status, category in [('completed', 'completed'), ('invalid_output', 'held'),
                                 ('reserved_or_interrupted', 'in_flight_or_reserved')]:
            state = {'requests': {'old': {'status': status, 'source_keys': [key], 'usage': {}}}}
            result = metrics.summarize(queue, catalog, state)
            self.assertEqual(result['inventory'][0]['category'], category)
            self.assertFalse(result['inventory'][0]['eligible_for_submission'])
        state['requests']['pending'] = {'status': 'batch_submitted', 'source_keys': [key], 'usage': {}}
        self.assertEqual(metrics.summarize(queue, catalog, state)['inventory'][0]['category'],
                         'in_flight_or_reserved')
        self.assertEqual(metrics.summarize(queue, catalog, {'requests': {}})['supply']['unattempted_requests'], 1)

    def test_failed_usage_does_not_inflate_completed_average(self):
        queue = {'schema_version': 1, 'entries': []}
        catalog = {'schema_version': 1, 'candidates': []}
        state = {'requests': {
            'ok': {'status': 'completed', 'source_keys': [], 'usage': {'total_tokens': 100},
                   'report': {'body': {'items': [{'assessment': 'verify'}, {'assessment': 'reject'}]}}},
            'bad': {'status': 'invalid_output', 'source_keys': [], 'usage': {'total_tokens': 900}}}}
        group = metrics.summarize(queue, catalog, state)['cohorts']['legacy_or_unknown']
        self.assertEqual(group['usage']['total_tokens'], 1000)
        self.assertEqual(group['tokens_per_completed_request'], 100)
        self.assertEqual(group['candidate_rate'], 0.5)
