import { readFile, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { loadConfig, validateConfig } from './config.js';
import { validateQQConfig } from './adapters/qq-official.js';
import type { Configuration } from './contracts.js';
import { Failure } from './errors.js';

interface QQSettings { appId: string; environment: 'production' | 'sandbox'; groupMessages: 'all' | 'mentions'; connectTimeoutMs: number; groupIds: string[] }
interface Settings { model: Config['model']; qq?: QQSettings; secrets: { deepseek?: string; qq?: string } }
interface Document { version: 1; active?: Settings; pending?: Settings; lastApplyFailed?: boolean }

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function revision(text: string): string { return createHash('sha256').update(text).digest('hex'); }
function snapshot(config: Config): Settings {
  const qq = config.adapter.module === 'builtin:qq-official' ? validateQQConfig(config.adapter.config) : undefined;
  return { model: structuredClone(config.model), ...(qq ? { qq: {
    appId: qq.appId, environment: qq.environment, groupMessages: qq.groupMessages,
    connectTimeoutMs: qq.connectTimeoutMs, groupIds: [...config.groupIds],
  } } : {}), secrets: {} };
}
function combine(base: Config, settings: Settings): Config {
  const config = structuredClone(base);
  config.model = structuredClone(settings.model);
  if (settings.qq) {
    if (config.adapter.module !== 'builtin:qq-official') throw new Failure('qq_configuration_unavailable');
    const { groupIds, ...qq } = settings.qq;
    config.adapter.config = { ...validateQQConfig({ ...config.adapter.config, ...qq }) };
    config.groupIds = [...groupIds];
  }
  return validateConfig(config);
}
function checkSettings(raw: unknown, base: Config): Settings {
  if (!record(raw) || !keys(raw, ['model', 'qq', 'secrets']) || !record(raw.secrets)
    || !keys(raw.secrets, ['deepseek', 'qq'])) throw new Failure('invalid_saved_settings');
  for (const secret of Object.values(raw.secrets)) {
    if (typeof secret !== 'string' || !secret.trim() || secret.length > 4096 || /[\r\n\0]/.test(secret)) throw new Failure('invalid_secret');
  }
  if (raw.qq !== undefined && (!record(raw.qq) || Object.keys(raw.qq).length !== 5 || !keys(raw.qq, ['appId', 'environment', 'groupMessages', 'connectTimeoutMs', 'groupIds'])
    || !Array.isArray(raw.qq.groupIds))) throw new Failure('invalid_saved_settings');
  const settings = raw as unknown as Settings;
  combine(base, settings);
  return settings;
}

/** Only these two configuration sections are writable; credentials never leave this service. */
export class ConfigurationStore implements Configuration {
  readonly config: Config;
  readonly secrets: { deepseek?: string; qq?: string };
  private boot: Settings;
  private initial: Settings;
  private writing = false;
  private restarting = false;
  private bootPending: boolean;
  private constructor(private base: Config, readonly path: string, document: Document,
    private environment: NodeJS.ProcessEnv, private restart: () => void, private canRestart: () => boolean) {
    this.initial = snapshot(base);
    this.bootPending = !!document.pending;
    this.boot = structuredClone(document.pending ?? document.active ?? this.initial);
    this.config = combine(base, this.boot);
    this.secrets = structuredClone(this.boot.secrets);
  }
  static async load(configPath: string, restart: () => void, canRestart: () => boolean,
    environment: NodeJS.ProcessEnv = process.env): Promise<ConfigurationStore> {
    const base = await loadConfig(configPath);
    const path = join(dirname(resolve(base.database)), 'settings.json');
    const document = (await ConfigurationStore.read(path, base)).document;
    return new ConfigurationStore(base, path, document, environment, restart, canRestart);
  }
  private static async read(path: string, base: Config): Promise<{ document: Document; revision: string }> {
    let text: string;
    try { text = await readFile(path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { document: { version: 1 }, revision: revision('') };
      throw new Failure('settings_read_failed');
    }
    try {
      const raw: unknown = JSON.parse(text);
      if (!record(raw) || raw.version !== 1 || !keys(raw, ['version', 'active', 'pending', 'lastApplyFailed'])
        || (raw.lastApplyFailed !== undefined && typeof raw.lastApplyFailed !== 'boolean')) throw new Error();
      if (raw.active !== undefined) checkSettings(raw.active, base);
      if (raw.pending !== undefined) checkSettings(raw.pending, base);
      return { document: raw as unknown as Document, revision: revision(text) };
    } catch { throw new Failure('invalid_saved_settings'); }
  }
  private async write(document: Document): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(document, null, 2) + '\n'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, this.path);
    } catch { throw new Failure('settings_write_failed'); }
    finally { await unlink(temporary).catch(() => {}); }
  }
  async view(): Promise<Record<string, unknown>> {
    const { document, revision } = await ConfigurationStore.read(this.path, this.base);
    const settings = document.pending ?? document.active ?? this.initial;
    const qq = this.base.adapter.module === 'builtin:qq-official' ? validateQQConfig(this.base.adapter.config) : undefined;
    return { revision, pendingRestart: !!document.pending, lastApplyFailed: !!document.lastApplyFailed, turnTimeoutMs: this.config.limits.turnTimeoutMs,
      model: { ...settings.model, secretConfigured: !!(settings.secrets.deepseek || this.environment.DEEPSEEK_API_KEY) },
      qq: { ...settings.qq, supported: this.base.adapter.module === 'builtin:qq-official',
        secretConfigured: !!(settings.secrets.qq || (qq && this.environment[qq.secretEnv])), transport: 'websocket' },
      active: { model: this.config.model.name, appId: this.config.adapter.config?.appId, environment: this.config.adapter.config?.environment },
    };
  }
  async save(section: 'model' | 'qq', raw: unknown): Promise<Record<string, unknown>> {
    if (this.writing || this.restarting) throw new Failure('settings_busy');
    this.writing = true;
    try {
      if (!record(raw) || !keys(raw, ['revision', 'value', 'secret']) || typeof raw.revision !== 'string' || !record(raw.value)
        || (raw.secret !== undefined && typeof raw.secret !== 'string')) throw new Failure('invalid_settings_request');
      const existing = await ConfigurationStore.read(this.path, this.base);
      if (raw.revision !== existing.revision) throw new Failure('settings_conflict');
      const next = structuredClone(existing.document.pending ?? existing.document.active ?? this.initial);
      if (section === 'qq') {
        if (!next.qq) throw new Failure('qq_configuration_unavailable');
        next.qq = raw.value as unknown as QQSettings;
      } else next.model = raw.value as unknown as Config['model'];
      const secret = typeof raw.secret === 'string' ? raw.secret.trim() : '';
      if (secret) next.secrets[section === 'model' ? 'deepseek' : 'qq'] = secret;
      checkSettings(next, this.base);
      const active = existing.document.active ?? this.boot;
      await this.write({ version: 1, active,
        ...(JSON.stringify(next) === JSON.stringify(active) ? {} : { pending: next }) });
      return await this.view();
    } finally { this.writing = false; }
  }
  async apply(expectedRevision: string): Promise<void> {
    if (this.writing || this.restarting) throw new Failure('settings_busy');
    this.restarting = true;
    try {
      const { document, revision } = await ConfigurationStore.read(this.path, this.base);
      if (revision !== expectedRevision) throw new Failure('settings_conflict');
      if (!document.pending) throw new Failure('no_pending_settings');
      if (!this.canRestart()) throw new Failure('chat_busy');
      this.restart();
    } catch (error) { this.restarting = false; throw error; }
  }
  async confirm(): Promise<void> {
    if (!this.bootPending) return;
    const { document } = await ConfigurationStore.read(this.path, this.base);
    if (JSON.stringify(document.pending) === JSON.stringify(this.boot)) await this.write({ version: 1, active: this.boot });
    this.bootPending = false;
  }
  async rollback(): Promise<boolean> {
    if (!this.bootPending) return false;
    const { document } = await ConfigurationStore.read(this.path, this.base);
    if (JSON.stringify(document.pending) !== JSON.stringify(this.boot)) return false;
    await this.write({ version: 1, active: document.active ?? this.initial, lastApplyFailed: true });
    return true;
  }
}
