"""Archive an exact reviewed public data inventory directly to public Releases."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'workloads'))
from common import checked_public, blob

REPO = 'gan-stat-app/municipal-public-audits'
API = 'https://api.github.com/repos/' + REPO
ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / 'storage/public-data-inputs.json'
ROOTS = set('age-specific-mortality cancer-care care data dpc food-business food-poisoning life-expectancy lifestyle medical-cost mental-health ndb population regional-healthcare-vision school-dental smr-json welfare'.split())


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def validate(manifest):
    assert manifest['schema_version'] == 1
    assert manifest['source_repository'] == 'gan-stat-app/municipal-smr-site'
    assert re.fullmatch('[0-9a-f]{40}', manifest['source_commit'])
    assert manifest['origin'] == 'https://municipal-smr.jp'
    files = manifest['files']
    assert 0 < len(files) <= 10000 and len({f['path'] for f in files}) == len(files)
    for f in files:
        p = PurePosixPath(f['path'])
        assert not p.is_absolute() and '..' not in p.parts and '\\' not in f['path']
        assert p.parts[0] in ROOTS and not any(x.startswith('.') for x in p.parts)
        assert re.search(r'\.(json|json\.gz|csv|csv\.gz|geojson|geojson\.gz|part|sqlite\.gz)$', f['path'])
        assert re.fullmatch('[0-9a-f]{40}', f['git_blob'])
        assert type(f['bytes']) is int and 0 < f['bytes'] < 128 * 2**20
    return files


def api(path, payload=None, method=None):
    assert path.startswith('/') and '..' not in path
    req = urllib.request.Request(API + path, data=None if payload is None else json.dumps(payload).encode(),
        method=method, headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=45) as response:
        return json.load(response)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def read_file(path):
    return path.read_bytes()


def make_archives(manifest, directory, download=checked_public):
    files = validate(manifest)
    directory = Path(directory)
    def get(f):
        raw = download({'path': f['path'], 'sha': f['git_blob'], 'bytes': f['bytes']})
        assert len(raw) == f['bytes'] and blob(raw) == f['git_blob']
        dest = directory / 'files' / f['path']
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        return {**f, 'sha256': sha(raw)}
    checked = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for i, f in enumerate(pool.map(get, files), 1):
            checked.append(f)
            if i % 100 == 0 or i == len(files):
                print(json.dumps({'downloaded': i, 'total': len(files)}), flush=True)
    archives, members, size = [], [], 0
    def flush():
        nonlocal members, size
        name = f'data-{len(archives)+1:03d}.zip'
        with zipfile.ZipFile(directory / name, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for f in members:
                info = zipfile.ZipInfo('files/' + f['path'], (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                z.writestr(info, (directory / 'files' / f['path']).read_bytes(), compresslevel=6)
                f['archive'] = name
        raw = read_file(directory / name)
        archives.append({'name': name, 'bytes': len(raw), 'sha256': sha(raw)})
        members, size = [], 0
    for f in checked:
        if members and size + f['bytes'] > 128 * 2**20:
            flush()
        members.append(f)
        size += f['bytes']
    if members:
        flush()
    receipt = {'schema_version': 1, 'status': 'verified', 'source_commit': manifest['source_commit'],
               'source_repository': manifest['source_repository'], 'files': checked, 'archives': archives}
    (directory / 'manifest.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
    return receipt


def put(release, name, path):
    raw = read_file(path)
    existing = [a for a in api(f'/releases/{release["id"]}/assets?per_page=100') if a['name'] == name]
    if existing:
        assert len(existing) == 1 and existing[0].get('digest') == 'sha256:' + sha(raw)
        return existing[0]
    url = f'https://uploads.github.com/repos/{REPO}/releases/{release["id"]}/assets?name={name}'
    req = urllib.request.Request(url, data=raw, headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                                                      'Content-Type': 'application/octet-stream'})
    with urllib.request.build_opener(NoRedirect).open(req, timeout=180) as response:
        asset = json.load(response)
    assert asset['size'] == len(raw) and asset.get('digest') == 'sha256:' + sha(raw)
    return asset


def main():
    assert os.environ.get('GITHUB_REPOSITORY') == REPO
    assert os.environ.get('GITHUB_REF') == 'refs/heads/main'
    assert os.environ.get('GITHUB_EVENT_NAME') in ('push', 'workflow_dispatch')
    manifest_raw = INPUT.read_bytes()
    manifest = json.loads(manifest_raw)
    tag = 'public-data-' + sha(manifest_raw)[:16]
    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        receipt = make_archives(manifest, directory)
        try:
            release = api('/releases/tags/' + tag)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            release = api('/releases', {'tag_name': tag, 'target_commitish': os.environ['GITHUB_SHA'],
                'name': 'Published municipal data ' + manifest['source_commit'][:12],
                'draft': True, 'prerelease': True, 'make_latest': 'false',
                'body': 'Exact previously published data bytes, with per-file provenance and SHA-256. '
                        'Source: ' + manifest['source_repository'] + '@' + manifest['source_commit']})
        uploaded = []
        for a in receipt['archives']:
            uploaded.append(put(release, a['name'], directory / a['name']))
        uploaded.append(put(release, 'manifest.json', directory / 'manifest.json'))
        if release['draft']:
            release = api('/releases/' + str(release['id']), {'draft': False}, method='PATCH')
        # Re-read the public release and verify all content digests after publication.
        public = api('/releases/tags/' + tag)
        assert not public['draft']
        for a in uploaded:
            actual = next(x for x in public['assets'] if x['id'] == a['id'])
            assert actual['size'] == a['size'] and actual['digest'] == a['digest']
        report = {'release': public['html_url'], 'tag': tag, 'files': len(receipt['files']),
                  'data_bytes': sum(f['bytes'] for f in receipt['files']),
                  'archive_bytes': sum(a['bytes'] for a in receipt['archives']),
                  'manifest_sha256': sha(read_file(directory / 'manifest.json'))}
        print(json.dumps(report), flush=True)
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as out:
            out.write('## Public data archive\n\n' + json.dumps(report, indent=2) + '\n\n'
                      'No Actions artifacts were uploaded. No private repository credentials were used.\n')


if __name__ == '__main__':
    main()
