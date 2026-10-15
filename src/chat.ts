import type { Context, Plugin } from 'cordis';
import type { Config } from './config.js';
import type { Message, ModelMessage, Turn } from './contracts.js';
import { elapsed, log, messageLog } from './contracts.js';
import { abortable, check, code, Failure } from './errors.js';
import { render } from './messages.js';

function size(value: unknown): number { return JSON.stringify(value).length; }
export function assemble(persona: string, history: ModelMessage[], current: Message, budget: number, toolChars: number): ModelMessage[] {
  const system: ModelMessage = { role: 'system', content: persona };
  const user: ModelMessage = { role: 'user', content: render(current) };
  const groups: ModelMessage[][] = [];
  for (const message of history) {
    if (message.role === 'user' || groups.length === 0) groups.push([]);
    groups[groups.length - 1]!.push(message);
  }
  const reserve = size(system) + size(user) + toolChars;
  if (reserve > budget) throw new Failure('input_too_long');
  let length = reserve;
  const selected: ModelMessage[][] = [];
  for (const group of groups.reverse()) {
    const cost = size(group);
    if (length + cost > budget) break;
    selected.unshift(group);
    length += cost;
  }
  return [system, ...selected.flat(), user];
}

async function executeTurn(ctx: Context, config: Config, turn: Turn, parent: AbortSignal, queuedAt: number): Promise<void> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(config.limits.turnTimeoutMs)]);
  try { await runTurn(ctx, config, turn, signal, queuedAt); }
  catch (error) {
    if (code(error) === 'cancelled' && signal.aborted && !parent.aborted) throw new Failure('turn_timeout');
    throw error;
  }
}
async function runTurn(ctx: Context, config: Config, turn: Turn, signal: AbortSignal, queuedAt: number): Promise<void> {
  ctx.store.state(turn.id, 'running');
  log(ctx, 'turn_started', turn.id, 'scheduler', { ...messageLog(turn.message), waitMs: elapsed(queuedAt) });
  const tools = ctx.tools.schemas();
  const allowedTools = new Set(tools.map(tool => tool.function.name));
  const messages = assemble(config.persona, ctx.store.history(turn.message, config.limits.history), turn.message, config.limits.contextChars, size(tools));
  const protocol: ModelMessage[] = [];
  const calls = new Set<string>();
  for (let step = 0; step < config.limits.steps; step++) {
    check(signal);
    if (size(messages) + size(tools) > config.limits.contextChars) throw new Failure('context_budget');
    const started = performance.now();
    const modelDetails = { model: config.model.name, step: step + 1 };
    log(ctx, 'model_started', turn.id, 'model', modelDetails);
    let response: ModelMessage;
    try { response = await abortable(ctx.model.complete(structuredClone(messages), tools, signal), signal); }
    catch (error) { log(ctx, 'model_failed', turn.id, 'model', { ...modelDetails, durationMs: elapsed(started), errorCode: code(error) }); throw error; }
    log(ctx, 'model_completed', turn.id, 'model', { ...modelDetails, durationMs: elapsed(started), toolCalls: response.tool_calls?.length ?? 0 });
    check(signal);
    if (response.role !== 'assistant') throw new Failure('model_invalid_response');
    messages.push(response);
    protocol.push(response);
    if (!response.tool_calls?.length) {
      if (!response.content?.trim()) throw new Failure('model_empty_response');
      log(ctx, 'reply_generated', turn.id, 'model', { preview: response.content });
      await ctx.output.send(turn, response.content, protocol, signal);
      ctx.store.state(turn.id, 'completed');
      log(ctx, 'turn_completed', turn.id, 'complete', { durationMs: elapsed(queuedAt), state: 'completed' });
      return;
    }
    if (response.tool_calls.length > 8) throw new Failure('too_many_tool_calls');
    for (const call of response.tool_calls) {
      check(signal);
      if (calls.has(call.id)) throw new Failure('duplicate_tool_call');
      calls.add(call.id);
      ctx.store.toolStart(turn.id, call);
      const toolStarted = performance.now();
      log(ctx, 'tool_started', turn.id, 'tool', { tool: call.function.name });
      let result: string;
      try {
        if (step + 1 >= config.limits.steps) throw new Failure('step_budget');
        if (!allowedTools.has(call.function.name)) throw new Failure('tool_unavailable');
        const toolSignal = AbortSignal.any([signal, AbortSignal.timeout(config.limits.toolTimeoutMs)]);
        const value = await ctx.tools.execute(call, turn.message, toolSignal);
        result = JSON.stringify({ ok: true, result: value ?? null });
        if (result.length > config.limits.toolResultChars) result = JSON.stringify({ ok: true, truncated: true, preview: result.slice(0, config.limits.toolResultChars - 100) });
        ctx.store.toolEnd(turn.id, call.id, 'succeeded', result);
        log(ctx, 'tool_completed', turn.id, 'tool', { tool: call.function.name, durationMs: elapsed(toolStarted) });
      } catch (error) {
        result = JSON.stringify({ ok: false, error: code(error) });
        const unknown = error instanceof Failure && error.unknownOutcome;
        ctx.store.toolEnd(turn.id, call.id, unknown ? 'unknown' : 'failed', result);
        log(ctx, unknown ? 'tool_unknown' : 'tool_failed', turn.id, 'tool', { tool: call.function.name, durationMs: elapsed(toolStarted), errorCode: code(error) });
        if (unknown) throw new Failure('tool_outcome_unknown', true);
      }
      const toolMessage: ModelMessage = { role: 'tool', tool_call_id: call.id, content: result };
      messages.push(toolMessage);
      protocol.push(toolMessage);
    }
  }
  throw new Failure('step_budget');
}

