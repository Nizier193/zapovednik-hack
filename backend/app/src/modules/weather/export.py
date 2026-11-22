import io
import sqlite3
from datetime import date, datetime

import xlsxwriter

from .analytics import average_hours, calculate_reference, calculate_series, collect_hours, compare_sites, create_rose, get_detail, iter_days
from .quality import PARAMS, RULE_VERSION, STATIONS, TIME_NOTE
from .storage import get_version


def create_workbook(connection: sqlite3.Connection, cards: list[dict]) -> bytes:
    result=io.BytesIO()
    workbook=xlsxwriter.Workbook(result,{'constant_memory':True,'strings_to_formulas':False,'strings_to_urls':False})
    data=workbook.add_worksheet('Данные')
    coverage=workbook.add_worksheet('Покрытие и флаги')
    methods=workbook.add_worksheet('Методика и фильтры')
    header=workbook.add_format({'bg_color':'#284C36','font_color':'#F1F6E8','bold':True})
    date_format=workbook.add_format({'num_format':'yyyy-mm-dd hh:mm'})
    data.write_row(0,0,['Карточка','Точка','Параметр','Начало','Конец','Единица','Среднее','Медиана','Минимум','Максимум','Число наблюдений','Статус','Файл','Строка','Исходное значение','Флаг','Версия'],header)
    coverage.write_row(0,0,['Карточка','Точка','Параметр','Период','Покрытие параметра','Покрытие станции','Всего','Статус','Причины исключений'],header)
    methods.write_row(0,0,['Карточка','Точка','Параметры','От','До','Уровень','Строки','Архив'],header)
    for sheet in [data,coverage,methods]:
        sheet.freeze_panes(1,0)
        sheet.set_column(0,2,30)
        sheet.set_column(3,5,24)
    data.set_column(11,12,26)
    data.set_column(14,15,27)
    coverage.set_column(7,8,42)
    version=get_version(connection)
    row,quality_row=1,1
    for i,card in enumerate(cards,1):
        station=card['station']; first=card['first']; last=card['last']; step=card['step']
        card_name=card.get('name') or f'График {i}'
        station_name=STATIONS[station][0]
        selected=card['parameters']
        methods.write_row(i,0,[card_name,station_name,', '.join(PARAMS[key][0] for key in selected),first.isoformat(),last.isoformat(),step,
                               'Пригодные' if card.get('valid_only') else 'Все',version])
        kind=card.get('kind','series')
        if kind in {'compare','rose','hours','season','anomaly','trend'}:
            for label,period,value,unit,count,status in iter_special(connection,card):
                if card.get('valid_only') and value is None:
                    continue
                data.write_row(row,0,[card_name,station_name,label,period,None,unit,value,None,None,None,count,status,None,None,None,None,version])
                coverage.write_row(quality_row,0,[card_name,station_name,label,period,count,None,None,status])
                row+=1;quality_row+=1
            continue
        for parameter in selected:
            label,unit,*_=PARAMS[parameter]
            if step=='term':
                for current in iter_days(first,last):
                    detail=get_detail(connection,station,parameter,current)
                    for item in detail['raw']:
                        value=item['value']
                        if card.get('valid_only') and value is None:
                            continue
                        if row>=1_048_576:
                            workbook.close()
                            raise ValueError('Выборка превышает лимит Excel. Сузьте период или число параметров.')
                        data.write_row(row,0,[card_name,station_name,label])
                        data.write_datetime(row,3,datetime.fromisoformat(item['time']),date_format)
                        data.write_row(row,5,[unit,value,None,None,None,int(value is not None),item['status'],item['file'],item['line'],item['original'],item['flag'],version])
                        row+=1
                    quality_row=write_coverage(coverage,quality_row,card_name,station_name,label,detail['summary'])
                continue
            for item in calculate_series(connection,station,parameter,first,last,step):
                if card.get('valid_only') and item['v'][0] is None:
                    continue
                if row>=1_048_576:
                    workbook.close()
                    raise ValueError('Выборка превышает лимит Excel. Сузьте период или число параметров.')
                data.write_row(row,0,[card_name,station_name,label])
                data.write_datetime(row,3,datetime.fromisoformat(item['start']),date_format)
                data.write_datetime(row,4,datetime.fromisoformat(item['end']),date_format)
                data.write_row(row,5,[unit,*item['v'],item['n'],item['status'],None,None,None,None,version])
                row+=1
                quality_row=write_coverage(coverage,quality_row,card_name,station_name,label,item)
    for i,value in enumerate([TIME_NOTE,f'Версия методики {RULE_VERSION}',
        'АМЕ-60: 72 уникальных срока. Сокол М1: 18 уникальных часов.',
        'Месяц: не более 10 неполных суток и максимум 4 подряд. Среднее по суточным средним.',
        'Декады: 1–10, 11–20, 21–конец месяца. Пропуски остаются пустыми.',
        'Дневные минимумы и максимумы относятся к срочным наблюдениям.',
        'Круговое среднее направления рассчитано по единичным векторам.'],len(cards)+3):
        methods.write(i,0,value)
    workbook.close()
    return result.getvalue()


