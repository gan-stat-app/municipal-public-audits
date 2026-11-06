from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]


class WorkflowTests(unittest.TestCase):
    def test_document_execution_and_key_probe_have_separate_main_only_guards(self):
        text = (ROOT / '.github/workflows/public-api-review.yml').read_text()
        workflow = yaml.load(text, Loader=yaml.BaseLoader)
        self.assertEqual(set(workflow['on']), {'pull_request', 'schedule', 'workflow_dispatch', 'push'})
        self.assertEqual(workflow['permissions'], {'contents': 'read'})
        execute = workflow['jobs']['execute']
        self.assertEqual(execute['if'], "(github.event_name == 'schedule' || github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.mode == 'document-once')) && github.ref == 'refs/heads/main' && vars.PUBLIC_API_ENABLED == 'true'")
        self.assertEqual(execute['permissions'], {'contents': 'write'})
        self.assertEqual(execute['timeout-minutes'], '45')
        self.assertEqual(execute['steps'][-1]['env'], {
            'GH_TOKEN': '${{ github.token }}', 'OPENAI_API_KEY': '${{ secrets.OPENAI_API_KEY }}',
            'API_RESULT_KEY': '${{ secrets.API_RESULT_KEY }}',
            'PUBLIC_RUN_MODE': '${{ inputs.mode }}'})
        check = workflow['jobs']['key-check']
        self.assertEqual(check['if'], "github.event_name == 'workflow_dispatch' && inputs.mode == 'key-check' && github.ref == 'refs/heads/main' && vars.PUBLIC_API_ENABLED == 'true'")
        self.assertEqual(check['permissions'], {'contents': 'write'})
        self.assertEqual(check['timeout-minutes'], '3')
        self.assertEqual(check['steps'][-1]['run'], 'python api_review/key_check.py')
        self.assertNotIn('worker.py', str(check['steps']))
        self.assertEqual(check['steps'][-1]['env'], {k: v for k, v in execute['steps'][-1]['env'].items() if k != 'PUBLIC_RUN_MODE'})
        self.assertEqual(workflow['on']['push'], {'branches': ['main'], 'paths': ['api_review/queue.json']})
        self.assertNotIn('secrets', str(workflow['jobs']['test']))
        self.assertEqual(workflow['jobs']['test']['if'], "github.event_name == 'pull_request'")
        self.assertNotIn('needs', execute)  # Scheduled work must not depend on the skipped PR job.
        self.assertIn('batch_worker.py', execute['steps'][-1]['run'])
        self.assertIn('workflow_dispatch', execute['steps'][-1]['run'])
        self.assertEqual(execute['steps'][0]['with']['sparse-checkout'].split(),
                         ['api_review', '.github/workflows'])
        self.assertEqual(workflow['concurrency']['cancel-in-progress'], 'false')

    def test_no_output_upload_cache_or_private_repository_credential(self):
        text = (ROOT / '.github/workflows/public-api-review.yml').read_text()
        self.assertNotIn('upload-artifact', text)
        self.assertNotIn('actions/cache', text)
        self.assertNotIn('municipal-smr-site', text)
        self.assertNotIn('pull_request_target', text)
        self.assertNotIn('workflow_run', text)
        self.assertNotIn('set -x', text)

    def test_api_only_changes_skip_unrelated_verification(self):
        workflow = yaml.load((ROOT / '.github/workflows/verify-public-records.yml').read_text(), Loader=yaml.BaseLoader)
        for event in ('push', 'pull_request'):
            self.assertEqual(workflow['on'][event]['paths-ignore'],
                             ['api_review/**', '.github/workflows/public-api-review.yml'])


if __name__ == '__main__':
    unittest.main()
