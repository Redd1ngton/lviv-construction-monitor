import fs from 'node:fs';
import assert from 'node:assert/strict';
let source=fs.readFileSync(new URL('../functions/api/parser.js',import.meta.url),'utf8');
const regions=JSON.parse(fs.readFileSync(new URL('../frontend/regions.json',import.meta.url)));
source=source.replace("import regions from '../../frontend/regions.json';",'const regions='+JSON.stringify(regions)+';');
const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let calls=[];globalThis.fetch=async(url)=>{calls.push(url);return new Response('<html>registry</html>');};
const get=query=>onRequest({request:new Request('https://example.pages.dev/api/parser'+query)});
assert.equal((await (await get('')).json()).configured,true);
for(const query of ['?action=detail&id=https://evil.test','?action=list&region=unknown','?action=list&region=lviv&start=2026-01-01&end=2026-11-10&page=1'])assert.equal((await get(query)).status,400);
assert.equal(calls.length,0);
assert.equal((await get('?action=list&region=lviv&start=2026-11-01&end=2026-11-10&page=1')).status,200);
assert(calls[0].startsWith('https://e-construction.gov.ua/document/'));
assert.equal((await get('?action=detail&id=12345')).status,200);
assert.equal(calls[1],'https://e-construction.gov.ua/document_detail/doc_id=12345/optype=100');
let redirects=0;
globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');redirects++;return redirects===1?new Response(null,{status:302,headers:{Location:'/document/optype=100/filter=test'}}):new Response('registry');};
assert.equal((await get('?action=list&region=lviv&start=2026-11-01&end=2026-11-10&page=1')).status,200);
assert.equal(redirects,2);
globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://evil.example/document/'}});
assert.equal((await get('?action=detail&id=12345')).status,502);
let loops=0;globalThis.fetch=async()=>{loops++;return new Response(null,{status:302,headers:{Location:'/document/loop'}});};
assert.equal((await get('?action=detail&id=12345')).status,502);assert.equal(loops,5);
globalThis.fetch=async()=>new Response('',{status:503});
assert.equal((await get('?action=detail&id=12345')).status,502);
globalThis.fetch=async()=>new Response('',{status:403});
let problem=await (await get('?action=detail&id=12345')).json();
assert.equal(problem.code,'ACCESS_DENIED');assert.equal(problem.retryable,false);assert(problem.advice.includes('фільтрів'));assert(problem.source_url.startsWith('https://e-construction.gov.ua/'));
globalThis.fetch=async()=>new Response('',{status:429});
problem=await (await get('?action=detail&id=12345')).json();assert.equal(problem.code,'RATE_LIMIT');assert.equal(problem.retryable,true);
globalThis.fetch=async()=>{const e=Error('timeout');e.name='TimeoutError';throw e;};
problem=await (await get('?action=detail&id=12345')).json();assert.equal(problem.code,'TIMEOUT');assert(problem.advice);
globalThis.fetch=async()=>Response.json({centroid:{coordinates:[49.8,24.1]}});
problem=await (await get('?action=parcel&number=4625384800%3A05%3A002%3A0016')).json();assert.equal(problem.point.lat,49.8);assert.equal(problem.point.coord_source,'registry_parcel');
assert.equal((await get('?action=parcel&number=invalid')).status,400);
globalThis.fetch=async()=>Response.json({centroid:{coordinates:[0,0]}});
problem=await (await get('?action=parcel&number=4625384800%3A05%3A002%3A0016')).json();assert.equal(problem.point,null);
console.log('Direct registry API: no secrets, bounded scope, host validation and upstream errors passed');

const { onRequest: getLun } = await import('../functions/api/lun.js');
const photo = 'https://market-images.lunstatic.net/lun-ua/960/1280/images/offers/123.jpg';
const card = {
  id: 42, location: [30.25, 50.25], header: 'Садова',
  urlRaw: 'https://example.com/houses/view/42', price: 52000, currency: 'usd',
  images: [{ imageId: 'offers/123' }],
  geoEntities: [{ type: 'city', name: 'Бобриця' }, { type: 'region', name: 'Київська область' }]
};
const cityCard = { ...card, id: 43, geoEntities: [{ type: 'city', name: 'Київ' }, card.geoEntities[1]] };
const lunHtml = (page, cards) => {
  const rows = ['$', '$L13', null, {
    realties: { cards, totalGroupedCount: 25 },
    initialValuesStr: 'geo_id=10000010&page=' + page
  }];
  return `<script>self.__next_f.push(${JSON.stringify([1, 'previous text12:' + JSON.stringify(rows) + '\n'])})</script>
<script id="schema-real-estate" type="application/ld+json">${JSON.stringify({ itemListElement: [{ item: { image: [photo] } }] })}</script>`;
};
const html = lunHtml(1, [card, cityCard, { ...card, id: 44, urlRaw: 'javascript:alert(1)' }]);
const lun = (region, page) => getLun({
  request: new Request('https://example.pages.dev/api/lun?' + new URLSearchParams({ region, ...(page && { page }) }))
});
const lunRequests = [];
globalThis.fetch = async url => {
  lunRequests.push(url);
  return new Response(new URL(url).searchParams.get('page') === '2'
    ? lunHtml(2, [{ ...card, id: 45 }])
    : html);
};
assert.equal((await lun('unrecognized')).status, 400);
assert.equal((await lun('lviv', '-1')).status, 400);
assert.equal(lunRequests.length, 0);
let listings = await (await lun('kyiv-oblast')).json();
assert.deepEqual(lunRequests, ['https://lun.ua/sale/kyiv/region-houses']);
assert.equal(listings.items.length, 1, 'Exclude Kyiv city and invalid listing URLs from the oblast');
assert.equal(listings.items[0].url, card.urlRaw);
assert.equal(listings.items[0].photo, photo);
assert.equal(listings.totalPages, 2);
listings = await (await lun('kyiv-oblast', '2')).json();
assert.equal(lunRequests[1], 'https://lun.ua/sale/kyiv/region-houses?page=2');
assert.equal(listings.page, 2);
assert.equal(listings.items[0].id, '45');
globalThis.fetch = async () => new Response(html);
assert.equal((await lun('kyiv-oblast', '2')).status, 502, 'Reject a repeated first page');

globalThis.fetch = async () => new Response('', { status: 403 });
listings = await (await lun('odesa')).json();
assert.equal(listings.region, 'odesa');
assert(listings.snapshot && listings.items.length && listings.items.every(item => item.photo && item.url));
assert.equal(listings.totalPages, null, 'A saved first page cannot represent the complete catalog');
assert.equal((await lun('odesa', '2')).status, 502, 'A failed later page must not return the first page');
console.log('LUN API: regional scope, distinct pages, photos, original links and explicit partial fallback passed');
