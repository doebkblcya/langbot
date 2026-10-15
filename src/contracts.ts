import type { Context } from 'cordis';

export type Fields = Record<string, unknown>;
export type Segment =
  | { type: 'text'; text: string }
  | { type: 'mention'; userId: string }
  | { type: 'reply'; messageId: string }
  | { type: 'unsupported'; kind: string };
export interface IncomingMessage {
  account: string;
  id: string;
  sender: string;
  name: string;
  group?: string;
  time: number;
  segments: Segment[];
}
export interface Message extends IncomingMessage {
  key: string;
  platform: string;
  session: string;
  text: string;
  seq: number;
}
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}
export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Fields };
}
export interface Model {
  complete(messages: ModelMessage[], tools: ToolSchema[], signal: AbortSignal): Promise<ModelMessage>;
}
export interface Adapter {
  platform: string;
  account: string;
  capabilities: { groupMessages: 'all' | 'mentions'; maxTextChars: number };
  start(receive: (message: IncomingMessage) => void): Promise<void> | void;
  stop(): Promise<void> | void;
  reply(message: Message, text: string, part: number, signal: AbortSignal): Promise<{ id: string }>;
}
export type TurnState = 'queued' | 'running' | 'sending' | 'completed' | 'failed' | 'cancelled' | 'unknown' | 'expired';
export interface Turn { id: string; message: Message; reason: string }
export interface SendRecord { part: number; text: string; state: 'pending' | 'sending' | 'sent' | 'failed' | 'unknown'; platformId?: string }
export interface Store {
  admit(message: Message): Message | undefined;
  history(message: Message, limit: number): ModelMessage[];
  createTurn(message: Message, reason: string): Turn;
  state(id: string, state: TurnState, code?: string): void;
  draft(id: string, text: string, protocol: ModelMessage[]): void;
  prepareSend(id: string, parts: string[]): void;
  sendState(id: string, part: number, state: SendRecord['state'], platformId?: string): void;
  delivered(turn: Turn, text: string, protocol: ModelMessage[], platformIds: string[]): void;
  confirmSend(turn: Turn, part: number, platformId: string, text: string, protocol: ModelMessage[], platformIds: string[]): void;
  toolStart(turn: string, call: ToolCall): void;
  toolEnd(turn: string, call: string, state: string, result: string): void;
}
export interface Scheduler {
  enqueue(key: string, run: (signal: AbortSignal) => Promise<void>): Promise<void>;
}
export interface Trigger { match(message: Message): string | undefined }
export interface Intake { receive(event: unknown): void }
export interface ToolContext { message: Message; signal: AbortSignal }
export interface Tool {
  name: string;
  description: string;
  parameters: Fields;
  effect?: 'read' | 'write';
  execute(args: Fields, context: ToolContext): Promise<unknown>;
}
export interface Tools {
  register(tool: Tool): () => void;
  schemas(): ToolSchema[];
  execute(call: ToolCall, message: Message, signal: AbortSignal): Promise<unknown>;
}
export interface Output {
  send(turn: Turn, text: string, protocol: ModelMessage[], signal: AbortSignal): Promise<void>;
}
export interface Chat { idle(): Promise<void>; stop(): Promise<void> }
export interface Log {
  code: string; time?: string; level?: 'info' | 'warn' | 'error';
  turn?: string; stage?: string; plugin?: string; dependencies?: string[];
  messageId?: string; scope?: 'private' | 'group'; sender?: string; group?: string;
  preview?: string; reason?: string; model?: string; step?: number; tool?: string;
  part?: number; parts?: number; toolCalls?: number; durationMs?: number; waitMs?: number;
  state?: string; errorCode?: string; receipt?: string;
}
export interface TurnView {
  id: string; seq: number; state: string; reason: string; errorCode: string | null;
  received: number; updated: number; scope: 'private' | 'group'; sender: string; group?: string;
  input: string; reply: string; inputTruncated: boolean; replyTruncated: boolean;
}
export interface TurnDetail extends TurnView {
  sends: { part: number; text: string; state: string; receipt: string | null }[];
  tools: { name: string; state: string }[];
}
export interface HistoryReader {
  counts(): Record<string, number>;
  recent(limit: number, before?: number, failures?: boolean): { items: TurnView[]; next: number | null };
  detail(id: string): TurnDetail | undefined;
}
export interface LogItem { seq: number; entry: Log }
export interface Inspection {
  status(): {
    started: number; uptimeMs: number; state: string; connection: string; lastMessage?: string;
    model: string; platform?: string; chatEnabled: boolean; memoryBytes: number;
    counts: Record<string, number>; plugins: { id: string; module: string; state: string }[];
  };
  recent: HistoryReader['recent']; detail: HistoryReader['detail'];
  logs(after?: number): { items: LogItem[]; cursor: number; reset: boolean };
}

declare module 'cordis' {
  interface Context {
    store: Store;
    scheduler: Scheduler;
    trigger: Trigger;
    intake: Intake;
    model: Model;
    adapter: Adapter;
    tools: Tools;
    output: Output;
    chat: Chat;
    logOutput: { write(entry: Log): void };
    historyReader: HistoryReader;
    inspection: Inspection;
  }
  interface Events {
    'xiaolang/message'(message: Message): void;
    'xiaolang/observed'(message: Message): void | Promise<void>;
    'xiaolang/log'(entry: Log): void;
    'xiaolang/logged'(entry: Log): void;
  }
}

export function emitLog(ctx: Context, entry: Log): void {
  // Observability must never change the outcome of message processing.
  try { ctx.emit('xiaolang/log', { ...entry, time: new Date().toISOString() }); } catch { /* isolated observer */ }
}
export function log(ctx: Context, code: string, turn?: string, stage?: string, details: Partial<Log> = {}): void {
  emitLog(ctx, { ...details, code, turn, stage });
}
export function messageLog(message: Message): Partial<Log> {
  return { messageId: message.key, scope: message.group ? 'group' : 'private', sender: message.name, group: message.group };
}
export function elapsed(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}
export function object(value: unknown): Fields | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : undefined;
}
export function id(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0 && value.length <= 512) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
}
