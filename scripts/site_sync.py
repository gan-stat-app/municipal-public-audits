"""Check a successful immutable public revision against both site mirrors.

Read-only: this gate never writes site files, creates commits or launches CI.
Changed results must go through the site's existing generator/review pipeline.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request

REPO = 'gan-stat-app/municipal-public-audits'
REPO_ID = 1438179149
SITE = 'gan-stat-app/municipal-smr-site'
WORKFLOW = '.github/workflows/verify-public-records.yml'
ALLOWLIST = {
    'analysis/akita-website-quality/findings.csv',
    'analysis/akita-website-quality/findings.json',
    'analysis/akita-website-quality/national.csv',
    'analysis/akita-website-quality/national.json',
    'analysis/akita-public-excel-review/inspection.csv',
    'analysis/akita-public-excel-review/office-inspection.csv',
    'analysis/akita-public-excel-review/expansion-20261027.csv',
    'analysis/municipal-machine-readability/all-scores.csv',
    'analysis/municipal-machine-readability/all-scores.json',
    'analysis/municipal-machine-readability/progress.json',
}
LIMIT = 2_000_000


def require(ok, message):
    if not ok:
        raise ValueError(message)


def api(endpoint):
    # No site/private token is sent to the public repository.
    url = f'https://api.github.com/repos/{REPO}/{endpoint}'
    request = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'municipal-public-audits-sync',
        'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(request, timeout=20) as response:
        require(response.geturl().startswith(f'https://api.github.com/repos/{REPO}/'), 'Unexpected API redirect')
        raw = response.read(LIMIT + 1)
    require(len(raw) <= LIMIT, 'API response too large')
    return json.loads(raw)


def content(path, commit, fetch):
    item = fetch(f'contents/{path}?ref={commit}')
    require(item.get('type') == 'file' and item.get('encoding') == 'base64', 'Not an ordinary text file')
    raw = base64.b64decode(''.join(item['content'].split()), validate=True)
    require(len(raw) <= LIMIT, 'Record too large')
    return raw


def check(site_root, commit, run_id, fetch=api):
    require(re.fullmatch('[0-9a-f]{40}', commit), 'Use a full immutable commit SHA')
    require(type(run_id) is int and run_id > 0, 'Invalid run ID')
    run = fetch(f'actions/runs/{run_id}')
    expected = {'id': run_id, 'head_sha': commit, 'head_branch': 'main', 'event': 'push',
                'status': 'completed', 'conclusion': 'success', 'path': WORKFLOW}
    require(all(run.get(k) == v for k, v in expected.items()), 'Not a successful main push for this exact revision')
    require(run.get('repository', {}).get('id') == REPO_ID and run['repository'].get('full_name') == REPO, 'Wrong run repository')
    require(run.get('head_repository', {}).get('id') == REPO_ID, 'Unexpected head repository')
    attempt = run.get('run_attempt')
    require(type(attempt) is int and attempt >= 1, 'Missing run attempt')
    jobs = fetch(f'actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100')
    require(jobs.get('total_count') == 1 and len(jobs.get('jobs', [])) == 1, 'Unexpected job coverage')
    job = jobs['jobs'][0]
    require(job.get('name') == 'verify' and job.get('status') == 'completed' and job.get('conclusion') == 'success', 'Verification did not pass')
    manifest = json.loads(content('manifest.json', commit, fetch))
    require(manifest.get('schema_version') == 1 and manifest.get('source_repository') == SITE, 'Wrong source manifest')
    entries = manifest.get('files', [])
    require(len(entries) == len(ALLOWLIST) and {f['path'] for f in entries} == ALLOWLIST, 'Unreviewed or missing paths')
    root = Path(site_root).resolve()
    differences = []
    for item in entries:
        path = item['path']
        require(item.get('source_url') == 'https://municipal-smr.jp/' + path, 'Unexpected publication route')
        raw = content('records/' + path, commit, fetch)
        require(len(raw) == item['bytes'], 'Size mismatch')
        digest = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        require(digest == item['git_blob_sha1'], 'Git blob mismatch')
        for relative in (path, 'source/public/' + path):
            target = root / relative
            require(target.resolve().is_relative_to(root), 'Site symlink escapes checkout')
            require(not any(p.is_symlink() for p in [target, *target.parents] if p != root and root in p.parents), 'Site symlink is not allowed')
            if not target.is_file() or target.read_bytes() != raw:
                differences.append(relative)
    return {'status': 'unchanged' if not differences else 'review_required',
            'public_commit': commit, 'public_run_id': run_id, 'records': len(entries),
            'compared_mirrors': len(entries) * 2, 'differences': sorted(differences),
            'automatic_publication': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site-root', required=True, type=Path)
    parser.add_argument('--public-commit', required=True)
    parser.add_argument('--run-id', required=True, type=int)
    args = parser.parse_args()
    origin = subprocess.check_output(['git', '-C', str(args.site_root), 'remote', 'get-url', 'origin'], text=True).strip()
    require(origin.removesuffix('.git') in (f'https://github.com/{SITE}', f'git@github.com:{SITE}'), 'Wrong site checkout')
    result = check(args.site_root, args.public_commit, args.run_id)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['status'] == 'unchanged' else 2


if __name__ == '__main__':
    raise SystemExit(main())
