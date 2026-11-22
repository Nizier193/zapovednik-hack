"""Сверка расчётного ядра с эталоном архива и контрольными числами.

Запуск:
    python -m meteo.verify [путь_к_архиву]
"""

import sys
from datetime import date
from pathlib import Path

from .config import data_root
from .engine import (accepted_rows, aggregate_periods, circular_mean, daily_statistics,
                     ingest_archive, mean, month_quality, verify)


def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else data_root()
    ref_csv = root.parent / "coverage_by_month.csv"
    print("archive:", root)

    by_point = ingest_archive(root)
    report = verify(by_point, ref_csv)
    print(f"rows: total={report['total']} accepted={report['accepted']} conflict={report['conflict']}")
    print(f"coverage: rows={report['coverage_rows']} matched={report['coverage_matched']} "
          f"differences={report['coverage_differences']}")

    # Контрольная сверка температуры Кр1 (2024-01-01 и январь 2024).
    kr1_days = daily_statistics(by_point, "kr1", "t_air", date(2024, 1, 1), date(2024, 12, 31))
    day = kr1_days[date(2024, 1, 1)]
    print(f"kr1 t_air 2024-01-01: value={day['value']!r} n={day['n']} (ожидается -15.89395833333333, 48)")
    jan = [kr1_days[d] for d in (date(2024, 1, 1) + __import__('datetime').timedelta(days=i) for i in range(31))]
    jan_vals = [e["value"] for e in jan if e["value"] is not None]
    print(f"kr1 t_air 2024-01: mean={mean(jan_vals)!r} days={len(jan_vals)} (ожидается -10.60166143828395, 31)")

    # Давление Кр1 за 2024: 363 дня станции, 334 дня давления, 11 месяцев, 1362 флага range.
    kr1_p_days = daily_statistics(by_point, "kr1", "pressure_hpa", date(2024, 1, 1), date(2024, 12, 31))
    station_days = sum(1 for e in kr1_p_days.values() if e["station_valid"])
    pressure_days = sum(1 for e in kr1_p_days.values() if e["parameter_valid"])
    flags = 0
    for row in by_point["kr1"]:
        if row["statuses"].get("pressure_hpa") in ("source_range", "import_range"):
            flags += 1
    print(f"kr1 pressure 2024: station_days={station_days} pressure_days={pressure_days} flags={flags} "
          f"(ожидается 363 / 334 / 1362)")

    # Ветер: 359+1 -> 0, 90+270 -> не определено.
    print("wind 359+1 ->", circular_mean([359.0, 1.0]), "(ожидается ~0)")
    print("wind 90+270 ->", circular_mean([90.0, 270.0]), "(ожидается None)")


if __name__ == "__main__":
    main()
