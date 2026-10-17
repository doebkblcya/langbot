import type { Fields } from './contracts.js';
import { object } from './contracts.js';
import { Failure } from './errors.js';

export interface ToolingConfig {
  access: { adminIds: string[] };
  web: { enabled: boolean; searchResults: number; pageChars: number };
  mcp: { enabled: boolean; servers: string };
  skills: { enabled: boolean; directory: string; runScripts: boolean };
}
export const toolingDefaults: ToolingConfig = {
  access: { adminIds: [] },
  web: { enabled: true, searchResults: 5, pageChars: 6000 },
  mcp: { enabled: true, servers: '{"mcpServers":{}}' },
  skills: { enabled: true, directory: 'data/skills', runScripts: false },
};
const fields = {
  access: { adminIds: { type: 'array', title: '管理员用户 ID', uniqueItems: true, maxItems: 50,
    items: { type: 'string', minLength: 1, maxLength: 512 }, description: '填写 QQ 官方消息里的用户 OpenID，每行一个。不是 QQ 号码；留空时无人能执行管理员工具。' } },
  web: { enabled: { type: 'boolean', title: '启用网页搜索与阅读' },
    searchResults: { type: 'integer', title: '默认搜索结果数', minimum: 1, maximum: 10 },
    pageChars: { type: 'integer', title: '每段网页正文字符数', minimum: 1000, maximum: 8000 } },
  mcp: { enabled: { type: 'boolean', title: '启用 MCP 接入' },
    servers: { type: 'string', title: 'MCP 连接配置 JSON', writeOnly: true, maxLength: 32000,
      description: '标准 mcpServers 对象，支持 url/headers 或 command/args/env。留空保留已有配置。远端工具默认仅管理员可用；明确开放的只读工具填在各服务 publicTools 数组中。' } },
  skills: { enabled: { type: 'boolean', title: '启用 Skills' }, directory: { type: 'string', title: 'Skills 目录', minLength: 1, maxLength: 1000,
    description: '容器内目录，默认 data/skills；每个子目录包含标准 SKILL.md，放入后应用配置或重启发现。' },
    runScripts: { type: 'boolean', title: '允许管理员运行 Skill 脚本', description: '只运行已安装 Skill 的 scripts/ 文件，支持容器已有的 Node.js、sh、Python 运行时；不会自动安装依赖。这是代码执行权限。' } },
};
export const toolingSchemas = Object.fromEntries(Object.entries(fields).map(([section, properties]) => [section,
  { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }])) as unknown as Record<keyof ToolingConfig, Fields>;
export const toolingSections: Record<string, keyof ToolingConfig> = {
  'xiaolang-tools': 'access', 'xiaolang-web': 'web', 'xiaolang-mcp': 'mcp', 'xiaolang-skills': 'skills',
};

export interface McpConnection { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; env?: Record<string, string>; publicTools?: string[] }
export function mcpConnections(text: string): Record<string, McpConnection> {
  let parsed;
  try { parsed = object(JSON.parse(text)); } catch { throw new Failure('invalid_mcp_config'); }
  const servers = object(parsed?.mcpServers);
  if (!servers || Object.keys(servers).length > 16) throw new Failure('invalid_mcp_config');
  for (const [name, raw] of Object.entries(servers)) {
    const c = object(raw);
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name) || !c || (!!c.url === !!c.command)
      || Object.keys(c).some(key => !['url', 'headers', 'command', 'args', 'env', 'publicTools'].includes(key))) throw new Failure('invalid_mcp_config');
    for (const key of ['headers', 'env']) if (c[key] !== undefined && (!object(c[key]) || Object.entries(c[key] as Fields).some(([k, v]) => !k || typeof v !== 'string' || /[\r\n\0]/.test(k + v)))) throw new Failure('invalid_mcp_config');
    for (const key of ['args', 'publicTools']) if (c[key] !== undefined && (!Array.isArray(c[key]) || (c[key] as unknown[]).length > 100 || (c[key] as unknown[]).some(v => typeof v !== 'string' || v.includes('\0')))) throw new Failure('invalid_mcp_config');
    if (c.url) {
      let url; try { url = new URL(String(c.url)); } catch { throw new Failure('invalid_mcp_config'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Failure('invalid_mcp_config');
    } else if (typeof c.command !== 'string' || !c.command.trim() || /[\r\n\0]/.test(c.command)) throw new Failure('invalid_mcp_config');
  }
  return servers as unknown as Record<string, McpConnection>;
}
