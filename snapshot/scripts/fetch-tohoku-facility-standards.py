#!/usr/bin/env python3
"""Archive and normalize Tohoku Regional Bureau facility-standard item 7.

The official six-prefecture workbook is retained unchanged.  A normalized snapshot
and a machine-readable diff from the preceding snapshot are generated alongside it.
No historical month is inferred when the official page still points to an older file.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import shutil
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

INDEX_URL = (
    "https://kouseikyoku.mhlw.go.jp/tohoku/gyomu/gyomu/"
    "hoken_kikan/documents/201805koushin.html"
)
LINK_RE = re.compile(
    r'href=["\']([^"\']*koumoku07-touhoku-ika-r(\d{2})(\d{2})\.xlsx(?:\?[^"\']*)?)["\']',
    re.IGNORECASE,
)
HEADERS = [
    "item_no", "prefecture_code", "prefecture", "accepted_name",
    "institution_number", "co_located_number", "symbol_number",
    "institution_name", "postal_code", "address", "phone", "fax",
    "licensed_beds_text", "acceptance_symbol", "acceptance_number",
    "billing_start_date", "individual_start_date", "remark_heading",
    "remark_value",
]


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "municipal-smr.jp official-data-archiver/1.0"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def clean(value) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).replace("\u3000", " ")).strip()


def snapshot_from_reiwa(year: str, month: str) -> str:
    western = 2018 + int(year)
    numeric_month = int(month)
    if not 1 <= numeric_month <= 12:
        raise ValueError(f"invalid month in official filename: {month}")
    return f"{western:04d}-{numeric_month:02d}"


def discover(index_html: bytes) -> tuple[str, str]:
    document = html.unescape(index_html.decode("utf-8", errors="replace"))
    matches = LINK_RE.findall(document)
    if not matches:
        raise RuntimeError("item 7 six-prefecture workbook link was not found")
    href, reiwa_year, month = matches[-1]
    return urllib.parse.urljoin(INDEX_URL, href), snapshot_from_reiwa(reiwa_year, month)


def normalize(workbook_path: Path, snapshot: str, source_url: str, sha256: str) -> dict:
    workbook = openpyxl.load_workbook(workbook_path, read_only=True, data_only=True)
    grouped: dict[tuple[str, ...], dict] = {}
    for sheet in workbook.worksheets:
        rows = sheet.iter_rows(values_only=True)
        for row in rows:
            values = [clean(row[i]) if i < len(row) else "" for i in range(len(HEADERS))]
            if values[:4] == ["項番", "都道府県コード", "都道府県名", "受理届出名称"]:
                continue
            if not values[1].isdigit() or not values[4] or not values[7]:
                continue
            record = dict(zip(HEADERS, values))
            key = (
                record["prefecture_code"],
                record["institution_number"],
                record["acceptance_symbol"],
                record["acceptance_number"],
            )
            if key not in grouped:
                grouped[key] = {
                    field: record[field]
                    for field in HEADERS
                    if field not in {"item_no", "phone", "fax", "remark_heading", "remark_value"}
                }
                grouped[key]["remarks"] = []
            heading = record["remark_heading"]
            value = record["remark_value"]
            remark = f"{heading}{value}".strip()
            if remark and remark not in grouped[key]["remarks"]:
                grouped[key]["remarks"].append(remark)
    records = sorted(
        grouped.values(),
        key=lambda row: (
            row["prefecture_code"], row["institution_number"],
            row["acceptance_symbol"], row["acceptance_number"],
        ),
    )
    return {
        "schemaVersion": 1,
        "source": "東北厚生局 施設基準の届出受理医療機関名簿（届出項目7・6県分Excel）",
        "sourceUrl": source_url,
        "snapshot": snapshot,
        "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sha256": sha256,
        "recordCount": len(records),
        "records": records,
    }


def record_key(record: dict) -> str:
    return "|".join(
        record.get(field, "")
        for field in ("prefecture_code", "institution_number", "acceptance_symbol", "acceptance_number")
    )


def build_diff(previous: dict | None, current: dict) -> dict:
    before = {record_key(row): row for row in (previous or {}).get("records", [])}
    after = {record_key(row): row for row in current["records"]}
    added = [after[key] for key in sorted(after.keys() - before.keys())]
    removed = [before[key] for key in sorted(before.keys() - after.keys())]
    changed = []
    for key in sorted(before.keys() & after.keys()):
        fields = sorted(
            field for field in set(before[key]) | set(after[key])
            if before[key].get(field) != after[key].get(field)
        )
        if fields:
            changed.append({
                "key": key,
                "institutionName": after[key].get("institution_name", ""),
                "changedFields": fields,
                "before": before[key],
                "after": after[key],
            })
    return {
        "schemaVersion": 1,
        "from": previous.get("snapshot") if previous else None,
        "to": current["snapshot"],
        "addedCount": len(added),
        "removedCount": len(removed),
        "changedCount": len(changed),
        "added": added,
        "removed": removed,
        "changed": changed,
        "warning": (
            "追加・削除は届出の新設・廃止を直ちに意味しない。"
            "名称変更、受理番号変更、改定時の再届出を含み得る。"
        ),
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-root",
        default="data/tohoku-facility-standards",
        help="archive root",
    )
    parser.add_argument("--workbook", help="use a local workbook for validation")
    parser.add_argument("--source-url", help="official URL for --workbook")
    parser.add_argument("--snapshot", help="YYYY-MM for --workbook")
    args = parser.parse_args()

    root = Path(args.output_root)
    if args.workbook:
        if not args.snapshot:
            parser.error("--snapshot is required with --workbook")
        source_url = args.source_url or "local-validation"
        snapshot = args.snapshot
        workbook_bytes = Path(args.workbook).read_bytes()
    else:
        source_url, snapshot = discover(fetch(INDEX_URL))
        workbook_bytes = fetch(source_url)

    digest = hashlib.sha256(workbook_bytes).hexdigest()
    index_path = root / "index.json"
    if index_path.exists():
        existing_index = json.loads(index_path.read_text(encoding="utf-8"))
        existing_entry = next(
            (row for row in existing_index.get("snapshots", []) if row["snapshot"] == snapshot),
            None,
        )
        if existing_entry and existing_entry.get("sha256") == digest:
            print(json.dumps({**existing_entry, "unchanged": True}, ensure_ascii=False))
            return 0

    raw_path = root / "raw" / snapshot / Path(urllib.parse.urlparse(source_url).path).name
    if not raw_path.name:
        raw_path = root / "raw" / snapshot / "item7-six-prefectures.xlsx"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_bytes(workbook_bytes)

    current = normalize(raw_path, snapshot, source_url, digest)
    normalized_path = root / "normalized" / f"{snapshot}.json"
    write_json(normalized_path, current)

    existing = sorted((root / "normalized").glob("*.json"))
    previous_path = next((path for path in reversed(existing) if path.stem < snapshot), None)
    previous = json.loads(previous_path.read_text(encoding="utf-8")) if previous_path else None
    write_json(root / "diff" / f"{snapshot}.json", build_diff(previous, current))

    index = {"schemaVersion": 1, "snapshots": []}
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding="utf-8"))
    entry = {
        "snapshot": snapshot,
        "sourceUrl": source_url,
        "retrievedAt": current["retrievedAt"],
        "sha256": digest,
        "recordCount": current["recordCount"],
        "raw": str(raw_path.relative_to(root)),
        "normalized": str(normalized_path.relative_to(root)),
        "diff": str((root / "diff" / f"{snapshot}.json").relative_to(root)),
    }
    entries = {row["snapshot"]: row for row in index.get("snapshots", [])}
    entries[snapshot] = entry
    index["snapshots"] = [entries[key] for key in sorted(entries)]
    write_json(index_path, index)
    shutil.copyfile(normalized_path, root / "latest.json")

    print(json.dumps(entry, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
