"""Тонкая обёртка над расчётным ядром для регенерации производных JSON.

Расчёт перенесён в пакет `meteo` (единая реализация правил для агрегатов,
журнала качества и выгрузки). Этот скрипт оставлен для обратной совместимости:
он перегенерирует series.json и exceptions.json из исходных CSV.

Запуск: python -m web.landing.dashboard.build_series [путь_к_архиву]
"""

import sys

from meteo.build_json import main

if __name__ == "__main__":
    main()
