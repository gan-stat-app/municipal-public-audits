#!/usr/bin/env python3
"""Inventory structured facility-standard files published by all regional bureaus.

The default operation stores only a lightweight link inventory. Binary downloads
must be explicitly enabled and directed to a storage root outside the web assets.
"""
from __future__ import annotations

import argparse
import hashlib
import html.parser
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

STRUCTURED = {".xlsx", ".xls", ".csv", ".zip"}
MAX_FILE = 80 * 1024 * 1024


class Links(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []
        self.href = None
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.href = dict(attrs).get("href")
            self.text = []

    def handle_data(self, data):
        if self.href is not None:
            self.text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.href is not None:
            self.items.append((self.href, " ".join("".join(self.text).split())))
            self.href = None


def fetch(url, limit=None):
    request = urllib.request.Request(
        url, headers={"User-Agent": "municipal-smr.jp official-data-inventory/2.1"}
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        if limit:
            size = response.headers.get("Content-Length")
            if size and int(size) > limit:
                raise RuntimeError(f"file too large: {size}")
            data = response.read(limit + 1)
            if len(data) > limit:
                raise RuntimeError("file too large")
        else:
            data = response.read()
        return data, response.headers.get("Content-Type", "")


def safe_name(url, digest):
    name = Path(urllib.parse.unquote(urllib.parse.urlparse(url).path)).name
    name = re.sub(r"[^0-9A-Za-z._-]+", "_", name) or "download"
    return f"{digest[:12]}-{name}"


def discover(bureau):
    page, _ = fetch(bureau["url"])
    parser = Links()
    parser.feed(page.decode("utf-8", "replace"))
    files = []
    seen = set()
    for href, label in parser.items:
        url = urllib.parse.urljoin(bureau["url"], href)
        extension = Path(urllib.parse.urlparse(url).path).suffix.lower()
        if extension not in STRUCTURED or url in seen:
            continue
        seen.add(url)
        files.append({"url": url, "label": label, "extension": extension.lstrip(".")})
    return page, files


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry", default="data/facility-standards/source-registry.json")
    parser.add_argument("--output-root", default="data/facility-standards/inventory")
    parser.add_argument("--bureau", action="append")
    parser.add_argument(
        "--download-root",
        help="explicit non-public binary storage root; omitted for inventory-only mode",
    )
    args = parser.parse_args()
    registry = json.loads(Path(args.registry).read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    day = now.date().isoformat()
    output_root = Path(args.output_root)
    results = []

    for bureau in registry["bureaus"]:
        if args.bureau and bureau["id"] not in args.bureau:
            continue
        try:
            page, files = discover(bureau)
            error = None
        except Exception as exc:
            page, files, error = b"", [], str(exc)

        downloaded = []
        if args.download_root and not error:
            binary_root = Path(args.download_root) / bureau["id"] / "objects"
            for item in files:
                try:
                    data, content_type = fetch(item["url"], MAX_FILE)
                    digest = hashlib.sha256(data).hexdigest()
                    destination = binary_root / safe_name(item["url"], digest)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    if not destination.exists():
                        destination.write_bytes(data)
                    downloaded.append({
                        "url": item["url"], "sha256": digest, "bytes": len(data),
                        "contentType": content_type, "object": str(destination),
                    })
                except Exception as exc:
                    downloaded.append({"url": item["url"], "error": str(exc)})

        counts = {}
        for item in files:
            counts[item["extension"]] = counts.get(item["extension"], 0) + 1
        record = {
            "bureau": bureau["id"],
            "name": bureau["name"],
            "sourcePage": bureau["url"],
            "pageSha256": hashlib.sha256(page).hexdigest() if page else None,
            "structuredLinkCount": len(files),
            "extensionCounts": counts,
            "files": files,
        }
        if error:
            record["error"] = error
        if args.download_root:
            record["downloads"] = downloaded
        results.append(record)

    payload = {
        "schemaVersion": 2,
        "retrievedAt": now.isoformat(timespec="seconds"),
        "mode": "download" if args.download_root else "inventory-only",
        "warning": "リンク一覧は正規化済みデータではなく、全国比較には使用しない。",
        "bureaus": results,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    for filename in (f"{day}.json", "latest.json"):
        (output_root / filename).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(json.dumps([
        {"bureau": row["bureau"], "links": row["structuredLinkCount"],
         "extensions": row["extensionCounts"], "error": row.get("error")}
        for row in results
    ], ensure_ascii=False))
    return 1 if any(row.get("error") or row["structuredLinkCount"] == 0 for row in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
