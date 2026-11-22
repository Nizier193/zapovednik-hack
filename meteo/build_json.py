"""Генерация производных JSON (кеш/демо-данные) из исходных CSV через расчётное ядро.

series.json и exceptions.json — производные данные; их происхождение и версия
фиксируются явно. Для проверки формул и разработки импорта используйте исходные
CSV, а не эти JSON. Числа в JSON округлены только для отображения (расчёт в ядре
ведётся с полной точностью).
"""

from __future__ import annotations

import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path

from .config import PARAMETERS, STATIONS, STATION_LIMITS, TIME_NOTE, VERSION, station_parameters
from .engine import accepted_rows, daily_statistics, ingest_archive, month_quality

OUT_DIR = Path(__file__).resolve().parents[1] / "web" / "landing" / "dashboard"
DECIMALS = 6

VALUE_REASONS = {
    "empty": "пустая ячейка",
    "invalid_number": "ошибка разбора числа",
    "source_range": "вне допустимого диапазона (флаг источника)",
    "source_fault": "сбой датчика (флаг источника)",
    "source_flag": "флаг источника",
    "import_range": "вне допустимого диапазона (обнаружено при импорте)",
    "import_fault": "сбой (обнаружено при импорте)",
}
ROW_REASONS = {
    "conflict": "противоречащие записи или dup_conflict",
    "duplicate": "точная копия срока",
    "invalid_time": "невалидный срок",
}


def _r(value):
    if value is None:
        return None
    if isinstance(value, float):
        value = round(value, DECIMALS)
    return value


def _wind_daily_map(by_point, station):
    """Роза по суткам одним проходом: {дата: [calm, s0b0, ..., s15b4]}."""
    out = {}
    for row in by_point[station]:
        ts = row["ts"]
        if ts is None:
            continue
        if row["state"] != "accepted" or row["statuses"].get("wind_speed") != "ok":
            continue
        speed = row["values"]["wind_speed"]
        day = ts.date().isoformat()
        bucket = out.get(day)
        if bucket is None:
            bucket = [0] * 81
            out[day] = bucket
        if speed == 0:
            bucket[0] += 1
            continue
        if row["statuses"].get("wind_dir") != "ok":
            continue
        if station == "ame60" and ts.year in (1998, 2021):
            continue
        direction = row["values"]["wind_dir"]
        sector = int(math.floor((direction + 11.25) / 22.5)) % 16
        if speed < 2:
            sbin = 0
        elif speed < 5:
            sbin = 1
        elif speed < 10:
            sbin = 2
        elif speed < 15:
            sbin = 3
        else:
            sbin = 4
        bucket[1 + sector * 5 + sbin] += 1
    return out


def build_series(by_point):
    payload = {"version": VERSION, "time_note": TIME_NOTE, "source": "meteo.build_json",
               "stations": {}}
    for station, (label, _short, params) in STATIONS.items():
        lo = date.fromisoformat(STATION_LIMITS[station][0])
        hi = date.fromisoformat(STATION_LIMITS[station][1])
        entry = {"label": label, "start": lo.isoformat(), "end": hi.isoformat(),
                 "parameters": list(params), "series": {}, "wind_days": {}}
        for parameter in params:
            days = daily_statistics(by_point, station, parameter, lo, hi)
            entry["series"][parameter] = {
                "unit": PARAMETERS[parameter][1],
                "days": [{"d": d.isoformat(), "v": _r(e["value"]), "min": _r(e["min"]), "max": _r(e["max"]),
                          "n": e["n"], "cov": e["count"], "threshold": e["threshold"],
                          "valid": e["parameter_valid"], "station_valid": e["station_valid"]}
                         for d, e in days.items()],
            }
        if "wind_dir" in params:
            entry["wind_days"] = _wind_daily_map(by_point, station)
        payload["stations"][station] = entry
    return payload


def build_exceptions(by_point):
    rows = []
    for station in STATIONS:
        for row in by_point[station]:
            if row["state"] == "invalid_time":
                rows.append({"station": station, "when": row["original_time"], "parameter": None,
                             "value": None, "reason": ROW_REASONS["invalid_time"], "kind": "row",
                             "file": row["file"], "line": row["line"]})
                continue
            if row["state"] == "conflict":
                rows.append({"station": station, "when": row["original_time"], "parameter": None,
                             "value": None,
                             "reason": "на один срок несколько разных значений или dup_conflict — строка целиком",
                             "kind": "row", "file": row["file"], "line": row["line"]})
            if row["state"] != "accepted":
                continue
            for parameter in station_parameters(station):
                status = row["statuses"].get(parameter)
                if status not in ("ok", "missing_column", "not_applicable"):
                    rows.append({"station": station, "when": row["original_time"],
                                 "parameter": parameter, "value": _r(row["values"].get(parameter)),
                                 "reason": VALUE_REASONS.get(status, status), "kind": "value",
                                 "status": status, "file": row["file"], "line": row["line"]})
    return {"version": VERSION, "rows": rows}


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    from .config import data_root
    root = root or data_root()
    by_point = ingest_archive(root)
    series = build_series(by_point)
    exceptions = build_exceptions(by_point)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "series.json").write_text(json.dumps(series, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT_DIR / "exceptions.json").write_text(json.dumps(exceptions, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("series.json bytes:", (OUT_DIR / "series.json").stat().st_size)
    print("exceptions.json bytes:", (OUT_DIR / "exceptions.json").stat().st_size,
          "rows:", len(exceptions["rows"]))


if __name__ == "__main__":
    main()
