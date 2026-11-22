import csv
import io
import os
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from statistics import mean
from unittest.mock import patch
from zipfile import ZipFile

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'backend'/'app'))

from src.modules.weather.analytics import calculate_series, compare_sites, create_rose, get_detail
from src.modules.weather.ingestion import extract_sources, get_source
from src.modules.weather.quality import calculate_daily, check_month
from src.modules.weather.storage import connect_store, publish_sources


def create_csv(station: str, stamps: list[str], values: list[float], flags: list[str] | None = None):
    header='datetime,t_air,rh,pressure_hpa,qc_flag\n'
    rows=''.join(f'{stamp},{value},70,998,{flag}\n' for stamp,value,flag in zip(stamps,values,flags or ['']*len(stamps)))
    return get_source(f'{station}_2025.csv',(header+rows).encode(),None)


class QualityTests(unittest.TestCase):
    def test_station_thresholds_and_mixed_minutes(self):
        for station,step,expected in [('ame60',15,72),('kr1',60,18)]:
            readings=[{'ts':f'2025-01-01 {i*step//60:02d}:{i*step%60:02d}','raw':{'t_air':'2'},'conflict':False} for i in range(expected)]
            key='t_air'
            self.assertIsNone(calculate_daily(readings[:-1],station)['metrics'][key]['v'][0])
            self.assertEqual(calculate_daily(readings,station)['metrics'][key]['v'][0],2)
        readings.append({'ts':'2025-01-01 00:12','raw':{'t_air':'21','rh':'150','qc_flag':'rh:range'},'conflict':False})
        result=calculate_daily(readings,'kr1')['metrics']
        self.assertEqual(result['t_air']['coverage'],18)
        self.assertEqual(result['t_air']['n'],19)
        self.assertEqual(result['t_air']['v'][0],3)
        self.assertEqual(result['rh']['flags']['Флаг источника: range'],1)

    def test_month_boundaries(self):
        self.assertTrue(check_month(([False]*4+[True]*8)*2+[False]*2+[True]*3))
        self.assertFalse(check_month(([False]*4+[True]*8)*2+[False]*3+[True]*3))
        self.assertFalse(check_month([True]*24+[False]*5))
        self.assertTrue(check_month([True]*25+[False]*4))

    def test_idempotence_and_conflict_recalculate_prior_day(self):
        with tempfile.TemporaryDirectory() as temporary,patch.dict(os.environ,{'METEO_DB':str(Path(temporary)/'observations.sqlite3')}):
            stamps=[f'2025-01-01 {hour:02d}:12' for hour in range(18)]
            source=create_csv('kr1',stamps,[8]*18)
            with connect_store() as connection:
                first=publish_sources(connection,[source]);repeat=publish_sources(connection,[source])
                self.assertEqual((first['accepted'],repeat['duplicates'],repeat['version']),(18,18,1))
                update=publish_sources(connection,[create_csv('kr1',[stamps[0]],[9])])
                self.assertEqual((update['conflicts'],update['version']),(1,2))
                detail=get_detail(connection,'kr1','t_air',date(2025,1,1))
                self.assertEqual(detail['summary']['coverage'],17)
                self.assertIsNone(detail['summary']['v'][0])
                self.assertEqual(sum(row['status']=='Конфликт срока' for row in detail['raw']),2)


@unittest.skipUnless(os.getenv('METEO_VERIFY_ARCHIVE'),'Set METEO_VERIFY_ARCHIVE and METEO_DB for real-archive checks')
class RealArchiveTests(unittest.TestCase):
    def test_station_calendar_and_reference_values(self):
        with ZipFile(os.environ['METEO_VERIFY_ARCHIVE']) as archive, connect_store() as connection:
            entry=next(name for name in archive.namelist() if name.endswith('/coverage_by_month.csv'))
            control=csv.DictReader(io.StringIO(archive.read(entry).decode('utf-8-sig')))
            cache={}
            for row in control:
                station=row['station'].lower();year=int(row['year']);month=int(row['month'])
                key=(station,year)
                if key not in cache:
                    cache[key]=calculate_series(connection,station,'t_air',date(year,1,1),date(year,12,31),'month')
                self.assertEqual(cache[key][month-1]['stationCoverage'],int(row['valid_days']),key+(month,))
            january=get_detail(connection,'ame60','t_air',date(2016,1,1))
            used=[row['value'] for row in january['raw'] if row['value'] is not None]
            self.assertEqual(len(used),96)
            self.assertAlmostEqual(mean(used),-15.45625)
            self.assertAlmostEqual(january['summary']['v'][0],mean(used))
            monthly=calculate_series(connection,'ame60','t_air',date(2016,1,1),date(2016,1,31),'month')[0]
            self.assertAlmostEqual(monthly['v'][0],-12.420631720430107)
            partial=calculate_series(connection,'ame60','t_air',date(2016,1,2),date(2016,1,31),'month')[0]
            self.assertEqual(partial['status'],'Часть месяца')
            self.assertIsNone(partial['v'][0])

    def test_pressure_wind_and_paired_temperature(self):
        with connect_store() as connection:
            first,last=date(2024,1,1),date(2024,12,31)
            day=calculate_series(connection,'kr1','pressure_hpa',first,last,'day')
            month=calculate_series(connection,'kr1','pressure_hpa',first,last,'month')
            self.assertEqual((sum(row['stationCoverage']>=18 for row in day),sum(row['coverage']>=18 for row in day)),(363,334))
            self.assertEqual(sum(row['flags'].get('Флаг источника: range',0) for row in day),1362)
            self.assertEqual(sum(row['v'][0] is not None for row in month),11)
            self.assertEqual((month[3]['coverage'],month[3]['v'][0]),(2,None))
            for year in [1998,2021]:
                self.assertEqual(create_rose(connection,'ame60',date(year,1,1),date(year,12,31))['n'],0)
            comparison=compare_sites(connection,date(2025,1,1),date(2025,12,31))
            jan=comparison['months'][0]
            self.assertEqual(jan['n'],31)
            self.assertAlmostEqual(jan['delta'],-0.18532258064516138)
            self.assertEqual(comparison['hourPairs'],8498)


if __name__=='__main__':
    unittest.main(verbosity=2)
