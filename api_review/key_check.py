"""One-shot credential probe. No document queue, retries, or plaintext logging."""
import base64
import json
import os
import urllib.error
from worker import REPO, Store, digest, fetch, seal

PROBE = {'model': 'gpt-6-luna', 'store': False, 'max_output_tokens': 16,
         'input': 'Reply only with OK.'}
IDENTITY = digest({'purpose': 'credential-probe-20261105', 'request': PROBE})
CODES = {'invalid_api_key', 'insufficient_quota', 'rate_limit_exceeded',
         'model_not_found', 'permission_denied', 'invalid_request_error'}

def probe(store, api_key, result_key, sender=fetch):
    state = store.read()
    if IDENTITY in state['requests']:
        print(json.dumps({'status': 'already_attempted', 'previous_status':
                          state['requests'][IDENTITY]['status']}))
        return 2
    record = {'status': 'reserved_or_interrupted', 'usage': {}}
    state['requests'][IDENTITY] = record
    store.write(state)
    try:
        data = sender('https://api.openai.com/v1/responses', PROBE, api_key, limit=262144)
        if not isinstance(data, dict) or not isinstance(data.get('id'), str):
            record['status'] = 'unexpected_response'
        else:
            record['status'] = 'api_accepted'
            record['usage'] = {k: v for k, v in (data.get('usage') or {}).items()
                               if k in ('input_tokens', 'output_tokens', 'total_tokens')
                               and type(v) is int and v >= 0}
    except urllib.error.HTTPError as exc:
        record.update(status='api_rejected', http_status=exc.code)
        try:
            error = json.loads(exc.read(16384)).get('error', {})
            code = error.get('code') or error.get('type')
            record['diagnostic'] = code if code in CODES else 'other_api_error'
        except Exception:
            record['diagnostic'] = 'unclassified_api_error'
    except Exception:
        record['status'] = 'transport_failed_or_unknown'
    # Check encryption without exposing the key, ciphertext, or model output.
    record['encryption_ready'] = bool(seal({'probe': True}, result_key, IDENTITY))
    store.write(state)
    print(json.dumps(record))
    return 0 if record['status'] == 'api_accepted' else 2

def main():
    try:
        if (os.environ.get('GITHUB_REPOSITORY') != REPO
            or os.environ.get('GITHUB_REF') != 'refs/heads/main'
            or os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch'):
            return 2
        key = os.environ['OPENAI_API_KEY']
        result_key = base64.b64decode(os.environ['API_RESULT_KEY'], validate=True)
        if not key.startswith('sk-') or len(result_key) != 32:
            print('{"status":"configuration_invalid"}')
            return 2
        store = Store(os.environ['GH_TOKEN'])
        store.url = 'https://api.github.com/repos/' + REPO + '/contents/api-runtime/key-check.json'
        return probe(store, key, result_key)
    except Exception:
        print('{"status":"configuration_or_checkpoint_unavailable"}')
        return 2

if __name__ == '__main__':
    raise SystemExit(main())
