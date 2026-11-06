#!/usr/bin/env python3
"""Build small, same-origin DPC browser datasets from MHLW public workbooks."""
from __future__ import annotations

import hashlib
import gzip
import json
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "dpc"
OUT = ROOT / "public" / "dpc" / "data"

MDC_NAMES = {
    "01": "神経系疾患", "02": "眼科系疾患", "03": "耳鼻咽喉科系疾患",
    "04": "呼吸器系疾患", "05": "循環器系疾患", "06": "消化器系疾患、肝臓・胆道・膵臓疾患",
    "07": "筋骨格系疾患", "08": "皮膚・皮下組織疾患", "09": "乳房の疾患",
    "10": "内分泌・栄養・代謝疾患", "11": "腎・尿路系疾患及び男性生殖器系疾患",
    "12": "女性生殖器系疾患及び産褥期疾患・異常妊娠分娩", "13": "血液・造血器・免疫臓器の疾患",
    "14": "新生児疾患、先天性奇形", "15": "小児疾患", "16": "外傷・熱傷・中毒",
    "17": "精神疾患", "18": "その他",
}

SOURCES = {
    "facility.xlsx": "https://www.mhlw.go.jp/content/12404000/001717940.xlsx",
    "mdc.xlsx": "https://www.mhlw.go.jp/content/12404000/001718078.xlsx",
    "admission.xlsx": "https://www.mhlw.go.jp/content/12404000/001718079.xlsx",
    "ambulance.xlsx": "https://www.mhlw.go.jp/content/12404000/001718080.xlsx",
    "death24h.xlsx": "https://www.mhlw.go.jp/content/12404000/001718081.xlsx",
    "diagnosis-groups.xlsx": "https://www.mhlw.go.jp/content/12404000/001718086.xlsx",
    "definition-table.xlsx": "https://www.mhlw.go.jp/content/12404000/001452312.xlsx",
    "medical-area-municipalities.xlsx": "https://data.e-gov.go.jp/data/uploads/resource/%E4%BA%8C%E6%AC%A1%E5%8C%BB%E7%99%82%E5%9C%8F.xlsx",
}


def load_diagnosis_groups():
    """Create a compact searchable national DPC-classification dataset.

    This workbook is a national aggregate, not a facility table. Keep that
    distinction explicit in both the schema and the UI.
    """
    wb = load_workbook(RAW / "diagnosis-groups.xlsx", read_only=True, data_only=True)
    cohorts = {}
    for sheet in ["DPC対象病院", "DPC準備病院＋出来高算定病院", "全体"]:
        ws = wb[sheet]
        cohort = {}
        for row in ws.iter_rows(min_row=4, values_only=True):
            dpc = text(row[0])
            if not dpc:
                continue
            cohort[dpc] = row
        cohorts[sheet] = cohort

    rows = []
    for dpc, row in cohorts["全体"].items():
        def val(i):
            v = row[i]
            return v if isinstance(v, (int, float)) else text(v)

        def summed(indices):
            values = [val(i) for i in indices]
            return sum(values) if all(isinstance(x, (int, float)) for x in values) else "-"

        top_icd = [{"code": text(row[i]), "cases": val(i + 1)} for i in range(82, 112, 3) if text(row[i])]
        top_surgery = [{"code": text(row[i]), "cases": val(i + 1)} for i in range(142, 172, 3) if text(row[i])]
        target = cohorts["DPC対象病院"].get(dpc)
        prep = cohorts["DPC準備病院＋出来高算定病院"].get(dpc)
        rows.append({
            "code": dpc, "name": text(row[1]), "inclusive": text(row[2]) == "○",
            "mdc": text(row[3]), "mdcName": text(row[4]), "cases": val(7),
            "targetCases": target[7] if target and isinstance(target[7], (int, float)) else None,
            "prepCases": prep[7] if prep and isinstance(prep[7], (int, float)) else None,
            "male": val(10), "female": val(12),
            "ages": [val(i) for i in [14, 16, 18, 20, 22, 24, 26, 28]],
            "referral": val(34), "outpatient": val(36), "ambulance": val(38),
            "unplanned": val(40), "emergency": val(42),
            "homeDischarge": summed([49, 50, 51]),
            "transfer": val(52), "death": summed([63, 64]),
            "losMean": val(66), "losMedian": val(71), "los90": val(73),
            "icd": top_icd, "surgery": top_surgery,
            "ventilator": val(172), "dialysis": val(174), "centralLine": val(176), "transfusion": val(178),
        })
    rows.sort(key=lambda x: (-int(x["cases"] or 0), x["code"]))
    return rows



