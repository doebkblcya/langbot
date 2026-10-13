import { createHash } from 'node:crypto';
import type { Message, Segment } from './contracts.js';
import { id, object } from './contracts.js';

export function normalize(raw: unknown, account: string, groups: string[]): Message | undefined {
  const event = object(raw);
  if (!event || event.post_type !== 'message' || id(event.self_id) !== account) return;
  const sender = id(event.user_id);
  const messageId = id(event.message_id);
  if (!sender || !messageId || sender === account) return;
  const isGroup = event.message_type === 'group';
  // Temporary private sessions need an explicit reply route; do not guess it.
  if (!isGroup && !(event.message_type === 'private' && event.sub_type === 'friend')) return;
  const group = isGroup ? id(event.group_id) : undefined;
  if (isGroup && (!group || (groups.length > 0 && !groups.includes(group)))) return;
  if (!Array.isArray(event.message) || event.message.length > 1000) return;
  const segments: Segment[] = [];
  for (const part of event.message) {
    const segment = object(part);
    const data = object(segment?.data);
    if (!segment || typeof segment.type !== 'string' || !data) continue;
    if (segment.type === 'text' && typeof data.text === 'string') segments.push({ type: 'text', data: { text: data.text.slice(0, 100_000) } });
    else if (segment.type === 'at' && id(data.qq)) segments.push({ type: 'at', data: { qq: id(data.qq)! } });
    else if (segment.type === 'reply' && id(data.id)) segments.push({ type: 'reply', data: { id: id(data.id)! } });
    else segments.push({ type: 'unsupported', data: { kind: segment.type.slice(0, 100) } });
  }
  if (!segments.length) return;
  const session = JSON.stringify([account, isGroup ? 'group' : 'private', group ?? sender]);
  const info = object(event.sender);
  const name = typeof info?.card === 'string' && info.card ? info.card : typeof info?.nickname === 'string' ? info.nickname : sender;
  return {
    key: createHash('sha256').update(JSON.stringify([session, messageId])).digest('hex'),
    account, session, id: messageId, sender, name: name.slice(0, 100), group,
    time: typeof event.time === 'number' && Number.isFinite(event.time) && Math.abs(event.time) <= 8_640_000_000_000 ? event.time * 1000 : Date.now(),
    segments, text: segments.filter(p => p.type === 'text').map(p => p.data.text).join(''), seq: 0,
  };
}
export function render(message: Message): string {
  const body = message.segments.map(part => {
    if (part.type === 'text') return String(part.data.text);
    if (part.type === 'at') return `[提及 QQ:${part.data.qq}]`;
    if (part.type === 'reply') return `[引用消息:${part.data.id}，原文未加载]`;
    return `[暂不支持的消息:${part.data.kind}]`;
  }).join('');
  return `[${new Date(message.time).toISOString()} ${message.name} QQ:${message.sender}] ${body}`;
}
