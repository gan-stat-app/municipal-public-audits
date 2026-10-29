"""Build a national registry from retained government and catalog originals.

Run against a retained input directory. Retrieval is a separate operation: the
registry can be reproduced offline and catalog update time is not a data date.
"""
from __future__ import annotations

import argparse
import csv
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import urllib.parse

from pipeline import ROOT, source_id, validate_source, write_json, sha


class Links(HTMLParser):
    def __init__(self):
        super().__init__(); self.current = None; self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.current = [dict(attrs).get("href", ""), ""]

    def handle_data(self, value):
        if self.current is not None:
            self.current[1] += value

    def handle_endtag(self, tag):
        if tag == "a" and self.current is not None:
            self.links.append(self.current); self.current = None


def html_links(data: bytes, url: str) -> list[tuple[str, str]]:
    # Honor the declared charset. The MIC source uses Shift-JIS; most local
    # government sites use UTF-8. Never silently discard Japanese municipality names.
    head = data[:8000].decode("ascii", errors="ignore")
    match = re.search(r"charset\s*=\s*['\"]?([A-Za-z0-9_-]+)", head, re.I)
    candidates = ([match.group(1)] if match else []) + ["utf-8", "cp932"]
    text = None
    for encoding in candidates:
        try:
            text = data.decode(encoding); break
        except (UnicodeDecodeError, LookupError):
            pass
    if text is None:
        raise ValueError("Could not decode the source page")
    parser = Links(); parser.feed(text)
    return [(urllib.parse.urljoin(url, h), re.sub(r"\s+", " ", t).strip()) for h, t in parser.links]


def checksum(code5: str) -> str:
    n = 11 - sum(int(v) * weight for v, weight in zip(code5, [6, 5, 4, 3, 2])) % 11
    return str(n % 10)


def government_registry(original: Path) -> dict:
    from openpyxl import load_workbook
    workbook = load_workbook(original, read_only=True, data_only=True)
    governments = []
    for row in list(workbook.worksheets[0].values)[1:]:
        if row[0] is None:
            continue
        code6 = str(row[0]).zfill(6)
        if not code6.isdigit() or code6[-1] != checksum(code6[:5]):
            raise ValueError(f"Invalid MIC code: {code6}")
        governments.append({"code": code6[:5], "code6": code6, "prefecture": row[1],
                            "name": row[2] or row[1], "type": "prefecture" if row[2] is None else "municipality",
                            "scope_review_required": code6[:5] in {"01695", "01696", "01697", "01698", "01699", "01700"}})
    known = {v["code"] for v in governments}
    wards = []
    for row in list(workbook.worksheets[1].values)[1:]:
        if row[0] is None:
            continue
        code6 = str(row[0]).zfill(6)
        if code6[:5] not in known:
            wards.append({"code": code6[:5], "code6": code6, "prefecture": row[1], "name": row[2], "type": "administrative_ward_reference"})
    workbook.close()
    if len(governments) != len(known):
        raise ValueError("Duplicate government code")
    return {"source_url": "https://www.soumu.go.jp/main_content/000925835.xlsx", "source_sha256": sha(original.read_bytes()),
            "publication_page": "https://www.soumu.go.jp/denshijiti/code.html", "source_edition": "2024-01-01; current publication checked 2026-10-23",
            "government_count": len(governments), "administrative_ward_reference_count": len(wards),
            "scope_note": "北方6村は所管・公表状況の確認対象として別フラグを保持。政令市の行政区は自治体数へ重複加算しない。",
            "governments": governments, "administrative_ward_references": wards}


def new_source(category, owner, channel, page, url, fmt, title, **extra):
    return {"id": source_id(category, owner, channel, url), "category": category, "owner_code": owner,
            "channel": channel, "page": page, "url": url, "format": fmt.lower(), "title": title,
            "declared_period": None, "period_verification": "not_confirmed", "scope": "scope_unconfirmed", **extra}


