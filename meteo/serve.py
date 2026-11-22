"""Локальный сервер метеоархива (без внешних зависимостей).

Обслуживает статический сайт из web/ и JSON/Excel API поверх расчётного ядра.
Запуск: python -m meteo.serve [--port 8501] [--data ПУТЬ_К_АРХИВУ]
"""

from __future__ import annotations

import argparse
import io
import json
import re
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .config import PARAMETERS, STATIONS, TIME_NOTE, VERSION, data_root
from .engine import (aggregate_days, aggregate_periods, compare_points, daily_statistics,
                     diurnal_points, diurnal_records, ingest_archive, month_quality,
                     wind_distribution)
from .export import write_workbook

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
NAME_PATTERN = re.compile(r"^(ame60|kr1|kr2)_\d{4}\.csv$", re.IGNORECASE)

MIME = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".ttf": "font/ttf", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


class Archive:
    def __init__(self, root):
        self.root = Path(root)
        self.by_point = None
        self.files = {}  # name -> bytes
        self.version = 0
        self._load()

    def _load(self):
        self.files = {}
        for point, folder, pattern in (("ame60", "ame60", "ame60_*.csv"),
                                       ("kr1", "sokol_m1", "kr1_*.csv"),
                                       ("kr2", "sokol_m1", "kr2_*.csv")):
            for path in sorted((self.root / folder).glob(pattern)):
                self.files[path.name] = path.read_bytes()
        self._reingest()

    def _reingest(self):
        tmp = self.root
        self.by_point = _ingest_files(self.files)

    def preview_import(self, name, data):
        point = NAME_PATTERN.match(Path(name).name)
        if not point:
            return {"ok": False, "error": "Имя файла должно быть вида ame60_ГГГГ.csv, kr1_ГГГГ.csv или kr2_ГГГГ.csv"}
        before = self.by_point
        merged = dict(self.files)
        merged[name] = data
        after = _ingest_files(merged)
        before_rows = sum(len(v) for v in before.values())
        after_rows = sum(len(v) for v in after.values())
        return {"ok": True, "point": point[1], "before_rows": before_rows, "after_rows": after_rows,
                "new_rows": after_rows - before_rows, "known": name in self.files}

    def commit_import(self, name, data):
        result = self.preview_import(name, data)
        if not result["ok"]:
            return result
        if name in self.files and self.files[name] == data:
            return {**result, "published": False, "version": self.version, "reason": "точная копия"}
        self.files[name] = data
        self._reingest()
        self.version += 1
        return {**result, "published": True, "version": self.version}


def _ingest_files(files):
    """Разбирает набор файлов в by_point через временную папку в памяти."""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for name, data in files.items():
            m = NAME_PATTERN.match(name)
            folder = "ame60" if m[1] == "ame60" else "sokol_m1"
            (root / folder).mkdir(parents=True, exist_ok=True)
            (root / folder / name).write_bytes(data)
        return ingest_archive(root)


