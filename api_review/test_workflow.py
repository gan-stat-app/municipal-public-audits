from pathlib import Path
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]


class WorkflowTests(unittest.TestCase):
    def test_only_scheduled_main_can_access_secrets_and_write_state(self):
        text = (ROOT / '.github/workflows/public-api-review.yml').read_text()
        workflow = yaml.load(text, Loader=yaml.BaseLoader)
        self.assertEqual(set(workflow['on']), {'pull_request', 'schedule'})
        self.assertEqual(workflow['permissions'], {'contents': 'read'})
        execute = workflow['jobs']['execute']
        self.assertEqual(execute['if'], "github.event_name == 'schedule' && github.ref == 'refs/heads/main' && vars.PUBLIC_API_ENABLED == 'true'")
        self.assertEqual(execute['permissions'], {'contents': 'write'})
        self.assertEqual(execute['timeout-minutes'], '45')
        self.assertEqual(execute['steps'][-1]['env'], {
            'GH_TOKEN': '${{ github.token }}', 'OPENAI_API_KEY': '${{ secrets.OPENAI_API_KEY }}',
            'API_RESULT_KEY': '${{ secrets.API_RESULT_KEY }}'})
        self.assertNotIn('secrets', str(workflow['jobs']['test']))
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
