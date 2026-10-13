import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/store.js';
import { Sender, splitText } from '../src/output.js';
import { normalize } from '../src/messages.js';
import { event, FakeGateway } from './fixtures.js';
import { Failure } from '../src/errors.js';

test('restart retains messages and marks interrupted sends and tools unknown without replay', () => {
  const directory = mkdtempSync(join(tmpdir(), 'xiaolang-unit-'));
  try {
    const path = join(directory, 'test.sqlite');
    let store = new SqliteStore(path);
    const message = store.admit(normalize(event('小狼'), '123456789', [])!)!;
    const turn = store.createTurn(message, 'keyword');
    store.prepareSend(turn.id, ['reply']);
    store.sendState(turn.id, 0, 'sending');
    store.toolStart(turn.id, { id: 'tool', type: 'function', function: { name: 'test', arguments: '{}' } });
    store.close();
    store = new SqliteStore(path);
    assert.equal(store.admit(message), undefined);
    assert.equal(store.inspectTurn(turn.id)?.state, 'unknown');
    assert.equal(store.inspectSends(turn.id)[0]?.state, 'unknown');
    assert.equal(store.inspectTools(turn.id)[0]?.state, 'unknown');
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('lost receipt is persisted as unknown and is never retried', async t => {
  const store = new SqliteStore(':memory:');
  t.after(() => store.close());
  const message = store.admit(normalize(event('小狼'), '123456789', [])!)!;
  const turn = store.createTurn(message, 'keyword');
  let sends = 0;
  const output = new Sender(store, { request: async () => { sends++; throw new Failure('onebot_timeout', true); } }, 100);
  await assert.rejects(output.send(turn, 'reply', [{ role: 'assistant', content: 'reply' }], new AbortController().signal), { code: 'onebot_timeout', unknownOutcome: true });
  assert.equal(sends, 1);
  assert.equal(store.inspectSends(turn.id)[0]?.state, 'unknown');
  const future = store.admit(normalize(event('next', 2), '123456789', [])!)!;
  assert.ok(!store.history(future, 10).some(message => message.role === 'assistant'));
});

test('multi-part replies use text segments, preserve Unicode and persist only confirmed content', async t => {
  const store = new SqliteStore(':memory:');
  t.after(() => store.close());
  const gateway = new FakeGateway();
  const message = store.admit(normalize(event('小狼'), '123456789', [])!)!;
  const turn = store.createTurn(message, 'keyword');
  const output = new Sender(store, gateway, 2);
  await output.send(turn, '甲🐺乙🐺', [{ role: 'assistant', content: '甲🐺乙🐺' }], new AbortController().signal);
  assert.deepEqual(splitText('甲🐺乙🐺', 2), ['甲🐺', '乙🐺']);
  assert.deepEqual(store.inspectSends(turn.id).map(row => row.state), ['sent', 'sent']);
  assert.equal(gateway.sent.length, 2);
  const future = store.admit(normalize(event('next', 2), '123456789', [])!)!;
  assert.equal(store.history(future, 10).at(-1)?.content, '甲🐺乙🐺');
});

test('partial delivery is visible in history without claiming the unsent suffix', async t => {
  const store = new SqliteStore(':memory:');
  t.after(() => store.close());
  const message = store.admit(normalize(event('小狼'), '123456789', [])!)!;
  const turn = store.createTurn(message, 'keyword');
  let count = 0;
  const output = new Sender(store, { request: async () => { if (count++) throw new Failure('onebot_timeout', true); return { message_id: 123 }; } }, 2);
  await assert.rejects(output.send(turn, '甲乙丙丁', [{ role: 'assistant', content: '甲乙丙丁' }], new AbortController().signal));
  const future = store.admit(normalize(event('next', 2), '123456789', [])!)!;
  assert.equal(store.history(future, 10).at(-1)?.content, '甲乙');
  assert.deepEqual(store.inspectSends(turn.id).map(row => row.state), ['sent', 'unknown']);
});
