import { Context, FiberState } from 'cordis';
import type { Fiber, Plugin } from 'cordis';
import { Loader } from '@cordisjs/plugin-loader';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Config } from './config.js';
import type { Adapter, Configuration, IncomingMessage, Log, Model } from './contracts.js';
import { emitLog, log, messageLog } from './contracts.js';
import { chatPlugin } from './chat.js';
import { inspectMessage } from './messages.js';
import { loggingPlugin } from './logging.js';
import { inspectionPlugin } from './inspection.js';
import { SessionQueue } from './scheduler.js';
import { SqliteStore } from './store.js';
import { DeepSeekModel } from './model.js';
import { ToolRegistry } from './tools.js';
import { Sender } from './output.js';
import { abortable, check, code, Failure } from './errors.js';
import { checkPlugins, configurePlugins } from './plugins.js';
import type { PluginStatus } from './plugins.js';

export const storePlugin: Plugin.Object<Config> = {
  name: 'xiaolang-store', apply(ctx, config) {
    const store = new SqliteStore(config.database);
    ctx.effect(() => () => store.close());
    ctx.provide('store', store);
    ctx.provide('historyReader', { counts: () => store.counts(), recent: (limit, before, failures) => store.recent(limit, before, failures), detail: id => store.detail(id) });
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
      if (message.segments.some(part => part.type === 'mention' && part.userId === message.account)) return 'mention';
      if (config.triggerWords.some(word => message.text.includes(word))) return 'keyword';
      return undefined;
    } });
  },
};
export const intakePlugin: Plugin.Object<Config> = {
  name: 'xiaolang-intake', inject: ['store', 'adapter'], apply(ctx, config) {
    ctx.provide('intake', { receive(event) {
      const result = inspectMessage(event, ctx.adapter, config.groupIds);
      const normalized = result.message;
      if (!normalized) { log(ctx, 'message_ignored', undefined, 'intake', { reason: result.reason }); return; }
      const details = messageLog(normalized);
      const message = ctx.store.admit(normalized);
      if (!message) { log(ctx, 'message_ignored', undefined, 'intake', { ...details, reason: 'duplicate' }); return; }
      log(ctx, 'message_received', undefined, 'intake', { ...details, preview: message.text });
      // Observers have no default reply path, and never block message dispatch.
      void ctx.parallel('xiaolang/observed', structuredClone(message)).catch(() => log(ctx, 'observer_failed'));
      if (!ctx.get('chat')) log(ctx, 'message_ignored', undefined, 'trigger', { ...details, reason: 'chat_disabled' });
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
  name: 'xiaolang-output', inject: ['store', 'adapter'], apply(ctx, config) { ctx.provide('output', new Sender(ctx.store, ctx.adapter, config.limits.replyChars, entry => emitLog(ctx, entry))); },
};
export interface AppOptions {
  apiKey?: string;
  model?: Model;
  adapter?: Adapter;
  signal?: AbortSignal;
  report?: (entry: Log) => void;
  writeLog?: (line: string) => void;
  secrets?: string[];
  configuration?: Configuration;
}

export async function createApp(config: Config, options: AppOptions) {
  const ctx = new Context();
  const fibers: Fiber[] = [];
  let chat: Fiber | undefined;
  let loader: Fiber | undefined;
  let adapter: Adapter | undefined = options.adapter;
  let state: 'starting' | 'running' | 'stopped' = 'starting';
  const beforeReady: IncomingMessage[] = [];
  async function mount<T>(plugin: Plugin<T>, config: T): Promise<Fiber> {
    const fiber = await ctx.plugin(plugin, config);
    fibers.push(fiber);
    return fiber;
  }
  const modelPlugin: Plugin.Object<void> = { name: 'xiaolang-deepseek', apply(context) {
    if (!options.model && !options.apiKey) throw new Failure('missing_model_key');
    context.provide('model', options.model ?? new DeepSeekModel(config.model, options.apiKey!));
  } };
  async function stop() {
    log(ctx, 'application_stopping', undefined, 'lifecycle');
    state = 'stopped';
    beforeReady.length = 0;
    const active = ctx.get('chat');
    try { if (typeof active?.stop === 'function') await active.stop(); }
    finally {
      try { if (typeof adapter?.stop === 'function') await adapter.stop(); }
      finally {
        if (chat && chat.state !== FiberState.DISPOSED) await chat.dispose();
        if (loader && loader.state !== FiberState.DISPOSED) await loader.dispose();
        for (const fiber of [...fibers].reverse()) if (fiber.state !== FiberState.DISPOSED) await fiber.dispose();
        await ctx.fiber.dispose();
      }
    }
  }
  try {
    await mount(loggingPlugin, { settings: config.logging, report: options.report, write: options.writeLog,
      secrets: [...(options.secrets ?? []), ...(options.apiKey ? [options.apiKey] : [])] });
    await mount(storePlugin, config);
    await mount(inspectionPlugin, config);
    if (options.configuration) await mount({ name: 'xiaolang-configuration', apply(context) {
      context.provide('configuration', options.configuration!);
    } }, undefined);
    await mount(schedulerPlugin, config);
    await mount(triggerPlugin, config);
    await mount(toolsPlugin, undefined);
    await mount(clockPlugin, undefined);
    await mount(intakePlugin, config);
    await mount(modelPlugin, undefined);
    await mount(outputPlugin, config);
    const settings = config.plugins ?? { directory: 'plugins', entries: [] };
    const entries = [...settings.entries];
    if (options.adapter) {
      await mount({ name: 'xiaolang-injected-adapter', apply(context) { context.provide('adapter', options.adapter!); } }, undefined);
    } else {
      entries.unshift({ id: 'xiaolang-adapter', ...config.adapter });
    }
    const loading = { ...settings, entries };
    if (entries.length) {
      ctx.baseUrl = pathToFileURL(join(resolve(settings.directory), 'plugins.json')).href;
      loader = await mount(Loader, {});
      await configurePlugins(ctx, loading, config.chatEnabled);
    }
    if (config.chatEnabled && !config.plugins?.chat) chat = await mount(chatPlugin, config);
    const plugins: PluginStatus[] = loader ? await checkPlugins(ctx, loading, config.chatEnabled) : [];
    adapter = ctx.get('adapter');
    if (!adapter || typeof adapter.start !== 'function' || typeof adapter.stop !== 'function' || typeof adapter.reply !== 'function'
      || typeof adapter.platform !== 'string' || !adapter.platform || adapter.platform.length > 64
      || typeof adapter.account !== 'string' || !adapter.account || adapter.account.length > 512
      || !['all', 'mentions'].includes(adapter.capabilities?.groupMessages)
      || !Number.isInteger(adapter.capabilities?.maxTextChars) || adapter.capabilities.maxTextChars < 1 || adapter.capabilities.maxTextChars > 100_000) throw new Failure('invalid_adapter_service');
    if (fibers.some(fiber => fiber.state !== FiberState.ACTIVE)) throw new Failure('plugin_not_ready');
    if (config.chatEnabled) {
      const active = ctx.get('chat');
      if (!active || typeof active.idle !== 'function' || typeof active.stop !== 'function') throw new Failure('invalid_chat_service');
    }
    if (adapter.capabilities.groupMessages === 'mentions' && config.triggerWords.length) log(ctx, 'adapter_group_messages_limited');
    if (options.signal) check(options.signal);
    const owned = adapter;
    const starting = Promise.resolve(owned.start(message => {
      if (state === 'stopped' || ctx.get('adapter') !== owned) return;
      if (state === 'starting') {
        if (beforeReady.length < 100) beforeReady.push(message);
        else log(ctx, 'adapter_startup_event_capacity');
        return;
      }
      ctx.intake.receive(message);
    }));
    if (options.signal) await abortable(starting, options.signal);
    else await starting;
    state = 'running';
    log(ctx, 'application_ready', undefined, 'lifecycle');
    for (const message of beforeReady.splice(0)) ctx.intake.receive(message);
    return { ctx, plugins: plugins.filter(plugin => plugin.id !== 'xiaolang-adapter'), stop, stopChat: async () => {
      try { await ctx.get('chat')?.stop(); }
      finally {
        if (chat) await chat.dispose();
        if (config.plugins?.chat) await ctx.loader.store[config.plugins.chat]?.fiber?.dispose();
      }
    } };
  } catch (error) {
    log(ctx, 'application_failed', undefined, 'startup', { errorCode: code(error), level: 'error' });
    await stop(); throw error;
  }
}