def bodik_sources(data: dict, category: str, government_map: dict) -> tuple[list, list]:
    if not data.get("success"):
        raise ValueError("CKAN query did not succeed")
    result = data["result"]
    if result["count"] != len(result["results"]):
        raise ValueError("Catalog query is truncated; pagination is required")
    rows, unresolved = [], []
    for package in result["results"]:
        org = package.get("organization") or {}
        org_match = re.fullmatch(r"(\d{6})", org.get("name", ""))
        org_code = org_match.group(1)[:5] if org_match and org_match.group(1)[-1] == checksum(org_match.group(1)[:5]) else None
        for resource in package.get("resources", []):
            url = resource.get("url", "")
            if not url or urllib.parse.urlsplit(url).scheme not in {"http", "https"}:
                unresolved.append({"package": package["name"], "organization": org.get("title", ""),
                                   "resource_url": url, "reason": "missing_or_invalid_resource_url"})
                continue
            fmt = resource.get("format", "").lower()
            suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower().lstrip(".")
            if suffix in {"xlsx", "xlsm", "xls", "csv", "tsv"}:
                fmt = suffix
            if fmt not in {"xlsx", "xlsm", "xls", "csv", "tsv"}:
                continue
            code = org_code
            if code is None:
                candidates = set()
                for value in [package.get("name", ""), Path(urllib.parse.urlsplit(url).path).name, resource.get("name", "")]:
                    m = re.match(r"^(\d{6})(?:[_\-\s]|$)", value)
                    if m and m[1][-1] == checksum(m[1][:5]):
                        candidates.add(m[1][:5])
                if len(candidates) == 1:
                    code = next(iter(candidates))
            org_title = org.get("title", "")
            gov = government_map.get(code)
            # A JIS-looking filename alone is not proof of ownership. Require
            # both a code match and the corresponding government in the publisher label.
            if gov is None or gov["name"] not in org_title:
                unresolved.append({"package": package["name"], "organization": org_title, "resource_url": url,
                                   "candidate_code": code, "reason": "publisher_identity_requires_confirmation"})
                continue
            page = "https://data.bodik.jp/dataset/" + package["name"]
            row = new_source(category, code, "delegated_catalog", page, url, fmt,
                             package["title"] + " / " + (resource.get("name") or ""),
                             publisher=org_title, publisher_match="government_code_and_organization_label",
                             catalog_modified_at=package.get("metadata_modified"), resource_modified_at=resource.get("last_modified"),
                             license=package.get("license_title") or package.get("license_id"),
                             catalog_package_id=package["id"], catalog_resource_id=resource["id"],
                             metadata_query_category=category)
            rows.append(row)
    return rows, unresolved


def food_sources(data: dict) -> list:
    rows = []
    for s in data["sources"]:
        national = s["publisher_type"] in {"prefecture", "health_center_city_or_ward"}
        row = new_source("food_business", s["authority_code"], "national_platform" if national else "municipal_direct",
                         s["page"], s["url"], s["format"], s["publisher"] + " / " + s["scope"],
                         publisher=s["publisher"], scope=s["scope"], declared_period=s.get("as_of"),
                         period_verification="existing_source_contract", source_catalog_id=s["id"],
                         license=s.get("license"), license_url=s.get("license_url"),
                         publisher_type=s["publisher_type"], existing_acquisition_available=s["available"])
        rows.append(row)
    return rows


def gsi_sources(data: bytes, government_map: dict) -> tuple[list, list]:
    rows, availability = [], []
    for row in csv.reader(io.StringIO(data.decode("utf-8-sig"))):
        if not row or row[0] not in government_map:
            continue
        code = row[0]
        row += [""] * max(0, 6 - len(row))
        available = bool(row[2] and row[3]) and row[4] not in {"2", "3", "9", "12"}
        availability.append({"owner_code": code, "name": row[1], "first_published_at": row[2],
                             "platform_updated_at": row[3], "flag": row[4], "comment": row[5],
                             "emergency_sites_download_available": available,
                             "scope": "national_platform_only_not_local_publication"})
        if not available:
            continue
        rows.append(new_source("emergency_sites", code, "national_platform",
                               "https://hinanmap.gsi.go.jp/hinanjocp/hinanbasho/koukaidate.html",
                               f"https://hinanmap.gsi.go.jp/hinanjocp/defaultFtpData/csv/{code}_2.csv", "csv", row[1] + " / 国土地理院配信",
                               publisher=row[1], scope="designated_emergency_sites", platform_first_published_at=row[2],
                               platform_updated_at=row[3], platform_status_flag=row[4], platform_comment=row[5],
                               source_role="reference_not_local_file_quality"))
    return rows, availability


