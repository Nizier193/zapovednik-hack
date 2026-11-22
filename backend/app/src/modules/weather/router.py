import base64
import hmac
import json
import logging
import os
import time
from datetime import date
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .analytics import average_hours, calculate_reference, calculate_series, collect_hours, compare_sites, create_rose, get_detail
from .export import create_workbook
from .ingestion import MAX_INPUT, extract_sources
from .quality import PARAMS, RULE_VERSION, STATIONS, TIME_NOTE, get_parameters
from .storage import connect_store, get_version, preview_source, publish_sources, read_catalog


router=APIRouter(prefix='/api/weather',tags=['Метеоархив'])
logger=logging.getLogger(__name__)
Step=Literal['term','day','decade','month']


class Selection(BaseModel):
    station: str
    parameters: list[str] = Field(min_length=1,max_length=9)
    first: date
    last: date
    step: Step = 'day'
    name: str = Field(default='',max_length=100)
    valid_only: bool=False
    kind: Literal['series','soil','wind','rose','hours','season','anomaly','trend','compare','coverage']='series'
    base_from: date|None=None
    base_to: date|None=None
    month: int=Field(default=1,ge=1,le=12)


class ExportRequest(BaseModel):
    cards: list[Selection] = Field(min_length=1,max_length=12)


def check_selection(station: str, parameter: str, first: date, last: date) -> None:
    if station not in STATIONS or parameter not in get_parameters(station):
        raise HTTPException(400,'Этот параметр недоступен на выбранной точке.')
    if first>last or first.year<1900 or last.year>2100:
        raise HTTPException(400,'Укажите корректные границы периода.')


def check_writer(token: str | None) -> None:
    if os.environ.get('METEO_LOCAL')=='1':
        return
    expected=os.environ.get('METEO_IMPORT_TOKEN')
    if not expected or not token or not hmac.compare_digest(token.encode(),expected.encode()):
        raise HTTPException(403,'Для серверного импорта нужен ключ оператора.')


@router.get('/catalog')
def get_catalog():
    with connect_store() as connection:
        return read_catalog(connection)|{'stations':STATIONS,'parameters':PARAMS,'method':RULE_VERSION,'time':TIME_NOTE,
                                        'importMode':'local' if os.environ.get('METEO_LOCAL')=='1' else 'operator'}


@router.get('/series')
def get_series(station: str, parameter: str, first: date, last: date, step: Step='day', limit: int=Query(1800,ge=50,le=10000)):
    check_selection(station,parameter,first,last)
    if step=='term' and (last-first).days>366:
        raise HTTPException(400,'Для срочного графика выберите не более одного года. Для длинного ряда доступна агрегация по дням.')
    with connect_store() as connection:
        rows=calculate_series(connection,station,parameter,first,last,step)
        count=len(rows)
        if count>limit:
            rows=reduce_plot(rows,limit)
        return {'rows':rows,'count':count,'reduced':count!=len(rows),'unit':PARAMS[parameter][1],'version':get_version(connection),'method':RULE_VERSION}


