"""Read object/parcel coordinates from public registry map data, with caching."""
import json
import re
import requests
import time
from pathlib import Path


def valid(lat, lon):
    return isinstance(lat, (float, int)) and isinstance(lon, (float, int)) and 44 <= lat <= 53 and 22 <= lon <= 41


def point(payload):
    # Registry's gis-url-proxy uses Leaflet [lat, lon], not GeoJSON order.
    centroid = payload.get('centroid') if isinstance(payload, dict) else None
    coords = centroid.get('coordinates', []) if isinstance(centroid, dict) else []
    if len(coords) == 2:
        a, b = map(float, coords)
        if valid(a, b):
            return {'lat': a, 'lon': b, 'coord_source': 'registry_parcel'}
        if valid(b, a):
            return {'lat': b, 'lon': a, 'coord_source': 'registry_parcel'}
    return None


def extract(soup):
    parcels = list(dict.fromkeys(re.findall(r'\b\d{10}:\d{2}:\d{3}:\d{4}\b', soup.get_text(' ', strip=True))))
    # Only explicit point attributes/marker calls; never use a generic map centre.
    for node in soup.select('#object_loc ~ .object-info [data-lat][data-lon], [data-object-lat][data-object-lon]'):
        try:
            lat = float(node.get('data-object-lat', node.get('data-lat')))
            lon = float(node.get('data-object-lon', node.get('data-lon')))
            if valid(lat, lon):
                return {'lat': lat, 'lon': lon, 'coord_source': 'registry'}, parcels
        except (ValueError, TypeError):
            pass
    markers = set()
    section = soup.select_one('#object_loc')
    scope = section.parent if section else None
    if scope:
        for node in scope.select('[data-geometry], [data-geojson], script[type="application/json"]'):
            raw = node.get('data-geometry') or node.get('data-geojson') or node.get_text()
            try:
                geometry = json.loads(raw)
                if geometry.get('type') == 'Feature': geometry = geometry.get('geometry') or {}
                if geometry.get('type') == 'Point':
                    lon, lat = map(float, geometry['coordinates'][:2])
                    if valid(lat, lon): markers.add((lat,lon))
            except (ValueError,TypeError,KeyError,AttributeError): pass
    for script in soup.select('script'):
        for match in re.finditer(r'L\.marker\(\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]', script.get_text()):
            lat, lon = map(float, match.groups())
            if valid(lat, lon):
                markers.add((lat, lon))
    if len(markers) == 1:
        lat, lon = markers.pop()
        return {'lat': lat, 'lon': lon, 'coord_source': 'registry'}, parcels
    return {}, parcels


class ParcelLookup:
    def __init__(self, session, cache_path):
        self.session, self.path, self.failures = session, Path(cache_path), 0
        self.cache = json.loads(self.path.read_text()) if self.path.exists() else {}

    def resolve(self, numbers):
        results = []
        for number in numbers:
            if number not in self.cache and self.failures < 3:
                try:
                    time.sleep(1.2)
                    response = self.session.get('https://e-construction.gov.ua/api-user/gis-url-proxy',
                                                params={'cadparcel': number}, timeout=(10, 20))
                    response.raise_for_status()
                    result = point(response.json())
                    if result:
                        self.cache[number] = result
                        self.path.parent.mkdir(parents=True, exist_ok=True)
                        self.path.write_text(json.dumps(self.cache, ensure_ascii=False, indent=2))
                    else:
                        self.failures += 1
                except (ValueError, TypeError, OSError, requests.RequestException):
                    self.failures += 1
            if self.cache.get(number):
                results.append(self.cache[number])
        # Multiple parcels must not silently become one purported building location.
        if len(numbers) == 1 and len(results) == 1:
            return results[0]
        return {}


class AddressLookup(ParcelLookup):
    def resolve_address(self, record):
        from address import address_point
        if not record.get('street_address'): return {}
        query=record.get('full_address','')
        key='address:'+query
        if key not in self.cache and self.failures<3:
            try:
                time.sleep(1.2)
                response=self.session.get('https://e-construction.gov.ua/api-user/gis-url-proxy',params={'searchtext':'Україна, '+query},timeout=(10,20))
                response.raise_for_status()
                result=address_point(response.json(),record)
                if result:
                    self.cache[key]=result
                    self.path.parent.mkdir(parents=True,exist_ok=True)
                    self.path.write_text(json.dumps(self.cache,ensure_ascii=False,indent=2))
                else:self.failures+=1
            except (ValueError,TypeError,OSError,requests.RequestException):self.failures+=1
        return self.cache.get(key,{})
