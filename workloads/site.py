"""Run the actual locked app build and existing UI tests in the public repository."""
from __future__ import annotations
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from common import ROOT, SNAPSHOT, blob, checked_public, code_check, receipt, safe_path, sha


def hydrate(data):
    def one(item):
        path = safe_path(SNAPSHOT, item['path'])
        if not path.is_file() or blob(path.read_bytes()) != item['sha']:
            raw = checked_public(item)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
    with ThreadPoolExecutor(max_workers=6) as executor:
        selected = [x for x in data['assets'] if not generated(x['path'])]
        for count, _ in enumerate(executor.map(one, selected), 1):
            if count % 200 == 0 or count == len(selected):
                print('Verified public inputs:', count, '/', len(selected), flush=True)
    for item in data['aliases']:
        if generated(item['source']):
            continue
        original = safe_path(SNAPSHOT, item['source'])
        target = safe_path(SNAPSHOT, item['target'])
        if blob(original.read_bytes()) != item['sha']:
            raise ValueError('Mirror input mismatch')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)


def generated(path):
    return path.startswith('data/cross-cause-profile-v1/')


def complete_generated_assets(data):
    # npm run build regenerates these exact outputs from the byte-checked
    # annual inputs. Do not depend on the deployed server's older derivatives.
    for item in data['assets']:
        if generated(item['path']):
            source = safe_path(SNAPSHOT / 'source/public', item['path'])
            raw = source.read_bytes()
            if blob(raw) != item['sha']:
                raise ValueError('Rebuilt derivative differs from Git: ' + item['path'])
            target = safe_path(SNAPSHOT, item['path'])
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)


COMMANDS = [
    ['npm', 'ci'],
    ['npm', 'audit', '--package-lock-only', '--ignore-scripts', '--audit-level=low'],
    ['npm', 'run', 'build'],
    ['npm', 'test'],
    ['node', 'scripts/article-hub-browser-test.mjs', '--built', 'dist'],
    ['node', 'scripts/map-display-browser-test.mjs'],
    ['node', 'scripts/medical-area-smr-browser-test.mjs'],
    ['node', 'scripts/death-difference-browser-test.mjs'],
    ['node', 'scripts/dpc-browser-regression-test.mjs'],
    ['node', 'scripts/school-trend-browser-test.mjs'],
    ['node', 'scripts/external-origin-build-audit.mjs'],
    ['node', 'scripts/production-bundle-integrity-test.mjs'],
]


def main():
    data = code_check()
    commands = []
    try:
        hydrate(data)
        for command in COMMANDS:
            start = time.monotonic()
            print('Run:', ' '.join(command), flush=True)
            result = subprocess.run(command, cwd=SNAPSHOT / 'source', timeout=1800,
                                    env={**os.environ, 'CHROMIUM_PATH': os.environ.get('CHROMIUM_PATH', '/usr/bin/google-chrome')})
            commands.append({'command': command, 'exit_code': result.returncode,
                             'seconds': round(time.monotonic() - start, 3)})
            if result.returncode:
                raise RuntimeError('Existing build or UI assertion failed')
            if command == ['npm', 'run', 'build']:
                complete_generated_assets(data)
        # Only generated public app assets are retained; never archive fetched
        # spreadsheets, the whole checkout, or detailed document diagnostics.
        dist = SNAPSHOT / 'source/dist'
        emitted = json.loads((dist / '.vite/manifest.json').read_bytes())
        names = {'index.html', '.vite/manifest.json'}
        for value in emitted.values():
            names.add(value['file'])
            names.update(value.get('css', []))
            names.update(value.get('assets', []))
        output = ROOT / 'app-build'
        files = []
        for name in sorted(names):
            source = safe_path(dist, name)
            raw = source.read_bytes()
            target = safe_path(output, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            files.append({'path': name, 'bytes': len(raw), 'sha256': sha(raw)})
        receipt('site', {'status': 'passed', 'commands': commands, 'files': files,
                         'public_assets_checked': len(data['assets']), 'mirrors': len(data['aliases'])})
    except Exception as exc:
        receipt('site', {'status': 'failed', 'error_type': type(exc).__name__, 'commands': commands})
        raise


if __name__ == '__main__':
    main()
