import { Context, FiberState } from 'cordis';
import type { Fiber, Plugin } from 'cordis';
import type { Config } from './config.js';
import type { Gateway, Log, Model } from './contracts.js';
import { log } from './contracts.js';
import { chatPlugin } from './chat.js';
import { normalize } from './messages.js';
import { SessionQueue } from './scheduler.js';
import { SqliteStore } from './store.js';
import { DeepSeekModel } from './model.js';
import { OneBotConnection } from './onebot.js';
import { ToolRegistry } from './tools.js';
import { Sender } from './output.js';
import { Failure } from './errors.js';

export const storePlugin: Plugin.Object<Config> = {
  name: 'xiaolang-store', apply(ctx, config) {
    const store = new SqliteStore(config.database);
    ctx.effect(() => () => store.close());
    ctx.provide('store', store);
  },
};
export const schedulerPlugin: Plugin.Object<Config> = {
  name: 'xiaolang-scheduler', apply(ctx, config) {
    const queue = new SessionQueue(config.limits.concurrency, config.limits.queue, config.limits.queueAgeMs);
    ctx.effect(() => () => queue.close());
    ctx.provide('scheduler', queue);
  },
};
export const triggerPlugin: Plugin.Object<Config> = {
  name: 'xiaolang-trigger', apply(ctx, config) {
    ctx.provide('trigger', { match(message) {
      if (!message.group) return 'private';
      if (message.segments.some(part => part.type === 'at' && part.data.qq === message.account)) return 'mention';
      if (config.triggerWords.some(word => message.text.includes(word))) return 'keyword';
      return undefined;
    } });
  },
};
export const intakePlugin: Plugin.Object<Config> = {
  name: 'xiaolang-intake', inject: ['store'], apply(ctx, config) {
    ctx.provide('intake', { receive(event) {
      const normalized = normalize(event, config.account, config.groupIds);
      if (!normalized) return;
      const message = ctx.store.admit(normalized);
      if (!message) return;
      // Observers have no default reply path, and never block message dispatch.
      void ctx.parallel('xiaolang/observed', structuredClone(message)).catch(() => log(ctx, 'observer_failed'));
      ctx.emit('xiaolang/message', message);
    } });
  },
};
export const toolsPlugin: Plugin.Object<void> = {
  name: 'xiaolang-tools', apply(ctx) { ctx.provide('tools', new ToolRegistry()); },
};
export const clockPlugin: Plugin.Object<void> = {
  name: 'xiaolang-clock', inject: ['tools'], apply(ctx) {
    ctx.effect(() => ctx.tools.register({
      name: 'current_time', description: '查询当前时间，返回 UTC 与北京时间。', effect: 'read',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async () => ({ utc: new Date().toISOString(), shanghai: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }),
    }));
  },
};
export const outputPlugin: Plugin.Object<Config> = {
  name: 'xiaolang-output', inject: ['store', 'gateway'], apply(ctx, config) { ctx.provide('output', new Sender(ctx.store, ctx.gateway, config.limits.replyChars)); },
};
export interface AppOptions {
  apiKey?: string;
  onebotToken?: string;
  model?: Model;
  gateway?: Gateway;
  report?: (entry: Log) => void;
}

export async function createApp(config: Config, options: AppOptions) {
  const ctx = new Context();
  const fibers: Fiber[] = [];
  let chat: Fiber | undefined;
  let connection: OneBotConnection | undefined;
  async function mount<T>(plugin: Plugin<T>, config: T): Promise<Fiber> {
    const fiber = await ctx.plugin(plugin, config);
    fibers.push(fiber);
    if (fiber.state !== FiberState.ACTIVE) throw new Failure('plugin_not_ready');
    return fiber;
  }
  const modelPlugin: Plugin.Object<void> = { name: 'xiaolang-deepseek', apply(context) {
    if (!options.model && !options.apiKey) throw new Failure('missing_model_key');
    context.provide('model', options.model ?? new DeepSeekModel(config.model, options.apiKey!));
  } };
  const gatewayPlugin: Plugin.Object<void> = { name: 'xiaolang-onebot', inject: ['intake'], apply(context) {
    if (options.gateway) { context.provide('gateway', options.gateway); return; }
    if (!options.onebotToken) throw new Failure('missing_onebot_token');
    connection = new OneBotConnection(config.onebot, config.account, options.onebotToken, event => context.intake.receive(event), code => log(context, code));
    const owned = connection;
    context.effect(() => () => owned.close());
    context.provide('gateway', connection);
  } };
  async function stop() {
    await ctx.get('chat')?.stop();
    if (chat && chat.state !== FiberState.DISPOSED) await chat.dispose();
    for (const fiber of [...fibers].reverse()) if (fiber.state !== FiberState.DISPOSED) await fiber.dispose();
    await ctx.fiber.dispose();
  }
  try {
    ctx.on('xiaolang/log', entry => { options.report?.(entry); });
    await mount(storePlugin, config);
    await mount(schedulerPlugin, config);
    await mount(triggerPlugin, config);
    await mount(toolsPlugin, undefined);
    await mount(clockPlugin, undefined);
    await mount(intakePlugin, config);
    await mount(modelPlugin, undefined);
    await mount(gatewayPlugin, undefined);
    await mount(outputPlugin, config);
    if (config.chatEnabled) chat = await mount(chatPlugin, config);
    connection?.start();
    return { ctx, stop, stopChat: async () => { await ctx.get('chat')?.stop(); if (chat) await chat.dispose(); } };
  } catch (error) { await stop(); throw error; }
}
