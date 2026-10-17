import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionQueue } from '../src/scheduler.js';
import { ToolRegistry } from '../src/tools.js';
import { normalize } from '../src/messages.js';
import { event, deferred, FakeAdapter } from './fixtures.js';
import { setTimeout as delay } from 'node:timers/promises';

test('same-session FIFO and independent-session progress respect concurrency', async () => {
  const queue = new SessionQueue(2, 10, 1000);
  const gate = deferred();
  const order: string[] = [];
  const first = queue.enqueue('a', async () => { order.push('a1'); await gate.promise; });
  const second = queue.enqueue('a', async () => { order.push('a2'); });
  const other = queue.enqueue('b', async () => { order.push('b'); });
  await other;
  assert.deepEqual(order, ['a1', 'b']);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['a1', 'b', 'a2']);
  await queue.close();
});

test('tool arguments are validated and plugin removal cancels an in-flight execution', async () => {
  const tools = new ToolRegistry(['200']);
  let executed = 0;
  const started = deferred();
  const remove = tools.register({ name: 'test', description: 'test', parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false },
    execute: async () => { executed++; started.resolve(); return new Promise(() => {}); } });
  const message = normalize(event('小狼'), new FakeAdapter(), [])!;
  await assert.rejects(tools.execute({ id: '1', type: 'function', function: { name: 'test', arguments: '{"value":"bad"}' } }, message, new AbortController().signal), { code: 'invalid_tool_arguments' });
  assert.equal(executed, 0);
  const task = tools.execute({ id: '2', type: 'function', function: { name: 'test', arguments: '{"value":1}' } }, message, new AbortController().signal);
  await started.promise;
  remove();
  await assert.rejects(task, { code: 'cancelled' });
  assert.deepEqual(tools.schemas(), []);
});

test('full and expired queues settle waiting tasks without executing them', async () => {
  const queue = new SessionQueue(1, 1, 5);
  const gate = deferred();
  const first = queue.enqueue('a', async () => gate.promise);
  let executed = false;
  const expired = assert.rejects(queue.enqueue('a', async () => { executed = true; }), { code: 'queue_expired' });
  await assert.rejects(queue.enqueue('b', async () => {}), { code: 'queue_full' });
  await delay(10);
  gate.resolve();
  await Promise.all([first, expired]);
  assert.equal(executed, false);
  await queue.close();
});
