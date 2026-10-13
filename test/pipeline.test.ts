import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { chatPlugin } from '../src/chat.js';
import { config, deferred, event, FakeGateway, FakeModel } from './fixtures.js';
import type { Log } from '../src/contracts.js';
import { Failure } from '../src/errors.js';
import { SqliteStore } from '../src/store.js';

test('private, keyword anywhere and @ trigger once; observe other messages; ignore duplicates and own replies', async t => {
  const model = new FakeModel();
  const gateway = new FakeGateway();
  const app = await createApp(config(), { model, gateway });
  t.after(() => app.stop());
  let observed = 0;
  app.ctx.on('xiaolang/observed', () => { observed++; });
  app.ctx.on('xiaolang/observed', async () => { throw new Error('isolated observer'); });
  app.ctx.intake.receive(event('普通群消息', 1));
  app.ctx.intake.receive(event('今天小狼怎么没说话', 2));
  app.ctx.intake.receive(event('今天小狼怎么没说话', 2));
  const at = event('小狼你好', 3);
  (at.message as unknown[]).push({ type: 'at', data: { qq: '123456789' } });
  app.ctx.intake.receive(at);
  app.ctx.intake.receive(event('你好', 4, null));
  app.ctx.intake.receive(event('小狼', 5, 100, 123456789));
  await app.ctx.chat.idle();
  assert.equal(observed, 4);
  assert.equal(model.requests.length, 3);
  assert.equal(gateway.sent.length, 3);
  assert.equal(gateway.sent.filter(send => send.action === 'send_private_msg').length, 1);
  assert.equal(gateway.sent.filter(send => send.action === 'send_group_msg').length, 2);
});

test('queued turns preserve their input boundary; group and private contexts stay separate', async t => {
  const gate = deferred();
  const started = deferred();
  let count = 0;
  const model = new FakeModel(async () => {
    if (count++ === 0) { started.resolve(); await gate.promise; }
    return { role: 'assistant', content: 'earlier-answer' };
  });
  const app = await createApp(config(), { model, gateway: new FakeGateway() });
  t.after(() => app.stop());
  app.ctx.intake.receive(event('小狼 first', 1));
  await started.promise;
  app.ctx.intake.receive(event('小狼 second', 2));
  app.ctx.intake.receive(event('future ordinary', 3));
  app.ctx.intake.receive(event('other-group', 4, 101));
  gate.resolve();
  await app.ctx.chat.idle();
  const second = JSON.stringify(model.requests[1]);
  assert.ok(second.includes('first'));
  assert.ok(second.includes('earlier-answer'));
  assert.ok(second.includes('second'));
  assert.ok(!second.includes('future ordinary'));
  assert.ok(!second.includes('other-group'));
  assert.equal(model.requests[1]!.filter(message => message.content?.includes('second')).length, 1);
});

test('tool continuation preserves IDs and reasoning; final result alone is delivered and persisted for later turns', async t => {
  const model = new FakeModel(async messages => {
    if (messages.at(-1)?.role === 'tool') return { role: 'assistant', content: '当前时间已查询。', reasoning_content: 'final-provider-state' };
    return { role: 'assistant', content: '先查询', reasoning_content: 'provider-state', tool_calls: [
      { id: 'clock-1', type: 'function', function: { name: 'current_time', arguments: '{}' } },
    ] };
  });
  const gateway = new FakeGateway();
  const app = await createApp(config(), { model, gateway });
  t.after(() => app.stop());
  app.ctx.intake.receive(event('小狼现在几点', 1));
  await app.ctx.chat.idle();
  assert.equal(model.requests.length, 2);
  const continued = model.requests[1]!;
  assert.equal(continued.at(-2)?.reasoning_content, 'provider-state');
  assert.equal(continued.at(-1)?.tool_call_id, 'clock-1');
  assert.ok(continued.at(-1)?.content?.includes('shanghai'));
  assert.equal(gateway.sent.length, 1);
  assert.equal(JSON.stringify(gateway.sent).includes('先查询'), false);
  app.ctx.intake.receive(event('小狼再说一遍', 2));
  await app.ctx.chat.idle();
  assert.ok(model.requests[2]!.some(message => message.reasoning_content === 'final-provider-state'));
});

