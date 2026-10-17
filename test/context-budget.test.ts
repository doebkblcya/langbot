import test from 'node:test';
import assert from 'node:assert/strict';
import { textTokens, contextSize, inputBudget } from '../src/context-budget.js';
import { assemble } from '../src/chat.js';
import { config, event } from './fixtures.js';
import { normalize } from '../src/messages.js';

test('token budget counts multilingual text and reserves image, response and tool capacity', () => {
  const options = config();
  assert.equal(textTokens('你好，小狼！ Hello world.'), 8);
  assert.ok(textTokens('hello '.repeat(100)) < 600);
  const plain = { role: 'user', content: '你好' };
  assert.equal(contextSize({ ...plain, images: [{ url: 'data:image/png;base64,AAAA' }] }, options.limits), contextSize(plain, options.limits) + 1024);
  assert.equal(inputBudget(options), 100000 - options.model.maxOutputTokens - options.limits.toolResultChars - 512);
});

test('history is trimmed by tokens while preserving the latest complete user/assistant group', () => {
  const options = config();
  const measure = (value: unknown) => contextSize(value, options.limits);
  const current = normalize(event('现在的问题'), { platform: 'mock', account: '123456789' }, []);
  assert.ok(current);
  const recent = [{ role: 'user' as const, content: '最近的问题' }, { role: 'assistant' as const, content: '最近的回答' }];
  const history = [{ role: 'user' as const, content: '很早的消息'.repeat(5000) }, ...recent];
  const result = assemble('人设', history, current, 500, 0, measure);
  assert.deepEqual(result.slice(1, -1), recent);
});
