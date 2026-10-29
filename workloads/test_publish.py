import io
import json
import unittest
import zipfile
from publish import validate


def archive(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as z:
        for path, value in files.items():
            z.writestr(path, value)
    return output.getvalue()


class PublishTests(unittest.TestCase):
    def test_only_successful_public_app_outputs_are_publishable(self):
        files = {'reports/site.json': json.dumps({'status': 'passed'}), 'app-build/.vite/manifest.json': '{}',
                 'app-build/index.html': '<html/>', 'app-build/assets/index.js': 'public'}
        validate(archive(files), 'public-site-build')
        for path in ('originals/raw.xlsx', 'app-build/private.md', '../secret', 'source/.env'):
            with self.assertRaises(ValueError):
                validate(archive({**files, path: 'private'}), 'public-site-build')
        with self.assertRaises(ValueError):
            validate(archive({**files, 'reports/site.json': '{"status":"failed"}'}), 'public-site-build')

    def test_collection_can_preserve_review_required_but_never_raw_originals(self):
        files = {'reports/food.json': '{"status":"review_required"}', 'collections/food/source.json.gz': b'normalized'}
        validate(archive(files), 'public-collection-1')
        with self.assertRaises(ValueError):
            validate(archive({**files, 'collections/food/source.xlsx': b'raw'}), 'public-collection-1')
        with self.assertRaises(ValueError):
            validate(archive(files), 'unapproved')


if __name__ == '__main__':
    unittest.main()
