"""Выгрузка .xlsx для выбранной карточки (исходные наблюдения или агрегат).

Книга содержит три листа: «Данные», «Покрытие и флаги», «Методика и фильтры».
Числа пишутся как числа, исходные сроки и единицы сохраняются, указываются
версия данных и методики. Сокращение ряда для графика не влияет на выгрузку.
"""

from __future__ import annotations

import json
from datetime import date

import xlsxwriter

from .config import PARAMETERS, STATIONS, TIME_NOTE, VERSION
from .engine import daily_statistics, month_quality

MAX_EXCEL_ROWS = 1_048_576


def _station_name(station):
    return STATIONS.get(station, (station, station))[0]


def _parameter_name(parameter):
    return PARAMETERS.get(parameter, (parameter, ""))[0]


def _unit(parameter):
    return PARAMETERS.get(parameter, ("", ""))[1]


class Sheets:
    def __init__(self, book, name, headers, widths, formats):
        self.book, self.name, self.headers, self.widths = book, name, headers, widths
        self.header, self.number, self.paragraph = formats
        self.part = 0
        self.sheet = None
        self.row = MAX_EXCEL_ROWS

    def start_sheet(self):
        self.finish()
        self.part += 1
        name = self.name if self.part == 1 else f"{self.name} {self.part}"
        self.sheet = self.book.add_worksheet(name)
        self.sheet.hide_gridlines(2)
        self.sheet.freeze_panes(1, 0)
        self.sheet.set_row(0, 29)
        for i, width in enumerate(self.widths):
            self.sheet.set_column(i, i, width)
        self.sheet.write_row(0, 0, self.headers, self.header)
        self.row = 1

    def write(self, values):
        if self.row >= MAX_EXCEL_ROWS:
            self.start_sheet()
        for column, value in enumerate(values):
            if isinstance(value, (list, tuple, dict)):
                value = json.dumps(value, ensure_ascii=False, default=str)
            if value is not None:
                fmt = self.number if isinstance(value, float) else self.paragraph
                self.sheet.write(self.row, column, value, fmt)
        self.row += 1

    def finish(self):
        if self.sheet is not None:
            self.sheet.autofilter(0, 0, max(1, self.row - 1), len(self.headers) - 1)


AGGREGATE_HEADERS = (
    "Карточка", "Точка", "Параметр", "Единица", "Метка", "Начало", "Конец", "Значение",
    "Минимум", "Максимум", "Объём выборки", "Статус", "Причина", "Версия данных", "Версия методики",
)
RAW_HEADERS = (
    "Карточка", "Точка", "Время", "Файл", "Строка", "Флаг", "Статус строки",
    "Параметр", "Единица", "Значение", "Исходное", "Качество", "Версия данных",
)
COVERAGE_HEADERS = (
    "Точка", "Уровень", "Начало", "Конец", "Пригодно", "Ожидалось", "Неполных", "Подряд", "Статус",
)


def _raw_rows(by_point, station, parameter, start, end):
    for row in by_point[station]:
        ts = row["ts"]
        if ts is None or ts.date() < start or ts.date() > end:
            continue
        status = row["statuses"].get(parameter, "not_applicable")
        eligible = row["state"] == "accepted" and status == "ok"
        value = row["values"].get(parameter) if eligible else None
        yield {
            "time": row["original_time"], "file": row["file"], "line": row["line"],
            "flag": row["qc_flag"], "row_status": row["state"], "parameter": parameter,
            "value": value, "original": row["values"].get(parameter), "status": status,
            "eligible": eligible,
        }


def write_workbook(by_point, path, station, parameter, start, end, *, level="day", raw=False):
    start = start if isinstance(start, date) else date.fromisoformat(start)
    end = end if isinstance(end, date) else date.fromisoformat(end)
    path.parent.mkdir(parents=True, exist_ok=True)
    title = f"{_station_name(station)} · {_parameter_name(parameter)}"
    options = {"constant_memory": True, "strings_to_urls": False, "strings_to_formulas": False,
               "tmpdir": str(path.parent), "use_zip64": True}
    with xlsxwriter.Workbook(path, options) as book:
        book.set_properties({"title": "Метеоархив заповедника", "subject": title})
        formats = (
            book.add_format({"bold": True, "bg_color": "#17483F", "font_color": "#FFFFFF", "valign": "vcenter"}),
            book.add_format({"num_format": "0.###############"}),
            book.add_format({"valign": "top"}),
        )
        data = Sheets(book, "Данные", RAW_HEADERS if raw else AGGREGATE_HEADERS,
                      [24, 24, 19, 20, 10, 16, 22, 30, 12, 22, 24, 30, 30] if raw else
                      [24, 24, 30, 12, 22, 16, 16, 22, 16, 16, 16, 22, 44, 16, 16], formats)
        flags = Sheets(book, "Покрытие и флаги", COVERAGE_HEADERS, [24, 12, 16, 16, 12, 12, 12, 10, 40], formats)
        method_sheet = Sheets(book, "Методика и фильтры", ("Раздел", "Свойство", "Значение"), [30, 27, 110], formats)
        data.start_sheet()
        flags.start_sheet()
        method_sheet.start_sheet()
        method_sheet.write(("Выборка", "Вид", "Срочные наблюдения" if raw else "Расчёты"))
        method_sheet.write(("Выборка", "Точка", title))
        method_sheet.write(("Выборка", "Период", f"{start.isoformat()} — {end.isoformat()}"))
        method_sheet.write(("Выборка", "Версия данных", VERSION))
        method_sheet.write(("Время", "Часовой пояс", TIME_NOTE))
        method_sheet.write(("Время", "Примечание", "Время как записано, без сдвига и округления"))

        if raw:
            for item in _raw_rows(by_point, station, parameter, start, end):
                data.write((title, _station_name(station), item["time"], item["file"], item["line"],
                            item["flag"], item["row_status"], _parameter_name(parameter), _unit(parameter),
                            item["value"], item["original"], item["status"], VERSION))
        else:
            days = daily_statistics(by_point, station, parameter, start, end)
            from .engine import aggregate_days, aggregate_periods
            points = aggregate_days(days, start, end, parameter, station) if level == "day" else \
                aggregate_periods(days, start, end, parameter, station, level)
            for point in points:
                data.write((title, _station_name(station), _parameter_name(parameter), _unit(parameter),
                            point["x"], point["start"], point["end"], point["value"], point["min"], point["max"],
                            point["count"], point["status"], "", VERSION, VERSION))

        for m in month_quality(days if not raw else daily_statistics(by_point, station, parameter, start, end), start, end):
            flags.write((_station_name(station), "Месяц", m["start"].isoformat(), m["end"].isoformat(),
                         m["parameter_valid_days"], m["calendar_days"], m["missing_days"], m["longest_gap"],
                         "ok" if m["parameter_valid"] else ("partial" if m["partial"] else "incomplete")))
        data.finish()
        flags.finish()
        method_sheet.finish()
    return path