export const chatPlugin: Plugin.Object<Config> = {
  name: 'xiaolang-chat', inject: ['store', 'scheduler', 'trigger', 'model', 'tools', 'output'],
  apply(ctx, config) {
    const controller = new AbortController();
    const jobs = new Set<Promise<void>>();
    const stop = async () => {
      remove();
      controller.abort();
      await Promise.allSettled([...jobs]);
    };
    ctx.provide('chat', { idle: async () => { await Promise.allSettled([...jobs]); }, stop });
    const remove = ctx.on('xiaolang/message', message => {
      const reason = ctx.trigger.match(message);
      if (!reason || controller.signal.aborted) {
        log(ctx, 'message_ignored', undefined, 'trigger', { ...messageLog(message), reason: controller.signal.aborted ? 'chat_disabled' : 'no_trigger' });
        return;
      }
      const turn = ctx.store.createTurn(message, reason);
      const queuedAt = performance.now();
      log(ctx, 'trigger_matched', turn.id, 'trigger', { ...messageLog(message), reason });
      log(ctx, 'turn_queued', turn.id, 'scheduler', messageLog(message));
      const settle = async (error: unknown) => {
        const failure = code(error);
        const state = error instanceof Failure && error.unknownOutcome ? 'unknown' : failure === 'queue_expired' ? 'expired' : failure === 'cancelled' ? 'cancelled' : 'failed';
        try { ctx.store.state(turn.id, state, failure); }
        catch { log(ctx, 'state_persistence_failed', turn.id); }
        log(ctx, failure, turn.id, 'error', { errorCode: failure, durationMs: elapsed(queuedAt), state, level: 'error' });
        if (!controller.signal.aborted) {
          try { await ctx.get('faultFeedback')?.notify(turn, failure, controller.signal); }
          catch { log(ctx, 'feedback_failed', turn.id, 'feedback'); }
        }
      };
      // Settle runtime failures before releasing this session to its next reply.
      const job = ctx.scheduler.enqueue(message.session, queueSignal =>
        executeTurn(ctx, config, turn, AbortSignal.any([queueSignal, controller.signal]), queuedAt).catch(settle))
        .catch(settle).finally(() => { jobs.delete(job); });
      jobs.add(job);
    });
    ctx.effect(() => stop);
  },
};
