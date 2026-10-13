import type { Gateway, ModelMessage, Output, Store, Turn } from './contracts.js';
import { id } from './contracts.js';
import { check, Failure } from './errors.js';

export function splitText(text: string, limit: number): string[] {
  const characters = Array.from(text);
  const parts: string[] = [];
  for (let start = 0; start < characters.length; start += limit) parts.push(characters.slice(start, start + limit).join(''));
  return parts;
}
export class Sender implements Output {
  constructor(private store: Store, private gateway: Gateway, private limit: number) {}
  async send(turn: Turn, text: string, protocol: ModelMessage[], signal: AbortSignal): Promise<void> {
    check(signal);
    if (!text.trim()) throw new Failure('empty_reply');
    const parts = splitText(text, this.limit);
    this.store.draft(turn.id, text, protocol);
    this.store.prepareSend(turn.id, parts);
    const platformIds: string[] = [];
    for (const [part, content] of parts.entries()) {
      check(signal);
      this.store.sendState(turn.id, part, 'sending');
      const params = { message: [{ type: 'text', data: { text: content } }],
        ...(turn.message.group ? { group_id: turn.message.group } : { user_id: turn.message.sender }) };
      let platformId: string;
      try {
        const response = await this.gateway.request(turn.message.group ? 'send_group_msg' : 'send_private_msg', params, signal);
        const receivedId = id(response.message_id);
        if (!receivedId) throw new Failure('send_invalid_receipt', true);
        platformId = receivedId;
      } catch (error) {
        const unknown = !(error instanceof Failure) || error.unknownOutcome;
        this.store.sendState(turn.id, part, unknown ? 'unknown' : 'failed');
        throw new Failure(error instanceof Failure ? error.code : 'send_error', unknown);
      }
      platformIds.push(platformId);
      // Only confirmed text enters future chat context; a failed draft never does.
      const visible = parts.slice(0, part + 1).join('');
      const visibleProtocol = structuredClone(protocol);
      visibleProtocol[visibleProtocol.length - 1] = { ...visibleProtocol[visibleProtocol.length - 1]!, content: visible };
      try {
        this.store.confirmSend(turn, part, platformId, visible, visibleProtocol, platformIds);
      } catch { throw new Failure('send_persistence_failed', true); }
    }
  }
}
