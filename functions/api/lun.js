import regionPages from '../../frontend/lun-regions.json' with { type: 'json' };
import regionNames from '../../frontend/regions.json' with { type: 'json' };
import snapshots from './lun-snapshot.json' with { type: 'json' };

const origin = 'https://lun.ua';
const pictureHost = 'market-images.lunstatic.net';

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

function readCards(html) {
  // Read the listing cards already included in the public page. Never execute embedded scripts.
  const chunks = html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g);
  const payload = Array.from(chunks, match => JSON.parse(match[1])).join('');
  const row = payload.match(/[a-f\d]+:(\["\$","\$L[a-f\d]+",null,\{"realties":[^\n]*)/);
  const cards = row && JSON.parse(row[1])[3]?.realties?.cards;
  if (!Array.isArray(cards)) throw new Error('Missing LUN listing cards');
  return cards;
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

export function parseListings(html, region) {
  const cards = readCards(html);
  const photos = readPhotos(html);
  const items = new Map();
  const expectedRegion = regionNames[region] + ' область';

  for (const card of cards.slice(0, 50)) {
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
      price: Number.isFinite(card.price) && card.price > 0 ? card.price : null,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
      photo: photo ?? null,
      url: link.href
    });
  }

  if (cards.length && !items.size) throw new Error('No usable LUN listings for this region');
  return [...items.values()];
}

export async function onRequest({ request, ctx }) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  const region = new URL(request.url).searchParams.get('region') ?? 'lviv';
  if (!Object.hasOwn(regionPages, region)) {
    return Response.json({ message: 'ЛУН не надає добірку будинків для цієї області.' }, { status: 400 });
  }

  const source = origin + regionPages[region];
  const key = new URL('/api/lun', request.url);
  key.search = new URLSearchParams({ region, version: '2' });
  const cache = globalThis.caches?.default;
  const cached = await cache?.match(key.href).catch(() => undefined);
  if (cached) return cached;

  let data;
  let maxAge = 900;
  try {
    const upstream = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(6500) });
    if (!upstream.ok) throw new Error('LUN source unavailable');
    const items = parseListings(await upstream.text(), region);
    data = { items, fetchedAt: new Date().toISOString() };
  } catch {
    const snapshot = snapshots[region];
    if (!snapshot) return Response.json({ message: 'ЛУН тимчасово недоступний.' }, { status: 502 });
    data = { ...snapshot, snapshot: true };
    maxAge = 300;
  }

  const response = Response.json({ ...data, source, region }, {
    headers: { 'Cache-Control': `public, max-age=${maxAge}` }
  });
  if (cache && ctx) ctx.waitUntil(cache.put(key.href, response.clone()).catch(() => {}));
  return response;
}
