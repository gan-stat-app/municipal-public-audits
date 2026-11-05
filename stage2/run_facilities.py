"""Verify one official facility workbook and its intermediate extraction only."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'workloads'))
from common import download
import facilities

SOURCE = json.loads((Path(__file__).parent / 'inventory.json').read_text())['sources'][0]
EXPECTED = json.loads((Path(__file__).parent / 'facility-local-receipt.json').read_text())

def extract(raw, directory):
    if len(raw) != SOURCE['bytes'] or hashlib.sha256(raw).hexdigest() != SOURCE['sha256']:
        raise ValueError('Official facility workbook changed')
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'facility.xlsx').write_bytes(raw)
    facilities.RAW = directory
    values = facilities.load_facilities()
    payload = json.dumps(list(values.values()), ensure_ascii=False, separators=(',', ':')).encode()
    if len(values) != EXPECTED['facility_count'] or hashlib.sha256(payload).hexdigest() != EXPECTED['extracted_sha256']:
        raise ValueError('Facility extraction differs from accepted original function result')
    return payload

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path)
    args = parser.parse_args()
    raw = args.source.read_bytes() if args.source else download(SOURCE['url'], SOURCE['bytes'])
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        payload = extract(raw, Path(directory))
    print(json.dumps({'status':'PASS', 'scope':'facility intermediate only', 'facilities':EXPECTED['facility_count'], 'bytes':len(payload), 'sha256':hashlib.sha256(payload).hexdigest()}))

if __name__ == '__main__':
    main()
