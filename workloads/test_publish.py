import hashlib
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


def site_files(extra=None):
    app = {'.vite/manifest.json': json.dumps({'index.html': {'file': 'assets/index.js'}}),
           'index.html': '<html/>', 'assets/index.js': 'public', **(extra or {})}
    files = {'app-build/' + path: value for path, value in app.items()}
    report = {'status': 'passed', 'files': [
        {'path': path, 'bytes': len(value.encode()), 'sha256': hashlib.sha256(value.encode()).hexdigest()}
        for path, value in app.items()]}
    files['reports/site.json'] = json.dumps(report)
    for width in ('1440', '320', '390'):
        for mode in ('js', 'no-js'):
            files[f'snapshot/source/article-index-review/{width}-{mode}.png'] = b'\x89PNG\r\n\x1a\n'
    for topic in ('cancer-screening', 'dpc', 'facility'):
        for width in ('1280', '390'):
            files[f'snapshot/source/map-display-review/{topic}-{width}.png'] = b'\x89PNG\r\n\x1a\n'
    return files


class PublishTests(unittest.TestCase):
    def test_only_successful_public_app_outputs_are_publishable(self):
        files = site_files()
        validate(archive(files), 'public-site-build')
        for path in ('originals/raw.xlsx', 'app-build/private.md', '../secret', 'source/.env'):
            with self.assertRaises(ValueError):
                validate(archive({**files, path: 'private'}), 'public-site-build')
        with self.assertRaises(ValueError):
            validate(archive({**files, 'reports/site.json': '{"status":"failed"}'}), 'public-site-build')

    def test_unlisted_json_and_changed_bytes_are_rejected(self):
        for extra in ({'app-build/private.json': '{}'}, {'app-build/assets/index.js': 'changed'}):
            with self.assertRaises(ValueError):
                validate(archive({**site_files(), **extra}), 'public-site-build')

    def test_receipt_cannot_expand_vite_inventory(self):
        with self.assertRaises(ValueError):
            validate(archive(site_files({'private.json': '{}'})), 'public-site-build')

    def test_unexpected_or_missing_screenshot_is_rejected(self):
        files = site_files()
        files['snapshot/source/map-display-review/private.png'] = b'\x89PNG\r\n\x1a\n'
        with self.assertRaises(ValueError):
            validate(archive(files), 'public-site-build')
        files = site_files()
        del files['snapshot/source/map-display-review/dpc-390.png']
        with self.assertRaises(ValueError):
            validate(archive(files), 'public-site-build')

    def test_credentials_rejected_even_with_matching_hash(self):
        with self.assertRaises(ValueError):
            validate(archive(site_files({'assets/index.js': 'ghp_' + 'x' * 36})), 'public-site-build')

    def test_symlink_is_rejected(self):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as z:
            for path, value in site_files().items():
                entry = zipfile.ZipInfo(path)
                entry.external_attr = (0o120777 << 16)
                z.writestr(entry, value)
        with self.assertRaises(ValueError):
            validate(output.getvalue(), 'public-site-build')

    def test_collection_can_preserve_review_required_but_never_raw_originals(self):
        files = {'reports/food.json': '{"status":"review_required"}', 'collections/food/source.json.gz': b'normalized'}
        validate(archive(files), 'public-collection-1')
        with self.assertRaises(ValueError):
            validate(archive({**files, 'collections/food/source.xlsx': b'raw'}), 'public-collection-1')
        with self.assertRaises(ValueError):
            validate(archive(files), 'unapproved')


if __name__ == '__main__':
    unittest.main()