def reduce_plot(rows: list[dict],limit: int) -> list[dict]:
    group=max(4,(len(rows)*4+limit-1)//limit)
    kept=[]
    for start in range(0,len(rows),group):
        section=rows[start:start+group]
        indices=[i for i,row in enumerate(section) if row['v'][0] is not None]
        if not indices:
            kept.append(section[0]);continue
        choose={indices[0],indices[-1]}
        choose.add(min(indices,key=lambda i:section[i]['v'][0]))
        choose.add(max(indices,key=lambda i:section[i]['v'][0]))
        for i,row in enumerate(section):
            if row['v'][0] is None and (not i or section[i-1]['v'][0] is not None):
                choose.add(i)
        kept.extend(section[i] for i in sorted(choose))
    return kept


@router.get('/day')
def get_day(station: str, parameter: str, day: date):
    check_selection(station,parameter,day,day)
    with connect_store() as connection:
        return get_detail(connection,station,parameter,day)


@router.get('/table')
def get_table(station: str, parameter: str, first: date, last: date, step: Step='day',
              offset: int=Query(0,ge=0), limit: int=Query(40,ge=1,le=200)):
    check_selection(station,parameter,first,last)
    if step=='term' and (last-first).days>366:
        raise HTTPException(400,'Для срочной таблицы выберите период до одного года.')
    with connect_store() as connection:
        rows=calculate_series(connection,station,parameter,first,last,step)
        return {'rows':rows[offset:offset+limit],'total':len(rows),'version':get_version(connection)}


@router.get('/hours')
def get_hours(station: str, parameter: str, first: date, last: date):
    check_selection(station,parameter,first,last)
    with connect_store() as connection:
        return {'profile':average_hours(collect_hours(connection,station,parameter,first,last),parameter)}


@router.get('/rose')
def get_rose(station: str, first: date, last: date):
    check_selection(station,'wind_dir',first,last)
    with connect_store() as connection:
        result=create_rose(connection,station,first,last)
        reason=None
        if not result['n'] and station=='ame60':
            reason='В 1998 году направление ветра не измерялось.' if first.year==last.year==1998 else 'Направление ветра за 2021 год недостоверно.' if first.year==last.year==2021 else None
        return result|{'reason':reason or ('Нет пригодных пар скорости и направления.' if not result['n'] else None)}


@router.get('/compare')
def get_comparison(first: date, last: date):
    check_selection('kr1','t_air',first,last)
    if (last-first).days>730:
        raise HTTPException(400,'Для сравнения выберите период до двух лет.')
    with connect_store() as connection:
        return compare_sites(connection,first,last)


@router.get('/reference')
def get_reference(station: str, parameter: str, first: date, last: date, base_from: date, base_to: date, month: int=Query(1,ge=1,le=12)):
    check_selection(station,parameter,first,last)
    check_selection(station,parameter,base_from,base_to)
    with connect_store() as connection:
        return calculate_reference(connection,station,parameter,first,last,base_from,base_to,month)


@router.post('/xlsx')
def export_workbook(request: ExportRequest):
    for filter_ in request.cards:
        for parameter in filter_.parameters:
            check_selection(filter_.station,parameter,filter_.first,filter_.last)
        if filter_.base_from and filter_.base_to:
            check_selection(filter_.station,filter_.parameters[0],filter_.base_from,filter_.base_to)
        if filter_.kind=='compare' and (filter_.last-filter_.first).days>730:
            raise HTTPException(400,'Для сравнения выберите период до двух лет.')
    with connect_store() as connection:
        try:
            content=create_workbook(connection,[card.model_dump() for card in request.cards])
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
    return Response(content,media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    headers={'Content-Disposition':'attachment; filename="meteo-archive.xlsx"'})


def unpack_upload(files: list,station: str | None) -> list:
    return [source for item in files for source in extract_sources(item['name'],base64.b64decode(item['data']),station)]


def create_preview(payload: list,station: str | None) -> dict:
    sources=unpack_upload(payload,station)
    with connect_store() as connection, connection:
        previews=[preview_source(connection,source) for source in sources]
        key=uuid4().hex
        connection.execute('DELETE FROM drafts WHERE created<?',(time.time()-1800,))
        connection.execute('INSERT INTO drafts VALUES(?,?,?)',(key,time.time(),json.dumps({'files':payload,'station':station})))
    return {'draft':key,'sources':previews}


@router.post('/import/preview')
async def preview_upload(files: list[UploadFile]=File(...),station: str|None=Form(None),x_import_key: str|None=Header(None)):
    check_writer(x_import_key)
    total=0
    payload=[]
    for upload in files:
        raw=await upload.read(MAX_INPUT-total+1)
        total+=len(raw)
        if total>MAX_INPUT:
            raise HTTPException(413,'Общий размер загрузки превышает 80 МБ.')
        payload.append({'name':upload.filename or 'upload.csv','data':base64.b64encode(raw).decode('ascii')})
    try:
        return await run_in_threadpool(create_preview,payload,station or None)
    except (ValueError,RuntimeError) as exc:
        raise HTTPException(400,str(exc)) from exc


@router.post('/import/{draft}')
def confirm_upload(draft: str,x_import_key: str|None=Header(None)):
    check_writer(x_import_key)
    with connect_store() as connection:
        row=connection.execute('SELECT content FROM drafts WHERE id=? AND created>=?',(draft,time.time()-1800)).fetchone()
        if not row:
            raise HTTPException(404,'Предпросмотр устарел. Выберите файлы повторно.')
        payload=json.loads(row['content'])
        try:
            result=publish_sources(connection,unpack_upload(payload['files'],payload['station']))
        except ValueError as exc:
            raise HTTPException(400,str(exc)) from exc
        with connection:
            connection.execute('DELETE FROM drafts WHERE id=?',(draft,))
        logger.info('Weather archive import completed. Version %s, files %s',result['version'],result['files'])
        return result
