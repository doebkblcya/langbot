import { readFile } from 'node:fs/promises';
import { Ajv } from 'ajv';
import { Failure } from './errors.js';

export interface PluginEntry {
  id: string;
  module: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}
export interface PluginConfig {
  directory: string;
  entries: PluginEntry[];
  chat?: string;
}

export interface Config {
  account: string;
  database: string;
  persona: string;
  triggerWords: string[];
  groupIds: string[];
  chatEnabled: boolean;
  plugins?: PluginConfig;
  onebot: { endpoint: string; timeoutMs: number; reconnectMs: number };
  model: { baseUrl: string; name: string; thinking: boolean; timeoutMs: number; maxOutputTokens: number; retries: number };
  limits: { concurrency: number; queue: number; queueAgeMs: number; turnTimeoutMs: number; contextChars: number; history: number; steps: number; toolTimeoutMs: number; toolResultChars: number; replyChars: number };
}
const positive = { type: 'integer', minimum: 1, maximum: 86_400_000 };
const text = { type: 'string', minLength: 1, maxLength: 20_000 };
const identifier = { type: 'string', pattern: '^[0-9]+$', maxLength: 32 };
const schema = {
  type: 'object', additionalProperties: false,
  required: ['account', 'database', 'persona', 'triggerWords', 'groupIds', 'chatEnabled', 'onebot', 'model', 'limits'],
  properties: {
    account: identifier, database: text, persona: text,
    triggerWords: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 100 } },
    groupIds: { type: 'array', maxItems: 1000, uniqueItems: true, items: identifier }, chatEnabled: { type: 'boolean' },
    plugins: { type: 'object', additionalProperties: false, required: ['directory', 'entries'], properties: {
      directory: text, chat: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' },
      entries: { type: 'array', maxItems: 100, items: {
        type: 'object', additionalProperties: false, required: ['id', 'module'], properties: {
          id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$' }, module: text,
          enabled: { type: 'boolean' }, config: { type: 'object' },
        },
      } },
    } },
    onebot: { type: 'object', additionalProperties: false, required: ['endpoint', 'timeoutMs', 'reconnectMs'], properties: { endpoint: text, timeoutMs: positive, reconnectMs: positive } },
    model: { type: 'object', additionalProperties: false, required: ['baseUrl', 'name', 'thinking', 'timeoutMs', 'maxOutputTokens', 'retries'], properties: {
      baseUrl: text, name: text, thinking: { type: 'boolean' }, timeoutMs: positive,
      maxOutputTokens: { type: 'integer', minimum: 1, maximum: 16384 }, retries: { type: 'integer', minimum: 0, maximum: 3 },
    } },
    limits: { type: 'object', additionalProperties: false,
      required: ['concurrency', 'queue', 'queueAgeMs', 'turnTimeoutMs', 'contextChars', 'history', 'steps', 'toolTimeoutMs', 'toolResultChars', 'replyChars'],
      properties: { concurrency: { ...positive, maximum: 32 }, queue: { ...positive, maximum: 1000 }, queueAgeMs: positive, turnTimeoutMs: positive,
        contextChars: { ...positive, minimum: 1000, maximum: 100_000 }, history: { ...positive, maximum: 1000 }, steps: { ...positive, maximum: 20 },
        toolTimeoutMs: positive, toolResultChars: { ...positive, minimum: 256, maximum: 20000 }, replyChars: { ...positive, maximum: 4000 } },
    },
  },
};
const validate = new Ajv().compile<Config>(schema);
export function validateConfig(raw: unknown): Config {
  if (!validate(raw)) throw new Failure('invalid_config');
  let endpoint: URL;
  let baseUrl: URL;
  try { endpoint = new URL(raw.onebot.endpoint); baseUrl = new URL(raw.model.baseUrl); }
  catch { throw new Failure('invalid_url'); }
  if (!['ws:', 'wss:'].includes(endpoint.protocol) || !['https:', 'http:'].includes(baseUrl.protocol)
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Failure('invalid_url');
  if (raw.persona.length + 500 >= raw.limits.contextChars) throw new Failure('persona_exceeds_context');
  if (raw.plugins) {
    const ids = raw.plugins.entries.map(entry => entry.id);
    if (new Set(ids).size !== ids.length) throw new Failure('duplicate_plugin_id');
    if (raw.plugins.chat && !raw.plugins.entries.some(entry => entry.id === raw.plugins!.chat && entry.enabled !== false)) throw new Failure('invalid_chat_plugin');
  }
  return raw;
}
export async function loadConfig(path: string): Promise<Config> {
  return validateConfig(JSON.parse(await readFile(path, 'utf8')) as unknown);
}
