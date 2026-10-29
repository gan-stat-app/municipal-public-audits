"""Independent acquisition and existing normalizers; originals stay temporary."""
from __future__ import annotations
import argparse
from collections import Counter
import contextlib
import datetime as dt
import gzip
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
from common import ROOT, SNAPSHOT, code_check, download, receipt, sha


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def write_normalized(relative, data):
    path = ROOT / 'collections' / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode()
    path.write_bytes(gzip.compress(raw, mtime=0))
    return {'path': str(path.relative_to(ROOT)), 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}


def facilities(limit=0):
    archive = module('facility_archive', SNAPSHOT / 'scripts/archive-national-facility-standards.py')
    normal = module('facility_normal', SNAPSHOT / 'scripts/normalize-facility-standards.py')
    tokai = module('facility_tokai', SNAPSHOT / 'scripts/normalize-tokai-hokuriku-facility-standards.py')
    registry = json.loads((SNAPSHOT / 'data/facility-standards/source-registry.json').read_bytes())
    bureaus = registry['bureaus'][:limit or None]
    results = []
    for bureau in bureaus:
        result = {'bureau': bureau['id'], 'originals': []}
        try:
            _, files = archive.discover(bureau)
            if not files:
                raise ValueError('No structured official inputs')
            with tempfile.TemporaryDirectory() as folder:
                work = Path(folder)
                for item in files:
                    raw = download(item['url'], limit=80*1024*1024)
                    digest = sha(raw)
                    name = archive.safe_name(item['url'], digest)
                    (work / name).write_bytes(raw)
                    result['originals'].append({'url': item['url'], 'sha256': digest, 'bytes': len(raw), 'name': name})
                if bureau['id'] == 'tokai-hokuriku':
                    # This bureau's normalizer reads the official month itself
                    # through its established CLI; do not invent the month.
                    snapshot = normal.snapshot_from_workbooks(work)
                    records, sources = tokai.normalize(sorted(work.glob('*.zip')), snapshot)
                else:
                    snapshot = normal.snapshot_from_workbooks(work)
                    records, sources = normal.normalize(work, snapshot)
                if not records:
                    raise ValueError('No verified facility records')
                result.update(status='normalized', snapshot=snapshot, records=len(records),
                    output=write_normalized(f'facility/{bureau["id"]}/{snapshot}.json.gz',
                        {'schema_version': 1, 'bureau': bureau['id'], 'snapshot': snapshot,
                         'records': records, 'sources': sources, 'originals': result['originals']}))
        except Exception as exc:
            result.update(status='unavailable', error_type=type(exc).__name__)
        results.append(result)
    return {'scope': 'facility', 'rows': results, 'expected': len(bureaus),
            'full_scope': len(bureaus) == len(registry['bureaus']),
            'status': 'passed' if all(r['status'] == 'normalized' for r in results) else 'review_required'}


def food(limit=0):
    sys.path.insert(0, str(SNAPSHOT / 'source/food-business'))
    import model
    import fetch
    config = json.loads((SNAPSHOT / 'source/food-business/sources.json').read_bytes())
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date()
    # Refresh the same national directory as the existing collector. A missing
    # source or failed parser remains unavailable, never a zero-record success.
    labels, as_of, available = fetch.national_catalog()
    current = {s['id']: s for s in config['sources']}
    template = next(s for s in config['sources'] if s['parser'] == 'ifas')
    for code, name in labels:
        ident = 'ifas-' + code
        current[ident] = {**current.get(ident, template), 'id': ident, 'publisher': name,
            'authority_code': code, 'prefecture_code': code[:2], 'as_of': as_of,
            'available': available[code],
            'url': 'https://i2fas.mhlw.go.jp/faspub/page/opendatadownload.jsp?param=' + code + '_food_business_all.csv'}
    sources = sorted(current.values(), key=lambda s: s['id'])[:limit or None]
    results = []
    for source in sources:
        row = {'source_id': source['id']}
        try:
            value = source if source['parser'] == 'ifas' else fetch.resolve_local(source, today)
            if not value['available']:
                raise ValueError('Official directory marks this source unavailable')
            raw = download(value['url'])
            records, qa = model.normalize(raw, value)
            if not records:
                raise ValueError('Empty normalized source needs review')
            metadata = {'source_id': source['id'], 'url': value['url'], 'sha256': sha(raw),
                        'bytes': len(raw), 'as_of': value.get('as_of'), 'scope': value['scope'],
                        'parser': value['parser'], 'period_start': value.get('period_start')}
            row.update(status='normalized', original=metadata, records=len(records),
                output=write_normalized(f'food/{today.isoformat()}/{source["id"]}.json.gz',
                    {'schema_version': 1, 'source': metadata, 'records': records, 'qa': qa}))
        except Exception as exc:
            row.update(status='unavailable', error_type=type(exc).__name__)
        results.append(row)
    return {'scope': 'food', 'rows': results, 'expected': len(sources),
            'full_scope': len(sources) == len(current),
            'status': 'passed' if all(r['status'] == 'normalized' for r in results) else 'review_required'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('kind', choices=['facility', 'food'])
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()
    if args.limit < 0:
        parser.error('limit must not be negative')
    code_check()
    try:
        payload = facilities(args.limit) if args.kind == 'facility' else food(args.limit)
    except Exception as exc:
        payload = {'scope': args.kind, 'status': 'failed', 'error_type': type(exc).__name__, 'rows': []}
    receipt(args.kind, payload)
    return 0 if payload['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
