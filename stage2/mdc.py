"""MDC intermediate extraction; original constants and function bodies unchanged."""
from pathlib import Path
from openpyxl import load_workbook
RAW = Path(__file__).resolve().parent / "raw"

MDC_NAMES = {
    "01": "神経系疾患", "02": "眼科系疾患", "03": "耳鼻咽喉科系疾患",
    "04": "呼吸器系疾患", "05": "循環器系疾患", "06": "消化器系疾患、肝臓・胆道・膵臓疾患",
    "07": "筋骨格系疾患", "08": "皮膚・皮下組織疾患", "09": "乳房の疾患",
    "10": "内分泌・栄養・代謝疾患", "11": "腎・尿路系疾患及び男性生殖器系疾患",
    "12": "女性生殖器系疾患及び産褥期疾患・異常妊娠分娩", "13": "血液・造血器・免疫臓器の疾患",
    "14": "新生児疾患、先天性奇形", "15": "小児疾患", "16": "外傷・熱傷・中毒",
    "17": "精神疾患", "18": "その他",
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
