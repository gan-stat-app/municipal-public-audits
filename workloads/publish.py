"""Publish only reviewed public outputs so consumers need no cross-repo secret."""
from __future__ import annotations
import hashlib
import io
import json
import os
from pathlib import PurePosixPath
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPO = 'gan-stat-app/municipal-public-audits'
BASE = 'https://api.github.com/repos/' + REPO


def require(ok, message):
    if not ok:
        raise ValueError(message)


def request(path, payload=None):
    headers = {'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json',
               'Authorization': 'Bearer ' + os.environ['GH_TOKEN']}
    data = None if payload is None else json.dumps(payload).encode()
    with urllib.request.urlopen(urllib.request.Request(BASE + '/' + path, data=data, headers=headers), timeout=30) as response:
        raw = response.read(2*1024*1024+1)
    require(len(raw) <= 2*1024*1024, 'Oversized API response')
    return json.loads(raw)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def artifact_bytes(artifact):
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN']}
    try:
        response = urllib.request.build_opener(NoRedirect()).open(
            urllib.request.Request(BASE + '/actions/artifacts/' + str(artifact['id']) + '/zip', headers=headers), timeout=30)
    except urllib.error.HTTPError as error:
        require(error.code == 302, 'Artifact redirect unavailable')
        url = error.headers['Location']
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == 'https' and not parsed.username and not parsed.password
                and (parsed.hostname or '').endswith(('.blob.core.windows.net', '.githubusercontent.com', '.amazonaws.com')),
                'Unapproved artifact host')
        response = urllib.request.urlopen(url, timeout=60)
    with response:
        raw = response.read(256*1024*1024+1)
    require(len(raw) <= 256*1024*1024
            and artifact.get('digest') == 'sha256:' + hashlib.sha256(raw).hexdigest(), 'Artifact digest differs')
    return raw


def validate(raw, name):
    site = name == 'public-site-build'
    require(site or re.fullmatch(r'public-(?:collection|tohoku)-\d+', name), 'Unapproved artifact')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        items = archive.infolist()
        require(len(items) < 2000 and sum(x.file_size for x in items) <= 256*1024*1024, 'Oversized output')
        require(len({x.filename for x in items}) == len(items), 'Duplicate output')
        for item in items:
            path = PurePosixPath(item.filename)
            require(not item.is_dir() and (item.external_attr >> 16) & 0o170000 in (0, 0o100000), 'Non-regular output')
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in item.filename, 'Unsafe output path')
            allowed = (item.filename == 'reports/site.json' or
                       (item.filename.startswith('app-build/') and path.suffix in {'.json', '.html', '.js', '.css', '.svg', '.png', '.webp', '.woff', '.woff2'}) or
                       (item.filename.startswith(('snapshot/source/article-index-review/', 'snapshot/source/map-display-review/')) and path.suffix == '.png')) if site else (
                       item.filename in {'reports/facility.json', 'reports/food.json', 'reports/tohoku.json'} or
                       (item.filename.startswith(('collections/facility/', 'collections/food/', 'collections/tohoku/')) and item.filename.endswith('.json.gz')))
            require(allowed, 'Unreviewed file in public output')
        reports = [json.loads(archive.read(x.filename)) for x in items if x.filename.startswith('reports/')]
        require(reports and all(r.get('status') in ({'passed'} if site else {'passed', 'review_required'}) for r in reports),
                'Failed or missing public receipt')
        if site:
            validate_site_inventory(archive)



