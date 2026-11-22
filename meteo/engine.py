"""Импорт, контроль качества и расчёт покрытия/агрегатов.

Одна реализация правил используется и для агрегатов, и для журнала качества,
и для выгрузки — график, таблица и Excel получают один и тот же расчётный
результат. Хранение — in-memory словари; для API поверх этого ядра добавлен
тонкий слой (см. meteo.api).
"""

from __future__ import annotations

import calendar
import csv
import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

from .config import (
    DIRECTIONS, MIN_TREND_YEARS, PARAMETERS, RANGES, SPEED_BINS, STATION_LIMITS, STATIONS,
    day_threshold, expected_terms, station_parameters,
)

DAY = timedelta(days=1)


# ---------------------------------------------------------------------------
# Разбор значений и флагов качества
# ---------------------------------------------------------------------------

def parse_value(raw):
    """Возвращает (значение, статус). Статус: ok / missing_column / empty / invalid_number."""
    if raw is None:
        return None, "missing_column"
    if not str(raw).strip():
        return None, "empty"
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None, "invalid_number"
    if not math.isfinite(value):
        return None, "invalid_number"
    return value, "ok"


def split_flags(raw_flags, parameters):
    """Разбирает qc_flag. Возвращает (набор флагов, {параметр: статус-источника}, неизвестные)."""
    flags = {piece.strip() for piece in (raw_flags or "").split(";") if piece.strip()}
    reasons = {}
    unknown = []
    for flag in sorted(flags - {"dup_conflict"}):
        parameter, sep, reason = flag.partition(":")
        if sep and parameter in parameters and reason:
            status = {"range": "source_range", "fault": "source_fault"}.get(reason, "source_flag")
            reasons.setdefault(parameter, status)
        else:
            unknown.append(flag)
    return flags, reasons, unknown


def check_value(name, value, parsed_status, source_status, point, year, air):
    """Приоритет: статус разбора -> флаг источника -> правила импорта -> диапазон."""
    if parsed_status != "ok":
        return parsed_status
    if source_status:
        return source_status
    if point == "ame60" and name == "wind_dir" and year == 2021:
        return "import_fault"
    if point == "ame60" and name == "soil_05" and air is not None and air > 0 and value < -15:
        return "import_fault"
    low, high = RANGES[name]
    return "ok" if low <= value <= high else "import_range"


def _observation_time(raw):
    raw = (raw or "").strip()
    if len(raw) != 16 or raw[4] != "-" or raw[7] != "-" or raw[10] != " " or raw[13] != ":":
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M")
    except ValueError:
        return None


def _signature(point, qc_flag, raw_values):
    return (point, tuple(raw_values))


# ---------------------------------------------------------------------------
# Импорт CSV
# ---------------------------------------------------------------------------

def _read_rows(path, point):
    """Читает один CSV и возвращает список сырых записей."""
    applicable = station_parameters(point)
    rows = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for line_no, raw in enumerate(reader, start=2):  # строка 1 — заголовок
            original_time = (raw.get("datetime") or "").strip()
            ts = _observation_time(original_time)
            qc_flag = raw.get("qc_flag") or ""
            flags, source_reasons, _unknown = split_flags(qc_flag, PARAMETERS)
            source_conflict = "dup_conflict" in flags
            air, _ = parse_value(raw.get("t_air"))
            year = ts.year if ts else None
            values = {}
            statuses = {}
            for name in PARAMETERS:
                if name not in applicable:
                    continue
                value, parsed = parse_value(raw.get(name))
                status = (check_value(name, value, parsed, source_reasons.get(name), point, year, air)
                          if name in raw else "missing_column")
                values[name] = value
                statuses[name] = status
            rows.append({
                "point": point,
                "ts": ts,
                "original_time": original_time,
                "file": path.name,
                "line": line_no,
                "qc_flag": qc_flag,
                "values": values,
                "statuses": statuses,
                "source_conflict": source_conflict,
                "signature": _signature(point, qc_flag, tuple(raw.get(n) for n in applicable)),
            })
    return rows


def ingest_archive(root):
    """Читает все CSV архива и возвращает {point: [rows...]} с решёнными статусами.

    Статус строки: accepted / duplicate / conflict / invalid_time.
    """
    root = Path(root)
    by_point = defaultdict(list)
    jobs = [("ame60", "ame60", "ame60_*.csv"),
            ("kr1", "sokol_m1", "kr1_*.csv"),
            ("kr2", "sokol_m1", "kr2_*.csv")]
    for point, folder, pattern in jobs:
        for path in sorted((root / folder).glob(pattern)):
            by_point[point].extend(_read_rows(path, point))
    for point, rows in by_point.items():
        rows.sort(key=lambda r: (r["ts"] or datetime.min, r["file"], r["line"]))
    _apply_decisions(by_point)
    return by_point