def municipal_finance_sources(folder: Path, government_map: dict) -> tuple[list, list]:
    """Exact municipality labels only. General pages are not evidence of FY2024."""
    rows, audit = [], []
    if not folder.exists():
        return rows, audit
    for index in json.loads((folder / "index.json").read_bytes()):
        item = dict(index)
        if item.get("status") != "downloaded":
            audit.append(item); continue
        file = folder / (item["prefecture_code"] + ".html")
        if not file.exists():
            audit.append({**item, "status": "retained_page_missing"}); continue
        count = 0
        names = {g["name"]: g for g in government_map.values()
                 if g["type"] == "municipality" and g["code"].startswith(item["prefecture_code"])}
        for url, label in html_links(file.read_bytes(), item["page"]):
            fmt = Path(urllib.parse.urlsplit(url).path).suffix.lower().lstrip(".")
            if fmt not in {"xlsx", "xls"}:
                continue
            clean = re.sub(r"[（(].*", "", label).replace("■", "").strip()
            gov = names.get(clean)
            if gov is None:
                continue
            # The MIC link is a locator. The local page/file may have several
            # years, so each file's fiscal year remains unconfirmed here.
            rows.append(new_source("finance", gov["code"], "prefectural_aggregate", item["page"], url, fmt,
                                   gov["prefecture"] + " / " + label + " / 財政状況資料集候補",
                                   publisher=gov["prefecture"], publisher_code=gov["code"][:2] + "000",
                                   scope="municipal_finance_report", discovery_fiscal_year_index="FY2024",
                                   subject_government_code=gov["code"], ownership_note="Local finance subject; prefecture publishes the file"))
            count += 1
        audit.append({**item, "page_sha256": sha(file.read_bytes()), "exact_name_file_candidates": count})
    return rows, audit


def finance_index(data: bytes, governments: list) -> tuple[list, list]:
    page = "https://www.soumu.go.jp/iken/zaisei/jyoukyou_shiryou/r06/index.html"
    prefs = {g["name"]: g for g in governments if g["type"] == "prefecture"}
    rows, indexes = [], []
    for url, label in html_links(data, page):
        label = label.replace("■", "").strip()
        if label not in prefs:
            continue
        owner = prefs[label]["code"]
        fmt = Path(urllib.parse.urlsplit(url).path).suffix.lower().lstrip(".")
        if fmt in {"xlsx", "xls"}:
            rows.append(new_source("finance", owner, "national_platform", page, url, fmt,
                                   label + " / 令和6年度財政状況資料集", scope="prefectural_finance_report", declared_period="FY2024",
                                   period_verification="official_fiscal_year_index", publisher=label))
        elif urllib.parse.urlsplit(url).scheme in {"http", "https"}:
            indexes.append({"prefecture_code": owner[:2], "page": url, "label": label,
                            "category": "finance", "declared_period": "FY2024", "role": "municipal_finance_index"})
    return rows, indexes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--food-contract", type=Path, required=True)
    parser.add_argument("--finance-pages", type=Path)
    args = parser.parse_args()
    governments = government_registry(args.inputs / "soumu-codes.xlsx")
    write_json(ROOT / "governments.json.gz", governments)
    government_map = {g["code"]: g for g in governments["governments"]}
    sources, unresolved, audits = [], [], []
    for category in ["population", "food_business", "emergency_sites", "public_facilities"]:
        file = args.inputs / ("bodik-exact-" + category + ".json")
        data = json.loads(file.read_bytes())
        rows, problems = bodik_sources(data, category, government_map)
        sources.extend(rows); unresolved.extend(problems)
        audits.append({"kind": "delegated_catalog", "category": category, "file": file.name,
                       "sha256": sha(file.read_bytes()), "query_total": data["result"]["count"],
                       "query_returned": len(data["result"]["results"]), "identity_matched_resources": len(rows), "unresolved_resources": len(problems)})
    sources.extend(food_sources(json.loads(args.food_contract.read_bytes())))
    gsi, availability = gsi_sources((args.inputs / "gsi-history.csv").read_bytes(), government_map)
    sources.extend(gsi)
    write_json(ROOT / "platform-availability.json.gz", availability)
    rows, indexes = finance_index((args.inputs / "soumu-finance.html").read_bytes(), governments["governments"])
    sources.extend(rows)
    municipal, finance_audit = municipal_finance_sources(args.finance_pages, government_map) if args.finance_pages else ([], [])
    sources.extend(municipal)
    write_json(ROOT / "finance-indexes.json", indexes)
    # Deduplicate exact source identities only. Paired XLSX/CSV and direct vs
    # national-platform representations remain distinct records.
    unique = {}
    for source in sources:
        validate_source(source, set(government_map))
        if source["id"] not in unique:
            unique[source["id"]] = source
    write_json(ROOT / "sources.json.gz", sorted(unique.values(), key=lambda s: (s["category"], s["owner_code"], s["id"])))
    write_json(ROOT / "discovery-audit.json", {"catalog_queries": audits, "unresolved_resources": unresolved,
                                               "finance_index_pages": len(indexes), "government_count": len(government_map),
                                               "sources_registered": len(unique), "registered_is_not_evaluated": True,
                                               "municipal_finance_page_audit": finance_audit})
    print(json.dumps({"governments": len(government_map), "sources": len(unique), "finance_indexes": len(indexes), "unresolved_resources": len(unresolved)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
