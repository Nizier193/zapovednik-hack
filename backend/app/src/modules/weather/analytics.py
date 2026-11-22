import calendar
import json
import math
import sqlite3
from collections import defaultdict
from datetime import date, timedelta
from itertools import groupby
from statistics import mean, median

from .quality import PARAMS, RULE_VERSION, STATIONS, calculate_direction, check_month, check_value, read_flags
from .storage import iter_records, read_day


def iter_days(first: date, last: date):
    for offset in range((last-first).days+1):
        yield first+timedelta(days=offset)


def fetch_daily(connection: sqlite3.Connection, station: str, first: date, last: date) -> dict:
    rows=connection.execute('SELECT day,result FROM daily WHERE station=? AND day BETWEEN ? AND ? ORDER BY day',
        (station,first.isoformat(),last.isoformat()))
    return {row['day']:json.loads(row['result']) for row in rows}


def date_bounds(day: date, step: str) -> tuple[date,date]:
    if step=='month':
        return day.replace(day=1),day.replace(day=calendar.monthrange(day.year,day.month)[1])
    if step=='decade':
        first=1 if day.day<=10 else 11 if day.day<=20 else 21
        last=10 if first==1 else 20 if first==11 else calendar.monthrange(day.year,day.month)[1]
        return day.replace(day=first),day.replace(day=last)
    return day,day


def summarize_interval(days: list[dict], parameter: str, step: str, complete: bool, threshold: int) -> dict:
    good=[item for item in days if item['metric'].get('coverage',0)>=threshold]
    values=[item['metric'] for item in good if item['metric']['v'][0] is not None]
    usable=bool(values and (step!='month' or (complete and check_month([item['metric'].get('coverage',0)>=threshold for item in days]))))
    summary=[None,None,None,None]
    if usable:
        averages=[item['v'][0] for item in values]
        if parameter=='wind_dir':
            summary[0]=calculate_direction(averages)
        else:
            summary=[mean(averages),median(item['v'][1] for item in values),min(item['v'][2] for item in values),max(item['v'][3] for item in values)]
    status='В расчёте' if summary[0] is not None else 'Часть месяца' if not complete else 'Нет наблюдений' if not any(item['station'] for item in days) else 'Недостаточное покрытие'
    return {'v':summary,'n':sum(item['metric']['n'] for item in good),
            'coverage':len(good),'capacity':len(days),'stationCoverage':sum(item['station']>=threshold for item in days),'status':status}


def calculate_series(connection: sqlite3.Connection, station: str, parameter: str, first: date, last: date, step: str) -> list[dict]:
    _,threshold,capacity,_=STATIONS[station]
    if step=='term':
        return collect_terms(connection,station,parameter,first,last)
    records=fetch_daily(connection,station,first,last)
    empty={'v':[None]*4,'n':0,'coverage':0,'status':'Нет наблюдений','flags':{}}

    def get_record(current: date) -> dict:
        stored=records.get(current.isoformat(),{})
        return {'day':current,'metric':stored.get('metrics',{}).get(parameter,empty),'station':stored.get('coverage',0)}

    result=[]
    for bounds,group in groupby(iter_days(first,last),key=lambda current:date_bounds(current,step)):
        group_days=list(group)
        values=[get_record(current) for current in group_days]
        complete=group_days[0]==bounds[0] and group_days[-1]==bounds[1]
        if step=='day':
            row=values[0]['metric']|{'capacity':capacity,'stationCoverage':values[0]['station']}
        else:
            row=summarize_interval(values,parameter,step,complete,threshold)
            row['partial']=not complete
        result.append(row|{'start':group_days[0].isoformat(),'end':group_days[-1].isoformat()})
    return result


def collect_terms(connection: sqlite3.Connection, station: str, parameter: str, first: date, last: date) -> list[dict]:
    result=[]
    for record in iter_records(connection,station,first.isoformat(),last.isoformat()):
        value,reason=check_value(record['raw'],parameter,read_flags(record['raw'].get('qc_flag') or ''),record['conflict'])
        if result and result[-1]['start'][:10]!=record['ts'][:10]:
            following=date.fromisoformat(record['ts'][:10])
            previous=date.fromisoformat(result[-1]['start'][:10])
            if (following-previous).days>1:
                marker=(previous+timedelta(days=1)).isoformat()+' 00:00'
                result.append({'start':marker,'end':marker,'v':[None]*4,'coverage':0,'capacity':1,'stationCoverage':0,'n':0,'status':'Нет наблюдений'})
        result.append({'start':record['ts'],'end':record['ts'],'v':[value,None,None,None],'coverage':int(value is not None),
            'capacity':1,'stationCoverage':int(not record['conflict']),'n':int(value is not None),'status':reason})
    return result


def get_detail(connection: sqlite3.Connection, station: str, parameter: str, current: date) -> dict:
    items=read_day(connection,station,current.isoformat())
    raw=[]
    for item in items:
        value,status=check_value(item['raw'],parameter,read_flags(item['raw'].get('qc_flag') or ''),bool(item['conflict']))
        if item['duplicate']:
            value,status=None,'Точная копия срока'
        raw.append({'time':item['stamp'],'line':item['line'],'file':item['name'],'sha256':item['digest'],
                    'imported':item['imported'],'flag':item['raw'].get('qc_flag') or '',
                    'original':item['raw'].get(parameter),'value':value,'status':status})
    return {'day':current.isoformat(),'summary':calculate_series(connection,station,parameter,current,current,'day')[0],'raw':raw}


