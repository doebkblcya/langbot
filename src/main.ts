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
  if (!process.env.DEEPSEEK_API_KEY || !process.env.ONEBOT_TOKEN) throw new Failure('missing_runtime_credentials');
  const app = await createApp(config, {
    apiKey: process.env.DEEPSEEK_API_KEY, onebotToken: process.env.ONEBOT_TOKEN,
    report: entry => console.info(JSON.stringify({ time: new Date().toISOString(), ...entry })),
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void app.stop().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.info(JSON.stringify({ code: 'application_ready' }));
}
void main().catch(error => {
  console.error(JSON.stringify({ code: code(error) }));
  process.exitCode = 1;
});
