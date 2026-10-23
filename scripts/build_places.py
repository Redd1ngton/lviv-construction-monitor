"""Build an offline Lviv settlement index from GeoNames CC BY 4.0 data."""
import io
import json
from pathlib import Path
import zipfile
import requests

URL = 'https://download.geonames.org/export/dump/UA.zip'
DISTRICTS = {'4602': 'Дрогобицький', '4604': 'Золочівський', '4606': 'Львівський',
             '4608': 'Самбірський', '4610': 'Стрийський', '4612': 'Шептицький', '4614': 'Яворівський'}


def build(content):
    rows = zipfile.ZipFile(io.BytesIO(content)).read('UA.txt').decode().splitlines()
    places = []
    for row in rows:
        cells = row.split('\t')
        if cells[10] != '15' or cells[7] not in ('PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLC'):
            continue
        names = list(dict.fromkeys([cells[1]] + cells[3].split(',')))
        names = [name for name in names if any('А' <= ch <= 'я' or ch in 'ІіЇїЄєҐґ' for ch in name)]
        if not names:
            continue
        places.append({'id': cells[0], 'names': names, 'district': DISTRICTS.get(cells[11], ''),
                       'lat': float(cells[4]), 'lon': float(cells[5])})
    return {'source': 'GeoNames', 'license': 'CC BY 4.0', 'url': URL, 'places': places}


if __name__ == '__main__':
    response = requests.get(URL, timeout=90)
    response.raise_for_status()
    output = Path(__file__).resolve().parents[1] / 'frontend/places.json'
    output.write_text(json.dumps(build(response.content), ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