def validate_site_inventory(archive):
    """Check generated inventory; hashes prove identity, not confidentiality."""
    report = json.loads(archive.read('reports/site.json'))
    files = report.get('files', [])
    require(files and len({f['path'] for f in files}) == len(files), 'Missing or duplicate app inventory')
    expected = {'app-build/' + f['path'] for f in files}
    actual = {n for n in archive.namelist() if n.startswith('app-build/')}
    require(expected == actual, 'Undeclared or missing app output')
    for entry in files:
        raw = archive.read('app-build/' + entry['path'])
        require(len(raw) == entry['bytes'] and hashlib.sha256(raw).hexdigest() == entry['sha256'],
                'App output hash or size differs')
    emitted = json.loads(archive.read('app-build/.vite/manifest.json'))
    names = {'index.html', '.vite/manifest.json'}
    for value in emitted.values():
        names.add(value['file'])
        names.update(value.get('css', []))
        names.update(value.get('assets', []))
    require(names == {f['path'] for f in files}, 'App output differs from build manifest')
    screenshots = {
        'snapshot/source/article-index-review/' + width + '-' + mode + '.png'
        for width in ('1440', '320', '390') for mode in ('js', 'no-js')
    } | {
        'snapshot/source/map-display-review/' + topic + '-' + width + '.png'
        for topic in ('cancer-screening', 'dpc', 'facility') for width in ('1280', '390')
    }
    require(set(archive.namelist()) == expected | screenshots | {'reports/site.json'},
            'Unexpected or missing screenshot')
    for name in screenshots:
        require(archive.read(name).startswith(b'\x89PNG\r\n\x1a\n'), 'Invalid screenshot format')
    # This deliberately narrow signature check supplements human content review.
    credential = re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|'
                            r'github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]{20,}|'
                            r'sk-(?:proj-)?[A-Za-z0-9_-]{24,}')
    for name in expected | {'reports/site.json'}:
        if PurePosixPath(name).suffix in {'.json', '.html', '.js', '.css', '.svg'}:
            require(not credential.search(archive.read(name).decode('utf-8')), 'Credential-like output')


def main():
    require(os.environ.get('GITHUB_REPOSITORY') == REPO and os.environ.get('GITHUB_REF') == 'refs/heads/main'
            and os.environ.get('GITHUB_EVENT_NAME') in {'push', 'schedule', 'workflow_dispatch'}, 'Untrusted publisher context')
    run_id = int(os.environ['GITHUB_RUN_ID'])
    run = request('actions/runs/' + str(run_id))
    require(run['head_sha'] == os.environ['GITHUB_SHA'] and run['head_branch'] == 'main', 'Wrong source execution')
    artifacts = request(f'actions/runs/{run_id}/artifacts?per_page=100')
    require(artifacts['total_count'] == len(artifacts['artifacts']), 'Incomplete artifact inventory')
    names = {'public-site-build', 'public-collection-' + str(run_id), 'public-tohoku-' + str(run_id)}
    selected = [a for a in artifacts['artifacts'] if a['name'] in names and not a.get('expired')]
    require(len(selected) == 1, 'Ambiguous public output')
    artifact = selected[0]
    raw = artifact_bytes(artifact)
    validate(raw, artifact['name'])
    tag = 'ci-handoff-' + str(run_id)
    try:
        release = request('releases/tags/' + tag)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        release = request('releases', {'tag_name': tag, 'target_commitish': run['head_sha'],
            'name': 'Verified public outputs ' + str(run_id), 'prerelease': True, 'make_latest': 'false',
            'body': 'Public normalized data or app outputs only. Source run: ' + run['html_url']})
    require(release['target_commitish'] == run['head_sha'] and not release['draft'], 'Wrong public handoff release')
    name = str(artifact['id']) + '.zip'
    existing = [a for a in release['assets'] if a['name'] == name]
    if existing:
        require(len(existing) == 1 and existing[0].get('digest') == artifact['digest'], 'Changed release asset')
        print('Identical public handoff already exists')
        return
    url = f'https://uploads.github.com/repos/{REPO}/releases/{release["id"]}/assets?name={name}'
    headers = {'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'Content-Type': 'application/zip'}
    with urllib.request.urlopen(urllib.request.Request(url, data=raw, headers=headers), timeout=120) as response:
        asset = json.load(response)
    require(asset.get('digest') == artifact['digest'], 'Uploaded public handoff differs')
    print('Published hash-verified public handoff', tag, name)


if __name__ == '__main__':
    main()
