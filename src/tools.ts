import { Ajv } from 'ajv';
import type { Fields, Message, Tool, ToolCall, Tools, ToolSchema } from './contracts.js';
import { object } from './contracts.js';
import { abortable, check, Failure } from './errors.js';

export class ToolRegistry implements Tools {
  private entries = new Map<string, { tool: Tool; validate: ReturnType<Ajv['compile']>; controller: AbortController }>();
  private ajv = new Ajv({ strict: true });
  register(tool: Tool): () => void {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(tool.name) || this.entries.has(tool.name)) throw new Failure('invalid_tool_registration');
    const entry = { tool, validate: this.ajv.compile(tool.parameters), controller: new AbortController() };
    this.entries.set(tool.name, entry);
    return () => {
      if (this.entries.get(tool.name) !== entry) return;
      this.entries.delete(tool.name);
      entry.controller.abort();
    };
  }
  schemas(): ToolSchema[] {
    return [...this.entries.values()].map(({ tool }) => ({
      type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }
  async execute(call: ToolCall, message: Message, signal: AbortSignal): Promise<unknown> {
    check(signal);
    const entry = this.entries.get(call.function.name);
    if (!entry) throw new Failure('tool_unavailable');
    let args: Fields | undefined;
    try { args = object(JSON.parse(call.function.arguments)); }
    catch { throw new Failure('invalid_tool_arguments'); }
    if (!args || !entry.validate(args)) throw new Failure('invalid_tool_arguments');
    const combined = AbortSignal.any([signal, entry.controller.signal]);
    check(combined);
    let started = false;
    try {
      return await abortable(Promise.resolve().then(() => {
        check(combined);
        started = true;
        return entry.tool.execute(args, { message, signal: combined });
      }), combined);
    } catch (error) {
      const unknown = started && (entry.tool.effect ?? 'write') === 'write';
      throw new Failure(error instanceof Failure ? error.code : 'tool_execution_failed', unknown || (error instanceof Failure && error.unknownOutcome));
    }
  }
}
