"""Preserve reviewed public datasets and run independent per-domain checks."""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path
from common import ROOT, SNAPSHOT, blob, checked_public, safe_path, manifest

REGISTRY = ROOT / 'workloads/datasets.json'


def load_registry():
    data = json.loads(REGISTRY.read_bytes())
    inputs = manifest()
    for name, group in data['groups'].items():
        group['assets'] = [a for a in inputs['assets'] if a['path'].startswith(tuple(group['prefixes']))
                           and not any(p in Path(a['path']).parts for p in ('raw','originals','archives','private'))
                           and Path(a['path']).suffix.lower() not in ('.xls','.xlsx','.pdf','.docx','.zip')]
        paths = {a['path'] for a in group['assets']}
        group['aliases'] = [a for a in inputs['aliases'] if a['source'] in paths]
        group['code'] = [a for a in inputs['code'] if a['path'] in ['source/'+c[1] for c in group['commands']]]
    return validate_registry(data)


def fingerprint(group):
    return hashlib.sha256(json.dumps(group, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def validate_registry(data):
    allowed = {'ndb', 'dpc', 'care', 'population', 'age-specific-mortality', 'life-expectancy',
               'school-dental', 'regional-healthcare-vision', 'welfare', 'cancer-screening',
               'cancer-care', 'medical-cost', 'mental-health', 'food-poisoning', 'lifestyle',
               'food-business', 'facility-standards', 'hospital-inspection', 'jmd'}
    if data.get('schema_version') != 1 or set(data['groups']) != allowed:
        raise ValueError('Unexpected dataset domains')
    seen = set()
    for name, group in data['groups'].items():
        paths = {x['path']: x['sha'] for x in group['assets']}
        if not paths or len(paths) != len(group['assets']):
            raise ValueError('Empty or duplicate domain')
        for item in group['assets']:
            path = item['path']
            safe_path(SNAPSHOT, path)
            extra = ('data/facility-standards/', 'data/tohoku-facility-standards/') if name == 'facility-standards' else (('data/jmd/',) if name == 'jmd' else ())
            if not path.startswith((name+'/', *extra)) or any(x in Path(path).parts for x in ('raw','originals','archives','private')):
                raise ValueError('Unapproved dataset path')
            if path in seen or len(item['sha']) != 40:
                raise ValueError('Duplicate or invalid input')
            seen.add(path)
        for alias in group['aliases']:
            safe_path(SNAPSHOT, alias['target'])
            if paths.get(alias['source']) != alias['sha'] or not alias['target'].startswith(('source/public/', 'source/food-poisoning/data/')):
                raise ValueError('Unreviewed mirror')
        code = {x['path']: x['sha'] for x in group['code']}
        for command in group['commands']:
            if len(command) != 2 or command[0] != 'node' or 'source/'+command[1] not in code:
                raise ValueError('Unreviewed command')
    return data


def run(name, data):
    group = data['groups'][name]
    output = ROOT / 'dataset-output' / name
    if output.exists():
        shutil.rmtree(output)
    files = []
    def one(item):
        source = safe_path(SNAPSHOT, item['path'])
        raw = source.read_bytes() if source.is_file() else b''
        if blob(raw) != item['sha']:
            raw = checked_public(item)
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(raw)
        target = safe_path(output / 'files', item['path'])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        return {'path':item['path'], 'bytes':len(raw), 'sha256':hashlib.sha256(raw).hexdigest(), 'git_blob':blob(raw)}
    # Four domain jobs, each with at most two reads, bound origin traffic.
    with ThreadPoolExecutor(max_workers=2) as pool:
        for count, entry in enumerate(pool.map(one, group['assets']), 1):
            files.append(entry)
            if count % 50 == 0:
                print(name, count, '/', len(group['assets']), flush=True)
    for item in group['aliases']:
        target = safe_path(SNAPSHOT, item['target'])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(safe_path(SNAPSHOT,item['source']), target)
    for item in group['code']:
        if blob(safe_path(SNAPSHOT,item['path']).read_bytes()) != item['sha']:
            raise ValueError('Validator differs from approved code')
    commands = []
    for command in group['commands']:
        started = time.monotonic()
        subprocess.run(command, cwd=SNAPSHOT/'source', timeout=600, check=True)
        commands.append({'command':command, 'seconds':round(time.monotonic()-started,3), 'exit_code':0})
    report = {'schema_version':1,'domain':name,'status':'passed',
              'coverage':group['coverage'],'generation':group['generation'],
              'fingerprint':fingerprint(group),'commands':commands,'files':files}
    (output/'receipt.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'domain':name,'status':'passed','files':len(files),'commands':len(commands)}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--domain')
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    data=load_registry()
    if not args.check:
        if args.domain not in data['groups']:
            parser.error('Select a registered domain')
        run(args.domain,data)
