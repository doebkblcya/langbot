import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../src/app.js';
import { emitLog } from '../src/contracts.js';
import { Failure } from '../src/errors.js';
import { config, event, FakeAdapter, FakeModel } from './fixtures.js';
import type { Inspection } from '../src/contracts.js';

async function handler(inspection: Inspection) {
  const module = await import(pathToFileURL(resolve('examples/plugins/panel/index.mjs')).href);
  const handle = module.createHandler(inspection);
  return async (url: string, method = 'GET', headers: Record<string, string> = {}) => {
    let status = 0, output = '', responseHeaders: Record<string, string> = {};
    // No HTTP listener on Mac: exercise the request handler with in-memory messages.
    await handle({ url, method, headers: { host: '127.0.0.1:18080', ...headers }, resume() {} }, {
      writeHead(value: number, values: Record<string, string>) { status = value; responseHeaders = values; },
      end(value: string | Buffer) { output = String(value); },
    });
    return { status, headers: responseHeaders, text: output, json: () => JSON.parse(output) };
  };
}

test('read-only history projections paginate, filter failures, and expose only confirmed reply text', async t => {
  let requests = 0;
  const settings = config(); settings.persona = 'hidden-system-prompt';
  const app = await createApp(settings, { adapter: new FakeAdapter(), model: new FakeModel(async () => {
    if (++requests === 2) throw new Failure('model_timeout');
    return { role: 'assistant', content: '确认回复', reasoning_content: 'hidden-thoughts' };
  }) });
  t.after(() => app.stop());
  app.ctx.intake.receive(event('第一条', 1, null)); await app.ctx.chat.idle();
  app.ctx.intake.receive(event('第二条', 2, null)); await app.ctx.chat.idle();
  const reader = app.ctx.historyReader;
  const first = reader.recent(1);
  assert.equal(first.items[0]?.input, '第二条');
  assert.equal(first.items[0]?.reply, '');
  assert.equal(first.items[0]?.errorCode, 'model_timeout');
  assert.ok(first.next);
  const older = reader.recent(1, first.next!);
  assert.equal(older.items[0]?.input, '第一条');
  assert.equal(older.items[0]?.reply, '确认回复');
  assert.equal(older.next, null);
  assert.equal(reader.recent(25, undefined, true).items.length, 1);
  assert.deepEqual(reader.counts(), { completed: 1, failed: 1 });
  const detail = reader.detail(older.items[0]!.id)!;
  assert.equal(detail.sends[0]?.state, 'sent');
  assert.ok(detail.sends[0]?.receipt);
  const serialized = JSON.stringify({ first, older, detail });
  for (const value of ['hidden-system-prompt', 'hidden-thoughts', 'protocol', 'draft', 'arguments']) assert.ok(!serialized.includes(value));
  assert.throws(() => reader.recent(1000));
  assert.throws(() => reader.recent(1, -1));
  assert.equal(reader.detail('missing'), undefined);
});

test('inspection status and bounded sanitized logs reflect lifecycle, reject stale cursors and resist mutation', async t => {
  const app = await createApp(config(), { adapter: new FakeAdapter(), model: new FakeModel(), secrets: ['secret-value'] });
  t.after(() => app.stop());
  const inspection = app.ctx.inspection;
  assert.equal(inspection.status().state, 'ready');
  emitLog(app.ctx, { code: 'qq_connected' });
  assert.equal(inspection.status().connection, 'connected');
  emitLog(app.ctx, { code: 'qq_disconnected' });
  assert.equal(inspection.status().connection, 'disconnected');
  for (let i = 0; i < 600; i++) emitLog(app.ctx, { code: 'test', preview: 'secret-value', step: i });
  const page = inspection.logs(1);
  assert.equal(page.items.length, 500);
  assert.equal(page.reset, true);
  assert.ok(!JSON.stringify(page).includes('secret-value'));
  page.items[0]!.entry.preview = 'mutated';
  assert.ok(!JSON.stringify(inspection.logs()).includes('mutated'));
  assert.equal(inspection.logs(page.cursor).items.length, 0);
  assert.equal(inspection.logs(page.cursor + 1).reset, true);
  assert.throws(() => inspection.logs(-1));
});

test('panel handler enforces local Host, same-origin, read-only methods and bounded queries without exposing files', async t => {
  const app = await createApp(config(), { adapter: new FakeAdapter(), model: new FakeModel() });
  t.after(() => app.stop());
  const request = await handler(app.ctx.inspection);
  const status = await request('/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.json().model, 'deepseek-flash');
  assert.equal(status.headers['Cache-Control'], 'no-store');
  assert.ok(status.headers['Content-Security-Policy']?.includes("frame-ancestors 'none'"));
  assert.equal((await request('/api/status', 'GET', { host: 'attacker.example:18080' })).status, 403);
  assert.equal((await request('/api/status', 'GET', { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('/api/status', 'GET', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/status', 'POST')).status, 405);
  for (const url of ['/api/turns?limit=0', '/api/turns?limit=101', '/api/turns?before=0', '/api/logs?after=-1', '/api/turns?failures=bad']) assert.equal((await request(url)).status, 400);
  for (const url of ['/.env', '/../../config.local.json', '/api/config', '/api/turns/../../.env']) assert.equal((await request(url)).status, 404);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.ok(page.text.includes('小狼'));
  assert.equal((await request('/app.js')).status, 200);
  assert.equal((await request('/style.css')).status, 200);
});
