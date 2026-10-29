"""Fetch public originals and run the pinned non-AI Harunobu worker independently.

Only identifiers, content hashes, status and numeric scores leave the temporary
directory. Originals, workbook metadata and detailed findings are never uploaded.
"""
from __future__ import annotations
import argparse
from collections import Counter
import csv
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.parse
from common import ROOT, SNAPSHOT, checked_public, code_check, download, receipt, sha

ENGINE_CODE = SNAPSHOT / 'source/machine-readability'
sys.path.insert(0, str(ENGINE_CODE))
import pipeline
from score_audit import independent_scores


def source_format(url):
    # Public APIs use download.jsp?param=...csv and some servers name an
    # attachment literally '.xlsx'; Path.suffix is empty for both cases.
    match = re.search(r'\.(csv|tsv|xlsx|xlsm|xls)(?:$|[?&#/])', urllib.parse.unquote(url), re.I)
    if not match:
        raise ValueError('Unknown scored national format')
    return match.group(1).lower()


def public_sources(data):
    national = list(csv.DictReader(io.StringIO(checked_public(data['score_sources'][0]).decode('utf-8-sig'))))
    rows = []
    for r in national:
        extension = source_format(r['original_url'])
        rows.append({'id': r['source_id'], 'url': r['original_url'], 'format': extension,
                     'sha256': r['original_sha256'],
                     'scores': {str(i): float(r['L' + str(i)]) if r['L' + str(i)] else None for i in (1, 2, 3)}})
    portal = json.loads(checked_public(data['score_sources'][1]))
    for r in portal['files']:
        if r.get('format') not in {'csv', 'tsv', 'xlsx', 'xlsm', 'xls'}:
            continue
        rows.append({'id': 'akita-' + r['resource_id'], 'url': r['url'], 'format': r['format'],
                     'sha256': r.get('sha256'), 'scores': r.get('scores'), 'status': r.get('status')})
    if len(national) != 76 or len(rows) < 1900:
        raise ValueError('Public source inventory is incomplete')
    return rows


def evaluate(row, engine, work):
    result = {'id': row['id'], 'expected_sha256': row.get('sha256')}
    raw = download(row['url'])
    result['current_sha256'] = sha(raw)
    same = result['current_sha256'] == row.get('sha256')
    check = pipeline.preflight(raw, row['format'])
    if check['status'] != 'ready':
        return {**result, 'status': check['status'], 'scores': {'1': None, '2': None, '3': None}}
    source = work / (result['current_sha256'] + '.' + row['format'])
    source.write_bytes(raw)
    target = work / (result['current_sha256'] + '.result.json')
    process = subprocess.run([sys.executable, str(ENGINE_CODE / 'worker.py'), '--engine', str(engine),
                              '--input', str(source), '--output', str(target), '--memory-mib', '2048'],
                             capture_output=True, timeout=240)
    if process.returncode:
        return {**result, 'status': 'evaluation_failed'}
    report = json.loads(target.read_bytes())
    scores = independent_scores(report['official'])
    if scores != report['summary']['scores']:
        raise ValueError('Independent score arithmetic failed')
    if same and row.get('scores') and scores != row['scores']:
        return {**result, 'status': 'score_mismatch', 'scores': scores}
    return {**result, 'status': 'matched' if same else 'changed', 'scores': scores}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0, help='0 verifies the entire published inventory')
    parser.add_argument('--shard', type=int, default=0)
    parser.add_argument('--shards', type=int, default=1)
    args = parser.parse_args()
    if args.limit < 0 or not 0 <= args.shard < args.shards <= 100:
        parser.error('Invalid partition')
    data = code_check()
    rows = public_sources(data)
    selected = rows[args.shard::args.shards]
    if args.limit:
        selected = selected[:args.limit]
    results = []
    with tempfile.TemporaryDirectory() as folder:
        work = Path(folder)
        engine = subprocess.check_output([sys.executable, str(ENGINE_CODE / 'bootstrap.py'),
                                          '--destination', str(work)], text=True).strip()
        for row in selected:
            try:
                result = evaluate(row, Path(engine), work)
            except Exception as exc:
                result = {'id': row['id'], 'status': 'unavailable', 'error_type': type(exc).__name__}
            results.append(result)
            # Remove originals and detailed findings immediately after each file.
            for path in work.glob('*'):
                if path.is_file():
                    path.unlink()
    counts = dict(Counter(r['status'] for r in results))
    errors = sum(counts.get(k, 0) for k in ('unavailable', 'score_mismatch', 'evaluation_failed'))
    receipt('opendata', {'status': 'passed' if not errors else 'review_required',
        'inventory': len(rows), 'checked': len(results), 'full_inventory': len(results) == len(rows),
        'shard': args.shard, 'shards': args.shards, 'counts': counts, 'rows': results,
        'scope': 'current_public_originals; retained historical archives remain private'})
    return 1 if errors else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        receipt('opendata', {'status': 'failed', 'error_type': type(exc).__name__})
        raise
