import { onRequest as loadLun } from './functions/api/lun.js';
import { onRequest } from './functions/api/parser.js';
import regions from './frontend/regions.json';
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/parser') return onRequest({ request, env });
    if (url.pathname === '/regions.json') {
      return new Response(JSON.stringify(regions), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    if (url.pathname === '/api/lun') return loadLun({ request, ctx });
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  }
};

// Release marker: simplified parser search UI, 2026-11-20.