def _apply_decisions(by_point):
    """Дубликаты и конфликты по ключу (точка, записанное время)."""
    for point, rows in by_point.items():
        groups = defaultdict(list)
        for row in rows:
            groups[row["ts"]].append(row)
        for ts, group in groups.items():
            if ts is None:
                for row in group:
                    row["state"] = "invalid_time"
                continue
            distinct = {row["signature"] for row in group}
            conflict = any(row["source_conflict"] for row in group) or len(distinct) > 1
            for row in group:
                if conflict:
                    row["state"] = "conflict"
                else:
                    # Точные повторы учитываются один раз; первый — accepted, остальные duplicate.
                    row["state"] = "duplicate"
            if not conflict:
                group[0]["state"] = "accepted"


def accepted_rows(by_point, point):
    return [r for r in by_point[point] if r["state"] == "accepted"]


# ---------------------------------------------------------------------------
# Полнота суток и месяцев
# ---------------------------------------------------------------------------

def _term(ts, point):
    return ts if point == "ame60" else ts.replace(minute=0, second=0, microsecond=0)


def daily_statistics(by_point, station, parameter, start, end):
    """Посуточная статистика для станции и параметра.

    Покрытие считается отдельно у станции (пригодные сроки) и у параметра
    (сроки с пригодным значением). Возвращает dict[date -> point-dict].
    """
    threshold = day_threshold(station)
    expected = expected_terms(station)
    rows = by_point[station]
    by_day = defaultdict(lambda: {"raw_n": 0, "station_terms": set(), "param_terms": set(),
                                  "values": [], "station_n": 0})
    for row in rows:
        if row["ts"] is None:
            continue
        day = row["ts"].date()
        if day < start or day > end:
            continue
        bucket = by_day[day]
        bucket["raw_n"] += 1
        if row["state"] == "accepted":
            bucket["station_n"] += 1
            bucket["station_terms"].add(_term(row["ts"], station))
            status = row["statuses"].get(parameter)
            if status == "ok":
                bucket["param_terms"].add(_term(row["ts"], station))
                bucket["values"].append(row["values"][parameter])
    output = {}
    cursor = start
    while cursor <= end:
        bucket = by_day.get(cursor)
        if bucket is None:
            station_status = "no_observations"
            parameter_status = "no_observations"
            value = None
            n = 0
            count = 0
            low = high = None
            station_count = 0
        else:
            station_count = len(bucket["station_terms"])
            station_status = ("ok" if station_count >= threshold
                              else "no_observations" if not bucket["raw_n"]
                              else "excluded" if not bucket["station_n"] else "incomplete")
            n = len(bucket["values"])
            count = len(bucket["param_terms"])
            if parameter == "wind_dir":
                value = circular_mean(bucket["values"]) if bucket["values"] else None
                low = high = None
            else:
                value = sum(bucket["values"]) / n if bucket["values"] else None
                low = min(bucket["values"]) if bucket["values"] else None
                high = max(bucket["values"]) if bucket["values"] else None
            if not bucket["raw_n"]:
                parameter_status = "no_observations"
            elif not n:
                parameter_status = "excluded" if bucket["station_n"] else "no_observations"
            elif count >= threshold:
                parameter_status = "ok"
            else:
                parameter_status = "incomplete"
            if parameter == "wind_dir" and n and parameter_status == "ok" and value is None:
                parameter_status = "undefined"
        output[cursor] = {
            "date": cursor, "value": value if parameter_status == "ok" else None,
            "count": count, "n": n,
            "status": parameter_status,
            "min": low, "max": high,
            "expected": expected, "threshold": threshold,
            "station_count": station_count, "station_status": station_status,
            "parameter_valid": parameter_status == "ok",
            "station_valid": station_status == "ok",
        }
        cursor += DAY
    return output


def month_completeness(valid_days):
    """(проходит, неполных, максимум подряд). Допустимо <=10 неполных и <=4 подряд."""
    run = longest = 0
    missing = 0
    for valid in valid_days:
        if valid:
            run = 0
        else:
            missing += 1
            run += 1
            longest = max(longest, run)
    return missing <= 10 and longest <= 4, missing, longest


