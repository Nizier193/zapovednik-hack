"""Суточный ветер для карты. Числа те же, что у meteo.engine.daily_statistics.

Скорость: среднее арифметическое пригодных wind_speed за сутки.
Направление: круговое среднее пригодных wind_dir (meteo.engine.circular_mean).
Сутки АМЕ-60: 72 срока из 96. Сокол: 18 разных часов из 24.
Это среднее за сутки, не климатическая норма. Время не сдвигается.
АМЕ-60 и Сокол не склеиваются.

Запуск (путь к CSV, либо переменная METEO_DATA):

  py -3 web/landing/map/build_wind.py C:\\path\\to\\meteo_clgz_hackathon\\data
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from meteo.config import STATION_LIMITS, day_threshold, expected_terms  # noqa: E402
from meteo.engine import daily_statistics, ingest_archive  # noqa: E402

OUT = Path(__file__).resolve().parent / "wind.json"
DECIMALS = 6

NAMES = {
    "ame60": "АМЕ-60",
    "kr1": "Кр1, поляна",
    "kr2": "Кр2, поле",
}


def _r(value):
    if value is None:
        return None
    value = float(value)
    if not math.isfinite(value):
        return None
    return round(value, DECIMALS)


def _phrase(station, entry, noun):
    return f"{entry['count']} из {entry['expected']} {noun}, нужно {entry['threshold']}"


def _noun(station):
    return "сроков" if station == "ame60" else "разных часов"


def classify(station, speed, direc):
    """Один день одной станции. vector только если есть и скорость, и направление."""
    year_block = None
    if station == "ame60" and speed["date"].year == 1998:
        year_block = "В 1998 году у АМЕ-60 нет столбца направления ветра"
    elif station == "ame60" and speed["date"].year == 2021:
        year_block = "Направление ветра АМЕ-60 за 2021 недостоверно (wind_dir:fault)"

    speed_value = _r(speed["value"]) if speed["status"] == "ok" else None
    dir_value = None
    if year_block is None and direc["status"] == "ok":
        dir_value = _r(direc["value"])

    base = {
        "speed_status": speed["status"],
        "dir_status": "blocked" if year_block else direc["status"],
        "station_count": speed["station_count"],
        "station_status": speed["station_status"],
        "speed_count": speed["count"],
        "speed_n": speed["n"],
        "dir_count": 0 if year_block else direc["count"],
        "dir_n": 0 if year_block else direc["n"],
        "expected": speed["expected"],
        "threshold": speed["threshold"],
    }

    if speed_value is not None and speed_value <= 1e-9:
        base.update(speed=0.0, dir=None, flow="calm", vector=False, reason="Штиль")
        return base

    if speed_value is not None and dir_value is not None:
        base.update(speed=speed_value, dir=dir_value, flow="vector", vector=True, reason="")
        return base

    if speed_value is not None:
        if year_block:
            reason = year_block
        elif direc["status"] == "undefined":
            reason = "Среднее направление не определено"
        elif direc["status"] == "incomplete":
            reason = "Направление неполное: " + _phrase(station, direc, _noun(station))
        else:
            reason = "Пригодного направления за сутки нет"
        base.update(speed=speed_value, dir=None, flow="speed", vector=False, reason=reason)
        return base

    noun = _noun(station)
    if speed["station_status"] == "incomplete":
        reason = "Сутки неполные: " + _phrase(station, {
            "count": speed["station_count"],
            "expected": speed["expected"],
            "threshold": speed["threshold"],
        }, noun)
    elif speed["station_status"] == "excluded":
        reason = "Сутки исключены: конфликтные строки не входят в расчёт"
    elif speed["status"] == "incomplete":
        reason = "Скорость ветра неполная: " + _phrase(station, speed, noun)
    elif speed["status"] == "excluded":
        reason = "Скорость ветра за сутки исключена"
    elif speed["status"] == "no_observations" or speed["station_status"] == "no_observations":
        reason = "Нет наблюдений за эти сутки"
    else:
        reason = "Нет пригодной скорости ветра за сутки"
    base.update(speed=None, dir=None, flow="none", vector=False, reason=reason)
    return base


def _keep(record):
    return record["station_status"] != "no_observations" or record["speed_status"] != "no_observations"


def build(by_point):
    stations = {}
    observed_max = 0.0
    dates = set()
    examples = {
        "shared": None,
        "ame_1998": None,
        "ame_2021": None,
        "calm": None,
        "southwest": None,
        "undefined_dir": None,
        "empty": "2001-06-15",
    }
    shared = []

    per_vectors = {key: [] for key in NAMES}

    for station in ("ame60", "kr1", "kr2"):
        start = date.fromisoformat(STATION_LIMITS[station][0])
        end = date.fromisoformat(STATION_LIMITS[station][1])
        assert expected_terms(station) == (96 if station == "ame60" else 24)
        assert day_threshold(station) == (72 if station == "ame60" else 18)
        print("aggregate", station, start.isoformat(), end.isoformat(), flush=True)
        speeds = daily_statistics(by_point, station, "wind_speed", start, end)
        dirs = daily_statistics(by_point, station, "wind_dir", start, end)
        days = {}
        for day in speeds:
            record = classify(station, speeds[day], dirs[day])
            if not _keep(record):
                continue
            iso = day.isoformat()
            days[iso] = record
            dates.add(iso)
            if record["speed"] is not None:
                observed_max = max(observed_max, record["speed"])
            if record["vector"]:
                per_vectors[station].append(iso)
            if station == "ame60" and day.year == 1998 and record["flow"] == "speed" and examples["ame_1998"] is None:
                examples["ame_1998"] = iso
            if station == "ame60" and day.year == 2021 and record["flow"] == "speed" and examples["ame_2021"] is None:
                examples["ame_2021"] = iso
            if record["flow"] == "calm" and examples["calm"] is None:
                examples["calm"] = iso
            if record["dir_status"] == "undefined" and record["speed"] is not None and examples["undefined_dir"] is None:
                examples["undefined_dir"] = iso
            if (record["vector"] and record["dir"] is not None and record["speed"] >= 1
                    and 202.5 <= record["dir"] < 247.5 and examples["southwest"] is None):
                examples["southwest"] = {"date": iso, "station": station, "dir": record["dir"], "speed": record["speed"]}
        stations[station] = {
            "name": NAMES[station],
            "period": [start.isoformat(), end.isoformat()],
            "vector_dates": per_vectors[station],
            "days": days,
        }
        print("  days", len(days), "vectors", len(per_vectors[station]), flush=True)

    kr_shared = set(per_vectors["kr1"]) & set(per_vectors["kr2"])
    if kr_shared:
        examples["shared"] = max(kr_shared)
        shared_day = examples["shared"]
        examples["shared_kr1"] = stations["kr1"]["days"][shared_day]
        examples["shared_kr2"] = stations["kr2"]["days"][shared_day]

    # Prefer a southwest day on a shared Kr date, so both local flows are on screen.
    sw_shared = None
    for iso in sorted(kr_shared, reverse=True):
        rec = stations["kr1"]["days"][iso]
        if rec["vector"] and rec["speed"] >= 1 and 202.5 <= rec["dir"] < 247.5:
            sw_shared = {"date": iso, "station": "kr1", "dir": rec["dir"], "speed": rec["speed"]}
            break
    if sw_shared:
        examples["southwest"] = sw_shared

    scale_max = max(1, int(math.ceil(observed_max - 1e-6)))
    archive_start = min(STATION_LIMITS[s][0] for s in NAMES)
    archive_end = max(STATION_LIMITS[s][1] for s in NAMES)
    payload = {
        "source": "meteo.engine.daily_statistics",
        "version": "map-wind-1",
        "label": "Среднее за сутки по архиву. Это не климатическая норма.",
        "rules": {
            "speed": "среднее арифметическое пригодных wind_speed",
            "direction": "круговое среднее пригодных wind_dir, градусы откуда дует",
            "ame_day": "72 срока из 96",
            "sokol_day": "18 разных часов из 24",
            "dup_conflict": "строка целиком вне расчёта",
            "flag": "флаг параметра исключает только этот параметр",
            "ame_1998": "столбца wind_dir нет, вектора нет",
            "ame_2021": "wind_dir:fault, вектора нет",
            "series": "АМЕ-60 и Сокол не объединяются",
            "time": "метки времени не сдвигались",
        },
        "scale_max_ms": scale_max,
        "observed_max_ms": round(observed_max, DECIMALS),
        "archive_start": archive_start,
        "archive_end": archive_end,
        "open_date": examples["shared"],
        "dates_with_data": sorted(dates),
        "examples": {
            "shared": examples["shared"],
            "ame_1998": examples["ame_1998"],
            "ame_2021": examples["ame_2021"],
            "calm": examples["calm"],
            "southwest": examples["southwest"],
            "undefined_dir": examples["undefined_dir"],
            "empty": examples["empty"],
        },
        "stations": stations,
    }
    return payload


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    env = os.environ.get("METEO_DATA", "")
    fallback = Path(r"C:\Users\kamau\Documents\CU\hackathon\meteo_clgz_hackathon\data")
    root = Path(arg or env or fallback)
    print("archive", root, flush=True)
    if not root.is_dir():
        raise SystemExit(f"archive not found: {root}")
    by_point = ingest_archive(root)
    print("rows", {key: len(rows) for key, rows in by_point.items()}, flush=True)
    payload = build(by_point)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote", OUT, "bytes", OUT.stat().st_size, flush=True)
    ex = payload["examples"]
    print("OPEN", ex["shared"], flush=True)
    if ex["shared"]:
        for key in ("kr1", "kr2", "ame60"):
            rec = payload["stations"][key]["days"].get(ex["shared"])
            print(" ", key, rec["flow"] if rec else "outside-or-empty",
                  rec.get("speed") if rec else None, rec.get("dir") if rec else None,
                  rec.get("reason") if rec else "", flush=True)
    print("EXAMPLES", json.dumps(ex, ensure_ascii=False), flush=True)
    # Guards: banned years never carry a direction vector.
    for iso, rec in payload["stations"]["ame60"]["days"].items():
        if iso.startswith("1998") or iso.startswith("2021"):
            if rec["vector"] or rec["dir"] is not None:
                raise SystemExit(f"direction leaked for AME {iso}")


if __name__ == "__main__":
    main()
