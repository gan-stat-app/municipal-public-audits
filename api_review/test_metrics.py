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
