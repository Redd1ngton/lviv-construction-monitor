import { onRequest } from './functions/api/parser.js';
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/parser') return onRequest({ request, env });
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  }
};
