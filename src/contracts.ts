import type { Context } from 'cordis';

export type Fields = Record<string, unknown>;
export interface Segment { type: string; data: Fields }
export interface Message {
  key: string;
  account: string;
  session: string;
  id: string;
  sender: string;
  name: string;
  group?: string;
  time: number;
  segments: Segment[];
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
export interface Gateway {
  request(action: string, params: Fields, signal: AbortSignal): Promise<Fields>;
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
export interface Log { code: string; turn?: string; stage?: string }

declare module 'cordis' {
  interface Context {
    store: Store;
    scheduler: Scheduler;
    trigger: Trigger;
    intake: Intake;
    model: Model;
    gateway: Gateway;
    tools: Tools;
    output: Output;
    chat: Chat;
  }
  interface Events {
    'xiaolang/message'(message: Message): void;
    'xiaolang/observed'(message: Message): void | Promise<void>;
    'xiaolang/log'(entry: Log): void;
  }
}

export function log(ctx: Context, code: string, turn?: string, stage?: string): void {
  ctx.emit('xiaolang/log', { code, turn, stage });
}
export function object(value: unknown): Fields | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : undefined;
}
export function id(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
}
