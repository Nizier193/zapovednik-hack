import math
from collections import Counter
from statistics import mean, median


RULE_VERSION = '1.0'
TIME_NOTE = 'Время как записано, часовой пояс не подтверждён'
PARAMS = {
    't_air': ('Температура воздуха', '°C', -50, 45),
    'rh': ('Относительная влажность', '%', 0, 100),
    'wind_speed': ('Скорость ветра', 'м/с', 0, 60),
    'wind_gust': ('Порывы ветра', 'м/с', 0, 75),
    'wind_dir': ('Направление ветра', '°', 0, 360),
    'soil_05': ('Температура почвы на 5 см', '°C', -40, 45),
    'soil_10': ('Температура почвы на 10 см', '°C', -40, 45),
    'soil_20': ('Температура почвы на 20 см', '°C', -40, 45),
    'pressure_hpa': ('Атмосферное давление', 'гПа', 940, 1050),
}
STATIONS = {
    'ame60': ('АМЕ-60', 72, 96, 16),
    'kr1': ('Сокол М1, Кр1 (поляна)', 18, 24, 13),
    'kr2': ('Сокол М1, Кр2 (поле)', 18, 24, 13),
}


def get_parameters(station: str) -> list[str]:
    return [key for key in PARAMS if (key != 'pressure_hpa' if station == 'ame60' else not key.startswith('soil_'))]


def read_flags(value: str) -> set[str]:
    return {flag.strip() for flag in value.split(';') if flag.strip()}


def check_value(raw: dict, key: str, flags: set[str], conflict: bool) -> tuple:
    if conflict or 'dup_conflict' in flags:
        return None, 'Конфликт срока'
    source_flags = sorted(flag.split(':',1)[1] for flag in flags if flag.startswith(key+':'))
    if source_flags:
        return None, 'Флаг источника: '+', '.join(source_flags)
    if key not in raw:
        return None, 'Колонка отсутствует'
    cell = raw[key]
    if cell is None or not cell.strip():
        return None, 'Пустая ячейка'
    try:
        value = float(cell)
    except ValueError:
        return None, 'Ошибка разбора числа'
    if not math.isfinite(value):
        return None, 'Ошибка разбора числа'
    _, _, lower, upper = PARAMS[key]
    if not lower <= value <= upper:
        return None, 'За пределами диапазона README'
    return value, 'В расчёте'


def calculate_direction(values: list[float]) -> float | None:
    if not values:
        return None
    east = mean(math.sin(math.radians(value)) for value in values)
    north = mean(math.cos(math.radians(value)) for value in values)
    if math.hypot(east, north) < .1:
        return None
    return math.degrees(math.atan2(east, north)) % 360


def calculate_daily(records: list, station: str) -> dict:
    _, threshold, capacity, precision = STATIONS[station]
    periods = {record['ts'][:precision] for record in records if not record['conflict']}
    samples = {key: ([], set(), Counter()) for key in get_parameters(station)}
    for record in records:
        stamp = record['ts'][:precision]
        flags = read_flags(record['raw'].get('qc_flag') or '')
        for key, (values, slots, failures) in samples.items():
            value, reason = check_value(record['raw'],key,flags,record['conflict'])
            if value is None:
                failures[reason] += 1
            else:
                values.append(value)
                slots.add(stamp)
    metrics = {}
    for key, (values, slots, failures) in samples.items():
        enough = len(slots) >= threshold
        direction = key == 'wind_dir'
        center = calculate_direction(values) if direction and enough else mean(values) if enough else None
        summary = [center, median(values), min(values), max(values)] if enough and not direction else [center,None,None,None]
        status = 'В расчёте' if center is not None else 'Нет наблюдений' if not records else 'Неполные сутки' if not enough else 'Направление неопределённо'
        if records and failures.get('Колонка отсутствует',0) == len(records):
            status = 'Параметр отсутствует'
        elif records and not slots and any(reason!='Колонка отсутствует' for reason in failures):
            status = 'Нет пригодных значений'
        metrics[key] = {'v':summary,'coverage':len(slots),'n':len(values),'status':status,'flags':dict(failures)}
    return {'coverage':len(periods),'capacity':capacity,'threshold':threshold,'metrics':metrics}


def check_month(good_days: list[bool]) -> bool:
    if not good_days or len(good_days)-sum(good_days)>10:
        return False
    run = 0
    for good in good_days:
        run = 0 if good else run+1
        if run >= 5:
            return False
    return True
