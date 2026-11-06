"""Offline refill from reviewed public excerpts. Never reads private data or downloads."""
import hashlib
import re
import worker as w


def approved(row):
    """Approval binds exact bytes, source and exclusive ownership, not a URL pattern."""
    try:
        if set(row) != {'bundle', 'approval'}:
            return False
        bundle, approval = row['bundle'], row['approval']
        w.payload(bundle)
        if set(approval) != {'bundle_sha256', 'review_commit', 'documents', 'exclusive_public_ownership'}:
            return False
        ownership = approval['exclusive_public_ownership']
        if (approval['bundle_sha256'] != w.digest(bundle)
                or not re.fullmatch('[a-f0-9]{40}', approval['review_commit'])
                or set(ownership) != {'private_state_commit', 'reserved', 'no_prior_attempt'}
                or not re.fullmatch('[a-f0-9]{40}', ownership['private_state_commit'])
                or ownership['reserved'] is not True or ownership['no_prior_attempt'] is not True):
            return False
        records = approval['documents']
        if len(records) != len(bundle['documents']):
            return False
        for doc, proof in zip(bundle['documents'], records):
            if set(proof) != {'id', 'source_url', 'original_url', 'source_sha256', 'text_sha256',
                    'terms_url', 'license', 'checked_at_jst', 'public_scope',
                    'visible_only', 'no_personal_information', 'redistribution_approved'}:
                return False
            if (proof['id'] != doc['id'] or proof['source_url'] != doc['url']
                    or proof['source_sha256'] != doc['source_sha256']
                    or proof['text_sha256'] != hashlib.sha256(doc['text'].encode()).hexdigest()
                    or any(proof[k] is not True for k in ('visible_only', 'no_personal_information', 'redistribution_approved'))
                    or any(not isinstance(proof[k], str) or not proof[k].strip()
                           for k in ('license', 'checked_at_jst', 'public_scope'))
                    or any(not proof[k].startswith('https://') for k in ('original_url', 'terms_url'))):
                return False
        return True
    except (w.Stop, KeyError, TypeError, ValueError, AttributeError):
        return False


def refill(queue, catalog):
    if (set(catalog) != {'schema_version', 'candidates'} or catalog['schema_version'] != 1
            or not isinstance(catalog['candidates'], list) or len(catalog['candidates']) > 1000):
        raise w.Stop()
    if set(queue) != {'schema_version', 'entries'} or queue['schema_version'] != 1:
        raise w.Stop()
    entries = list(queue['entries'])
    sources, ids = set(), set()
    for bundle in entries:
        w.payload(bundle)
        ids.add(bundle['id'])
        sources.update(d['source_sha256'] for d in bundle['documents'])
    waiting = duplicates = added = 0
    for row in catalog['candidates']:
        if not approved(row):
            waiting += 1
            continue
        bundle = row['bundle']
        hashes = [d['source_sha256'] for d in bundle['documents']]
        if bundle['id'] in ids or sources.intersection(hashes) or len(set(hashes)) != len(hashes):
            duplicates += 1
            continue
        if len(entries) >= 1000:
            waiting += 1
            continue
        entries.append(bundle)
        ids.add(bundle['id'])
        sources.update(hashes)
        added += 1
    return {'schema_version': 1, 'entries': entries}, {
        'supply_added': added, 'supply_confirmation_required': waiting, 'supply_duplicates': duplicates}
