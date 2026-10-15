import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

export const name = 'xiaolang-panel';
export const xiaolangApiVersion = 1;
export const inject = ['inspection'];
const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
const headers = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
function integer(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null) return fallback;
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) throw new Error('invalid_query');
  return Number(value);
}
export function createHandler(inspection) {
  return async (request, response) => {
    const send = (status, value, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { ...headers, 'Content-Type': type });
      response.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    const host = request.headers.host ?? '';
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/.test(host)) return send(403, { error: 'local_access_only' });
    if ((request.headers.origin && request.headers.origin !== `http://${host}`)
      || (request.url?.startsWith('/api/') && request.headers['sec-fetch-site'] === 'cross-site')) return send(403, { error: 'same_origin_required' });
    if (request.method !== 'GET') { request.resume?.(); return send(405, { error: 'read_only' }); }
    if (!request.url || request.url.length > 2048) return send(400, { error: 'invalid_request' });
    let url;
    try { url = new URL(request.url, `http://${host}`); } catch { return send(400, { error: 'invalid_request' }); }
    try {
      if (assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        return send(200, await readFile(new URL(file, import.meta.url)), type);
      }
      if (url.pathname === '/api/status') return send(200, inspection.status());
      if (url.pathname === '/api/logs') return send(200, inspection.logs(integer(url.searchParams.get('after'), 0)));
      if (url.pathname === '/api/turns') {
        const limit = integer(url.searchParams.get('limit'), 25, 100);
        const before = integer(url.searchParams.get('before'), undefined);
        const failures = url.searchParams.get('failures');
        if (limit < 1 || before === 0 || (failures !== null && !['0', '1'].includes(failures))) throw new Error('invalid_query');
        return send(200, inspection.recent(limit, before, failures === '1'));
      }
      const match = /^\/api\/turns\/([a-f0-9-]{36})$/i.exec(url.pathname);
      if (match) {
        const detail = inspection.detail(match[1]);
        return detail ? send(200, detail) : send(404, { error: 'turn_not_found' });
      }
      return send(404, { error: 'not_found' });
    } catch (error) {
      return send(error.message === 'invalid_query' || error.message === 'invalid_log_cursor' || error.code === 'invalid_history_query' ? 400 : 500,
        { error: error.message === 'invalid_query' || error.message === 'invalid_log_cursor' || error.code === 'invalid_history_query' ? 'invalid_query' : 'panel_query_failed' });
    }
  };
}
export async function apply(ctx, config = {}) {
  const host = config.host ?? '127.0.0.1';
  const port = config.port ?? 18080;
  if (!['127.0.0.1', '0.0.0.0'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_panel_config');
  const server = createServer({ maxHeaderSize: 8192 }, createHandler(ctx.inspection));
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxConnections = 32;
  ctx.effect(() => () => new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  server.on('error', () => ctx.emit('xiaolang/log', { code: 'panel_server_error', plugin: 'panel' }));
  ctx.emit('xiaolang/log', { code: 'panel_listening', plugin: 'panel' });
}