def iter_special(connection: sqlite3.Connection, card: dict):
    first,last,station=(card[key] for key in ('first','last','station'))
    key=card['parameters'][0]
    unit=PARAMS[key][1]
    kind=card['kind']
    if kind=='compare':
        compare=compare_sites(connection,first,last)
        for row in compare['months']:
            for site,label in [('kr1','Кр1, поляна'),('kr2','Кр2, поле'),('delta','Кр1 − Кр2')]:
                yield label,row['month'],row[site],'°C',row['n'],row['status']
        for series,label in [('hoursKr1','Суточный ход Кр1'),('hoursKr2','Суточный ход Кр2')]:
            for row in compare[series]:
                yield label,f"{row['hour']:02d}:00",row['value'],'°C',row['n'],'Общие пары дата + час'
    elif kind=='rose':
        result=create_rose(connection,station,first,last)
        n=result['n']
        for i,sector in enumerate(result['sectors']):
            for j,band in enumerate(result['bins']):
                count=result['counts'][j][i]
                yield f'{sector}, {band} м/с',f'{first} — {last}',count*100/n if n else None,'%',count,f'Знаменатель {n}'
        yield 'Штиль',f'{first} — {last}',result['calm']*100/n if n else None,'%',result['calm'],f'Знаменатель {n}'
    elif kind=='hours':
        for row in average_hours(collect_hours(connection,station,key,first,last),key):
            yield PARAMS[key][0],f"{row['hour']:02d}:00",row['value'],unit,row['n'],'Число дней'
    else:
        ref=calculate_reference(connection,station,key,first,last,card.get('base_from') or first,card.get('base_to') or last,card['month'])
        if kind=='season':
            for row in ref['seasonal']:
                yield 'Среднее за выбранный период',f"Месяц {row['month']}",row['value'],unit,len(row['years']),', '.join(map(str,row['years']))
        elif kind=='anomaly':
            for row in ref['monthly']:
                yield 'Отклонение',row['start'],row['delta'],unit,len(row['years']),', '.join(map(str,row['years']))
        else:
            for row in ref['trend']:
                yield 'Месячное среднее',str(row['year']),row['value'],unit,int(row['value'] is not None),'Месяц '+str(card['month'])
            if ref['fit']:
                yield 'Наклон тренда',f"{ref['fit']['first']} — {ref['fit']['last']}",ref['fit']['slope'],unit+'/год',ref['n'],'Линейная оценка'


def write_coverage(sheet, row: int, card: str, station: str, parameter: str, point: dict) -> int:
    causes='; '.join(f'{key}: {count}' for key,count in point.get('flags',{}).items())
    if row<1_048_576:
        sheet.write_row(row,0,[card,station,parameter,point['start'],point['coverage'],point['stationCoverage'],point['capacity'],point['status'],causes])
    return row+1
