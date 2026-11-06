"""Verify the official MDC workbook and its unjoined intermediate only."""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'workloads'))
from common import download, blob
import mdc

SOURCE = next(s for s in json.loads((Path(__file__).parent / 'inventory.json').read_text())['sources'] if s['filename'] == 'mdc.xlsx')
EXPECTED = json.loads((Path(__file__).parent / 'mdc-local-receipt.json').read_text())

def extract(raw, directory, original=None):
    if len(raw) != SOURCE['bytes'] or hashlib.sha256(raw).hexdigest() != SOURCE['sha256']:
        raise ValueError('Official MDC workbook changed')
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'mdc.xlsx').write_bytes(raw)
    previous = mdc.RAW
    try:
        mdc.RAW = directory
        values = mdc.load_mdc({}, {})
        if original is not None:
            names = {'MDC_NAMES', 'text', 'code', 'public_number', 'load_mdc'}
            nodes = [n for n in ast.parse(original).body if
                     (isinstance(n, ast.FunctionDef) and n.name in names) or
                     (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'MDC_NAMES' for t in n.targets))]
            if len(nodes) != 5:
                raise ValueError('Original MDC functions missing')
            namespace = {'RAW': directory, 'load_workbook': mdc.load_workbook}
            exec(compile(ast.Module(body=nodes, type_ignores=[]), '<pinned original>', 'exec'), namespace)
            if values != namespace['load_mdc']({}, {}):
                raise ValueError('MDC dictionary differs from original code')
    finally:
        mdc.RAW = previous
    payload = json.dumps(list(values.values()), ensure_ascii=False, separators=(',', ':')).encode()
    if (len(values) != EXPECTED['hospital_keys'] or len(payload) != EXPECTED['extracted_bytes']
            or hashlib.sha256(payload).hexdigest() != EXPECTED['extracted_sha256']):
        raise ValueError('MDC extraction differs from accepted original function result')
    return payload

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    raw = args.source.read_bytes() if args.source else download(SOURCE['url'], SOURCE['bytes'])
    original_raw = (Path(__file__).parent / 'reference/build-dpc-data.py').read_bytes()
    if blob(original_raw) != EXPECTED['source_git_blob']:
        raise ValueError('Original code differs from pinned Git blob')
    original = original_raw.decode()
    with tempfile.TemporaryDirectory() as directory:
        payload = extract(raw, Path(directory), original)
    print(json.dumps({'status': 'PASS', 'scope': EXPECTED['scope'], 'hospital_keys': EXPECTED['hospital_keys'],
                      'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest()}))

if __name__ == '__main__':
    main()
