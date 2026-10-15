import type { Adapter, Log, ModelMessage, Output, Store, Turn } from './contracts.js';
import { elapsed, id, messageLog } from './contracts.js';
import { check, code, Failure } from './errors.js';

export function splitText(text: string, limit: number): string[] {
  const characters = Array.from(text);
  const parts: string[] = [];
  for (let start = 0; start < characters.length; start += limit) parts.push(characters.slice(start, start + limit).join(''));
  return parts;
}
export class Sender implements Output {
  constructor(private store: Store, private adapter: Adapter, private limit: number, private report: (entry: Log) => void = () => {}) {}
  private emit(entry: Log): void { try { this.report(entry); } catch { /* isolated observer */ } }
  async feedback(turn: Turn, text: string, signal: AbortSignal): Promise<boolean> {
    check(signal);
    if (turn.message.platform !== this.adapter.platform || turn.message.account !== this.adapter.account) throw new Failure('adapter_target_mismatch');
    if (!text.trim() || Array.from(text).length > Math.min(this.limit, this.adapter.capabilities.maxTextChars)) throw new Failure('feedback_too_long');
    if (!this.store.prepareFeedback(turn.id, text)) return false;
    const details = { ...messageLog(turn.message), turn: turn.id, stage: 'feedback' };
    this.emit({ ...details, code: 'feedback_started', preview: text });
    let receipt: string;
    try {
      check(signal);
      const response = await this.adapter.reply(turn.message, text, 0, signal);
      const value = id(response.id);
      if (!value) throw new Failure('send_invalid_receipt', true);
      receipt = value;
    } catch (error) {
      const unknown = !(error instanceof Failure) || error.unknownOutcome;
      this.store.sendState(turn.id, -1, unknown ? 'unknown' : 'failed');
      this.emit({ ...details, code: unknown ? 'feedback_unknown' : 'feedback_failed', errorCode: code(error) });
      return false;
    }
    this.store.sendState(turn.id, -1, 'sent', receipt);
    this.emit({ ...details, code: 'feedback_sent', receipt });
    return true;
  }
  async send(turn: Turn, text: string, protocol: ModelMessage[], signal: AbortSignal): Promise<void> {
    check(signal);
    if (!text.trim()) throw new Failure('empty_reply');
    if (turn.message.platform !== this.adapter.platform || turn.message.account !== this.adapter.account) throw new Failure('adapter_target_mismatch');
    const parts = splitText(text, Math.min(this.limit, this.adapter.capabilities.maxTextChars));
    this.store.draft(turn.id, text, protocol);
    this.store.prepareSend(turn.id, parts);
    const platformIds: string[] = [];
    for (const [part, content] of parts.entries()) {
      check(signal);
      this.store.sendState(turn.id, part, 'sending');
      const started = performance.now();
      const details = { ...messageLog(turn.message), turn: turn.id, stage: 'send', part: part + 1, parts: parts.length };
      this.emit({ ...details, code: 'send_started', preview: content });
      let platformId: string;
      try {
        const response = await this.adapter.reply(turn.message, content, part, signal);
        const receivedId = id(response.id);
        if (!receivedId) throw new Failure('send_invalid_receipt', true);
        platformId = receivedId;
      } catch (error) {
        const unknown = !(error instanceof Failure) || error.unknownOutcome;
        this.store.sendState(turn.id, part, unknown ? 'unknown' : 'failed');
        this.emit({ ...details, code: unknown ? 'send_unknown' : 'send_failed', durationMs: elapsed(started), errorCode: code(error) });
        throw new Failure(error instanceof Failure ? error.code : 'send_error', unknown);
      }
      platformIds.push(platformId);
      this.emit({ ...details, code: 'send_confirmed', durationMs: elapsed(started), receipt: platformId });
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