test('stopping and replacing chat leaves observation alive and never doubles the default reply', async t => {
  const gateway = new FakeGateway();
  const app = await createApp(config(), { model: new FakeModel(), gateway });
  t.after(() => app.stop());
  await app.stopChat();
  let observed = 0;
  app.ctx.on('xiaolang/observed', () => { observed++; });
  app.ctx.intake.receive(event('小狼停用后', 1));
  assert.equal(gateway.sent.length, 0);
  const replacement = await app.ctx.plugin(chatPlugin, config());
  app.ctx.intake.receive(event('小狼恢复', 2));
  await app.ctx.chat.idle();
  assert.equal(observed, 2);
  assert.equal(gateway.sent.length, 1);
  await replacement.dispose();
});

test('unloading active chat cancels its request and prevents a late reply', async t => {
  const started = deferred();
  const late = deferred<import('../src/contracts.js').ModelMessage>();
  const gateway = new FakeGateway();
  const logs: Log[] = [];
  const app = await createApp(config(), { gateway, model: new FakeModel(async () => { started.resolve(); return late.promise; }), report: entry => logs.push(entry) });
  t.after(() => app.stop());
  app.ctx.intake.receive(event('小狼', 1));
  await started.promise;
  await app.stopChat();
  late.resolve({ role: 'assistant', content: '迟到回复' });
  assert.equal(gateway.sent.length, 0);
  assert.ok(logs.some(entry => entry.code === 'cancelled'));
});

test('a successful side effect is not replayed when the next model request fails', async t => {
  let executed = 0;
  let turnId = '';
  const model = new FakeModel(async messages => {
    if (messages.at(-1)?.role === 'tool') throw new Failure('model_network');
    return { role: 'assistant', content: null, tool_calls: [{ id: 'write-1', type: 'function', function: { name: 'increment', arguments: '{}' } }] };
  });
  const app = await createApp(config(), { model, gateway: new FakeGateway(), report: entry => { if (entry.turn) turnId = entry.turn; } });
  t.after(() => app.stop());
  app.ctx.tools.register({ name: 'increment', description: 'test', parameters: { type: 'object', properties: {}, additionalProperties: false }, execute: async () => ++executed });
  app.ctx.intake.receive(event('小狼', 1));
  await app.ctx.chat.idle();
  assert.equal(executed, 1);
  const store = app.ctx.store as SqliteStore;
  assert.equal(store.inspectTools(turnId)[0]?.state, 'succeeded');
  assert.equal(store.inspectTurn(turnId)?.state, 'failed');
});

test('unknown side-effect result ends the turn before the model can request a repeat', async t => {
  const settings = config();
  settings.limits.toolTimeoutMs = 10;
  let executed = 0;
  let turnId = '';
  let timer: NodeJS.Timeout | undefined;
  const model = new FakeModel(async () => ({ role: 'assistant', content: null,
    tool_calls: [{ id: 'slow-write', type: 'function', function: { name: 'slow_write', arguments: '{}' } }] }));
  const app = await createApp(settings, { model, gateway: new FakeGateway(), report: entry => { if (entry.turn) turnId = entry.turn; } });
  t.after(async () => { clearTimeout(timer); await app.stop(); });
  app.ctx.tools.register({ name: 'slow_write', description: 'test', effect: 'write', parameters: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => { executed++; return new Promise(resolve => { timer = setTimeout(() => resolve('late'), 100); }); } });
  app.ctx.intake.receive(event('小狼', 1));
  await app.ctx.chat.idle();
  assert.equal(executed, 1);
  assert.equal(model.requests.length, 1);
  const store = app.ctx.store as SqliteStore;
  assert.equal(store.inspectTools(turnId)[0]?.state, 'unknown');
  assert.equal(store.inspectTurn(turnId)?.state, 'unknown');
});
