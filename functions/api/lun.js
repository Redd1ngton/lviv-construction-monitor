import regionPages from '../../frontend/lun-regions.json' with { type: 'json' };
import regionNames from '../../frontend/regions.json' with { type: 'json' };
import snapshots from './lun-snapshot.json' with { type: 'json' };

const origin = 'https://lun.ua';
const pictureHost = 'market-images.lunstatic.net';
const pageSize = 24;
const houseTypes = new Set(['house', 'part_of_house', 'townhouse', 'duplex', 'dacha', 'modular']);
const roomCount = /\d+\s*(?:[-–]?х\s*)?[-–]?\s*к(?:імн\p{L}*|омн\p{L}*)?\.?/u;
const adjective = /(?:затишн|простор|світл|сучасн|стильн|дворівнев|двокімнатн|трикімнатн|однокімнатн)\p{L}+/u;
const apartmentTitle = new RegExp(
  '^(?:(?:' + roomCount.source + '|' + adjective.source + ')\\s*){0,3}квартир[ауиы](?!\\p{L})', 'iu'
);

function declaresApartment(value) {
  if (typeof value !== 'string') return false;
  const title = value.slice(0, 160).replace(/^[^\p{L}\d]*/u, '')
    .replace(/^(?:продаж[а]?|продам|продається|прода[её]тся|продаю)\s+/iu, '');
  return apartmentTitle.test(title);
}

function objectType(card) {
  if (card.sectionId === 1 || declaresApartment(card.header) || declaresApartment(card.text)) return 'apartment';
  return houseTypes.has(card.houseTypeName) ? card.houseTypeName : 'unknown';
}

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function readPage(html) {
  // Read the listing cards already included in the public page. Never execute embedded scripts.
  const chunks = html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g);
  const payload = Array.from(chunks, match => JSON.parse(match[1])).join('');
  const row = payload.match(/[a-f\d]+:(\["\$","\$L[a-f\d]+",null,\{"realties":[^\n]*)/);
  const model = row && JSON.parse(row[1])[3];
  const { cards, totalGroupedCount } = model?.realties ?? {};
  const page = Number(new URLSearchParams(model?.initialValuesStr).get('page') ?? 1);
  if (!Array.isArray(cards) || !Number.isSafeInteger(totalGroupedCount) || totalGroupedCount < 0 ||
      !Number.isSafeInteger(page) || page < 1) {
    throw new Error('Missing LUN page metadata');
  }
  const totalPages = Math.max(1, Math.ceil(totalGroupedCount / pageSize));
  return { cards, page, totalPages };
}

function readPhotos(html) {
  const script = html.match(/<script\b[^>]*\bid=["']schema-real-estate["'][^>]*>([\s\S]*?)<\/script>/i);
  const schema = JSON.parse(script?.[1] ?? 'null');
  const photos = new Map();

  for (const entry of schema?.itemListElement ?? []) {
    const images = entry?.item?.image;
    for (const value of Array.isArray(images) ? images : [images]) {
      const url = httpsUrl(value);
      if (url?.hostname !== pictureHost) continue;
      const imageId = url.pathname.match(/\/images\/(.+)\.(?:jpe?g|webp|png|avif)$/i)?.[1];
      if (imageId && !photos.has(imageId)) photos.set(imageId, url.href);
    }
  }

  return photos;
}

export function parseLunPage(html, region) {
  const { cards, page, totalPages } = readPage(html);
  const photos = readPhotos(html);
  const items = new Map();
  const expectedRegion = regionNames[region] + ' область';

  for (const card of cards) {
    if (!Array.isArray(card?.location)) continue;
    const [lon, lat] = card.location;
    const link = httpsUrl(card.urlRaw);
    if (!link || !Number.isSafeInteger(card.id)) continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 44 || lat > 53 || lon < 22 || lon > 41) continue;

    const entities = card.geoEntities ?? [];
    const locality = entities.find(entity => entity.type === 'city')?.name ?? '';
    const isKyiv = locality === 'Київ';
    const matchesRegion = region === 'kyiv-city'
      ? isKyiv
      : entities.some(entity => entity.type === 'region' && entity.name === expectedRegion);
    if (!matchesRegion || (region === 'kyiv-oblast' && isKyiv)) continue;

    const currency = String(card.currency ?? '').toUpperCase();
    const photo = (card.images ?? []).map(image => photos.get(String(image.imageId))).find(Boolean);
    const id = String(card.id);
    items.set(id, {
      id,
      lat,
      lon,
      locality: locality.slice(0, 100),
      address: String(card.header ?? '').slice(0, 160),
      objectType: objectType(card),
      price: Number.isFinite(card.price) && card.price > 0 ? card.price : null,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
      photo: photo ?? null,
      url: link.href
    });
  }

  return { page, totalPages, items: [...items.values()] };
}

export async function onRequest({ request, ctx }) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  const params = new URL(request.url).searchParams;
  const region = params.get('region') ?? 'lviv';
  const pageText = params.get('page') ?? '1';
  const page = Number(pageText);
  if (!Object.hasOwn(regionPages, region)) {
    return Response.json({ message: 'ЛУН не надає добірку будинків для цієї області.' }, { status: 400 });
  }
  if (!/^[1-9]\d*$/.test(pageText) || !Number.isSafeInteger(page)) {
    return Response.json({ message: 'Некоректний номер сторінки ЛУН.' }, { status: 400 });
  }

  const source = new URL(regionPages[region].path, origin);
  if (page > 1) source.searchParams.set('page', String(page));
  const key = new URL('/api/lun', request.url);
  key.search = new URLSearchParams({ region, page: String(page), version: '4' });
  const cache = globalThis.caches?.default;
  const cached = await cache?.match(key.href).catch(() => undefined);
  if (cached) return cached;

  let message = 'Не вдалося отримати сторінку від ЛУН.';
  let responseStatus = 502;
  let retryAfter;
  let retryable = true;
  try {
    const upstream = await fetch(source.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(18000),
      headers: { 'User-Agent': 'ConstructionMonitor/3.0', Accept: 'text/html' }
    });
    if (upstream.ok) {
      message = 'ЛУН не повернув дані запитаної сторінки.';
      const data = parseLunPage(await upstream.text(), region);
      if (data.page !== page) throw new Error('LUN returned a different page');
      const response = Response.json({ ...data, source: source.href, region, fetchedAt: new Date().toISOString() }, {
        headers: { 'Cache-Control': 'public, max-age=1800' }
      });
      if (cache && ctx) ctx.waitUntil(cache.put(key.href, response.clone()).catch(() => {}));
      return response;
    }

    responseStatus = upstream.status === 429 ? 429 : 502;
    retryable = upstream.status === 429 || upstream.status >= 500;
    retryAfter = upstream.headers.get('Retry-After');
    message = upstream.status === 429
      ? 'ЛУН тимчасово обмежив частоту запитів.'
      : `ЛУН повернув HTTP ${upstream.status}.`;
    await upstream.body?.cancel();
  } catch (error) {
    if (error.name === 'TimeoutError') message = 'ЛУН не відповів за 18 секунд.';
  }

  const headers = { 'Cache-Control': 'no-store' };
  if (retryAfter) headers['Retry-After'] = retryAfter;
  const snapshot = page === 1 ? snapshots[region] : undefined;
  if (snapshot) {
    return Response.json({
      ...snapshot, page, totalPages: null, snapshot: true, source: source.href, region, message, retryable
    }, { headers });
  }
  return Response.json({ page, region, message, retryable }, { status: responseStatus, headers });
}
