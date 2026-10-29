#!/usr/bin/env python3
"""Normalize all current Tokai-Hokuriku facility-standard workbooks."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

HEADERS = [
    "item_no", "prefecture_code", "prefecture", "category",
    "institution_number", "co_located_number", "symbol_number",
    "institution_name", "postal_code", "address", "phone", "fax",
    "licensed_beds_text", "accepted_name", "acceptance_symbol",
    "acceptance_number", "billing_start_date", "individual_start_date",
    "remark_heading", "remark_value",
]
CATEGORY_SLUG = {"医科": "medical", "歯科": "dental", "薬局": "pharmacy"}


def clean(value):
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).replace("\u3000", " ")).strip()


def workbook_records(content):
    workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    for sheet in workbook.worksheets:
        for row in sheet.iter_rows(values_only=True):
            values = [clean(row[i]) if i < len(row) else "" for i in range(len(HEADERS))]
            if values[:2] == ["項番", "都道府県コード"]:
                continue
            if not values[1].isdigit() or values[3] not in CATEGORY_SLUG:
                continue
            if not values[4] or not values[7] or not values[13]:
                continue
            yield dict(zip(HEADERS, values))


def normalize(zip_paths, snapshot):
    grouped = {}
    source_files = []
    for zip_path in zip_paths:
        archive_bytes = zip_path.read_bytes()
        source_files.append({
            "name": zip_path.name,
            "sha256": hashlib.sha256(archive_bytes).hexdigest(),
            "bytes": len(archive_bytes),
        })
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            for member in archive.namelist():
                if not member.lower().endswith(".xlsx"):
                    continue
                content = archive.read(member)
                for row in workbook_records(content):
                    key = (
                        row["prefecture_code"], row["category"],
                        row["institution_number"], row["accepted_name"],
                        row["acceptance_symbol"], row["acceptance_number"],
                    )
                    if key not in grouped:
                        grouped[key] = {
                            field: row[field] for field in HEADERS
                            if field not in {"item_no", "remark_heading", "remark_value"}
                        }
                        grouped[key]["remarks"] = []
                    remark = "：".join(x for x in (
                        row["remark_heading"], row["remark_value"]
                    ) if x)
                    if remark and remark not in grouped[key]["remarks"]:
                        grouped[key]["remarks"].append(remark)
    records = sorted(grouped.values(), key=lambda x: (
        x["prefecture_code"], x["category"], x["institution_number"],
        x["accepted_name"], x["acceptance_number"],
    ))
    return records, source_files


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
                    encoding="utf-8")


def write_json_gzip(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    path.write_bytes(gzip.compress(content, compresslevel=9, mtime=0))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip-root", required=True)
    parser.add_argument("--snapshot")
    parser.add_argument("--output-root", default="data/facility-standards/normalized/tokai-hokuriku")
    args = parser.parse_args()
    zip_paths = sorted(Path(args.zip_root).glob("*.zip"))
    if len(zip_paths) != 3:
        raise RuntimeError(f"expected 3 ZIP files, found {len(zip_paths)}")
    snapshot = args.snapshot
    if not snapshot:
        match = re.search(r"(\d{2})(\d{2})-06_01-", zip_paths[0].name)
        if not match:
            raise RuntimeError("snapshot was not found in official ZIP filename")
        snapshot = f"{2000 + int(match.group(1)):04d}-{int(match.group(2)):02d}"
    records, source_files = normalize(zip_paths, snapshot)
    output_root = Path(args.output_root)
    # Historical partitions remain source documents for analytical snapshots.
    # index.json below selects the current month for the public search indexes.
    partitions = defaultdict(list)
    for row in records:
        partitions[(row["prefecture_code"], CATEGORY_SLUG[row["category"]])].append(row)
    files = []
    for (prefecture_code, category), subset in sorted(partitions.items()):
        path = output_root / snapshot / f"{prefecture_code}-{category}.json.gz"
        payload = {
            "schemaVersion": 1, "bureau": "tokai-hokuriku",
            "snapshot": snapshot, "prefectureCode": prefecture_code,
            "prefecture": subset[0]["prefecture"], "category": subset[0]["category"],
            "recordCount": len(subset), "records": subset,
        }
        write_json_gzip(path, payload)
        files.append({
            "prefectureCode": prefecture_code, "prefecture": subset[0]["prefecture"],
            "category": subset[0]["category"], "recordCount": len(subset),
            "path": str(path.relative_to(output_root)),
        })
    index = {
        "schemaVersion": 1, "bureau": "tokai-hokuriku", "snapshot": snapshot,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "recordCount": len(records), "sourceFiles": source_files, "partitions": files,
        "warning": "届出受理状況であり、診療実績、稼働状況、医療の質を示さない。",
    }
    write_json(output_root / "index.json", index)
    print(json.dumps({"recordCount": len(records), "partitions": len(files)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