def load_surgery_definitions():
    """Extract disease-specific surgery branches 01-06 from the R6 definition table."""
    ws = load_workbook(RAW / "definition-table.xlsx", read_only=True, data_only=True).active
    diseases = {}
    current = None
    for row in ws.iter_rows(min_row=4, values_only=True):
        if row[0] is not None and row[1] is not None:
            current = text(row[0]).zfill(2) + text(row[1]).removesuffix(".0").zfill(4)
        if not current:
            continue
        branch = text(row[12])
        if branch not in {"01", "02", "03", "04", "05", "06"}:
            continue
        group = diseases.setdefault(current, {}).setdefault(
            branch, {"title": "", "procedures": []}
        )
        title = text(row[11])
        if title:
            group["title"] = title
        procedure = [text(row[14]), text(row[15])]
        if any(procedure) and procedure not in group["procedures"]:
            group["procedures"].append(procedure)
    return {
        "meta": {
            "year": "令和6年度",
            "effective": "2025-03-18",
            "source": SOURCES["definition-table.xlsx"],
            "note": "令和6年度末時点の厚生労働省DPC定義テーブルから抽出",
        },
        "diseases": diseases,
    }

def text(v):
    return "" if v is None else str(v).strip()


def code(v, width=5):
    s = text(v)
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(width) if s else ""


def public_number(v):
    if isinstance(v, (int, float)):
        return int(v), 0
    return 0, 1 if text(v) == "-" else 0


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_area_mapping():
    ws = load_workbook(RAW / "medical-area-municipalities.xlsx", read_only=True, data_only=True).active
    municipalities, areas = {}, {}
    for row in ws.iter_rows(min_row=6, values_only=True):
        area_code, muni_code = code(row[2], 4), code(row[4], 5)
        if not area_code or not muni_code:
            continue
        municipalities[muni_code] = area_code
        areas[area_code] = {"code": area_code, "name": text(row[3]), "prefecture": text(row[1])}
    # 浜松市は2024-01-01に7区から3区へ再編。対応表は2023-12-31時点、
    # 令和6年度DPC施設表は再編後コードのため、いずれも同じ西部医療圏へ接続する。
    municipalities.update({"22138": "2208", "22139": "2208", "22140": "2208"})
    return municipalities, areas


def load_facilities():
    ws = load_workbook(RAW / "facility.xlsx", read_only=True, data_only=True)["施設概要表"]
    facilities = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        notice = code(row[0])
        serial = code(row[1])
        if not notice or not serial:
            continue
        facilities[(notice, serial)] = {
            "notice": notice, "serial": serial, "municipality": code(row[2]),
            "prefecture": text(row[3]), "name": text(row[4]), "type": text(row[5]),
            "dpcBeds": int(row[6]) if isinstance(row[6], (int, float)) else None,
        }
    return facilities


def load_mdc(facilities, muni_to_area):
    ws = load_workbook(RAW / "mdc.xlsx", read_only=True, data_only=True)["件数"]
    hospitals = {}
    current = None
    for row in ws.iter_rows(min_row=4, values_only=True):
        if row[0] is not None:
            key = (code(row[0]), code(row[1]))
            base = facilities.get(key, {})
            current = {
                **base, "notice": key[0], "serial": key[1], "name": text(row[2]) or base.get("name", ""),
                "area": muni_to_area.get(base.get("municipality", "")),
                "mdc": {k: {"published": 0, "suppressed": 0, "surgeryPublished": 0, "surgerySuppressed": 0} for k in MDC_NAMES},
            }
            hospitals[key] = current
        if current is None or text(row[3]) not in {"無し", "有り"}:
            continue
        surgery = text(row[3]) == "有り"
        for idx, mdc in enumerate(MDC_NAMES, start=4):
            value, suppressed = public_number(row[idx])
            item = current["mdc"][mdc]
            item["published"] += value
            item["suppressed"] += suppressed
            if surgery:
                item["surgeryPublished"] += value
                item["surgerySuppressed"] += suppressed
    return hospitals


def add_matrix(hospitals, filename, per_mdc, fields):
    ws = load_workbook(RAW / filename, read_only=True, data_only=True).active
    for row in ws.iter_rows(min_row=4, values_only=True):
        key = (code(row[0]), code(row[1]))
        hospital = hospitals.get(key)
        if hospital is None:
            continue
        for mdc_index, mdc in enumerate(MDC_NAMES):
            for offset, field in fields.items():
                value, suppressed = public_number(row[3 + mdc_index * per_mdc + offset])
                hospital["mdc"][mdc][field + "Published"] = value
                hospital["mdc"][mdc][field + "Suppressed"] = suppressed


