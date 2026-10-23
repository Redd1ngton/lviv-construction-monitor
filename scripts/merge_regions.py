"""Publish successful region artifacts while preserving other regions and history."""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'parser'))
from scrape import atomic_write, FIELDS
from regions import REGIONS, region_of
import csv
import io
from datetime import datetime, timezone


def merge(root, artifacts):
    data=root/'data';regional=data/'regions';regional.mkdir(parents=True,exist_ok=True)
    paths=list(artifacts.rglob('constructions.json'))
    if not paths: raise ValueError('No successful region artifacts; previous dataset retained')
    for path in paths:
        payload=json.loads(path.read_text())
        key=payload.get('region_key')
        if key not in REGIONS or not isinstance(payload.get('items'),list):
            raise ValueError('Invalid region artifact')
        atomic_write(regional/f'{key}.json',json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
    previous=json.loads((data/'constructions.json').read_text()) if (data/'constructions.json').exists() else {'items':[]}
    records={row['doc_number']:row for row in previous['items']}
    coverage=[]
    for path in sorted(regional.glob('*.json')):
        payload=json.loads(path.read_text());key=payload['region_key']
        for row in payload['items']:
            row['region_key']=key;row['region']=REGIONS[key];records[row['doc_number']]=row
        coverage.append({'key':key,'name':REGIONS[key],'count':len(payload['items']),'updated_at':payload['updated_at']})
    for row in records.values():
        row['region_key']=row.get('region_key') or region_of(row.get('address',''))
        row['region']=REGIONS.get(row['region_key'],'Не визначено')
    rows=sorted(records.values(),key=lambda r:(r.get('reg_date') or '',r['doc_number']),reverse=True)
    payload={'updated_at':datetime.now(timezone.utc).isoformat(timespec='seconds'),'region':'Україна','count':len(rows),'items':rows,'coverage':coverage}
    serialized=json.dumps(payload,ensure_ascii=False,indent=2)+'\n'
    atomic_write(data/'constructions.json',serialized);atomic_write(root/'frontend/data.json',serialized)
    stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=FIELDS,extrasaction='ignore');writer.writeheader()
    for row in rows:
        writer.writerow({k:"'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v for k,v in row.items()})
    atomic_write(data/'constructions.csv','\ufeff'+stream.getvalue());atomic_write(root/'frontend/data.csv','\ufeff'+stream.getvalue())
    print(f'Published {len(rows)} records; {len(coverage)} regions')


if __name__=='__main__':
    merge(Path(__file__).resolve().parents[1],Path(sys.argv[1]))
