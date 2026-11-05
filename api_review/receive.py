"""Decrypt a downloaded public checkpoint into a private local output file only."""
import argparse
import base64
import json
import os
from pathlib import Path

from worker import raw, unseal


def receive(state, key):
    if state.get('schema_version') != 1 or not isinstance(state.get('requests'), dict):
        raise ValueError()
    result = {}
    for identity, record in state['requests'].items():
        if record['payload_sha256'] != identity:
            raise ValueError()
        if 'report' not in record:
            continue  # Unconfirmed send remains reserved; never resend.
        report = unseal(record['report'], key, identity)
        if (report['status'] != record['status'] or report['usage'] != record['usage']
                or report['source_keys'] != record['source_keys'] or report['payload_sha256'] != identity):
            raise ValueError()
        result[identity] = {**report, 'usage': record['usage'], 'source_keys': record['source_keys']}
    return {'schema_version': 1, 'requests': result, 'publication_approved': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.checkpoint.stat().st_size > 2_000_000:
            raise ValueError()
        result = receive(json.loads(args.checkpoint.read_text()),
                         base64.b64decode(os.environ['API_RESULT_KEY'], validate=True))
        # Refuse existing paths and symlinks. Caller must use a private directory.
        fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw(result))
        print(json.dumps({'status': 'received', 'requests': len(result['requests'])}))
        return 0
    except Exception:
        print('{"status":"stopped","reason":"private_receive_failed"}')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
