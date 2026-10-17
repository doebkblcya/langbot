import { createHash } from 'node:crypto';
import type { Adapter, Message, Segment } from './contracts.js';
import { id, object } from './contracts.js';

/** Validate the application message contract, never a platform's wire format. */
export function normalize(raw: unknown, adapter: Pick<Adapter, 'platform' | 'account'>, groups: string[]): Message | undefined {
  return inspectMessage(raw, adapter, groups).message;
}
type Inspection = { message: Message; reason?: never } | { message?: never; reason: string };
export function inspectMessage(raw: unknown, adapter: Pick<Adapter, 'platform' | 'account'>, groups: string[]): Inspection {
  const invalid: Inspection = { reason: 'invalid_message' };
  const event = object(raw);
  if (!event) return invalid;
  if (event.account !== adapter.account) return { reason: 'account_mismatch' };
  const sender = id(event.sender);
  const messageId = id(event.id);
  if (!sender || !messageId) return invalid;
  if (sender === adapter.account) return { reason: 'own_message' };
  const group = event.group === undefined ? undefined : id(event.group);
  if (event.group !== undefined && !group) return invalid;
  if (group && groups.length > 0 && !groups.includes(group)) return { reason: 'group_not_allowed' };
  if (typeof event.time !== 'number' || !Number.isFinite(event.time) || Math.abs(event.time) > 8_640_000_000_000_000) return invalid;
  if (!Array.isArray(event.segments) || event.segments.length > 1000) return invalid;
  const segments: Segment[] = [];
  for (const part of event.segments) {
    const segment = object(part);
    if (!segment) return invalid;
    if (segment.type === 'text' && typeof segment.text === 'string') segments.push({ type: 'text', text: segment.text.slice(0, 100_000) });
    else if (segment.type === 'mention' && id(segment.userId)) segments.push({ type: 'mention', userId: id(segment.userId)! });
    else if (segment.type === 'reply' && id(segment.messageId)) segments.push({ type: 'reply', messageId: id(segment.messageId)! });
    else if (segment.type === 'image' && typeof segment.url === 'string' && segment.url.length <= 4096 && /^https:\/\//.test(segment.url)) segments.push({ type: 'image', url: segment.url, ...(typeof segment.mime === 'string' ? { mime: segment.mime.slice(0, 100) } : {}) });
    else if (segment.type === 'unsupported' && typeof segment.kind === 'string') segments.push({ type: 'unsupported', kind: segment.kind.slice(0, 100) });
    else return invalid;
  }
  if (!segments.length) return invalid;
  const session = JSON.stringify([adapter.platform, adapter.account, group ? 'group' : 'private', group ?? sender]);
  return { message: {
    key: createHash('sha256').update(JSON.stringify([session, messageId])).digest('hex'),
    platform: adapter.platform, account: adapter.account, session, id: messageId, sender,
    name: typeof event.name === 'string' ? event.name.slice(0, 100) : sender, group, time: event.time,
    segments, text: segments.filter(p => p.type === 'text').map(p => p.text).join(''), seq: 0,
  } };
}
export function render(message: Message): string {
  const body = message.segments.map(part => {
    if (part.type === 'text') return part.text;
    if (part.type === 'mention') return `[提及用户:${part.userId}]`;
    if (part.type === 'reply') return `[引用消息:${part.messageId}，原文未加载]`;
    if (part.type === 'image') return '[图片]';
    return `[暂不支持的消息:${part.kind}]`;
  }).join('');
  return `[${new Date(message.time).toISOString()} ${message.name} 用户:${message.sender} ${message.group ? `群:${message.group}` : '私聊'}] ${body}`;
}
