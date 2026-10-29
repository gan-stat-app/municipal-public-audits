"""Move the existing six-prefecture item-7 acquisition without publishing originals."""
from pathlib import Path
import tempfile
from common import ROOT, SNAPSHOT, code_check, download, receipt, sha
from collectors import module, write_normalized


def main():
    code_check()
    adapter = module('tohoku_item7', SNAPSHOT / 'scripts/fetch-tohoku-facility-standards.py')
    try:
        url, month = adapter.discover(download(adapter.INDEX_URL))
        raw = download(url, limit=80*1024*1024)
        original = {'url': url, 'sha256': sha(raw), 'bytes': len(raw), 'format': 'xlsx'}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'official.xlsx'
            path.write_bytes(raw)
            payload = adapter.normalize(path, month, url, original['sha256'])
        if not payload['recordCount'] or {x['prefecture_code'] for x in payload['records']} != {'02','03','04','05','06','07'}:
            raise ValueError('The established six-prefecture scope is incomplete')
        output = write_normalized(f'tohoku/{month}/item7.json.gz', payload)
        receipt('tohoku', {'scope': 'tohoku', 'status': 'passed', 'full_scope': True, 'expected': 6,
                          'rows': [{'source_id': 'tohoku-item7', 'status': 'normalized', 'original': original,
                                    'records': payload['recordCount'], 'output': output}]})
        return 0
    except Exception as error:
        receipt('tohoku', {'scope': 'tohoku', 'status': 'review_required', 'full_scope': False,
                          'error_type': type(error).__name__, 'rows': []})
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