def month_quality(days, start, end):
    """Помесячное покрытие по календарным месяцам, включая пустые дни."""
    output = []
    cursor = start.replace(day=1)
    while cursor <= end:
        first = cursor.replace(day=1)
        last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
        part_start = max(start, first)
        part_end = min(end, last)
        entries = [days[d] for d in _iter_dates(part_start, part_end)]
        partial = part_start != first or part_end != last
        station_valid = [e["station_valid"] for e in entries]
        param_valid = [e["parameter_valid"] for e in entries]
        s_full, s_missing, s_run = month_completeness(station_valid)
        p_full, p_missing, p_run = month_completeness(param_valid)
        output.append({
            "x": first.isoformat(), "start": part_start, "end": part_end, "partial": partial,
            "calendar_days": (last - first).days + 1, "selected_days": len(entries),
            "station_valid_days": len(entries) - s_missing,
            "parameter_valid_days": len(entries) - p_missing,
            "station_valid": s_full and not partial,
            "parameter_valid": p_full and not partial,
            "station_missing_days": s_missing, "station_longest_gap": s_run,
            "missing_days": p_missing, "longest_gap": p_run,
            "month": first.month, "year": first.year,
        })
        cursor = last + DAY
    return output


def coverage_table(by_point):
    """Покрытие по станции (уровень станции) для сравнения с coverage_by_month.csv."""
    rows = []
    for station in STATIONS:
        limit = STATION_LIMITS[station]
        start = date.fromisoformat(limit[0])
        end = date.fromisoformat(limit[1])
        days = daily_statistics(by_point, station, None, start, end)
        months = month_quality(days, start, end)
        for m in months:
            rows.append({
                "station": "AME60" if station == "ame60" else station.upper(),
                "year": m["year"], "month": m["month"],
                "days_in_month": m["calendar_days"],
                "valid_days": m["station_valid_days"],
                "month_valid": m["station_valid"],
            })
    return rows


# ---------------------------------------------------------------------------
# Утилиты
# ---------------------------------------------------------------------------

def _iter_dates(start, end):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += DAY


def circular_mean(values):
    if not values:
        return None
    east = sum(math.sin(math.radians(v)) for v in values)
    north = sum(math.cos(math.radians(v)) for v in values)
    if math.hypot(east, north) / len(values) < 1e-10:
        return None
    direction = math.degrees(math.atan2(east, north)) % 360
    return 0.0 if direction >= 360 - 1e-10 else direction


def mean(values):
    return sum(values) / len(values) if values else None


# ---------------------------------------------------------------------------
# Агрегаты по уровням
# ---------------------------------------------------------------------------

def aggregate_days(days, start, end, parameter, station):
    """Дневной ряд в виде списка точек {x, value, count, status, min, max, ...}."""
    output = []
    for d in _iter_dates(start, end):
        entry = days[d]
        output.append({
            "x": d.isoformat(), "start": d.isoformat(), "end": d.isoformat(),
            "value": entry["value"], "count": entry["n"],
            "status": entry["status"], "min": entry["min"], "max": entry["max"],
            "station_valid": entry["station_valid"], "parameter_valid": entry["parameter_valid"],
            "station_count": entry["station_count"], "threshold": entry["threshold"],
        })
    return output


def aggregate_periods(days, start, end, parameter, station, level):
    """Агрегаты по декадам или месяцам."""
    output = []
    cursor = start
    while cursor <= end:
        first = cursor.replace(day=1)
        last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
        if level == "dekad":
            if cursor.day <= 10:
                first, last = cursor.replace(day=1), cursor.replace(day=10)
            elif cursor.day <= 20:
                first, last = cursor.replace(day=11), cursor.replace(day=20)
            else:
                first = cursor.replace(day=21)
        part_start = max(start, first)
        part_end = min(end, last)
        entries = [days[d] for d in _iter_dates(part_start, part_end)]
        partial = part_start != first or part_end != last
        param_valid = [e["parameter_valid"] for e in entries]
        p_full, p_missing, p_run = month_completeness(param_valid) if level == "month" else (any(param_valid), sum(not v for v in param_valid), None)
        values = [e["value"] for e in entries if e["value"] is not None]
        permitted = bool(values) and (partial or p_full or level != "month")
        circular = parameter == "wind_dir"
        value = circular_mean(values) if (circular and permitted) else (mean(values) if permitted else None)
        status = "partial" if partial else ("ok" if p_full else "incomplete" if values else "no_observations")
        output.append({
            "x": first.isoformat(), "start": part_start.isoformat(), "end": part_end.isoformat(),
            "value": value, "count": len(values), "status": status,
            "min": min(values) if (permitted and not circular) else None,
            "max": max(values) if (permitted and not circular) else None,
            "partial": partial, "valid_days": len(values),
            "missing_days": p_missing, "longest_gap": p_run,
        })
        cursor = last + DAY
    return output


