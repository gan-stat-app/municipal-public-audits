#!/usr/bin/env python3
"""Build a sharded nationwide facility-standard notification index."""

from __future__ import annotations

import argparse
import gzip
import json
import unicodedata
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--normalized-root", type=Path, default=Path("data/facility-standards/normalized"))
    parser.add_argument("--facility-index", type=Path, default=Path("data/facility-standards/facility-index.json.gz"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/facility-standards/notification-index"))
    parser.add_argument("--names-per-shard", type=int, default=50)
    return parser.parse_args()


def read_gzip_json(path: Path) -> dict:
    return json.loads(gzip.decompress(path.read_bytes()))


def normalize(value: str) -> str:
    return "".join(unicodedata.normalize("NFKC", value).lower().split())


def write_gzip_json(path: Path, payload: dict) -> int:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    compressed = gzip.compress(raw, compresslevel=9, mtime=0)
    path.write_bytes(compressed)
    return len(compressed)


def main() -> None:
    args = parse_args()
    if args.names_per_shard < 1:
        raise ValueError("names-per-shard must be positive")

    facility_index = read_gzip_json(args.facility_index)
    categories = facility_index["categories"]
    facility_ids = {}
    for facility_id, row in enumerate(facility_index["facilities"]):
        prefecture_code, category_index, institution_number = row[:3]
        bureau = facility_index["prefectureBureaus"][prefecture_code]
        facility_ids[(bureau, prefecture_code, categories[category_index], institution_number)] = facility_id

    pairs: dict[tuple[str, str], set[int]] = {}
    for index_path in sorted(args.normalized_root.glob("*/index.json")):
        index = json.loads(index_path.read_text(encoding="utf-8"))
        bureau = index["bureau"]
        for partition in index["partitions"]:
            payload = read_gzip_json(index_path.parent / partition["path"])
            if payload["recordCount"] != len(payload["records"]):
                raise ValueError(f"record count mismatch: {partition['path']}")
            for record in payload["records"]:
                name = (record.get("accepted_name") or "").strip()
                symbol = (record.get("acceptance_symbol") or "").strip()
                if not name and not symbol:
                    continue
                facility_key = (
                    bureau,
                    record["prefecture_code"],
                    record["category"],
                    record["institution_number"],
                )
                try:
                    facility_id = facility_ids[facility_key]
                except KeyError as error:
                    raise ValueError(f"facility is missing from nationwide index: {facility_key}") from error
                pairs.setdefault((name, symbol), set()).add(facility_id)

    entries = sorted(pairs, key=lambda item: (normalize(item[0]), normalize(item[1]), item))
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for old in args.output_dir.glob("notification-postings-*.json.gz"):
        old.unlink()

    catalog = []
    postings_bytes = 0
    max_shard_bytes = 0
    for start in range(0, len(entries), args.names_per_shard):
        shard = start // args.names_per_shard
        chunk = entries[start:start + args.names_per_shard]
        postings = []
        for offset, key in enumerate(chunk):
            name_id = start + offset
            facility_list = sorted(pairs[key])
            postings.append([name_id, facility_list])
            catalog.append([key[0], key[1], shard, len(facility_list)])
        size = write_gzip_json(
            args.output_dir / f"notification-postings-{shard:03d}.json.gz",
            {"schemaVersion": 1, "start": start, "postings": postings},
        )
        postings_bytes += size
        max_shard_bytes = max(max_shard_bytes, size)

    generated_at = datetime.now(timezone.utc).isoformat()
    catalog_bytes = write_gzip_json(
        args.output_dir / "notification-catalog.json.gz",
        {
            "schemaVersion": 1,
            "generatedAt": generated_at,
            "recordCount": len(catalog),
            "facilityCount": len(facility_index["facilities"]),
            "columns": ["name", "symbol", "shard", "facility_count"],
            "items": catalog,
        },
    )
    meta = {
        "schemaVersion": 1,
        "generatedAt": generated_at,
        "recordCount": len(catalog),
        "facilityCount": len(facility_index["facilities"]),
        "shardCount": (len(catalog) + args.names_per_shard - 1) // args.names_per_shard,
        "catalogCompressedBytes": catalog_bytes,
        "postingsCompressedBytes": postings_bytes,
        "maxShardCompressedBytes": max_shard_bytes,
    }
    (args.output_dir / "notification-index-meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {len(catalog):,} notification names in {meta['shardCount']} shards "
        f"({catalog_bytes + postings_bytes:,} compressed bytes)"
    )


if __name__ == "__main__":
    main()
