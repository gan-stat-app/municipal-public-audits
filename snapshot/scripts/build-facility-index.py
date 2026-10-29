#!/usr/bin/env python3
"""Build a compact nationwide facility-name index from normalized partitions."""

from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--normalized-root",
        type=Path,
        default=Path("data/facility-standards/normalized"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/facility-standards/facility-index.json.gz"),
    )
    parser.add_argument(
        "--meta-output",
        type=Path,
        default=Path("data/facility-standards/facility-index-meta.json"),
    )
    return parser.parse_args()


def read_gzip_json(path: Path) -> dict:
    return json.loads(gzip.decompress(path.read_bytes()))


def main() -> None:
    args = parse_args()
    facilities: dict[tuple[str, str, str, str], dict] = {}
    snapshots: dict[str, str] = {}
    prefectures: dict[str, str] = {}
    prefecture_bureaus: dict[str, str] = {}

    for index_path in sorted(args.normalized_root.glob("*/index.json")):
        index = json.loads(index_path.read_text(encoding="utf-8"))
        bureau = index["bureau"]
        snapshots[bureau] = index["snapshot"]
        for partition in index["partitions"]:
            payload = read_gzip_json(index_path.parent / partition["path"])
            if payload["recordCount"] != len(payload["records"]):
                raise ValueError(f"record count mismatch: {partition['path']}")
            for record in payload["records"]:
                prefectures[record["prefecture_code"]] = record["prefecture"]
                prefecture_bureaus[record["prefecture_code"]] = bureau
                key = (
                    bureau,
                    record["prefecture_code"],
                    record["category"],
                    record["institution_number"],
                )
                facility = {
                    "bureau": bureau,
                    "snapshot": index["snapshot"],
                    "prefecture_code": record["prefecture_code"],
                    "prefecture": record["prefecture"],
                    "category": record["category"],
                    "institution_number": record["institution_number"],
                    "institution_name": record["institution_name"],
                    "address": record["address"],
                }
                previous = facilities.setdefault(key, facility)
                if previous != facility:
                    raise ValueError(f"conflicting facility metadata: {key}")

    ordered = sorted(
        facilities.values(),
        key=lambda item: (
            item["prefecture_code"],
            item["category"],
            item["institution_name"],
            item["institution_number"],
        ),
    )
    categories = ["医科", "歯科", "薬局"]
    compact = [
        [
            item["prefecture_code"],
            categories.index(item["category"]),
            item["institution_number"],
            item["institution_name"],
            item["address"],
        ]
        for item in ordered
    ]
    payload = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "recordCount": len(compact),
        "snapshots": snapshots,
        "prefectures": prefectures,
        "prefectureBureaus": prefecture_bureaus,
        "categories": categories,
        "columns": ["prefecture_code", "category_index", "institution_number",
                    "institution_name", "address"],
        "facilities": compact,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    compressed = gzip.compress(encoded, compresslevel=9, mtime=0)
    args.output.write_bytes(compressed)
    meta = {
        "schemaVersion": 2,
        "recordCount": len(compact),
        "compressedBytes": len(compressed),
        "generatedAt": payload["generatedAt"],
    }
    args.meta_output.write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {len(compact):,} facilities to {args.output} "
        f"({len(compressed):,} bytes)"
    )


if __name__ == "__main__":
    main()
