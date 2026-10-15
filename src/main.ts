import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { code, Failure } from './errors.js';

async function main(): Promise<void> {
  const config = await loadConfig(process.env.XIAOLANG_CONFIG ?? 'config.local.json');
  if (process.argv.includes('--check-config')) {
    console.info('配置格式检查通过。');
    return;
  }
  if (process.platform !== 'linux') throw new Failure('runtime_requires_linux');
  if (!process.env.DEEPSEEK_API_KEY) throw new Failure('missing_model_key');
  const controller = new AbortController();
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    if (app) void app.stop().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    app = await createApp(config, {
      apiKey: process.env.DEEPSEEK_API_KEY, signal: controller.signal,
      writeLog: line => console.info(line),
      secrets: Object.entries(process.env).filter(([key, value]) => value && /KEY|SECRET|TOKEN|PASSWORD/i.test(key)).map(([, value]) => value!),
    });
  } catch (error) {
    if (controller.signal.aborted) { process.exitCode = 0; return; }
    throw error;
  }
}
void main().catch(error => {
  console.error(JSON.stringify({ code: code(error) }));
  process.exitCode = 1;
});
