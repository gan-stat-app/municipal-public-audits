"""One official workbook -> one existing public JSON, fail closed on changes."""
import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'workloads'))
from common import download, checked_public, blob, sha
import definitions

SOURCE = {'url': definitions.SOURCES['definition-table.xlsx'], 'bytes': 1113503,
          'sha256': '1dc6fe4d63f8fa1e8ecdc9300717be9c940d2cb70379cdc08b38d0366e561edc'}
REFERENCE = {'path': 'dpc/data/surgery-definitions.json', 'size': 131031,
             'sha': '074dca0005941bdbbe6bb3d8f8b1868977322448'}

def check_source(raw):
    if len(raw) != SOURCE['bytes'] or sha(raw) != SOURCE['sha256']:
        raise ValueError('Official workbook changed; migration remains incomplete')

def compare(generated, reference):
    if len(reference) != REFERENCE['size'] or blob(reference) != REFERENCE['sha']:
        raise ValueError('Published reference changed')
    if generated != reference:
        raise ValueError('Generated JSON differs from published bytes')
    return json.loads(generated)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    parser.add_argument('--reference', type=Path)
    args = parser.parse_args()
    start = time.monotonic()
    raw = args.source.read_bytes() if args.source else download(SOURCE['url'], SOURCE['bytes'])
    acquired = datetime.now(timezone(timedelta(hours=9))).isoformat()
    check_source(raw)
    definitions.RAW.mkdir(exist_ok=True)
    (definitions.RAW / 'definition-table.xlsx').write_bytes(raw)
    generated = json.dumps(definitions.load_surgery_definitions(), ensure_ascii=False, separators=(',', ':')).encode()
    reference = args.reference.read_bytes() if args.reference else checked_public(REFERENCE)
    value = compare(generated, reference)
    out = Path('dpc-stage2-output'); out.mkdir(exist_ok=True)
    (out / 'surgery-definitions.json').write_bytes(generated)
    receipt = {'status': 'PASS', 'scope': '2024 surgery definitions only',
               'source': dict(SOURCE, retrieved_jst=acquired, retrieval='local verified official download' if args.source else 'official HTTPS'),
               'reference': REFERENCE, 'generated_bytes': len(generated),
               'generated_sha256': sha(generated), 'byte_identity': True,
               'json_identity': value == json.loads(reference), 'diseases': len(value['diseases']),
               'procedure_groups': sum(len(x) for x in value['diseases'].values()),
               'elapsed_seconds': round(time.monotonic() - start, 3),
               'github_run_id': __import__('os').environ.get('GITHUB_RUN_ID'),
               'private_checks_skipped': False, 'savings': 'not demonstrated'}
    (out / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(receipt, ensure_ascii=False))

if __name__ == '__main__':
    main()
