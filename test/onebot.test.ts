import { EventEmitter } from 'node:events';
import { setImmediate as tick } from 'node:timers/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type WebSocket from 'ws';
import type { Fields } from '../src/contracts.js';
import { OneBotConnection } from '../src/onebot.js';
import { config, event } from './fixtures.js';

// In-memory transport only: no local server, QQ or network connection is opened.
class MockSocket extends EventEmitter {
  readyState = 1;
  sent: Fields[] = [];
  constructor(private account = 123456789) { super(); }
  send(data: string, callback?: (error?: Error) => void): void {
    const request = JSON.parse(data) as Fields;
    this.sent.push(request);
    if (request.action === 'get_login_info') queueMicrotask(() => this.reply(request, { user_id: this.account }));
    callback?.();
  }
  reply(request: Fields, data: Fields, status = 'ok', retcode = 0) {
    this.emit('message', Buffer.from(JSON.stringify({ echo: request.echo, status, retcode, data })));
  }
  terminate() { this.readyState = 3; this.emit('close'); }
  ping() { this.emit('pong'); }
}
function connection(socket: MockSocket, receive: (event: unknown) => void = () => {}, report: (code: string) => void = () => {}) {
  return new OneBotConnection({ ...config().onebot, timeoutMs: 30 }, '123456789', 'fake-not-a-secret', receive, report,
    () => { queueMicrotask(() => socket.emit('open')); return socket as unknown as WebSocket; });
}

test('OneBot verifies account, associates concurrent echoes and forwards messages', async t => {
  const socket = new MockSocket();
  const received: unknown[] = [];
  const client = connection(socket, event => received.push(event));
  t.after(() => client.close());
  client.start();
  await tick();
  assert.equal(client.ready, true);
  const first = client.request('send_group_msg', { group_id: '100' }, new AbortController().signal);
  const second = client.request('send_private_msg', { user_id: '200' }, new AbortController().signal);
  socket.reply(socket.sent[2]!, { message_id: 2 });
  socket.reply(socket.sent[1]!, { message_id: 1 });
  assert.deepEqual(await first, { message_id: 1 });
  assert.deepEqual(await second, { message_id: 2 });
  socket.emit('message', Buffer.from(JSON.stringify(event('小狼'))));
  assert.equal(received.length, 1);
});

test('OneBot disconnect after send marks outcome unknown; explicit rejection remains known', async t => {
  const socket = new MockSocket();
  const client = connection(socket);
  t.after(() => client.close());
  client.start();
  await tick();
  const rejected = client.request('send_group_msg', {}, new AbortController().signal);
  socket.reply(socket.sent.at(-1)!, {}, 'failed', 100);
  await assert.rejects(rejected, { code: 'onebot_api_rejected', unknownOutcome: false });
  const uncertain = client.request('send_group_msg', {}, new AbortController().signal);
  socket.terminate();
  await assert.rejects(uncertain, { code: 'onebot_disconnected', unknownOutcome: true });
  assert.equal(client.ready, false);
});

test('OneBot timeout and cancellation settle pending calls without replay', async t => {
  const socket = new MockSocket();
  const client = connection(socket);
  t.after(() => client.close());
  client.start();
  await tick();
  await assert.rejects(client.request('send_group_msg', {}, new AbortController().signal), { code: 'onebot_timeout', unknownOutcome: true });
  const controller = new AbortController();
  const task = client.request('send_group_msg', {}, controller.signal);
  controller.abort();
  await assert.rejects(task, { code: 'cancelled', unknownOutcome: true });
  assert.equal(socket.sent.filter(request => request.action === 'send_group_msg').length, 2);
});

test('wrong account blocks the connection; heartbeat offline prevents sending', async t => {
  const wrong = new MockSocket(999);
  const logs: string[] = [];
  const client = connection(wrong, undefined, code => logs.push(code));
  t.after(() => client.close());
  client.start();
  await tick();
  assert.ok(logs.includes('onebot_account_mismatch'));
  assert.equal(client.ready, false);
  const socket = new MockSocket();
  const online = connection(socket);
  t.after(() => online.close());
  online.start();
  await tick();
  socket.emit('message', Buffer.from(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat', status: { online: false } })));
  await assert.rejects(online.request('send_group_msg', {}, new AbortController().signal), { code: 'onebot_not_ready', unknownOutcome: false });
});

test('messages received while verifying the login account are admitted after verification', async t => {
  const socket = new MockSocket();
  const received: unknown[] = [];
  const client = new OneBotConnection(config().onebot, '123456789', 'fake', message => received.push(message), () => {}, () => {
    queueMicrotask(() => {
      socket.emit('open');
      socket.emit('message', Buffer.from(JSON.stringify(event('小狼'))));
    });
    return socket as unknown as WebSocket;
  });
  t.after(() => client.close());
  client.start();
  await tick();
  assert.equal(received.length, 1);
});
