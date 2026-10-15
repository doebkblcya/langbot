import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FiberState } from 'cordis';
import type { Context } from 'cordis';
import type { EntryOptions } from '@cordisjs/plugin-loader';
import type { PluginConfig, PluginEntry } from './config.js';
import { emitLog, object } from './contracts.js';
import { Failure } from './errors.js';

export interface PluginStatus { id: string; state: 'active' | 'disabled' }

function fail(ctx: Context, code: string, plugin: string, dependencies?: string[]): never {
  emitLog(ctx, { code, plugin, dependencies });
  throw new Failure(code);
}
function disabled(entry: PluginEntry, settings: PluginConfig, chatEnabled: boolean): boolean {
  return entry.enabled === false || (entry.id === settings.chat && !chatEnabled);
}
function contains(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path !== '' && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path);
}
async function moduleName(ctx: Context, directory: string, entry: PluginEntry): Promise<string> {
  const name = entry.module;
  if (name.startsWith('builtin:')) {
    if (name !== 'builtin:qq-official') return fail(ctx, 'plugin_unknown_builtin', entry.id);
    return new URL('./adapters/qq-official.js', import.meta.url).href;
  }
  if (name.startsWith('./')) {
    try {
      const file = await realpath(resolve(directory, name));
      if (!contains(directory, file) || !['.js', '.mjs', '.cjs'].includes(extname(file))) return fail(ctx, 'plugin_invalid_path', entry.id);
      if (!(await stat(file)).isFile()) return fail(ctx, 'plugin_invalid_path', entry.id);
      return pathToFileURL(file).href;
    } catch (error) {
      if (error instanceof Failure) throw error;
      return fail(ctx, 'plugin_file_missing', entry.id);
    }
  }
  // Package names resolve in the mounted workspace, never through remote URLs.
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-zA-Z0-9._-]+)*$/.test(name)
    || name.split('/').some(part => part === '..' || part === '.')) return fail(ctx, 'plugin_invalid_module', entry.id);
  try {
    if (!(await stat(join(directory, 'package.json'))).isFile()) return fail(ctx, 'plugin_workspace_missing', entry.id);
  } catch { return fail(ctx, 'plugin_workspace_missing', entry.id); }
  return name;
}

/** Import and activation belong to the upstream Loader; this only validates app configuration. */
export async function configurePlugins(ctx: Context, settings: PluginConfig, chatEnabled: boolean): Promise<void> {
  let directory = resolve(settings.directory);
  const enabled = settings.entries.filter(entry => !disabled(entry, settings, chatEnabled));
  const workspaceEntries = enabled.filter(entry => !entry.module.startsWith('builtin:'));
  if (workspaceEntries.length) {
    try { directory = await realpath(directory); }
    catch { return fail(ctx, 'plugin_directory_missing', workspaceEntries[0]!.id); }
  }
  const rows: EntryOptions[] = [];
  for (const entry of settings.entries) {
    if (disabled(entry, settings, chatEnabled)) {
      rows.push({ id: entry.id, name: entry.module, disabled: true, config: entry.config ?? {} });
      continue;
    }
    const name = await moduleName(ctx, directory, entry);
    let exports: unknown;
    try { exports = await ctx.loader.import(name); }
    catch { return fail(ctx, 'plugin_import_failed', entry.id); }
    const module = object(exports);
    if (module?.xiaolangApiVersion !== undefined && module.xiaolangApiVersion !== 1) return fail(ctx, 'plugin_api_incompatible', entry.id);
    const plugin: unknown = ctx.loader.unwrapExports(exports);
    if (typeof plugin !== 'function' && typeof object(plugin)?.apply !== 'function') return fail(ctx, 'plugin_invalid_export', entry.id);
    rows.push({ id: entry.id, name, disabled: false, config: entry.config ?? {} });
  }
  try {
    await ctx.loader.root.update(rows);
    await ctx.loader.await();
  } catch { fail(ctx, 'plugin_activation_failed', 'loader'); }
}

export async function checkPlugins(ctx: Context, settings: PluginConfig, chatEnabled: boolean): Promise<PluginStatus[]> {
  await ctx.loader.await();
  return settings.entries.map(entry => {
    if (disabled(entry, settings, chatEnabled)) return { id: entry.id, state: 'disabled' };
    const fiber = ctx.loader.store[entry.id]?.fiber;
    if (fiber?.state === FiberState.PENDING) {
      const missing = Object.keys(fiber.inject).filter(name => fiber.parent.get(name) === undefined);
      return fail(ctx, 'plugin_dependency_missing', entry.id, missing);
    }
    if (fiber?.state !== FiberState.ACTIVE) return fail(ctx, 'plugin_activation_failed', entry.id);
    return { id: entry.id, state: 'active' };
  });
}
