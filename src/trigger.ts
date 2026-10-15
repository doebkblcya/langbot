import type { Plugin } from 'cordis';
import type { Config } from './config.js';

export function triggerSettings(config: Config): NonNullable<Config['trigger']> {
  return structuredClone(config.trigger ?? { privateReply: true, groupMention: true, groupKeywords: true, words: config.triggerWords });
}

/** The only default trigger provider. Custom providers replace it, never run beside it. */
export const triggerPlugin: Plugin.Object<Config> = {
  name: 'xiaolang-trigger', apply(ctx, config) {
    const settings = triggerSettings(config);
    ctx.provide('trigger', { match(message) {
      if (!message.group) return settings.privateReply ? 'private' : undefined;
      if (settings.groupMention && message.segments.some(part => part.type === 'mention' && part.userId === message.account)) return 'mention';
      if (settings.groupKeywords && settings.words.some(word => message.text.includes(word))) return 'keyword';
      return undefined;
    } });
  },
};
