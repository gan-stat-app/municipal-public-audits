"""Bounded public inputs and non-sensitive receipts for independent public jobs."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'snapshot'
MANIFEST = ROOT / 'workloads/inputs.json'


def blob(raw):
    return hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def safe_path(root, relative):
    path = Path(relative)
    if path.is_absolute() or '..' in path.parts or not path.parts:
        raise ValueError('Unsafe input/output path')
    result = root / path
    if not result.resolve().is_relative_to(root.resolve()):
        raise ValueError('Path leaves its designated directory')
    return result


def public_url(url):
    value = urllib.parse.urlsplit(url)
    host = value.hostname or ''
    allowed = (host == 'municipal-smr.jp' or host.endswith(('.lg.jp', '.go.jp'))
               or host in {'codeload.github.com', 'raw.githubusercontent.com', 'github.com'})
    if (value.scheme != 'https' or not allowed or value.username or value.password
            or value.port not in (None, 443)):
        raise ValueError('Only approved public HTTPS sources are allowed')
    return url


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, url):
        public_url(url)
        return super().redirect_request(request, fp, code, message, headers, url)


def download(url, limit=32*1024*1024):
    public_url(url)
    opener = urllib.request.build_opener(Redirects())
    error = None
    for attempt in range(2):
        try:
            request = urllib.request.Request(url, headers={
                'User-Agent': 'municipal-smr.jp public reproducibility CI/1.0',
                'Accept-Encoding': 'identity'})
            with opener.open(request, timeout=45) as response:
                raw = response.read(limit + 1)
            if not raw or len(raw) > limit:
                raise ValueError('Empty or oversized public response')
            return raw
        except Exception as exc:
            error = exc
            if attempt == 0:
                time.sleep(1)
    raise RuntimeError(type(error).__name__ + ': public source unavailable') from None


def manifest():
    return json.loads(MANIFEST.read_bytes())


def checked_public(item):
    raw = download('https://municipal-smr.jp/' + urllib.parse.quote(item['path'], safe='/'),
                   max(item.get('size', item.get('bytes', 0)) + 1, 32*1024*1024))
    if blob(raw) != item['sha']:
        raise ValueError('Public input differs from the reviewed Git blob: ' + item['path'])
    return raw


def code_check():
    data = manifest()
    for item in data['code']:
        if blob(safe_path(SNAPSHOT, item['path']).read_bytes()) != item['sha']:
            raise ValueError('Reviewed code snapshot changed: ' + item['path'])
    return data


def receipt(name, payload):
    data = {'schema_version': 1, 'source_commit': manifest()['source_commit'],
            'inputs_sha256': sha(MANIFEST.read_bytes()), **payload}
    path = ROOT / 'reports' / (name + '.json')
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + '\n')
    print(json.dumps({k: v for k, v in data.items() if k not in {'files', 'rows', 'commands'}},
                     ensure_ascii=False))
    return path
