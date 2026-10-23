"""Supported administrative regions; registry's region filter accepts names."""
REGIONS = {
 'lviv': 'Львівська', 'vinnytsia': 'Вінницька', 'volyn': 'Волинська',
 'dnipro': 'Дніпропетровська', 'donetsk': 'Донецька', 'zhytomyr': 'Житомирська',
 'zakarpattia': 'Закарпатська', 'zaporizhzhia': 'Запорізька', 'ivano-frankivsk': 'Івано-Франківська',
 'kyiv-oblast': 'Київська', 'kirovohrad': 'Кіровоградська', 'luhansk': 'Луганська',
 'mykolaiv': 'Миколаївська', 'odesa': 'Одеська', 'poltava': 'Полтавська',
 'rivne': 'Рівненська', 'sumy': 'Сумська', 'ternopil': 'Тернопільська',
 'kharkiv': 'Харківська', 'kherson': 'Херсонська', 'khmelnytskyi': 'Хмельницька',
 'cherkasy': 'Черкаська', 'chernivtsi': 'Чернівецька', 'chernihiv': 'Чернігівська',
 'kyiv-city': 'Київ', 'crimea': 'Автономна Республіка Крим', 'sevastopol': 'Севастополь',
}


def region_of(address):
    import re
    for key, name in REGIONS.items():
        if key in ('kyiv-city', 'sevastopol'):
            if re.search(r'(?:^|[,;]\s*)(?:м\.?|місто)\s*'+re.escape(name)+r'(?:\b|,)', address, re.I):
                return key
        elif key == 'crimea':
            if re.search(r'Крим|АРК', address, re.I):
                return key
        elif re.search(re.escape(name)+r'\s+(?:обл|область)', address, re.I):
            return key
    return ''


def select_regions(raw, configured, confirmed=False, manual=False):
    """Never schedule a whole-country scrape without per-run user confirmation."""
    keys = list(REGIONS) if raw.strip()=='all' else list(dict.fromkeys(key.strip() for key in raw.split(',') if key.strip())) if raw.strip() else list(dict.fromkeys(configured))
    if not keys or any(key not in REGIONS for key in keys):
        raise ValueError('Оберіть коректні коди регіонів')
    if len(keys)==len(REGIONS) and not (confirmed and manual):
        raise ValueError('Для всієї України потрібне окреме підтвердження confirm_country при ручному запуску')
    return keys
