import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '/app/dist/src/app.js';

// CI only: an actual Linux container with externally mounted code and zero network access.
const config = JSON.parse(await readFile('/app/config.example.json', 'utf8'));
config.database = ':memory:';
config.plugins = {
  directory: '/app/plugins',
  entries: [{ id: 'hello', module: './hello/index.mjs', config: { greeting: '容器测试通过' } }],
};
let delivered = '';
let requests = 0;
const app = await createApp(config, {
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
  gateway: { request: async (_action, params) => { delivered = JSON.stringify(params.message); return { message_id: 1 }; } },
});
try {
  app.ctx.intake.receive({
    post_type: 'message', message_type: 'private', sub_type: 'friend',
    self_id: Number(config.account), user_id: 200, message_id: 1,
    message: [{ type: 'text', data: { text: '向小狼问好' } }],
  });
  await app.ctx.chat.idle();
  assert.equal(requests, 2);
  assert.ok(delivered.includes('容器测试通过，小狼。'));
  console.info('Mounted external plugin: OK');
} finally { await app.stop(); }
