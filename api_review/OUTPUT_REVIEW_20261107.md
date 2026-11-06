# Batch output review — 2026-11-07 JST

Scope: worker prompt → future payloads; Batch recovery → approved source matching; API-only tests. No queue, supply, ledger, model, token ceiling, evidence validator or publication gate changes. No live API requests or workflow dispatch.

## Evidence and limits

The public api-public-state ledger inspected at main commit 21c86c9 records:

| Request prefix | Input | Output | Total | Diagnostic |
| --- | ---: | ---: | ---: | --- |
| bc13d698 | 2855 | 1200 | 4055 | absent |
| d403a31f | 2856 | 1200 | 4056 | absent |
| d8eb53d5 | 2850 | 905 | 3755 | absent |

All three have invalid_output and empty result items. Ceiling: 1200 per request, with up to three documents, seven required fields per document, up to four 180-character quotes and four strings accepted up to 800 characters each. The schema enforces fields/types but not all validator constraints. Two requests reached the ceiling: truncation is plausible, not established. The 905-token request shows that raising the ceiling alone cannot be assumed to fix all failures. Original response status, incomplete reason and text are unavailable in this ledger; individual causes remain unknown.

PR #30 already added allowlisted diagnostic codes for incomplete output/token limit, JSON, identity, fields, text and evidence validation, without retaining raw responses. This change builds on that implementation.

## Changes

The previous prompt omitted the rule that hold/reject must have empty draft_title and draft_fact, although the validator rejects nonempty drafts. Explicitly state that rule. Request minimum necessary quotes, concise reasons, and a single shared article/X factual draft for verify rather than two drafts. Preserve all seven fields, the 1200-token ceiling, exact source evidence rules and false publication/fact approval flags. Actual token savings and failure reduction require future naturally scheduled results; fixed responses do not establish model behavior.

Prompt edits change payload hashes. Recover existing Batch results by matching exactly one current approved bundle with the same ordered source keys (model/source hash/excerpt). Keep original custom_id/report identity. Source history still blocks submission of held, completed and in-flight sources. Missing or ambiguous approval remains pending. This also handles future schema/prompt changes without resending the two pending requests.

## Validation

API-only unittest discovery: 47 tests passed. Includes fixed incomplete/token-limit responses, completed output at the ceiling, evidence mismatch/shape checks, compact three-document hold/reject output, changed-prompt in-flight/held deduplication and old Batch collection. No live API calls, retries, full generation or full CI. Old failures are not reclassified without evidence. Review future diagnostic codes and actual usage before considering any ceiling increase.

## Superseding policy: triage first

The user subsequently authorized triage-only API output. New requests omit both draft fields, bound rationale/next_check to 100 characters in validation, and preserve the token ceiling and evidence checks. Only validated verify items get a deterministic candidate from the source title, rationale and first exact quote; all evidence remains saved. There is no extra model call. Legacy seven-field responses are retained for in-flight compatibility. Batch collection reports no-finding/evidence-needed/candidate document counts so Work can skip no-finding text and focus on candidate review. The earlier combined article/X instruction above is superseded. API-only suite: 52 tests passed; no live requests or ledger changes.
