# Журнал исключений: только строки, которые правила выводят из расчёта.
import csv
import json
from collections import Counter
from pathlib import Path

DATA = Path(r"c:\Users\kamau\Documents\CU\hackathon\meteo_clgz_hackathon\data")
OUT = Path(__file__).with_name("exceptions.json")
NAMES = {
    "t_air": "температура воздуха",
    "rh": "влажность",
    "wind_speed": "скорость ветра",
    "wind_gust": "порыв",
    "wind_dir": "направление ветра",
    "soil_05": "почва 5 см",
    "soil_10": "почва 10 см",
    "soil_20": "почва 20 см",
    "pressure_hpa": "давление",
}
WHY = {
    "range": "вне допустимого диапазона",
    "fault": "сбой датчика",
}


def reason(param, kind):
    if param == "wind_dir" and kind == "fault":
        return "направление за 2021 год недостоверно целиком"
    if param == "soil_05" and kind == "fault":
        return "сбой датчика почвы 5 см"
    title = NAMES.get(param, param)
    return f"{title}: {WHY.get(kind, kind)}"


def scan(path, station):
    counts = Counter()
    samples = {key: [] for key in ()}
    kept = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            raw = (row.get("qc_flag") or "").strip()
            if not raw:
                continue
            moment = (row.get("datetime") or "").strip()
            parts = [part.strip() for part in raw.split(";") if part.strip()]
            if "dup_conflict" in parts:
                counts[(station, "на один срок несколько разных значений, строка целиком")] += 1
                kept.append((station, moment, "вся строка", "", "на один срок несколько разных значений, строка целиком"))
                continue
            for part in parts:
                if ":" not in part:
                    continue
                param, kind = part.split(":", 1)
                if kind not in ("range", "fault"):
                    continue
                why = reason(param, kind)
                counts[(station, why)] += 1
                kept.append((station, moment, NAMES.get(param, param), (row.get(param) or "").strip(), why))
    return counts, kept


def main():
    counts = Counter()
    rows = []
    jobs = [(DATA / "ame60", "ame60"), (DATA / "sokol_m1", None)]
    for folder, forced in jobs:
        for path in sorted(folder.glob("*.csv")):
            station = forced or path.name.split("_")[0]
            part_counts, part_rows = scan(path, station)
            counts.update(part_counts)
            rows.extend(part_rows)
    year = DATA / "ame60" / "ame60_1998.csv"
    missing = 0
    if year.exists():
        with year.open(encoding="utf-8", newline="") as handle:
            missing = sum(1 for _ in csv.DictReader(handle))
    summary = [
        {"station": station, "why": why, "count": count}
        for (station, why), count in sorted(counts.items(), key=lambda item: (-item[1], item[0][0]))
    ]
    if missing:
        summary.append({"station": "ame60", "why": "в 1998 году колонки направления ветра нет", "count": missing})
    by_reason = {}
    for row in rows:
        by_reason.setdefault(row[4], [])
        if len(by_reason[row[4]]) < 80:
            by_reason[row[4]].append({
                "station": row[0], "when": row[1], "parameter": row[2], "value": row[3], "why": row[4]
            })
    examples = [item for group in by_reason.values() for item in group]
    OUT.write_text(json.dumps({"summary": summary, "rows": examples}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("summary", len(summary), "examples", len(examples), "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
