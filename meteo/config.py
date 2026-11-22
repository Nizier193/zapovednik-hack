"""Константы схемы данных: параметры, точки, физические диапазоны, шаг приборов."""

from pathlib import Path

VERSION = "2026.11.1"
TIME_NOTE = "Время как записано, часовой пояс не подтверждён"

PARAMETERS = {
    "t_air": ("Температура воздуха", "°C"),
    "rh": ("Относительная влажность", "%"),
    "wind_speed": ("Скорость ветра", "м/с"),
    "wind_gust": ("Порывы ветра", "м/с"),
    "wind_dir": ("Направление ветра", "°"),
    "soil_05": ("Температура почвы, 5 см", "°C"),
    "soil_10": ("Температура почвы, 10 см", "°C"),
    "soil_20": ("Температура почвы, 20 см", "°C"),
    "pressure_hpa": ("Атмосферное давление", "гПа"),
}

# Включающие диапазоны из README архива (границы входят в допустимые значения).
RANGES = {
    "t_air": (-50.0, 45.0),
    "rh": (0.0, 100.0),
    "wind_speed": (0.0, 60.0),
    "wind_gust": (0.0, 75.0),
    "wind_dir": (0.0, 360.0),
    "soil_05": (-40.0, 45.0),
    "soil_10": (-40.0, 45.0),
    "soil_20": (-40.0, 45.0),
    "pressure_hpa": (940.0, 1050.0),
}

_COMMON = ("t_air", "rh", "wind_speed", "wind_gust", "wind_dir")

STATIONS = {
    "ame60": ("АМЕ-60", "АМЕ-60", (*_COMMON, "soil_05", "soil_10", "soil_20")),
    "kr1": ("Сокол М1, Кр1 · поляна", "Кр1", (*_COMMON, "pressure_hpa")),
    "kr2": ("Сокол М1, Кр2 · поле", "Кр2", (*_COMMON, "pressure_hpa")),
}

STATION_LIMITS = {
    "ame60": ("1992-01-01", "2021-12-31"),
    "kr1": ("2022-01-01", "2025-12-31"),
    "kr2": ("2022-01-01", "2025-12-31"),
}

# Сутки проходят при наличии не менее 75% сроков.
def expected_terms(station: str) -> int:
    return 96 if station == "ame60" else 24


def day_threshold(station: str) -> int:
    return expected_terms(station) * 3 // 4


# Минимальное число пригодных лет для линейной оценки месячного тренда.
MIN_TREND_YEARS = 5

# Роза ветров: 16 секторов по 22.5°, первый сектор (С) центрирован на 0°.
DIRECTIONS = ("С", "ССВ", "СВ", "ВСВ", "В", "ВЮВ", "ЮВ", "ЮЮВ", "Ю", "ЮЮЗ", "ЮЗ", "ЗЮЗ", "З", "ЗСЗ", "СЗ", "ССЗ")
SPEED_BINS = ("0 < v < 2", "2 ≤ v < 5", "5 ≤ v < 10", "10 ≤ v < 15", "v ≥ 15")


def station_parameters(station: str):
    return STATIONS[station][2]


def data_root() -> Path:
    """Путь к архиву CSV. Берётся из переменной окружения METEO_DATA,
    иначе — папка `.data/metoo_clgz_hackathon/data` рядом с репозиторием."""
    import os
    env = os.environ.get("METEO_DATA")
    if env:
        return Path(env).expanduser()
    return Path(__file__).resolve().parents[1] / ".data" / "meteo_clgz_hackathon" / "data"
