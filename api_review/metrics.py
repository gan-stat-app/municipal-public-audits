"""Offline inventory and outcome comparison. No API calls or state writes."""
from collections import Counter
import json
from pathlib import Path
import sys

import worker as w
from supply import refill


def summarize(queue, catalog, state):
    queue, supply = refill(queue, catalog)
    records = state['requests']
    prior = {key for r in records.values() for key in r['source_keys']}
    cohorts = {}
    available = 0
    for bundle in queue['entries']:
        identity = w.digest(w.payload(bundle))
        keys = [w.digest({'model': w.MODEL, 'source': d['source_sha256'], 'text': d['text']})
                for d in bundle['documents']]
        if not any(k in prior for k in keys):
            available += 1
        # Exact payload identity proves the current contract even for old records
        # that predate explicit metadata. Source-key matching alone cannot.
        if identity in records:
            cohorts[identity] = 'triage-concise-v2'
        previous = w.payload(bundle)
        previous['instructions'] = w.TRIAGE_V1_INSTRUCTIONS
        previous_identity = w.digest(previous)
        if previous_identity in records:
            cohorts[previous_identity] = 'triage-v1'
    result = {'supply': {**supply, 'unattempted_requests': available}, 'cohorts': {}}
    for identity, record in records.items():
        cohort = cohorts.get(identity, record.get('output_contract', 'legacy_or_unknown'))
        group = result['cohorts'].setdefault(cohort, {
            'statuses': Counter(), 'diagnostics': Counter(), 'usage': Counter(),
            'assessments': Counter(), 'usage_observed_requests': 0})
        group['statuses'][record['status']] += 1
        if record.get('diagnostic'):
            group['diagnostics'][record['diagnostic']] += 1
        usage = record.get('usage', {})
        group['usage'].update(usage)
        group['usage_observed_requests'] += bool(usage)
        if record['status'] == 'completed':
            items = record.get('report', {}).get('body', {}).get('items', [])
            group['assessments'].update(i['assessment'] for i in items)
    for group in result['cohorts'].values():
        statuses = group['statuses']
        terminal = sum(n for s, n in statuses.items()
                       if s not in ('batch_submitted', 'reserved_or_interrupted'))
        completed = statuses.get('completed', 0)
        group['validation_success_rate'] = completed / terminal if terminal else None
        group['tokens_per_completed_request'] = (
            group['usage'].get('total_tokens', 0) / completed if completed else None)
        group['work_candidate_documents'] = group['assessments'].get('verify', 0)
        group['actual_work_reviews'] = None  # Requires separate human/Work review evidence.
    return result


if __name__ == '__main__':
    print(json.dumps(summarize(json.loads(Path('api_review/queue.json').read_text()),
        json.loads(Path('api_review/supply.json').read_text()),
        json.loads(Path(sys.argv[1]).read_text())), ensure_ascii=False, indent=2))
