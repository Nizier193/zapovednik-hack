import json
import os
import sqlite3
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .ingestion import CsvSource, check_stamp, create_signature, open_csv
from .quality import PARAMS, STATIONS, calculate_daily, check_value, get_parameters, read_flags


SCHEMA = '''
CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, station TEXT NOT NULL, digest TEXT NOT NULL,
    imported TEXT NOT NULL, content BLOB NOT NULL, row_count INTEGER NOT NULL,
    UNIQUE (station,digest)
);
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id),
    line INTEGER NOT NULL, stamp TEXT NOT NULL, signature TEXT NOT NULL, raw TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS periods (
    station TEXT NOT NULL, stamp TEXT NOT NULL, observation_id INTEGER NOT NULL REFERENCES observations(id),
    signature TEXT NOT NULL, conflict INTEGER NOT NULL, PRIMARY KEY (station,stamp)
);
CREATE INDEX IF NOT EXISTS observations_stamp ON observations(stamp);
CREATE INDEX IF NOT EXISTS sources_station ON sources(station);
CREATE TABLE IF NOT EXISTS daily (
    station TEXT NOT NULL, day TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY (station,day)
);
CREATE TABLE IF NOT EXISTS archive_version (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT OR IGNORE INTO archive_version VALUES (1,0);
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, created REAL NOT NULL, content BLOB NOT NULL);
'''

UPSERT = '''
INSERT INTO periods VALUES (?,?,?,?,?)
ON CONFLICT(station,stamp) DO UPDATE SET conflict =
    (periods.conflict OR excluded.conflict OR periods.signature <> excluded.signature)
'''


def get_store_path() -> Path:
    return Path(os.environ.get('METEO_DB','weather-store/observations.sqlite3'))


@contextmanager
def connect_store():
    path = get_store_path()
    path.parent.mkdir(exist_ok=True,parents=True)
    connection = sqlite3.connect(path,timeout=120)
    connection.row_factory = sqlite3.Row
    try:
        if not connection.execute('SELECT 1 FROM sqlite_master WHERE name=?',('archive_version',)).fetchone():
            connection.executescript('PRAGMA journal_mode=WAL;'+SCHEMA)
        yield connection
    finally:
        connection.close()


def iter_source(source: CsvSource):
    reader = open_csv(source)
    for line in reader:
        raw = {key:value for key,value in line.items() if key is not None}
        stamp = check_stamp(raw.get('datetime'))
        yield reader.line_num,stamp,raw


def preview_source(connection: sqlite3.Connection, source: CsvSource) -> dict:
    if source.name.lower()=='coverage_by_month.csv':
        return {'name':source.name,'reference':True}
    reader = open_csv(source)
    schema = set(reader.fieldnames)
    expected = get_parameters(source.station) if source.station else list(PARAMS)
    selected = [key for key in expected if key in schema]
    record = {'name':source.name,'station':source.station,'digest':source.digest,'parameters':selected,
              'missing':sorted(set(expected)-schema),'unknown':sorted(schema-{'datetime','qc_flag',*PARAMS}),
              'first':None,'last':None,'rows':0,'errors':0,'duplicates':0,'overlaps':0,'conflicts':0,
              'examples':[],'issues':{}}
    stamps = {}
    flags = Counter()
    for line,stamp,raw in iter_source(source):
        record['rows']+=1
        if not stamp:
            record['errors']+=1
            if len(record['examples'])<6:
                record['examples'].append({'line':line,'reason':'Некорректная отметка datetime'})
            continue
        signature = create_signature(raw)
        if stamp in stamps:
            if stamps[stamp]==signature:
                record['duplicates']+=1
            else:
                record['conflicts']+=1
        stamps[stamp]=signature
        source_flags=read_flags(raw.get('qc_flag') or '')
        for key in selected:
            value,reason=check_value(raw,key,source_flags,False)
            if value is None:
                flags[reason]+=1
                if len(record['examples'])<6:
                    record['examples'].append({'line':line,'reason':f'{key}: {reason}'})
    record['issues']=dict(flags)
    if stamps:
        record['first']=min(stamps)
        record['last']=max(stamps)
    if source.station and stamps:
        archived=connection.execute('SELECT stamp,signature,conflict FROM periods WHERE station=? AND stamp BETWEEN ? AND ?',
            (source.station,record['first'],record['last']))
        for item in archived:
            if item['stamp'] in stamps:
                record['overlaps']+=1
                if item['signature']!=stamps[item['stamp']] or item['conflict']:
                    record['conflicts']+=1
    record['already_imported']=bool(source.station and connection.execute('SELECT 1 FROM sources WHERE station=? AND digest=?',(source.station,source.digest)).fetchone())
    return record


