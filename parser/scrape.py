#!/usr/bin/env python3
"""Collect public ЄДЕССБ documents using its server-rendered HTML filters."""
import argparse
import csv
import io
import json
import os
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = 'https://e-construction.gov.ua'
DATA_DIR = Path(__file__).resolve().parents[1] / 'data'
FIELDS = ['doc_number', 'reg_date', 'object_name', 'address', 'customer', 'status',
          'org_issuer', 'doc_type', 'lat', 'lon', 'detail_url']


def clean(value):
    return re.sub(r'\s+', ' ', value or '').strip()


def normalize(value):
    return clean(value).replace('’', "'").replace('ʼ', "'").lower()


def parse_detail(html, url):
    soup = BeautifulSoup(html, 'html.parser')
    pairs = {}
    for row in soup.select('.object-info-item'):
        label, value = row.select_one('.object-info_left'), row.select_one('.object-info_right')
        if label and value:
            pairs.setdefault(normalize(label.get_text(' ', strip=True)), clean(value.get_text(' ', strip=True)))
    def field(*names):
        return next((pairs[normalize(n)] for n in names if pairs.get(normalize(n))), '')
    number = field('Реєстраційний номер в ЄДЕССБ')
    if not re.fullmatch(r'[А-ЯІЇЄҐA-Z]{1,3}\d{8,}', number):
        raise ValueError(f'Unrecognized detail page: {url}')
    raw_date = field('Дата реєстрації в ЄДЕССБ', 'Дата реєстрації')
    registered = datetime.strptime(raw_date, '%d.%m.%Y').date().isoformat() if raw_date else None
    customers = []
    heading = soup.select_one('#applicants_info[data-title-nav=""]')
    if heading:
        table = heading.find_next('table')
        if table:
            customers = [clean(row.select_one('td').get_text(' ', strip=True))
                         for row in table.select('tbody tr') if row.select_one('td')]
    address_section = soup.select_one('#object_loc')
    address = field('Адреса')
    if address_section:
        for row in address_section.parent.select('.object-info-item'):
            left, right = row.select_one('.object-info_left'), row.select_one('.object-info_right')
            if left and right and normalize(left.get_text()) == 'адреса':
                address = clean(right.get_text(' ', strip=True))
                break
    return dict(doc_number=number, reg_date=registered,
                object_name=field("Назва об'єкта", "Назва об'єкта будівництва"),
                address=address, customer='; '.join(dict.fromkeys(customers)),
                status=field('Статус документу', 'Статус документа'),
                org_issuer=field('Орган, що видав'), doc_type=field('Тип'),
                lat=None, lon=None, detail_url=url)


def list_links(html):
    soup = BeautifulSoup(html, 'html.parser')
    container = soup.select_one('.datasets__list')
    if container is None:
        raise ValueError('Registry list missing (layout change or access denied)')
    links = list(dict.fromkeys(urljoin(BASE_URL, a['href']) for a in
                              container.select('a[href*="document_detail/doc_id="]')))
    for url in links:
        if urlparse(url).netloc != urlparse(BASE_URL).netloc:
            raise ValueError('Unexpected detail host')
    next_page = soup.select_one('.pagination__next:not(.disabled) a[filter-user]')
    return links, bool(next_page)


def list_url(start, end, page):
    # Codes verified against the registry's /api-user/filter-list endpoint.
    filters = f'1061_Львівська,1060_1,1057_{start}_{end}'
    return f'{BASE_URL}/document/optype=100/filter={quote(filters, safe=",_-")}/page={page}'


def eligible(record, start, end):
    return (bool(re.search(r'Львівська\s+(?:обл|область)', record['address'], re.I))
            and bool(record['reg_date']) and start <= record['reg_date'] <= end
            and record['status'] == 'Діючий')


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(content, encoding='utf-8')
    os.replace(temp, path)


def save(records, output, start, end):
    path = output / 'constructions.json'
    old = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'items': []}
    merged = {r['doc_number']: r for r in old['items']}
    for record in records:
        merged[record['doc_number']] = record
    ordered = sorted(merged.values(), key=lambda r: (r.get('reg_date') or '', r['doc_number']), reverse=True)
    payload = dict(updated_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
                   region='Львівська область', count=len(ordered), items=ordered,
                   last_run=dict(from_date=start, to_date=end, collected=len(records)),
                   note='Архів спостережень. Статус актуальний на момент останнього збору картки.')
    stream = io.StringIO(newline='')
    writer = csv.DictWriter(stream, fieldnames=FIELDS, extrasaction='ignore')
    writer.writeheader()
    for record in ordered:
        # Avoid spreadsheet formula execution from external registry text.
        writer.writerow({k: "'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@')) else v
                         for k, v in record.items()})
    atomic_write(output / 'constructions.csv', '\ufeff' + stream.getvalue())
    atomic_write(path, json.dumps(payload, ensure_ascii=False, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--days', type=int, default=30)
    parser.add_argument('--from-date')
    parser.add_argument('--to-date')
    parser.add_argument('--max-pages', type=int, default=1000)
    parser.add_argument('--delay', type=float, default=1.2)
    parser.add_argument('--output-dir', type=Path, default=DATA_DIR)
    args = parser.parse_args()
    if args.days < 1 or args.max_pages < 1 or args.delay < 0:
        parser.error('days/max-pages must be positive; delay must be nonnegative')
    end = date.fromisoformat(args.to_date) if args.to_date else date.today()
    start = date.fromisoformat(args.from_date) if args.from_date else end - timedelta(days=args.days)
    if start > end:
        parser.error('from-date must not exceed to-date')
    start, end = start.isoformat(), end.isoformat()
    session = requests.Session()
    session.headers['User-Agent'] = 'LvivConstructionMonitor/2.0 (+https://github.com/Redd1ngton/lviv-construction-monitor)'
    session.mount('https://', HTTPAdapter(max_retries=Retry(total=3, backoff_factor=2,
                  status_forcelist=[429, 500, 502, 503, 504], respect_retry_after_header=True)))
    def fetch(url):
        time.sleep(args.delay)
        response = session.get(url, timeout=(15, 60))
        response.raise_for_status()
        response.encoding = 'utf-8'
        return response.text
    records, seen, page_signatures = [], set(), set()
    try:
        for page in range(1, args.max_pages + 1):
            links, has_next = list_links(fetch(list_url(start, end, page)))
            print(f'Page {page}: {len(links)} documents', flush=True)
            if not links:
                raise RuntimeError('Empty registry response; previous dataset retained')
            signature = tuple(links)
            if signature in page_signatures or all(url in seen for url in links):
                raise RuntimeError('Pagination repeated a page; refusing partial publication')
            page_signatures.add(signature)
            for url in links:
                if url in seen:
                    continue
                seen.add(url)
                record = parse_detail(fetch(url), url)
                if eligible(record, start, end):
                    records.append(record)
                else:
                    print(f'Skip outside verified region/date/status: {record["doc_number"]}', flush=True)
            if not has_next:
                break
        else:
            raise RuntimeError('Page limit reached; increase --max-pages. Dataset not replaced.')
        if not records:
            raise RuntimeError('No verified records; previous dataset retained')
        save(records, args.output_dir, start, end)
        print(f'Saved {len(records)} verified records', flush=True)
    finally:
        session.close()


if __name__ == '__main__':
    main()