def collect_hours(connection: sqlite3.Connection, station: str, parameter: str, first: date, last: date) -> dict:
    daily=calculate_series(connection,station,parameter,first,last,'day')
    good={p['start'] for p in daily if p['coverage']>=STATIONS[station][1]}
    sums=defaultdict(list)
    for row in iter_records(connection,station,first.isoformat(),last.isoformat()):
        if row['ts'][:10] not in good:
            continue
        value,_=check_value(row['raw'],parameter,read_flags(row['raw'].get('qc_flag') or ''),row['conflict'])
        if value is not None:
            sums[row['ts'][:13]].append(value)
    combine=calculate_direction if parameter=='wind_dir' else mean
    return {key:combine(values) for key,values in sums.items()}


def average_hours(values: dict, parameter: str) -> list[dict]:
    by_hour=defaultdict(list)
    for time,value in values.items():
        if value is not None:
            by_hour[int(time[11:13])].append(value)
    combine=calculate_direction if parameter=='wind_dir' else mean
    return [{'hour':hour,'value':combine(by_hour[hour]) if by_hour[hour] else None,'n':len(by_hour[hour])} for hour in range(24)]


def create_rose(connection: sqlite3.Connection, station: str, first: date, last: date) -> dict:
    counts=[[0]*8 for _ in range(4)]
    calm=0
    for record in iter_records(connection,station,first.isoformat(),last.isoformat()):
        raw=record['raw'];flags=read_flags(raw.get('qc_flag') or '')
        direction,_=check_value(raw,'wind_dir',flags,record['conflict'])
        speed,_=check_value(raw,'wind_speed',flags,record['conflict'])
        if direction is None or speed is None:
            continue
        if speed<.5:
            calm+=1
            continue
        sector=int((direction+22.5)%360/45)
        band=sum(speed>=boundary for boundary in [2,4,6])
        counts[band][sector]+=1
    return {'counts':counts,'calm':calm,'n':calm+sum(sum(band) for band in counts),
            'sectors':['С','СВ','В','ЮВ','Ю','ЮЗ','З','СЗ'],'bins':['0,5–<2','2–<4','4–<6','от 6']}


def compare_sites(connection: sqlite3.Connection, first: date, last: date) -> dict:
    first_rows=calculate_series(connection,'kr1','t_air',first,last,'day')
    second_rows=calculate_series(connection,'kr2','t_air',first,last,'day')
    months=[]
    for bounds,group in groupby(zip(first_rows,second_rows),key=lambda pair:date_bounds(date.fromisoformat(pair[0]['start']),'month')):
        pairs=list(group)
        selection=[a['v'][0] is not None and b['v'][0] is not None for a,b in pairs]
        complete=len(pairs)==calendar.monthrange(bounds[0].year,bounds[0].month)[1]
        valid=complete and check_month(selection) and any(selection)
        a=mean(p[0]['v'][0] for p,good in zip(pairs,selection) if good) if valid else None
        b=mean(p[1]['v'][0] for p,good in zip(pairs,selection) if good) if valid else None
        months.append({'month':bounds[0].isoformat(),'kr1':a,'kr2':b,'delta':a-b if valid else None,'n':sum(selection),
                       'capacity':len(pairs),'status':'В расчёте' if valid else 'Недостаточное пересечение'})
    left=collect_hours(connection,'kr1','t_air',first,last)
    right=collect_hours(connection,'kr2','t_air',first,last)
    common=sorted(left.keys()&right.keys())
    return {'months':months,'hoursKr1':average_hours({key:left[key] for key in common},'t_air'),
            'hoursKr2':average_hours({key:right[key] for key in common},'t_air'),'hourPairs':len(common)}


def calculate_reference(connection: sqlite3.Connection, station: str, parameter: str, first: date, last: date,
                        base_from: date, base_to: date, trend_month: int) -> dict:
    monthly=calculate_series(connection,station,parameter,first,last,'month')
    reference=calculate_series(connection,station,parameter,base_from,base_to,'month')
    seasonal=[]
    for month in range(1,13):
        rows=[row for row in reference if int(row['start'][5:7])==month and row['v'][0] is not None]
        values=[row['v'][0] for row in rows]
        value=calculate_direction(values) if parameter=='wind_dir' else mean(values) if values else None
        seasonal.append({'month':month,'value':value,'years':[int(row['start'][:4]) for row in rows]})
    for row in monthly:
        base=seasonal[int(row['start'][5:7])-1]
        row['baseline']=base['value']
        row['delta']=row['v'][0]-base['value'] if row['v'][0] is not None and base['value'] is not None and parameter!='wind_dir' else None
        row['years']=base['years']
    trend=[{'year':int(row['start'][:4]),'value':row['v'][0]} for row in monthly if int(row['start'][5:7])==trend_month and not row.get('partial')]
    valid=[item for item in trend if item['value'] is not None]
    fit=None
    if len(valid)>=5 and parameter!='wind_dir':
        x=mean(item['year'] for item in valid);y=mean(item['value'] for item in valid)
        slope=sum((item['year']-x)*(item['value']-y) for item in valid)/sum((item['year']-x)**2 for item in valid)
        fit={'slope':slope,'first':valid[0]['year'],'last':valid[-1]['year'],'offset':y-slope*x}
    return {'seasonal':seasonal,'monthly':monthly,'trend':trend,'fit':fit,'n':len(valid),'method':RULE_VERSION}
