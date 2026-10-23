/* Offline settlement matching. Never infer a building position from its town. */
(function(root) {
  const norm = value => String(value || '').toLocaleLowerCase('uk-UA').replace(/[’ʼ`]/g, "'").replace(/[‐‑–]/g, '-').replace(/\s+/g, ' ').trim();
  function settlement(address) {
    const text = String(address || '').replace(/\([^)]*\)/g, '');
    const m = text.match(/(?:^|[,;]\s*)(?:м\.|с\.|смт\.?|с-ще|селище(?: міського типу)?|село|місто)\s*([^,;]+)/i);
    return m ? m[1].trim() : '';
  }
  function district(address) {
    const m = String(address || '').match(/([А-ЯІЇЄҐа-яіїєґ'-]+)\s+район/i);
    let name = m ? m[1] : '';
    if (norm(name) === 'червоноградський') name = 'Шептицький';
    return name;
  }
  function category(name) {
    const n = norm(name);
    if (/багатоквартир|квартирного|житлового комплексу|житлових будинків/.test(n)) return 'Багатоквартирне житло';
    if (/житлов|садов[иіо]|дачн|садибн/.test(n)) return 'Індивідуальне / садове житло';
    if (/склад|логіст|ангар/.test(n)) return 'Склади / логістика';
    if (/виробнич|завод|цех|промислов|ферм|сільськогосподар/.test(n)) return 'Виробництво / агро';
    if (/магазин|торгов|офіс|готел|ресторан|кафе|автосервіс|сто\b|азс|комерці/.test(n)) return 'Комерційні об’єкти';
    if (/гараж|паркінг|автостоян/.test(n)) return 'Гаражі / паркінги';
    if (/школ|лікар|дитяч|амбулатор|спорт|навчаль|культур|церкв/.test(n)) return 'Соціальні об’єкти';
    if (/дорог|благоустр|мереж|електр|водоп|каналіза|газоп|мост|тротуар|вулиц.*ремонт|ремонт.*вулиц/.test(n)) return 'Інфраструктура';
    return 'Інші / не визначено';
  }
  function index(places) {
    const result = new Map();
    for (const place of places) for (const name of new Set(place.names.map(norm))) {
      const key=(place.region_key || 'lviv')+'|'+name;
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(place);
    }
    return result;
  }
  function locate(item, lookup) {
    const candidates = lookup.get((item.region_key || 'lviv')+'|'+norm(item.settlement)) || [];
    const narrowed = item.district && candidates.length > 1 ? candidates.filter(p => norm(p.district) === norm(item.district)) : candidates;
    if (!narrowed.length) return null;
    // Duplicate gazetteer entries within ~500 m represent the same locality.
    const p = narrowed[0];
    if (narrowed.some(other => Math.abs(other.lat-p.lat) > .003 || Math.abs(other.lon-p.lon) > .005)) return null;
    return {lat:p.lat, lon:p.lon, coord_source:'settlement', geoname_id:p.id};
  }
  function region(address, regions) {
    const text=norm(address);
    for(const [key,name] of Object.entries(regions)) {
      if(['kyiv-city','sevastopol'].includes(key)) {if(new RegExp('(?:^|[,;]\\s*)(?:м\\.?|місто)\\s*'+norm(name)+'(?:$|[,\\s])').test(text))return key;}
      else if(key==='crimea'){if(/крим|арк/.test(text))return key;}
      else if(text.includes(norm(name)+' обл'))return key;
    }
    return '';
  }
  const api = {region, norm, settlement, district, category, index, locate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConstructionGeo = api;
})(typeof window === 'undefined' ? globalThis : window);
