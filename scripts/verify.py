"""Offline integrity checks for explicitly reviewed public records, not raw originals."""
import csv
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify(root=ROOT):
    root = Path(root)
    manifest = json.loads((root / 'manifest.json').read_text())
    require(manifest['schema_version'] == 1, 'Unknown manifest version')
    require(re.fullmatch(r'[0-9a-f]{40}', manifest['source_commit']), 'Invalid source commit')
    records = root / 'records'
    paths = [f['path'] for f in manifest['files']]
    require(len(paths) == len(set(paths)), 'Duplicate paths')
    require(all(not p.is_symlink() for p in records.rglob('*')), 'Symlinks are not accepted')
    require(set(paths) == {p.relative_to(records).as_posix() for p in records.rglob('*') if p.is_file()}, 'Missing or undeclared record')
    documents = {}
    for f in manifest['files']:
        path = PurePosixPath(f['path'])
        require(not path.is_absolute() and '..' not in path.parts, 'Unsafe path')
        require(path.parts[:2] in [('analysis', 'akita-website-quality'), ('analysis', 'akita-public-excel-review'), ('analysis', 'municipal-machine-readability')], 'Unexpected route')
        require(path.suffix in ('.json', '.csv'), 'Unexpected record format')
        require(f['source_url'] == 'https://municipal-smr.jp/' + str(path), 'Unexpected publication URL')
        raw = (records / path).read_bytes()
        require(len(raw) == f['bytes'], 'Byte count mismatch: ' + str(path))
        blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        require(blob == f['git_blob_sha1'], 'Git blob mismatch: ' + str(path))
        text = raw.decode('utf-8-sig')
        require(not re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,}', text), 'Credential-like content')
        documents[str(path)] = json.loads(text) if path.suffix == '.json' else list(csv.DictReader(io.StringIO(text)))
    quality = 'analysis/akita-website-quality/'
    local = documents[quality + 'findings.json']
    national = documents[quality + 'national.json']
    require(local['scope']['whole_site_complete'] is False, 'Do not imply whole-site completion')
    prefectures = national['prefectures']
    require(sorted(p['code'] for p in prefectures) == [f'{n:02d}' for n in range(1, 48)], 'Expected 47 distinct prefectures')
    for p in prefectures:
        progress = p['progress']
        require(progress['whole_site_complete'] is False and progress['semantic_review_complete'] is False, 'Completion claim requires separate review')
        require(progress['pdf_deferred'] <= progress['pending_documents'], 'PDF pending count mismatch')
        for key, value in progress.items():
            if type(value) is int:
                require(value >= 0, 'Negative progress count')
        require(p['published_records'] == sum(f['prefecture_code'] == p['code'] for f in national['findings']), 'Finding count mismatch')
    for stem, data in [('findings', local), ('national', national)]:
        rows = documents[quality + stem + '.csv']
        require(len(rows) == len(data['findings']), 'Finding CSV count mismatch')
        require({r['記録ID'] for r in rows} == {f['id'] for f in data['findings']}, 'Finding CSV IDs mismatch')
    route = 'analysis/municipal-machine-readability/'
    scores = documents[route + 'all-scores.json']
    rows = documents[route + 'all-scores.csv']
    require(len(rows) == len(scores['files']) == scores['published_score_files'], 'Score count mismatch')
    index = {r['source_id']: r for r in rows}
    require(len(index) == len(rows), 'Duplicate score source')
    require(len({r['source_id'] for r in scores['files']}) == len(rows), 'Duplicate JSON score source')
    for f in scores['files']:
        r = index[f['source_id']]
        for level in ('1', '2', '3'):
            value = f['scores'][level]
            require(type(value) in (int, float) and 0 <= value <= 100, 'Invalid score')
            require(float(r['L' + level]) == value, 'CSV/JSON score mismatch')
        require(r['original_sha256'] == f['original_sha256'], 'Original hash mismatch')
    for path, rows in documents.items():
        if path.startswith('analysis/akita-public-excel-review/'):
            require(bool(rows), 'Empty inspection summary')
            for row in rows:
                total = int(row.get('原本数', row.get('分母（原本）')))
                require(total >= 0, 'Negative denominator')
                for key in ('情報あり', '要確認', '問題あり', '検査未完了', '情報あり（件）', '要確認（件）', '問題あり（件）', '検査未完了（件）'):
                    if key in row:
                        require(0 <= int(row[key]) <= total, 'Inspection count exceeds denominator')
    return {'files': len(paths), 'prefectures': len(prefectures), 'scores': len(scores['files']), 'status': 'passed'}


if __name__ == '__main__':
    print(json.dumps(verify(), ensure_ascii=False))
