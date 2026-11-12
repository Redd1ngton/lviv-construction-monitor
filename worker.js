import { onRequest as loadLun } from './functions/api/lun.js';
import { onRequest } from './functions/api/parser.js';
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/parser') return onRequest({ request, env });
    if (url.pathname === '/api/lun') return loadLun({ request, ctx });
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
