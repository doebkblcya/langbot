import { readFileSync } from 'node:fs';
import { validateConfig } from '../src/config.js';
import type { Config } from '../src/config.js';
import type { Fields, Gateway, Model, ModelMessage, ToolSchema } from '../src/contracts.js';

export function config(): Config {
  const value = validateConfig(JSON.parse(readFileSync('config.example.json', 'utf8')));
  value.database = ':memory:';
  value.limits.turnTimeoutMs = 3000;
  value.model.timeoutMs = 1000;
  return value;
}
export function event(text: string, messageId = 1, group: number | null = 100, user = 200): Fields {
  return { post_type: 'message', message_type: group ? 'group' : 'private', sub_type: group ? 'normal' : 'friend',
    self_id: 123456789, user_id: user, group_id: group, message_id: messageId, time: 1700000000,
    sender: { nickname: `user-${user}` }, message: [{ type: 'text', data: { text } }] };
}
export class FakeGateway implements Gateway {
  sent: { action: string; params: Fields }[] = [];
  async request(action: string, params: Fields): Promise<Fields> {
    this.sent.push({ action, params });
    return { message_id: this.sent.length + 1000 };
  }
}
export class FakeModel implements Model {
  requests: ModelMessage[][] = [];
  constructor(private reply: (messages: ModelMessage[], tools: ToolSchema[], signal: AbortSignal) => Promise<ModelMessage> = async () => ({ role: 'assistant', content: '收到。' })) {}
  async complete(messages: ModelMessage[], tools: ToolSchema[], signal: AbortSignal): Promise<ModelMessage> {
    this.requests.push(structuredClone(messages));
    return this.reply(messages, tools, signal);
  }
}
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