def iter_records(connection: sqlite3.Connection, station: str, first: str, last: str):
    rows=connection.execute('''
        SELECT p.stamp,p.conflict,o.raw FROM periods p JOIN observations o ON o.id=p.observation_id
        WHERE p.station=? AND p.stamp BETWEEN ? AND ? ORDER BY p.stamp
    ''',(station,first+' 00:00',last+' 23:59'))
    for row in rows:
        yield {'ts':row['stamp'],'conflict':bool(row['conflict']),'raw':json.loads(row['raw'])}


def read_day(connection: sqlite3.Connection, station: str, date: str) -> list:
    rows=connection.execute('''
        SELECT o.stamp,o.line,o.raw,s.name,s.digest,s.imported,p.conflict,p.observation_id,o.id
        FROM periods p JOIN observations o ON o.stamp=p.stamp
        JOIN sources s ON s.id=o.source_id AND s.station=p.station
        WHERE p.station=? AND p.stamp BETWEEN ? AND ? ORDER BY o.stamp,o.id
    ''',(station,date+' 00:00',date+' 23:59'))
    return [dict(row)|{'raw':json.loads(row['raw']),'duplicate':row['observation_id']!=row['id'] and not row['conflict']} for row in rows]


def save_day(connection: sqlite3.Connection, station: str, date: str) -> None:
    records=list(iter_records(connection,station,date,date))
    result=calculate_daily(records,station)
    connection.execute('INSERT OR REPLACE INTO daily VALUES (?,?,?)',(station,date,json.dumps(result,ensure_ascii=False,separators=(',',':'))))


def publish_sources(connection: sqlite3.Connection, sources: list[CsvSource]) -> dict:
    data=[source for source in sources if source.name.lower()!='coverage_by_month.csv']
    if not data or any(source.station not in STATIONS for source in data):
        raise ValueError('Укажите точку для CSV с неоднозначным именем.')
    counts=Counter(accepted=0,duplicates=0,conflicts=0,invalid=0,files=0)
    dirty=set()
    with connection:
        connection.execute('BEGIN IMMEDIATE')
        for source in data:
            earlier=connection.execute('SELECT row_count FROM sources WHERE station=? AND digest=?',(source.station,source.digest)).fetchone()
            if earlier:
                counts['duplicates']+=earlier['row_count']
                continue
            cursor=connection.execute('INSERT INTO sources(name,station,digest,imported,content,row_count) VALUES (?,?,?,?,?,0)',
                (source.name,source.station,source.digest,datetime.now(timezone.utc).isoformat(),source.content))
            source_id=cursor.lastrowid
            total=0
            for line,stamp,raw in iter_source(source):
                if not stamp:
                    counts['invalid']+=1
                    continue
                total+=1
                signature=create_signature(raw)
                current=connection.execute('SELECT signature,conflict FROM periods WHERE station=? AND stamp=?',(source.station,stamp)).fetchone()
                forced='dup_conflict' in read_flags(raw.get('qc_flag') or '')
                if current and current['signature']==signature and not current['conflict'] and not forced:
                    counts['duplicates']+=1
                elif current or forced:
                    counts['conflicts']+=1
                else:
                    counts['accepted']+=1
                slot=connection.execute('INSERT INTO observations(source_id,line,stamp,signature,raw) VALUES(?,?,?,?,?)',
                    (source_id,line,stamp,signature,json.dumps(raw,ensure_ascii=False,separators=(',',':')))).lastrowid
                connection.execute(UPSERT,(source.station,stamp,slot,signature,int(forced)))
                dirty.add((source.station,stamp[:10]))
            if not total:
                raise ValueError(f'{source.name}: нет записей с пригодным временем. Архив сохранён в прежнем состоянии.')
            connection.execute('UPDATE sources SET row_count=? WHERE id=?',(total,source_id))
            counts['files']+=1
        for station,date in sorted(dirty):
            save_day(connection,station,date)
        if dirty:
            connection.execute('UPDATE archive_version SET version=version+1 WHERE id=1')
    return dict(counts)|{'version':get_version(connection)}


def get_version(connection: sqlite3.Connection) -> int:
    return connection.execute('SELECT version FROM archive_version WHERE id=1').fetchone()[0]


def read_catalog(connection: sqlite3.Connection) -> dict:
    sources=connection.execute('SELECT id,name,station,digest,imported,row_count FROM sources ORDER BY imported DESC,id DESC').fetchall()
    bounds=connection.execute('SELECT station,MIN(day) AS first,MAX(day) AS last FROM daily GROUP BY station').fetchall()
    return {'files':[dict(row) for row in sources],'bounds':{row['station']:{'first':row['first'],'last':row['last']} for row in bounds},'version':get_version(connection)}
