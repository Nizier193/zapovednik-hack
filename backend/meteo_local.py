import argparse
import json
import os
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'app'))

from src.modules.weather.ingestion import extract_sources, get_source
from src.modules.weather.router import router
from src.modules.weather.storage import connect_store, publish_sources


def seed_archive(source: Path) -> dict:
    if source.is_dir():
        files = sorted(source.rglob('*.csv'))
        sources = [get_source(path.name, path.read_bytes(), None) for path in files]
    else:
        sources = extract_sources(source.name, source.read_bytes())
    with connect_store() as connection:
        return publish_sources(connection, sources)


def create_app() -> FastAPI:
    os.environ.setdefault('METEO_LOCAL','1')
    app=FastAPI(title='Метеоархив заповедника')
    app.include_router(router)
    web=ROOT.parent / 'web'
    app.mount('/archive',StaticFiles(directory=web/'archive',html=True),name='archive')
    app.mount('/fonts',StaticFiles(directory=web/'fonts'),name='fonts')
    app.mount('/landing',StaticFiles(directory=web/'landing',html=True),name='landing')

    @app.get('/')
    def open_archive():
        return RedirectResponse('/archive/')

    return app


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Локальный метеоархив заповедника')
    parser.add_argument('--import',dest='source',type=Path,help='Путь к архиву ZIP, CSV или каталогу')
    parser.add_argument('--import-only',action='store_true')
    parser.add_argument('--port',type=int,default=8765)
    args=parser.parse_args()
    if args.source:
        print(json.dumps(seed_archive(args.source),ensure_ascii=False),flush=True)
    if not args.import_only:
        uvicorn.run(create_app(),host='127.0.0.1',port=args.port)
