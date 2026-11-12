const source = 'https://lun.ua/sale/lviv/houses?geoDistance=10012684%3A45000';

export function parseListings(html) {
  const script = html.match(/<script\b[^>]*\bid=["']schema-real-estate["'][^>]*>([\s\S]*?)<\/script>/i);
  const data = JSON.parse(script?.[1] ?? 'null');
  if (!Array.isArray(data?.itemListElement)) throw new Error('Missing listing data');

  const items = [];
  for (const { item } of data.itemListElement.slice(0, 50)) {
    const lat = item?.geo?.latitude;
    const lon = item?.geo?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 48 || lat > 51 || lon < 21 || lon > 27) continue;

    const price = item.offers?.price;
    const currency = String(item.offers?.priceCurrency ?? '').toUpperCase();
    items.push({
      lat,
      lon,
      locality: String(item.address?.addressLocality ?? '').slice(0, 100),
      price: Number.isFinite(price) && price > 0 ? price : null,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : null
    });
  }
  if (data.itemListElement.length && !items.length) throw new Error('Missing listing coordinates');
  return { source, items };
}

export async function onRequest({ request, ctx }) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  const url = new URL('/api/lun', request.url);
  const cache = globalThis.caches?.default;
  const cached = await cache?.match(url.href);
  if (cached) return cached;

  try {
    const upstream = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (!upstream.ok) throw new Error('Listing source unavailable');
    const data = parseListings(await upstream.text());
    const response = Response.json(data, { headers: { 'Cache-Control': 'public, max-age=900' } });
    if (cache && ctx) ctx.waitUntil(cache.put(url.href, response.clone()).catch(() => {}));
    return response;
  } catch {
    return Response.json({ message: 'ЛУН тимчасово недоступний. Спробуйте пізніше.' }, { status: 502 });
  }
}