def _json_handler(archive, pathname, query, body):
    parts = pathname.rstrip("/").split("/")
    if pathname == "/api/meta":
        return 200, {"version": VERSION, "time_note": TIME_NOTE,
                     "stations": {s: {"label": v[0], "parameters": list(v[2])} for s, v in STATIONS.items()},
                     "parameters": {k: {"title": v[0], "unit": v[1]} for k, v in PARAMETERS.items()}}

    if pathname == "/api/coverage":
        spec = body or {}
        station = spec.get("station", "ame60")
        parameter = spec.get("parameter", "t_air")
        start = date.fromisoformat(spec.get("start", "1992-01-01"))
        end = date.fromisoformat(spec.get("end", "2025-12-31"))
        days = daily_statistics(archive.by_point, station, parameter, start, end)
        months = month_quality(days, start, end)
        return 200, {"months": [{k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in m.items()}
                                for m in months],
                     "station_days": sum(1 for e in days.values() if e["station_valid"]),
                     "parameter_days": sum(1 for e in days.values() if e["parameter_valid"])}

    if pathname == "/api/compare":
        spec = body or {}
        start = date.fromisoformat(spec.get("start", "2022-01-01"))
        end = date.fromisoformat(spec.get("end", "2025-12-31"))
        kr1 = daily_statistics(archive.by_point, "kr1", "t_air", start, end)
        kr2 = daily_statistics(archive.by_point, "kr2", "t_air", start, end)
        return 200, {"months": compare_points(kr1, kr2, start, end)}

    if pathname == "/api/wind":
        spec = body or {}
        station = spec.get("station", "ame60")
        start = date.fromisoformat(spec.get("start", "1992-01-01"))
        end = date.fromisoformat(spec.get("end", "2021-12-31"))
        return 200, wind_distribution(archive.by_point, station, start, end)

    if pathname == "/api/raw":
        spec = body or {}
        station = spec.get("station", "ame60")
        parameter = spec.get("parameter", "t_air")
        start = date.fromisoformat(spec.get("start", "1992-01-01"))
        end = date.fromisoformat(spec.get("end", "2025-12-31"))
        issue_only = spec.get("issue_only", False)
        offset = int(spec.get("offset", 0))
        limit = min(int(spec.get("limit", 100)), 1000)
        rows = []
        for row in archive.by_point[station]:
            ts = row["ts"]
            if ts is None or ts.date() < start or ts.date() > end:
                continue
            status = row["statuses"].get(parameter)
            eligible = row["state"] == "accepted" and status == "ok"
            if issue_only and eligible:
                continue
            if issue_only and status in ("ok", "missing_column", "not_applicable") and row["state"] == "accepted":
                continue
            rows.append({"datetime": row["original_time"], "file": row["file"], "line": row["line"],
                         "flag": row["qc_flag"], "row_status": row["state"],
                         "value": row["values"].get(parameter), "status": status,
                         "eligible": eligible})
        total = len(rows)
        return 200, {"rows": rows[offset:offset + limit], "total": total, "offset": offset, "limit": limit}

    if pathname == "/api/exceptions":
        spec = body or {}
        station = spec.get("station")
        parameter = spec.get("parameter")
        reason = spec.get("reason")
        start = spec.get("start")
        end = spec.get("end")
        offset = int(spec.get("offset", 0))
        limit = min(int(spec.get("limit", 100)), 1000)
        from .build_json import build_exceptions
        rows = build_exceptions(archive.by_point)["rows"]
        if station:
            rows = [r for r in rows if r["station"] == station]
        if parameter:
            rows = [r for r in rows if r["parameter"] == parameter]
        if reason:
            rows = [r for r in rows if reason in (r.get("reason") or "")]
        if start:
            rows = [r for r in rows if r.get("when", "")[:10] >= start]
        if end:
            rows = [r for r in rows if r.get("when", "")[:10] <= end]
        total = len(rows)
        return 200, {"rows": rows[offset:offset + limit], "total": total, "offset": offset, "limit": limit}

    if pathname == "/api/export.xlsx":
        spec = body or {}
        station = spec.get("station", "ame60")
        parameter = spec.get("parameter", "t_air")
        start = spec.get("start", "1992-07-01")
        end = spec.get("end", "2021-12-31")
        level = spec.get("level", "day")
        raw = bool(spec.get("raw"))
        buffer = io.BytesIO()
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "export.xlsx"
            write_workbook(archive.by_point, path, station, parameter, start, end, level=level, raw=raw)
            data = path.read_bytes()
        return "xlsx", data

    if pathname == "/api/import":
        spec = body or {}
        name = spec.get("name", "")
        content = spec.get("content", "")
        import base64
        data = base64.b64decode(content)
        if spec.get("commit"):
            return 200, archive.commit_import(name, data)
        return 200, archive.preview_import(name, data)

    return 404, {"error": "not found"}


class Handler(BaseHTTPRequestHandler):
    archive = None

    def _send_json(self, code, payload):
        data = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_xlsx(self, data):
        self.send_response(200)
        self.send_header("Content-Type", MIME[".xlsx"])
        self.send_header("Content-Disposition", 'attachment; filename="archive.xlsx"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, rel):
        path = (WEB / rel).resolve()
        if not str(path).startswith(str(WEB.resolve())) or not path.is_file():
            self._send_json(404, {"error": "not found"})
            return
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        pathname = url.path
        if pathname == "/":
            pathname = "/index.html"
        if pathname.startswith("/api/"):
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            code, payload = _json_handler(self.archive, pathname, query, None)
            self._send_json(code, payload)
            return
        self._send_file(pathname.lstrip("/"))

    def do_POST(self):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        body = json.loads(raw.decode("utf-8") or "{}")
        code, payload = _json_handler(self.archive, url.path, {}, body)
        if code == "xlsx":
            self._send_xlsx(payload)
        else:
            self._send_json(code, payload)

    def log_message(self, fmt, *args):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8501)
    parser.add_argument("--data", default=None)
    args = parser.parse_args()
    Handler.archive = Archive(Path(args.data) if args.data else data_root())
    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"meteo archive serving on http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
