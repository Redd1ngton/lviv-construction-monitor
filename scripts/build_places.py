"""Build regional offline place indexes from GeoNames (CC BY 4.0)."""
import io
import json
from pathlib import Path
import zipfile
import requests

URL='https://download.geonames.org/export/dump/UA.zip'
CODES={'01':'cherkasy','02':'chernihiv','03':'chernivtsi','04':'dnipro','05':'donetsk','06':'ivano-frankivsk','07':'kharkiv','08':'kherson','09':'khmelnytskyi','10':'kirovohrad','11':'crimea','12':'kyiv-city','13':'kyiv-oblast','14':'luhansk','15':'lviv','16':'mykolaiv','17':'odesa','18':'poltava','19':'rivne','20':'sevastopol','21':'sumy','22':'ternopil','23':'vinnytsia','24':'volyn','25':'zakarpattia','26':'zaporizhzhia','27':'zhytomyr'}
LVIV_DISTRICTS={'4602':'Дрогобицький','4604':'Золочівський','4606':'Львівський','4608':'Самбірський','4610':'Стрийський','4612':'Шептицький','4614':'Яворівський'}


def build(content):
    rows=[row.split('\t') for row in zipfile.ZipFile(io.BytesIO(content)).read('UA.txt').decode().splitlines()]
    districts={}
    for cells in rows:
        if cells[7]=='ADM2':
            name=next((name for name in cells[3].split(',') if name.lower().endswith(' район') and any(c in name for c in 'іїєІЇЄ')), '')
            districts[(cells[10],cells[11])]=name.removesuffix(' Район').removesuffix(' район')
    result={key:[] for key in CODES.values()}
    for cells in rows:
        if cells[10] not in CODES or cells[7] not in ('PPL','PPLA','PPLA2','PPLA3','PPLA4','PPLC'):continue
        names=list(dict.fromkeys(cells[3].split(',')))
        names=[name for name in names if any('А'<=c<='я' or c in 'ІіЇїЄєҐґ' for c in name)]
        if not names:continue
        key=CODES[cells[10]]
        district=LVIV_DISTRICTS.get(cells[11],'') if key=='lviv' else districts.get((cells[10],cells[11]),'')
        result[key].append({'id':cells[0],'names':names,'district':district,'region_key':key,'lat':float(cells[4]),'lon':float(cells[5])})
    return result


def write(content):
    output=Path(__file__).resolve().parents[1]/'frontend/places';output.mkdir(parents=True,exist_ok=True)
    for key,places in build(content).items():
        payload={'source':'GeoNames','license':'CC BY 4.0','url':URL,'places':places}
        (output/(key+'.json')).write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':')))


if __name__=='__main__':
    response=requests.get(URL,timeout=90);response.raise_for_status();write(response.content)
