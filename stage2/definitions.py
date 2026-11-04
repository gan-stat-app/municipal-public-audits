"""Reviewed extraction from build-dpc-data.py; calculations unchanged."""
from pathlib import Path
from openpyxl import load_workbook
RAW = Path(__file__).resolve().parent / "raw"
SOURCES = {"definition-table.xlsx": "https://www.mhlw.go.jp/content/12404000/001452312.xlsx"}
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