# ---------------------------------------------------------------------------
# Ветер
# ---------------------------------------------------------------------------

def wind_distribution(by_point, station, start, end):
    """Роза ветров из пригодных срочных наблюдений, 16 секторов + штиль отдельно."""
    reason = _wind_unavailable(station, start, end)
    if reason:
        return {"station": station, "sectors": [], "status": "unavailable", "reason": reason,
                "observations": 0, "denominator": 0}
    bins = Counter()
    calm = 0
    for row in by_point[station]:
        ts = row["ts"]
        if ts is None or ts.date() < start or ts.date() > end:
            continue
        if row["state"] != "accepted":
            continue
        if row["statuses"].get("wind_speed") != "ok":
            continue
        speed = row["values"].get("wind_speed")
        if speed == 0:
            calm += 1
            continue
        if row["statuses"].get("wind_dir") != "ok":
            continue
        if station == "ame60" and ts.year in (1998, 2021):
            continue
        direction = row["values"].get("wind_dir")
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
        bins[(sector, sbin)] += 1
    denominator = calm + sum(bins.values())
    if not denominator:
        return {"station": station, "sectors": [], "status": "no_observations",
                "reason": "Нет пригодных срочных данных ветра", "observations": 0, "denominator": 0}
    sectors = []
    for index, name in enumerate(DIRECTIONS):
        counts = [bins.get((index, s), 0) for s in range(len(SPEED_BINS))]
        sectors.append({
            "name": name, "degrees": 22.5 * index, "count": sum(counts),
            "percent": 100 * sum(counts) / denominator,
            "bins": [{"label": lbl, "count": c, "percent": 100 * c / denominator} for lbl, c in zip(SPEED_BINS, counts)],
        })
    return {"station": station, "sectors": sectors, "status": "ok", "observations": denominator,
            "directional_observations": denominator - calm, "denominator": denominator,
            "calm": calm, "calm_percent": 100 * calm / denominator, "unit": "%",
            "speed_unit": "м/с", "speed_bins": list(SPEED_BINS),
            "note": "Знаменатель включает штиль при 0 м/с и ненулевые скорости с пригодным направлением"}


def _wind_unavailable(station, start, end):
    if station == "ame60" and start.year == end.year:
        if start.year == 1998:
            return "В 1998 году АМЕ-60 не измеряла направление ветра"
        if start.year == 2021:
            return "За весь 2021 год направление ветра АМЕ-60 помечено как недостоверное"
    return None


# ---------------------------------------------------------------------------
# Сравнение Кр1 и Кр2
# ---------------------------------------------------------------------------

def compare_points(kr1_days, kr2_days, start, end):
    """Месячная разность по общим пригодным суткам."""
    output = []
    cursor = start.replace(day=1)
    while cursor <= end:
        first = cursor.replace(day=1)
        last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
        part_start = max(start, first)
        part_end = min(end, last)
        pairs = [(d, kr1_days[d]["value"], kr2_days[d]["value"]) for d in _iter_dates(part_start, part_end)]
        shared = [(d, a, b) for d, a, b in pairs if a is not None and b is not None]
        valid, missing, longest = month_completeness([a is not None and b is not None for _, a, b in pairs])
        partial = (first, last) != (part_start, part_end)
        value = None
        cr1 = mean([a for _, a, _ in shared])
        cr2 = mean([b for _, _, b in shared])
        if partial:
            status, reason = "partial", "Для разности нужен целиком выбранный календарный месяц"
        elif not valid:
            status = "no_observations" if not shared else "incomplete"
            reason = f"Общих пригодных суток {len(shared)} из {len(pairs)}. Неполных {missing}, подряд {longest}"
        else:
            status, reason = "ok", None
            value = cr1 - cr2
        output.append({
            "x": first.isoformat(), "start": part_start.isoformat(), "end": part_end.isoformat(),
            "value": value, "count": len(shared), "status": status, "reason": reason,
            "kr1_mean": cr1, "kr2_mean": cr2, "shared_days": len(shared),
            "expected": len(pairs), "missing_days": missing, "longest_gap": longest,
        })
        cursor = last + DAY
    return output


