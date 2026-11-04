"""Stage 1: regenerate only area/MDC summaries from pinned public aggregates."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import subprocess
import time
from common import ROOT, blob, checked_public, safe_path

SNAPSHOT = ROOT / 'dpc-snapshot'

MANIFEST = ROOT / 'workloads/dpc-generation-inputs.json'


def validate(data):
    expected = {'dpc/data/summary.json', 'dpc/data/death24h.json.gz'}
    expected.update(f'dpc/data/pref/{n:02}.json.gz' for n in range(1, 48))
    expected.update(f'dpc/data/year-{y}.json.gz.b64' for y in (2021, 2022, 2023))
    if (data['scope'] != 'area-mdc-summary-only' or data['upstream_originals'] != 'not-migrated'
            or len(data['inputs']) != len(expected) or {x['path'] for x in data['inputs']} != expected
            or data['output']['path'] != 'dpc/data/area-mdc-summary.json.gz.b64'
            or {x['path'] for x in data['code']} != {'scripts/build-dpc-area-mdc-summary.mjs', 'scripts/verify-dpc-area-mdc-summary.mjs'}):
        raise ValueError('Unapproved generation scope')
    for item in [*data['inputs'], data['output'], *data['code']]:
        safe_path(SNAPSHOT, item['path'])
        if len(item['sha']) != 40 or any(c not in '0123456789abcdef' for c in item['sha']):
            raise ValueError('Invalid input pin')
    return data


def main():
    data = validate(json.loads(MANIFEST.read_bytes()))
    for item in data['code']:
        if blob(safe_path(SNAPSHOT, item['path']).read_bytes()) != item['sha']:
            raise ValueError('Generator or verifier changed')
    def restore(item):
        target = safe_path(SNAPSHOT, item['path'])
        raw = target.read_bytes() if target.is_file() else b''
        if blob(raw) != item['sha']:
            raw = checked_public(item)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        return raw
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(restore, data['inputs']))
    published = restore(data['output'])
    mirror = SNAPSHOT / 'source/public' / data['output']['path']
    mirror.parent.mkdir(parents=True, exist_ok=True)
    mirror.write_bytes(published)
    def run(command):
        begin = time.monotonic()
        subprocess.run(command, cwd=SNAPSHOT, check=True, timeout=180)
        return {'command': command, 'exit_code': 0, 'seconds': round(time.monotonic()-begin, 3)}
    # The existing independent rebuild verifier checks 265,320 numeric cells.
    commands = [run(['node', 'scripts/verify-dpc-area-mdc-summary.mjs'])]
    commands.append(run(['node', 'scripts/build-dpc-area-mdc-summary.mjs']))
    rebuilt = (SNAPSHOT / data['output']['path']).read_bytes()
    if rebuilt != published or mirror.read_bytes() != published:
        raise ValueError('Generated output differs byte-for-byte from published output')
    report = {'schema_version': 1, 'scope': data['scope'], 'status': 'passed',
              'inputs_sha256': hashlib.sha256(MANIFEST.read_bytes()).hexdigest(),
              'output_git_blob': blob(rebuilt), 'output_sha256': hashlib.sha256(rebuilt).hexdigest(),
              'input_files': len(data['inputs']), 'numeric_cells': 4*335*18*11,
              'byte_identity': True, 'upstream_originals': 'not-migrated',
              'commands': commands, 'seconds': round(time.monotonic()-started, 3)}
    out = ROOT / 'dpc-generation-output'
    out.mkdir(exist_ok=True)
    (out/'receipt.json').write_text(json.dumps(report, indent=2)+'\n')
    (out/'area-mdc-summary.json.gz.b64').write_bytes(rebuilt)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
