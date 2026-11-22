import csv
import hashlib
import io
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath
from zipfile import ZipFile, is_zipfile

from .quality import PARAMS, STATIONS, read_flags


MAX_INPUT = 80 * 1024 * 1024
MAX_UNPACKED = 160 * 1024 * 1024
STAMP = re.compile(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}')
FILENAME = re.compile(r'(ame60|kr1|kr2)_\d{4}\.csv',re.IGNORECASE)


@dataclass
class CsvSource:
    name: str
    station: str | None
    content: bytes
    digest: str


def get_source(name: str, content: bytes, station_choice: str | None) -> CsvSource:
    label = PurePosixPath(name.replace('\\','/')).name
    match = FILENAME.fullmatch(label)
    station = match.group(1).lower() if match else station_choice
    return CsvSource(label,station,content,hashlib.sha256(content).hexdigest())


def extract_sources(name: str, blob: bytes, station_choice: str | None = None) -> list[CsvSource]:
    if len(blob)>MAX_INPUT:
        raise ValueError('Размер файла превышает 80 МБ.')
    if station_choice and station_choice not in STATIONS:
        raise ValueError('Выберите точку наблюдения из списка.')
    if name.lower().endswith('.csv'):
        return [get_source(name,blob,station_choice)]
    buffer = io.BytesIO(blob)
    if not name.lower().endswith('.zip') or not is_zipfile(buffer):
        raise ValueError('Нужен CSV или ZIP с файлами наблюдений.')
    sources = []
    with ZipFile(buffer) as archive:
        files = [member for member in archive.infolist() if not member.is_dir() and member.filename.lower().endswith('.csv') and '__MACOSX' not in member.filename]
        if len(files)>150 or sum(member.file_size for member in files)>MAX_UNPACKED:
            raise ValueError('Слишком большой объём CSV внутри архива.')
        for member in files:
            if member.flag_bits & 1:
                raise ValueError('Архив содержит файлы под паролем.')
            sources.append(get_source(member.filename,archive.read(member),station_choice))
    if not sources:
        raise ValueError('В архиве не найдено файлов CSV.')
    return sources


def open_csv(source: CsvSource) -> csv.DictReader:
    try:
        raw = source.content.decode('utf-8-sig')
    except UnicodeDecodeError:
        raw = source.content.decode('cp1251')
    first = raw.split('\n',1)[0]
    delimiter = ';' if first.count(';')>first.count(',') else ','
    reader = csv.DictReader(io.StringIO(raw,newline=''),delimiter=delimiter)
    if not reader.fieldnames or len(reader.fieldnames)!=len(set(reader.fieldnames)) or 'datetime' not in reader.fieldnames:
        raise ValueError(f'{source.name}: нужна уникальная колонка datetime.')
    if not set(reader.fieldnames)&PARAMS.keys():
        raise ValueError(f'{source.name}: не найдено метеопараметров.')
    return reader


def check_stamp(value: str) -> str | None:
    if not value or not STAMP.fullmatch(value):
        return None
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        return None
    return value if 1900<=stamp.year<=2100 else None


def create_signature(raw: dict) -> str:
    values = []
    for key in PARAMS:
        cell = raw.get(key)
        if isinstance(cell,str) and cell.strip():
            try:
                cell = str(float(cell))
            except ValueError:
                cell = cell.strip()
        values.append(cell or '')
    values.extend(sorted(read_flags(raw.get('qc_flag') or '')))
    return hashlib.sha1(repr(values).encode(),usedforsecurity=False).hexdigest()