def diurnal_records(by_point, station, parameter, days):
    """Среднее внутри часа каждого пригодного дня -> dict[(day, hour) -> value]."""
    eligible = {d for d, e in days.items() if e["parameter_valid"]}
    if not eligible:
        return {}
    by_hour = defaultdict(list)
    for row in by_point[station]:
        ts = row["ts"]
        if ts is None or ts.date() not in eligible:
            continue
        if row["state"] != "accepted" or row["statuses"].get(parameter) != "ok":
            continue
        by_hour[(ts.date(), ts.hour)].append(row["values"][parameter])
    circular = parameter == "wind_dir"
    return {(d, h): (circular_mean(vals) if circular else mean(vals)) for (d, h), vals in by_hour.items()}


def diurnal_points(hourly, station, parameter, start, end, shared=None):
    output = []
    by_hour = [[] for _ in range(24)]
    keys = sorted(shared) if shared is not None else list(hourly)
    for key in keys:
        value = hourly.get(key)
        if value is not None:
            by_hour[key[1]].append((key[0], value))
    circular = parameter == "wind_dir"
    for hour, group in enumerate(by_hour):
        values = [v for _, v in group]
        value = circular_mean(values) if circular else mean(values)
        output.append({
            "x": f"{hour:02d}:00", "start": start.isoformat(), "end": end.isoformat(),
            "value": value, "count": len(values), "hour": hour,
            "status": "ok" if value is not None else "no_observations",
            "shared_days": len(values) if shared is not None else None,
            "dates": [d.isoformat() for d, _ in group] if len(group) <= 366 else None,
        })
    return output


# ---------------------------------------------------------------------------
# Годовой ход, отклонения, тренд
# ---------------------------------------------------------------------------

def annual_points(months, station, parameter, start, end):
    output = []
    for number in range(1, 13):
        group = [m for m in months if m["month"] == number and m["parameter_valid"] and m["value"] is not None]
        values = [m["value"] for m in group]
        years = [m["year"] for m in group]
        circular = parameter == "wind_dir"
        value = circular_mean(values) if circular else mean(values)
        output.append({
            "x": f"{number:02d}", "month": number, "start": start.isoformat(), "end": end.isoformat(),
            "value": value, "count": len(years), "years": years,
            "status": "ok" if value is not None else "no_observations",
            "min": min(values) if (values and not circular) else None,
            "max": max(values) if (values and not circular) else None,
        })
    return output


def trend_series(months, station, parameter, trend_month):
    subject = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август",
               "сентябрь", "октябрь", "ноябрь", "декабрь"][trend_month - 1]
    if parameter == "wind_dir":
        return {"slope": None, "years": [], "missing": [], "note": "Линейный тренд не применяется к круговому направлению"}
    selected = [m for m in months if m["month"] == trend_month and not m["partial"]]
    eligible = [(m["year"], m["value"]) for m in selected if m["parameter_valid"] and m["value"] is not None]
    missing = [m["year"] for m in selected if not m["parameter_valid"] or m["value"] is None]
    if len(eligible) < MIN_TREND_YEARS:
        return {"slope": None, "years": [y for y, _ in eligible], "missing": missing,
                "note": f"Для линейной оценки нужны не менее {MIN_TREND_YEARS} пригодных лет. Найдено {len(eligible)}"}
    xs = [y for y, _ in eligible]
    ys = [v for _, v in eligible]
    xm = mean(xs)
    ym = mean(ys)
    spread = sum((x - xm) ** 2 for x in xs)
    slope = sum((x - xm) * (y - ym) for x, y in zip(xs, ys)) / spread
    return {"slope": slope, "years": xs, "missing": missing, "note": None,
            "subject": subject, "unit": PARAMETERS[parameter][1]}


# ---------------------------------------------------------------------------
# Проверка против эталона
# ---------------------------------------------------------------------------

def verify(by_point, reference_csv):
    """Сверяет число строк и покрытие с эталоном. Возвращает отчёт."""
    total = accepted = conflict = 0
    for point, rows in by_point.items():
        total += len(rows)
        accepted += sum(1 for r in rows if r["state"] == "accepted")
        conflict += sum(1 for r in rows if r["state"] == "conflict")
    report = {"total": total, "accepted": accepted, "conflict": conflict}
    coverage = coverage_table(by_point)
    ref = {}
    with open(reference_csv, encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            key = (row["station"], int(row["year"]), int(row["month"]))
            ref[key] = (int(row["valid_days"]), row["month_valid"].strip().lower() in ("true", "1"))
    matched = differences = 0
    for row in coverage:
        key = (row["station"], row["year"], row["month"])
        if key in ref:
            expected_days, expected_valid = ref[key]
            if expected_days == row["valid_days"] and expected_valid == row["month_valid"]:
                matched += 1
            else:
                differences += 1
    report["coverage_rows"] = len(coverage)
    report["coverage_matched"] = matched
    report["coverage_differences"] = differences
    return report
