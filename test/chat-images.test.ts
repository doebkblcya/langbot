import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatImages, pictures } from '../src/chat-images.js';
import { MemoryRepository } from '../src/memory-store.js';
import { memoryDefaults } from '../src/memory-config.js';
import { createApp } from '../src/app.js';
import { normalize } from '../src/messages.js';
import { config, event, FakeAdapter, FakeModel, deferred } from './fixtures.js';
import type { Message } from '../src/contracts.js';
const settings = { ...memoryDefaults, enabled: true };
const signal = () => new AbortController().signal;
function pictureMessage(): Message {
  const input = event('', 1, 'group-one');
  input.segments = [{ type: 'image', url: 'https://example.qpic.cn/first.png?key=one' }, { type: 'image', url: 'https://example.qpic.cn/second.png?key=two' }];
  return { ...normalize(input, new FakeAdapter(), [])!, seq: 7 };
}
function fetchPictures(count: { value: number }): typeof fetch {
  return async url => { count.value++; return new Response(String(url).includes('second') ? 'second-pixels' : 'first-pixels', { headers: { 'Content-Type': 'image/png' } }); };
}

test('each picture has its own stable reference; descriptions are reused but reinspection fetches originals every time', async () => {
  const repository = new MemoryRepository(':memory:', settings), calls = { value: 0 };
  const model = new FakeModel(async messages => ({ role: 'assistant', content: messages.at(-1)!.content === '请描述这张图片。' ? '两列商品价格表。' : '第二列价格是128元。' }));
  const images = new ChatImages(settings, repository, model, () => {}, fetchPictures(calls));
  try {
    const message = pictureMessage();
    assert.deepEqual(pictures(message).map(image => image.imageId), ['img_7_1', 'img_7_2']);
    await Promise.all([images.describe(message), images.describe(message)]);
    assert.equal(calls.value, 2); assert.equal(model.requests.length, 2);
    assert.ok(images.text(message).includes('img_7_2'));
    assert.ok(!JSON.stringify(images.references(message)).includes('base64'));
    await images.describe(message); assert.equal(calls.value, 2);
    const first = await images.inspect(message, 1, '第二列多少钱？', signal());
    const second = await images.inspect(message, 1, '再确认一下价格', signal());
    assert.equal(first.available, true); assert.equal(second.imageId, 'img_7_2'); assert.equal(calls.value, 4);
    const supplied = model.requests.at(-1)!.at(-1)!.images![0]!.url;
    assert.equal(Buffer.from(supplied.split(',')[1]!, 'base64').toString(), 'second-pixels');
    await assert.rejects(images.inspect(message, 2, '看图', signal()), /image_not_found/);
  } finally { await images.stop(); repository.close(); }
});

test('an unavailable QQ image is reported as unavailable, even when an old text description exists', async () => {
  const repository = new MemoryRepository(':memory:', settings), message = pictureMessage();
  repository.image(pictures(message)[0]!.key, '旧描述：一张表格。');
  const model = new FakeModel();
  const images = new ChatImages(settings, repository, model, () => {}, async () => new Response('', { status: 403 }));
  try {
    const result = await images.inspect(message, 0, '第二行的数字', signal());
    assert.equal(result.available, false); assert.equal(result.description, '旧描述：一张表格。');
    assert.ok(result.notice?.includes('没有重新看到原图'));
    assert.equal(model.requests.length, 0);
  } finally { await images.stop(); repository.close(); }
});

test('untriggered images are described immediately; multiple text followups carry references without original pixels and tools inspect the selected image', async () => {
  const options = config(); options.memory = settings;
  const adapter = new FakeAdapter(), described = deferred<void>(), calls = { value: 0 };
  const background = new FakeModel(async messages => {
    const current = messages.at(-1)!;
    if (current.images?.length) {
      if (current.content === '请描述这张图片。') { described.resolve(); return { role: 'assistant', content: '一张两列的商品价格表，具体数字需重看原图确认。' }; }
      assert.equal(current.content, '第二行的价格？');
      return { role: 'assistant', content: '第二行价格为128元。' };
    }
    return { role: 'assistant', content: '{"memories":[]}' };
  });
  const model = new FakeModel(async messages => {
    assert.ok(!messages.some(message => message.images?.length));
    assert.ok(JSON.stringify(messages).includes('img_1_1'));
    const last = messages.at(-1)!;
    if (last.role === 'tool') { assert.ok(last.content?.includes('128元')); return { role: 'assistant', content: '第二行是128元。' }; }
    if (last.content?.includes('第二行')) return { role: 'assistant', content: null, tool_calls: [{ id: 'see-first-image', type: 'function', function: { name: 'inspect_chat_image', arguments: '{"imageId":"img_1_1","question":"第二行的价格？"}' } }] };
    return { role: 'assistant', content: '记得，是商品价格表。' };
  });
  const app = await createApp(options, { adapter, model, memoryModel: background, imageFetch: fetchPictures(calls) });
  try {
    const image = event('', 1); image.segments = [{ type: 'image', url: 'https://example.qpic.cn/table.png' }];
    app.ctx.intake.receive(image);
    await described.promise; await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(adapter.sent.length, 0);
    assert.equal(calls.value, 1);
    app.ctx.intake.receive(event('小狼，你记得这张图吗？', 2)); await app.ctx.chat.idle();
    assert.equal(calls.value, 1);
    app.ctx.intake.receive(event('小狼，第二行是多少？', 3)); await app.ctx.chat.idle();
    assert.equal(calls.value, 2);
    assert.equal(adapter.sent.at(-1)!.text, '第二行是128元。');
    assert.ok(app.ctx.historyReader.recent(1).items[0]!.state === 'completed');
    // Forgetting the source also prevents the image tool from reopening it.
    const memory = await app.ctx.memory.mutate({ action: 'remember', value: { content: '一张表格', kind: 'event', people: ['200'], sources: [1], importance: 2 } }) as { item: { id: string; version: number } };
    await app.ctx.memory.mutate({ action: 'forget', id: memory.item.id, version: memory.item.version });
    await assert.rejects(app.ctx.tools.execute({ id: 'blocked-image', type: 'function', function: { name: 'inspect_chat_image', arguments: '{"imageId":"img_1_1","question":"价格？"}' } }, app.ctx.store.record(1)!.message, signal()), /image_not_found/);
  } finally { await app.stop(); }
});