def totals(hospital):
    keys = ["published", "surgeryPublished", "emergencyPublished", "ambulancePublished"]
    for key in keys:
        hospital[key] = sum(v.get(key, 0) for v in hospital["mdc"].values())
        suppressed_key = key.replace("Published", "Suppressed") if key != "published" else "suppressed"
        hospital[suppressed_key] = sum(v.get(suppressed_key, 0) for v in hospital["mdc"].values())


def compact_hospital(h):
    return {k: h.get(k) for k in ["notice", "serial", "name", "municipality", "prefecture", "area", "type", "dpcBeds", "published", "suppressed", "surgeryPublished", "surgerySuppressed", "emergencyPublished", "emergencySuppressed", "ambulancePublished", "ambulanceSuppressed"]} | {"mdc": h["mdc"]}


def main():
    muni_to_area, area_master = load_area_mapping()
    facilities = load_facilities()
    hospitals = load_mdc(facilities, muni_to_area)
    add_matrix(hospitals, "admission.xlsx", 4, {3: "emergency"})
    add_matrix(hospitals, "ambulance.xlsx", 2, {0: "ambulance"})
    for hospital in hospitals.values():
        totals(hospital)
    diagnosis_groups = load_diagnosis_groups()
    surgery_definitions = load_surgery_definitions()

    area_values = defaultdict(lambda: defaultdict(int))
    unmapped = []
    for hospital in hospitals.values():
        area = hospital.get("area")
        if not area:
            unmapped.append({"name": hospital["name"], "municipality": hospital.get("municipality")})
            continue
        a = area_values[area]
        a["hospitalCount"] += 1
        for key in ["published", "suppressed", "surgeryPublished", "surgerySuppressed", "emergencyPublished", "emergencySuppressed", "ambulancePublished", "ambulanceSuppressed"]:
            a[key] += hospital.get(key, 0)

    OUT.mkdir(parents=True, exist_ok=True)
    pref_dir = OUT / "pref"
    pref_dir.mkdir(exist_ok=True)
    by_pref = defaultdict(list)
    for hospital in hospitals.values():
        pref_code = hospital.get("municipality", "")[:2]
        if pref_code:
            by_pref[pref_code].append(compact_hospital(hospital))
    for pref_code, rows in by_pref.items():
        rows.sort(key=lambda x: (x.get("area") or "9999", x["name"], x["serial"]))
        payload = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        (pref_dir / f"{pref_code}.json.gz").write_bytes(gzip.compress(payload, compresslevel=9, mtime=0))
        old_json = pref_dir / f"{pref_code}.json"
        if old_json.exists():
            old_json.unlink()

    source_manifest = []
    for filename, url in SOURCES.items():
        p = RAW / filename
        source_manifest.append({"filename": filename, "url": url, "bytes": p.stat().st_size, "sha256": sha256(p)})
    summary = {
        "meta": {
            "survey": "令和6年度DPCの評価・検証等に係る調査（退院患者調査）",
            "publishedPage": "https://www.mhlw.go.jp/stf/shingi2/newpage_00203.html",
            "corrected": "2026-06-30", "built": "2026-08-30",
            "hospitalCount": len(hospitals), "areaCount": len(area_values), "unmappedHospitalCount": len(unmapped),
            "sourceManifest": source_manifest,
        },
        "mdc": [{"code": k, "name": v} for k, v in MDC_NAMES.items()],
        "areas": [{**area_master[k], **dict(v)} for k, v in sorted(area_values.items())],
        "prefectures": sorted(by_pref),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    diagnosis_payload = json.dumps({
        "meta": {"scope": "全国集計", "classificationCount": len(diagnosis_groups), "surveyYear": "令和6年度"},
        "rows": diagnosis_groups,
    }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    (OUT / "diagnosis-groups.json.gz").write_bytes(gzip.compress(diagnosis_payload, compresslevel=9, mtime=0))
    (OUT / "surgery-definitions.json").write_text(json.dumps(surgery_definitions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    validation = {
        "status": "PASS" if len(area_values) == 335 and not unmapped else "WARN",
        "hospitalCount": len(hospitals), "areaCount": len(area_values), "unmappedHospitals": unmapped,
        "prefectureFiles": {k: len(v) for k, v in sorted(by_pref.items())},
    }
    (OUT / "validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(validation, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
