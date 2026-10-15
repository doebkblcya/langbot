import { setTimeout as delay } from 'node:timers/promises';
import type { Config } from './config.js';
import type { Model, ModelMessage, ToolCall, ToolSchema } from './contracts.js';
import { object } from './contracts.js';
import { check, Failure } from './errors.js';

export class DeepSeekModel implements Model {
  constructor(private config: Config['model'], private apiKey: string, private fetcher: typeof fetch = fetch) {}
  async complete(messages: ModelMessage[], tools: ToolSchema[], signal: AbortSignal): Promise<ModelMessage> {
    for (let attempt = 0; ; attempt++) {
      check(signal);
      try { return await this.once(messages, tools, signal); }
      catch (error) {
        check(signal);
        if (!(error instanceof Failure) || !error.retryable || attempt >= this.config.retries) throw error;
        await delay(Math.min(500 * 2 ** attempt, 4000), undefined, { signal });
      }
    }
  }
  private async once(messages: ModelMessage[], tools: ToolSchema[], signal: AbortSignal): Promise<ModelMessage> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]);
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: combined,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.name, messages, stream: false, max_tokens: this.config.maxOutputTokens,
          thinking: { type: this.config.thinking ? 'enabled' : 'disabled' },
          ...(this.config.thinking ? {
            ...(this.config.reasoningEffort ? { reasoning_effort: this.config.reasoningEffort } : {}),
            ...(this.config.topP !== undefined ? { top_p: this.config.topP } : {}),
          } : this.config.temperature !== undefined ? { temperature: this.config.temperature } : {}),
          ...(this.config.stop?.length ? { stop: this.config.stop } : {}), ...(tools.length ? { tools } : {}) }),
      });
    } catch {
      check(signal);
      throw new Failure(combined.aborted ? 'model_timeout' : 'model_network', false, true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Failure(`model_http_${response.status}`, false, response.status === 429 || response.status >= 500);
    }
    let raw: unknown;
    try { raw = await response.json(); }
    catch {
      check(signal);
      throw new Failure(combined.aborted ? 'model_timeout' : 'model_invalid_json', false, combined.aborted);
    }
    check(signal);
    const body = object(raw);
    const choices = body?.choices;
    const choice = Array.isArray(choices) ? object(choices[0]) : undefined;
    if (choice?.finish_reason === 'length') throw new Failure('model_output_truncated');
    if (!choice || !['stop', 'tool_calls'].includes(String(choice.finish_reason))) throw new Failure('model_invalid_response');
    const message = object(choice.message);
    if (message?.role !== 'assistant') throw new Failure('model_invalid_response');
    const result: ModelMessage = { role: 'assistant', content: typeof message.content === 'string' ? message.content : null };
    if (typeof message.reasoning_content === 'string') result.reasoning_content = message.reasoning_content;
    if (message.tool_calls !== undefined && message.tool_calls !== null) {
      if (!Array.isArray(message.tool_calls) || message.tool_calls.length > 8) throw new Failure('model_invalid_tool_calls');
      const ids = new Set<string>();
      result.tool_calls = message.tool_calls.map((rawCall: unknown): ToolCall => {
        const call = object(rawCall);
        const fn = object(call?.function);
        if (!call || call.type !== 'function' || typeof call.id !== 'string' || !call.id || call.id.length > 128 || ids.has(call.id)
          || typeof fn?.name !== 'string' || typeof fn.arguments !== 'string' || fn.arguments.length > 20000) throw new Failure('model_invalid_tool_calls');
        ids.add(call.id);
        return { id: call.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } };
      });
    }
    if (!result.tool_calls?.length && !result.content?.trim()) throw new Failure('model_empty_response');
    return result;
  }
}
