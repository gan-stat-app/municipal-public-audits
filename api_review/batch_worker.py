"""Submit approved work once, then exit. Poll once on the next scheduled run."""
from datetime import datetime
import json
import os
from pathlib import Path
import re
import urllib.request
from zoneinfo import ZoneInfo

import worker as w
from supply import refill

TERMINAL = {'completed', 'failed', 'expired', 'cancelled'}


def identifier(value, prefix):
    if not isinstance(value, str) or not re.fullmatch(prefix + r'[A-Za-z0-9_-]+', value):
        raise w.Stop()
    return value


class API:
    def __init__(self, key):
        self.key = key

    def request(self, path, body=None, *, content_type='application/json', text=False):
        req = urllib.request.Request('https://api.openai.com/v1/' + path, data=body,
            headers={'Authorization': 'Bearer ' + self.key, 'Content-Type': content_type})
        with urllib.request.build_opener(w.NoRedirect).open(req, timeout=45) as response:
            data = response.read(4_000_001)
        if len(data) > 4_000_000:
            raise w.Stop()
        return data.decode() if text else json.loads(data)

    def upload(self, lines):
        boundary = 'public-review-' + os.urandom(16).hex()
        data = (f'--{boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nbatch\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="requests.jsonl"\r\n'
                'Content-Type: application/jsonl\r\n\r\n').encode() + lines + f'\r\n--{boundary}--\r\n'.encode()
        return identifier(self.request('files', data, content_type='multipart/form-data; boundary=' + boundary)['id'], 'file[-_]')

    def submit(self, file_id):
        return identifier(self.request('batches', w.raw({'input_file_id': file_id,
            'endpoint': '/v1/responses', 'completion_window': '24h'}))['id'], 'batch_')

    def poll(self, batch_id):
        return self.request('batches/' + identifier(batch_id, 'batch_'))

    def results(self, file_id):
        return self.request('files/' + identifier(file_id, 'file[-_]') + '/content', text=True)


def tick(queue, store, api, *, max_requests=100):
    # Same identities and source keys as the synchronous executor: no duplicate path.
    if (set(queue) != {'schema_version', 'entries'} or queue['schema_version'] != 1
            or not isinstance(queue['entries'], list) or len(queue['entries']) > 1000
            or type(max_requests) is not int or not 1 <= max_requests <= 100):
        raise w.Stop()
    prepared, seen = {}, set()
    for bundle in queue['entries']:
        request = w.payload(bundle)
        identity = w.digest(request)
        keys = [w.digest({'model': w.MODEL, 'source': d['source_sha256'], 'text': d['text']})
                for d in bundle['documents']]
        if any(k in seen for k in keys):
            raise w.Stop()
        seen.update(keys)
        prepared[identity] = (bundle, request, keys)
    state = store.read()
    completed = held = submitted = 0
    triage_counts = {assessment: 0 for assessment in ('reject', 'hold', 'verify')}
    groups = {}
    for identity, record in state['requests'].items():
        if record.get('status') == 'batch_submitted':
            groups.setdefault(identifier(record.get('batch_id'), 'batch_'), []).append(identity)
    for batch_id, identities in groups.items():
        batch = api.poll(batch_id)
        if batch.get('id') != batch_id:
            raise w.Stop()
        if batch.get('status') not in TERMINAL:
            continue  # Never sleep or keep a runner waiting for provider computation.
        rows = {}
        for field in ('output_file_id', 'error_file_id'):
            if batch.get(field):
                for line in api.results(batch[field]).splitlines():
                    row = json.loads(line)
                    identity = row.get('custom_id')
                    if identity not in identities or identity in rows:
                        raise w.Stop()
                    rows[identity] = row
        for identity in identities:
            record = state['requests'][identity]
            # Prompt/schema changes alter payload hashes, but must not strand
            # already submitted work. Match the exact ordered approved sources.
            candidates = [entry[0] for entry in prepared.values()
                          if entry[2] == record['source_keys']]
            if len(candidates) != 1:
                continue  # Missing/ambiguous approval: retain pending result.
            bundle = candidates[0]
            row = rows.get(identity, {})
            response = row.get('response') or {}
            data = response.get('body') or {}
            usage = data.get('usage') or {}
            record['usage'] = {k: v for k, v in usage.items()
                if k in ('input_tokens', 'output_tokens', 'total_tokens') and type(v) is int and v >= 0}
            report = {'status': 'request_failed_or_unknown', 'items': []}
            if response.get('status_code') == 200:
                try:
                    report = {'status': 'completed', 'items': w.validate_response(data, bundle)}
                except (w.Stop, KeyError, TypeError, ValueError, AttributeError) as exc:
                    report['status'] = 'invalid_output'
                    record['diagnostic'] = w.output_diagnostic(exc)
            report.update(usage=record['usage'], source_keys=record['source_keys'],
                          payload_sha256=identity, date=record['date'])
            record.update(status=report['status'], report=w.public_report(report))
            for item in report['items']:
                triage_counts[item['assessment']] += 1
            completed += int(report['status'] == 'completed')
            held += int(report['status'] != 'completed')
        store.write(state)
    prior = {k for record in state['requests'].values() for k in record['source_keys']}
    selected = []
    for identity, (bundle, request, keys) in prepared.items():
        if identity in state['requests'] or any(k in prior for k in keys):
            continue
        selected.append((identity, request, keys))
        prior.update(keys)
        if len(selected) >= max_requests:
            break
    if selected:
        # A failed or ambiguous submission is held, never silently resubmitted.
        for identity, request, keys in selected:
            state['requests'][identity] = {'status': 'reserved_or_interrupted',
                'output_contract': 'triage-concise-v2',
                'max_output_tokens': request['max_output_tokens'],
                'source_keys': keys, 'payload_sha256': identity, 'usage': {},
                'date': datetime.now(ZoneInfo('Asia/Tokyo')).date().isoformat()}
        if len(w.raw(state)) > 1_600_000:
            raise w.Stop()
        store.write(state)  # CAS before file upload or model submission.
        lines = b'\n'.join(w.raw({'custom_id': i, 'method': 'POST', 'url': '/v1/responses', 'body': p})
                           for i, p, _ in selected) + b'\n'
        file_id = api.upload(lines)
        batch_id = api.submit(file_id)
        for identity, _, _ in selected:
            state['requests'][identity].update(status='batch_submitted', batch_id=batch_id,
                                               input_file_id=file_id)
        store.write(state)
        submitted = len(selected)
    return {'submitted': submitted, 'completed': completed, 'held': held,
            'triage_no_finding': triage_counts['reject'],
            'triage_needs_evidence': triage_counts['hold'],
            'triage_candidates': triage_counts['verify'],
            'in_flight': sum(r['status'] == 'batch_submitted' for r in state['requests'].values())}


def main():
    try:
        if (os.environ.get('GITHUB_REPOSITORY') != w.REPO
                or os.environ.get('GITHUB_REF') != 'refs/heads/main'
                or os.environ.get('GITHUB_EVENT_NAME') not in ('schedule', 'push')):
            raise w.Stop()
        key = os.environ['OPENAI_API_KEY']
        if not key.startswith('sk-'):
            raise w.Stop()
        queue = json.loads(Path('api_review/queue.json').read_text())
        catalog = json.loads(Path('api_review/supply.json').read_text())
        queue, supply_status = refill(queue, catalog)
        print(json.dumps({**tick(queue, w.Store(os.environ['GH_TOKEN']), API(key)), **supply_status}))
        return 0
    except Exception:
        print('{"status":"stopped","reason":"batch_configuration_transport_or_checkpoint"}')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
