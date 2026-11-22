# Суточные ряды для дэшборда. Числа только из CSV, без заполнения пропусков.
import csv
import json
import math
from datetime import date, datetime, timedelta
from pathlib import Path

DATA = Path(r"c:\Users\kamau\Documents\CU\hackathon\meteo_clgz_hackathon\data")
OUT = Path(__file__).with_name("series.json")

AME = ["t_air", "rh", "wind_speed", "wind_gust", "wind_dir", "soil_05", "soil_10", "soil_20"]
SOKOL = ["t_air", "rh", "wind_speed", "wind_gust", "wind_dir", "pressure_hpa"]


def flags(text):
    bad = set()
    dup = False
    for part in (text or "").split(";"):
        part = part.strip()
        if not part:
            continue
        if part == "dup_conflict":
            dup = True
            continue
        if ":" in part:
            name, kind = part.split(":", 1)
            if kind in ("range", "fault"):
                bad.add(name)
    return bad, dup


def number(text):
    if text is None or str(text).strip() == "":
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    return value


def ingest(paths, metrics):
    slots = {}
    for path in paths:
        with path.open(encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                raw = (row.get("datetime") or "").strip()
                try:
                    moment = datetime.strptime(raw, "%Y-%m-%d %H:%M")
                except ValueError:
                    continue
                bad, dup = flags(row.get("qc_flag"))
                if dup or slots.get(raw) == "dup":
                    slots[raw] = "dup"
                    continue
                parsed = {}
                for metric in metrics:
                    if metric in bad or metric not in row:
                        continue
                    value = number(row.get(metric))
                    if value is not None:
                        parsed[metric] = value
                previous = slots.get(raw)
                if previous is None:
                    slots[raw] = (moment, parsed)
                elif previous[1] != parsed:
                    slots[raw] = "dup"
    days = {}
    for cell in slots.values():
        if cell == "dup":
            continue
        moment, parsed = cell
        bucket = days.get(moment.date())
        if bucket is None:
            bucket = {metric: [] for metric in metrics}
            bucket["_hours"] = {metric: set() for metric in metrics}
            days[moment.date()] = bucket
        for metric, value in parsed.items():
            bucket[metric].append(value)
            bucket["_hours"][metric].add(moment.hour)
    return days


def circle(values):
    count = len(values)
    east = sum(math.sin(math.radians(v)) for v in values) / count
    north = sum(math.cos(math.radians(v)) for v in values) / count
    if math.hypot(east, north) < 0.1:
        return None
    return round((math.degrees(math.atan2(east, north)) + 360) % 360, 4)


def pack(values, count, direction):
    if direction:
        mean = circle(values) if count else None
        return [mean, None, None, count]
    if not values:
        return [None, None, None, 0]
    return [round(sum(values) / len(values), 4), round(min(values), 4), round(max(values), 4), count]


def series_for(days, metrics, start, end, hourly, need):
    size = (end - start).days + 1
    series = {metric: [] for metric in metrics}
    for offset in range(size):
        day = start + timedelta(days=offset)
        bucket = days.get(day)
        for metric in metrics:
            if bucket is None:
                series[metric].append([None, None, None, 0])
                continue
            values = bucket[metric]
            count = len(bucket["_hours"][metric]) if hourly else len(values)
            if count < need:
                series[metric].append([None, None, None, count])
                continue
            if metric == "wind_dir":
                series[metric].append(pack(values, count, True))
            elif metric == "wind_gust":
                series[metric].append([round(max(values), 4), round(min(values), 4), round(max(values), 4), count])
            else:
                series[metric].append(pack(values, count, False))
    return {"start": start.isoformat(), "size": size, "series": series}


def month_gap(rows, year):
    failed = []
    for month in range(1, 13):
        start = date(year, month, 1)
        end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        days = (end - start).days
        origin = date(2024, 1, 1)
        offset = (start - origin).days
        chunk = rows[offset:offset + days]
        good = [row for row in chunk if row[0] is not None]
        streak = longest = 0
        for row in chunk:
            streak = streak + 1 if row[0] is None else 0
            longest = max(longest, streak)
        if days - len(good) > 10 or longest >= 5 or len(good) == 0:
            failed.append(month)
    return failed


def main():
    ame_days = ingest(sorted((DATA / "ame60").glob("ame60_*.csv")), AME)
    kr1_days = ingest(sorted((DATA / "sokol_m1").glob("kr1_*.csv")), SOKOL)
    kr2_days = ingest(sorted((DATA / "sokol_m1").glob("kr2_*.csv")), SOKOL)
    payload = {
        "ame60": series_for(ame_days, AME, date(1992, 7, 1), date(2021, 12, 31), False, 72),
        "kr1": series_for(kr1_days, SOKOL, date(2022, 1, 1), date(2025, 12, 31), True, 18),
        "kr2": series_for(kr2_days, SOKOL, date(2022, 1, 1), date(2025, 12, 31), True, 18),
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    ame = payload["ame60"]["series"]["t_air"]
    day = date(2014, 1, 1)
    index = (day - date(1992, 7, 1)).days
    pressure = payload["kr1"]["series"]["pressure_hpa"]
    year = pressure[(date(2024, 1, 1) - date(2022, 1, 1)).days:(date(2025, 1, 1) - date(2022, 1, 1)).days]
    print("bytes", OUT.stat().st_size)
    print("ame size", payload["ame60"]["size"], "2014-01-01", ame[index])
    print("kr1 2024 pressure days", sum(row[0] is not None for row in year), "failed months", month_gap(year, 2024))


if __name__ == "__main__":
    main()
