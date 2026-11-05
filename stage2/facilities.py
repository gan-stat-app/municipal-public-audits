"""Facility-only extraction; original function bodies unchanged."""
from pathlib import Path
from openpyxl import load_workbook
RAW = Path(__file__).resolve().parent / "raw"

def text(v):
    return "" if v is None else str(v).strip()

def code(v, width=5):
    s = text(v)
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(width) if s else ""

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
