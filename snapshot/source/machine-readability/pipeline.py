"""Resumable national file inventory and unchanged-original Harunobu evaluation.

Network discovery and scoring are explicit commands. Offline verification never
downloads files or calls an AI provider. Failed attempts never replace a good run.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict, deque
import csv
import datetime as dt
import gzip
import hashlib
import io
import importlib.metadata
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent
POLICY = json.loads((ROOT / "policy.json").read_text())
COMMIT = POLICY["engine"]["commit"]


def now() -> str:
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path):
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == ".gz" else data)


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(gzip.compress(text.encode("utf-8"), mtime=0)) if path.suffix == ".gz" else tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def source_id(category: str, owner_code: str, channel: str, url: str) -> str:
    return f"{category}-{owner_code}-{sha((channel + '|' + url).encode())[:16]}"


def validate_source(s: dict, governments: set[str] | None = None) -> None:
    if s["category"] not in {v["id"] for v in POLICY["scope"]}:
        raise ValueError("Unknown category")
    if s["channel"] not in POLICY["channels"]:
        raise ValueError("Unknown publication channel")
    if not isinstance(s["owner_code"], str) or len(s["owner_code"]) != 5 or not s["owner_code"].isdigit():
        raise ValueError("Publisher code must be a five-digit string")
    if governments is not None and s["owner_code"] not in governments:
        raise ValueError("Publisher not in government registry")
    for key in ("url", "page"):
        u = urllib.parse.urlsplit(s[key])
        if u.scheme not in {"http", "https"} or not u.hostname or u.username or u.password:
            raise ValueError(f"A public data URL is required: {s['id']} {key}")
    expected = source_id(s["category"], s["owner_code"], s["channel"], s["url"])
    if s["id"] != expected:
        raise ValueError("Source identity mismatch")
    if s["format"].lower() not in {"xlsx", "xlsm", "xls", "csv", "tsv"}:
        raise ValueError("Unsupported inventory format")


def write_original(work: Path, data: bytes) -> tuple[str, str]:
    digest = sha(data)
    rel = f"originals/{digest}.gz"
    p = work / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    packed = gzip.compress(data, mtime=0)
    if p.exists():
        if sha(gzip.decompress(p.read_bytes())) != digest:
            raise ValueError("Preserved original was modified")
    else:
        temp = p.with_suffix(".tmp")
        temp.write_bytes(packed)
        temp.replace(p)
    return digest, rel


def raw_bytes(work: Path, fetch: dict) -> bytes:
    rel = Path(fetch["original_path"])
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError("Unsafe original path")
    data = gzip.decompress((work / rel).read_bytes())
    if sha(data) != fetch["sha256"] or len(data) != fetch["size_bytes"]:
        raise ValueError("Original checksum/size mismatch")
    return data


def validate_container(data: bytes, fmt: str) -> None:
    if data.lstrip().lower().startswith((b"<!doctype html", b"<html")):
        raise ValueError("HTML returned instead of data")
    if fmt in {"xlsx", "xlsm"}:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            if "xl/workbook.xml" not in z.namelist():
                raise ValueError("Not an OOXML workbook")
    elif fmt == "xls" and not data.startswith(bytes.fromhex("D0CF11E0A1B11AE1")):
        raise ValueError("Not a binary Excel workbook")


def fetch_one(source: dict, work: Path, *, refresh: bool = False) -> dict:
    validate_source(source)
    current = work / "fetch" / (source["id"] + ".json")
    if current.exists() and not refresh:
        saved = read_json(current)
        if saved.get("status") == "downloaded" and saved["source"] == source:
            raw_bytes(work, saved)
            return saved
    stamp = now()
    result = {"source": source, "attempted_at": stamp, "status": "download_failed"}
    try:
        parsed = urllib.parse.urlsplit(source["url"])
        request_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc,
            urllib.parse.quote(parsed.path, safe="/%:@"), urllib.parse.quote(parsed.query, safe="%=&/?:@+"), ""))
        request = urllib.request.Request(request_url, headers={"User-Agent": "MunicipalReadabilityResearch/1.0"})
        with urllib.request.urlopen(request, timeout=POLICY["limits"]["download_timeout_seconds"]) as response:
            data = response.read(POLICY["limits"]["download_bytes"] + 1)
            if len(data) > POLICY["limits"]["download_bytes"]:
                raise ValueError("File exceeds the configured byte limit")
            validate_container(data, source["format"])
            digest, rel = write_original(work, data)
            result.update(status="downloaded", sha256=digest, size_bytes=len(data), original_path=rel,
                          resolved_url=response.url, content_type=response.headers.get("Content-Type"),
                          last_modified=response.headers.get("Last-Modified"))
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
    attempt_id = sha((source["id"] + stamp).encode())[:24]
    write_json(work / "attempts" / (attempt_id + ".json"), result)
    # Keep the last verified original after a failed refresh; retain the failure
    # independently so it remains visible in monitoring.
    if result["status"] == "downloaded" or not current.exists():
        write_json(current, result)
    return result


def preflight(data: bytes, fmt: str) -> dict:
    if fmt == "xls":
        return {"status": "unsupported_format", "reason": "Harunobu 0.2.2 does not support native .xls; original retained without conversion"}
    if fmt not in {"xlsx", "xlsm"}:
        return {"status": "ready", "reader_limit_scope": "Harunobu Excel caps do not apply to CSV/TSV"}
    dimensions = []
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            if not name.startswith("xl/worksheets/sheet") or not name.endswith(".xml"):
                continue
            max_row = max_col = 0
            with z.open(name) as stream:
                for _, elem in ET.iterparse(stream, events=("end",)):
                    if elem.tag != ns + "c":
                        continue
                    has_data = elem.find(ns + "v") is not None or elem.find(ns + "f") is not None or elem.find(ns + "is") is not None
                    ref = elem.get("r", "")
                    if has_data and ref:
                        letters = "".join(c for c in ref if c.isalpha())
                        digits = "".join(c for c in ref if c.isdigit())
                        col = 0
                        for c in letters:
                            col = col * 26 + ord(c.upper()) - 64
                        max_row = max(max_row, int(digits or 0)); max_col = max(max_col, col)
                    elem.clear()
            dimensions.append({"part": name, "max_data_row": max_row, "max_data_column": max_col})
    exceeds = any(d["max_data_row"] > POLICY["limits"]["xlsx_rows"] or d["max_data_column"] > POLICY["limits"]["xlsx_columns"] for d in dimensions)
    return {"status": "reader_limit_exceeded" if exceeds else "ready", "dimensions": dimensions}


def engine_fingerprint(engine: Path) -> str:
    """Include every scoring implementation/resource byte, not just its label."""
    if not (engine / "harunobu/core/analyzer.py").exists():
        raise ValueError("Missing Harunobu checkout")
    rows = []
    for path in sorted((engine / "harunobu").rglob("*")):
        if path.is_file() and path.suffix != ".pyc" and "__pycache__" not in path.parts:
            rows.append([str(path.relative_to(engine)), sha(path.read_bytes())])
    return sha(json.dumps(rows, separators=(",", ":")).encode())


def assessment_id(original_sha: str, engine_hash: str, fmt: str) -> str:
    return sha(json.dumps([original_sha, engine_hash, fmt, POLICY["engine"], POLICY["limits"]], sort_keys=True).encode())


def planned_jobs(pending: list[tuple[str, dict]]) -> list[dict]:
    """Balance fields and prefectures; a historical monthly series cannot dominate."""
    never_attempted = any(not stamp for stamp, _ in pending)
    groups = defaultdict(lambda: defaultdict(list))
    def priority(pair):
        stamp, s = pair
        text = unicodedata.normalize("NFKC", s["title"] + " " + s["url"])
        target = "2024" if s["category"] == "finance" else "2026"
        hint = 0 if (s.get("declared_period") or "").startswith(("FY" if s["category"] == "finance" else "") + target) else 1 if target in text else 2
        return (hint, s["channel"] not in POLICY["direct_publication_channels"], s["format"] != "xlsx", stamp, s["owner_code"], s["id"])
    for pair in sorted(pending, key=priority):
        stamp, s = pair
        if never_attempted and stamp:
            continue
        groups[s["category"]][s["owner_code"][:2]].append(s)
    queues = {}
    for category, prefs in groups.items():
        prefs = {key: deque(value) for key, value in sorted(prefs.items())}
        spread = deque()
        while any(prefs.values()):
            for queue in prefs.values():
                if queue:
                    spread.append(queue.popleft())
        queues[category] = spread
    jobs = []
    while any(queues.values()):
        for category in POLICY["scope"]:
            queue = queues.get(category["id"])
            if queue:
                jobs.append(queue.popleft())
    return jobs


def score_one(fetch: dict, work: Path, engine: Path, *, timeout: int | None = None) -> dict:
    source = fetch["source"]
    if fetch.get("status") != "downloaded":
        return {"source_id": source["id"], "status": "download_failed", "scores": {str(i): None for i in (1, 2, 3)}}
    data = raw_bytes(work, fetch)
    fingerprint = engine_fingerprint(engine)
    lock = read_json(ROOT / "engine-lock.json")
    if fingerprint != lock["implementation_sha256"]:
        raise ValueError("Harunobu source differs from the pinned implementation")
    dependencies = {name: importlib.metadata.version(name) for name in lock["runtime_dependencies"]}
    if dependencies != lock["runtime_dependencies"] or (importlib.util.find_spec("magika") is not None) != lock["magika_available"]:
        raise ValueError("Runtime dependencies differ from the scoring contract; use a separate pinned environment")
    ident = assessment_id(fetch["sha256"], fingerprint, source["format"])
    path = work / "assessments" / (ident + ".json")
    if path.exists():
        saved = read_json(path)
        if saved.get("status") == "evaluated" and saved.get("dependencies") != dependencies:
            raise ValueError("Cached assessment was produced with different dependencies")
        return saved
    record = {"id": ident, "original_sha256": fetch["sha256"], "engine_sha256": fingerprint,
              "engine": POLICY["engine"], "created_at": now(), "scores": {str(i): None for i in (1, 2, 3)},
              "review_status": "unreviewed", "scope": "single_original_file", "format": source["format"]}
    check = preflight(data, source["format"])
    record["preflight"] = check
    if check["status"] != "ready":
        record["status"] = check["status"]
        write_json(path, record)
        return record
    with tempfile.TemporaryDirectory(prefix="harunobu-file-") as temp:
        temp = Path(temp)
        original = temp / (fetch["sha256"] + "." + source["format"])
        original.write_bytes(data)
        output = temp / "result.json"
        env = dict(os.environ, HARUNOBU_AI_DISABLED="1")
        command = [sys.executable, str(ROOT / "worker.py"), "--engine", str(engine.resolve()), "--input", str(original), "--output", str(output)]
        try:
            completed = subprocess.run(command, env=env, capture_output=True, text=True,
                                       timeout=timeout or POLICY["limits"]["evaluation_timeout_seconds"])
            if completed.returncode:
                raise RuntimeError(completed.stderr[-1600:] or f"Worker exit {completed.returncode}")
            detailed = read_json(output)
            record.update(detailed["summary"], status="no_tables_detected" if detailed["summary"]["no_tables_detected"] else "evaluated")
            official_bytes = json.dumps(detailed["official"], ensure_ascii=False, sort_keys=True).encode()
            report_rel = f"official/{ident}.json.gz"
            report_file = work / report_rel
            report_file.parent.mkdir(parents=True, exist_ok=True)
            report_file.write_bytes(gzip.compress(official_bytes, mtime=0))
            record.update(official_path=report_rel, official_sha256=sha(official_bytes))
        except subprocess.TimeoutExpired:
            record.update(status="evaluation_timeout", error="Harunobu worker exceeded the configured time limit")
        except Exception as exc:
            record.update(status="evaluation_error", error=f"{type(exc).__name__}: {exc}")
    # A failed worker can be retried. Successful, unsupported and blocked records
    # remain immutable for the same original/configuration identity.
    if record["status"] in {"evaluation_error", "evaluation_timeout"}:
        write_json(work / "evaluation_attempts" / (ident + "-" + sha(now().encode())[:12] + ".json"), record)
    else:
        write_json(path, record)
    return record


def summarize(governments: list[dict], sources: list[dict], work: Path) -> dict:
    codes = {g["code"] for g in governments}
    for s in sources:
        validate_source(s, codes)
    source_counts = Counter()
    direct_counts = Counter()
    scored_counts = Counter()
    scored_direct = Counter()
    status_counts = defaultdict(Counter)
    covered = defaultdict(set)
    covered_direct = defaultdict(set)
    file_rows = []
    assessment_index = defaultdict(list)
    lock = read_json(ROOT / "engine-lock.json")
    for path in (work / "assessments").glob("*.json"):
        a = read_json(path)
        expected_id = assessment_id(a.get("original_sha256"), lock["implementation_sha256"], a.get("format"))
        if (a.get("engine") == POLICY["engine"] and a.get("engine_sha256") == lock["implementation_sha256"]
                and a.get("id") == expected_id
                and (a.get("status") != "evaluated" or a.get("dependencies") == lock["runtime_dependencies"])):
            assessment_index[(a.get("original_sha256"), a.get("format"))].append(a)
    for source in sources:
        cat = source["category"]
        source_counts[cat] += 1
        direct = source["channel"] in POLICY["direct_publication_channels"]
        if direct:
            direct_counts[cat] += 1
        status = "source_metadata_registered"
        fetch_path = work / "fetch" / (source["id"] + ".json")
        a = None
        if fetch_path.exists():
            fetch = read_json(fetch_path)
            status = fetch["status"]
            if fetch.get("source") != source:
                status = "source_metadata_changed_refresh_required"
            elif status == "downloaded":
                raw_bytes(work, fetch)
                choices = assessment_index.get((fetch["sha256"], source["format"]), [])
                if choices:
                    a = max(choices, key=lambda x: x["created_at"])
                    status = a["status"]
        status_counts[cat][status] += 1
        if status == "evaluated":
            scored_counts[cat] += 1; covered[cat].add(source["owner_code"])
            if direct:
                scored_direct[cat] += 1; covered_direct[cat].add(source["owner_code"])
        file_rows.append({"source_id": source["id"], "owner_code": source["owner_code"], "category": cat,
                          "channel": source["channel"], "status": status,
                          "assessment_id": a["id"] if a else None,
                          "scores": a["scores"] if a and status == "evaluated" else {str(i): None for i in (1, 2, 3)},
                          "review_status": a.get("review_status", "unreviewed") if a else "not_evaluated",
                          "last_job": read_json(work / "jobs" / (source["id"] + ".json")) if (work / "jobs" / (source["id"] + ".json")).exists() else None})
    scoped = []
    for category in POLICY["scope"]:
        key = category["id"]
        metadata_owners = {s["owner_code"] for s in sources if s["category"] == key}
        scoped.append({"category": key, "name": category["name"], "government_registry_entries": len(governments),
                       "source_files_registered": source_counts[key], "owners_with_source_metadata": len(metadata_owners),
                       "direct_source_files_registered": direct_counts[key], "files_evaluated": scored_counts[key],
                       "direct_files_evaluated": scored_direct[key], "owners_evaluated": len(covered[key]),
                       "owners_direct_evaluated": len(covered_direct[key]),
                       "source_discovery_pending": len(codes - metadata_owners), "file_statuses": dict(status_counts[key])})
    return {"schema_version": 1, "generated_at": now(), "scoring_unit": "original_file",
            "government_registry_entries": len(governments), "target_cells": len(governments) * len(POLICY["scope"]),
            "target_cells_meaning": "Discovery grid only; applicability and publication jurisdiction require review, especially food permits",
            "scope_review_required_entries": [g["code"] for g in governments if g.get("scope_review_required")],
            "scope": scoped, "files": file_rows,
            "notes": ["Registration is not evaluation completion.", "National-platform files do not count as local direct-publication evaluations.",
                      "No source found yet does not mean unpublished.", "Review is required before publishing findings or assigning municipality rankings."]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["run", "plan", "summary", "verify"])
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--sources", type=Path, default=ROOT / "sources.json.gz")
    parser.add_argument("--engine", type=Path)
    parser.add_argument("--category", choices=[v["id"] for v in POLICY["scope"]])
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--include-reference", action="store_true", help="Also process national-platform files, separately from local publications")
    args = parser.parse_args()
    sources = read_json(args.sources)
    governments = read_json(ROOT / "governments.json.gz")["governments"]
    for source in sources:
        validate_source(source, {g["code"] for g in governments})
    if args.command in {"run", "plan"}:
        if not args.engine or args.limit < 1:
            parser.error("run requires --engine and a positive --limit")
        fingerprint = engine_fingerprint(args.engine)
        pending = []
        for source in sources:
            if args.category is not None and source["category"] != args.category:
                continue
            if source["channel"] == "national_platform" and not args.include_reference:
                continue
            fetched = args.work / "fetch" / (source["id"] + ".json")
            if fetched.exists() and not args.refresh:
                f = read_json(fetched)
                if f.get("status") == "downloaded" and f.get("source") == source:
                    ident = assessment_id(f["sha256"], fingerprint, source["format"])
                    if (args.work / "assessments" / (ident + ".json")).exists():
                        continue
            job = args.work / "jobs" / (source["id"] + ".json")
            last_attempt = read_json(job)["attempted_at"] if job.exists() else ""
            pending.append((last_attempt, source))
        selected = planned_jobs(pending)[:args.limit]
        if args.command == "plan":
            print(json.dumps(selected, ensure_ascii=False, indent=2)); return
        done = 0
        for source in selected:
            fetch = fetch_one(source, args.work, refresh=args.refresh)
            result = score_one(fetch, args.work, args.engine)
            print(source["id"], result["status"], result.get("scores"), flush=True)
            write_json(args.work / "jobs" / (source["id"] + ".json"), {"attempted_at": now(), "status": result["status"]})
            done += 1
            if done >= args.limit:
                break
    summary = summarize(governments, sources, args.work)
    write_json(args.work / "coverage.json", summary)
    if args.command == "verify":
        for path in (args.work / "assessments").glob("*.json"):
            a = read_json(path)
            if a["status"] == "evaluated":
                raw = gzip.decompress((args.work / a["official_path"]).read_bytes())
                if sha(raw) != a["official_sha256"]:
                    raise ValueError("Official report checksum mismatch")
        print("Preserved originals and all detailed assessment checksums verified", flush=True)
    print(json.dumps([{k: v for k, v in s.items() if k != "file_statuses"} for s in summary["scope"]], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
