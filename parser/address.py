"""Public object addresses and conservative matching of registry street search."""
import re
from coordinates import valid

STREET = re.compile(r'\b(?:вулиця|вул\.?|провулок|пров\.?|проспект|просп\.?|площа|пл\.?|шосе|набережна|бульвар)\s+[^,;\n]+', re.I)


def norm(value):
    return re.sub(r'[^\w]+', ' ', value.lower().replace('’', "'").replace('ʼ', "'")).strip()


def address_fields(address, description='', name=''):
    # Object title is used only for an explicitly named street, never a customer's address.
    match = next((m for text in (address, description, name) if (m := STREET.search(text))), None)
    street_address = match.group().strip() if match else ''
    house = re.search(r'(?:будинок|буд\.?|№)\s*([0-9]+[А-Яа-яA-Za-z]?(?:[/\-][0-9А-Яа-яA-Za-z]+)?)', address+', '+description, re.I)
    if not house and street_address:
        house = re.search(r'[, ]\s*(\d+[А-Яа-яA-Za-z]?(?:[/\-][0-9А-Яа-яA-Za-z]+)?)\s*$', street_address)
    clean_address = re.sub(r'\([^)]*\)', '', address).strip(' ,')
    additions = []
    if street_address and norm(street_address) not in norm(clean_address): additions.append(street_address)
    if house and not re.search(r'\b'+re.escape(house.group(1))+r'\b', clean_address+' '+street_address): additions.append('буд. '+house.group(1))
    return dict(street_address=street_address,house_number=house.group(1) if house else '',full_address=', '.join([clean_address]+additions))


def address_point(payload, record):
    if not isinstance(payload,dict) or not isinstance(payload.get('Location'),dict): return None
    location=payload['Location'];position=location.get('DisplayPosition') or {};address=location.get('Address') or {}
    try: lat,lon=float(position['Latitude']),float(position['Longitude'])
    except (KeyError,TypeError,ValueError): return None
    if not valid(lat,lon): return None
    requested=record.get('street_address','')
    if not requested:return None
    tokens=[t for t in norm(STREET.sub(lambda m: re.sub(r'^\S+\s*','',m.group()),requested)).split() if len(t)>2 and not t.isdigit()]
    label=norm(address.get('Street','')+' '+address.get('Label',''))
    if not tokens or not all(token in label.split() for token in tokens):return None
    # Require settlement as well as street; street names recur across regions.
    town=re.search(r'(?:^|[,;]\s*)(?:м\.|с\.|смт\.?|селище|село|місто)\s*([^,;(]+)',record.get('address',''),re.I)
    if not town or norm(town.group(1)) not in norm(address.get('City','')+' '+address.get('District','')+' '+address.get('Label','')):return None
    house=record.get('house_number','')
    if house and norm(house)!=norm(str(address.get('HouseNumber',''))):return None
    return dict(lat=lat,lon=lon,coord_source='registry_address' if house else 'registry_street',coordinate_address=address.get('Label',''))
