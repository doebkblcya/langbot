import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '/app/dist/src/app.js';

// CI only: an actual Linux container with externally mounted code and zero network access.
const config = JSON.parse(await readFile('/app/config.example.json', 'utf8'));
config.database = ':memory:';
config.plugins = {
  directory: '/app/plugins',
  entries: [
    { id: 'hello', module: './hello/index.mjs', config: { greeting: '容器测试通过' } },
    { id: 'console-logger', module: './console-logger/index.mjs', config: { format: 'text' } },
  ],
};
let delivered = '';
let requests = 0;
const events = [];
const app = await createApp(config, {
  report: entry => events.push(entry),
  model: {
    complete: async (messages, tools) => {
      requests++;
      assert.ok(tools.some(tool => tool.function.name === 'greet'));
      if (messages.at(-1)?.role === 'tool') return { role: 'assistant', content: messages.at(-1).content };
      return { role: 'assistant', content: null, tool_calls: [
        { id: 'container-test', type: 'function', function: { name: 'greet', arguments: '{"name":"小狼"}' } },
      ] };
    },
  },
  adapter: {
    platform: 'mock', account: 'test-app', capabilities: { groupMessages: 'all', maxTextChars: 4000 },
    start() {}, stop() {}, reply: async (_message, text) => { delivered = text; return { id: '1' }; },
  },
});
try {
  app.ctx.intake.receive({
    account: 'test-app', sender: 'user-openid', id: '1', name: '测试用户', time: Date.now(),
    segments: [{ type: 'text', text: '向小狼问好' }],
  });
  await app.ctx.chat.idle();
  assert.equal(requests, 2);
  assert.ok(delivered.includes('容器测试通过，小狼。'));
  assert.equal(typeof app.ctx.logOutput.write, 'function');
  assert.ok(events.some(entry => entry.code === 'message_received' && entry.preview === '向小狼问好'));
  assert.ok(events.some(entry => entry.code === 'send_confirmed' && entry.receipt === '1'));
  console.info('Mounted external plugin: OK');
} finally { await app.stop(); }
