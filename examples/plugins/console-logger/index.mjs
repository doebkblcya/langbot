// External Cordis plugin: edit this mounted file and restart; no image rebuild.
export const name = 'xiaolang-console-logger';
export const xiaolangApiVersion = 1;

const labels = {
  application_ready: '小狼已就绪', application_stopping: '小狼正在停止', application_failed: '启动失败',
  qq_connected: 'QQ 已连接', qq_disconnected: 'QQ 已断开', qq_connection_error: 'QQ 连接错误',
  qq_connection_failed: 'QQ 连接失败', qq_event_failed: 'QQ 消息解析失败',
  adapter_group_messages_limited: '当前声明仅接收群 @ 消息，非 @ 推送权限尚待验证',
  message_received: '收到消息', message_ignored: '忽略消息', trigger_matched: '触发回复',
  turn_queued: '等待调度', turn_started: '开始处理', model_started: '调用模型',
  model_completed: '模型返回', model_failed: '模型调用失败', reply_generated: '生成回复',
  tool_started: '调用工具', tool_completed: '工具完成', tool_failed: '工具失败', tool_unknown: '工具结果未知',
  send_started: '发送回复', send_confirmed: 'QQ 已确认发送', send_failed: '发送失败', send_unknown: '发送结果未知',
  turn_completed: '本轮完成', turn_failed: '本轮失败',
  panel_listening: '面板已启动', panel_server_error: '面板服务异常',
};
const reasons = {
  private: '私聊默认回复', mention: '@机器人', keyword: '命中触发词', no_trigger: '未 @ 且未命中触发词',
  duplicate: '重复消息', own_message: '机器人自身消息', group_not_allowed: '群不在白名单',
  account_mismatch: '账号不匹配', invalid_message: '消息格式无效', chat_disabled: '聊天链路已停用',
};
export function formatText(entry) {
  const text = [`${entry.time} ${entry.level?.toUpperCase()} ${labels[entry.code] ?? entry.code}`, `event=${entry.code}`];
  if (entry.scope) text.push(entry.scope === 'private' ? '私聊' : '群聊');
  if (entry.sender) text.push(`用户=${JSON.stringify(entry.sender)}`);
  if (entry.group) text.push(`群=${JSON.stringify(entry.group)}`);
  if (entry.reason) text.push(`原因=${reasons[entry.reason] ?? entry.reason}`);
  if (entry.preview !== undefined) text.push(`内容=${JSON.stringify(entry.preview)}`);
  if (entry.turn) text.push(`turn=${entry.turn}`);
  if (entry.messageId) text.push(`message=${entry.messageId}`);
  if (entry.model) text.push(`模型=${entry.model}`);
  if (entry.step !== undefined) text.push(`模型步骤=${entry.step}`);
  if (entry.tool) text.push(`工具=${JSON.stringify(entry.tool)}`);
  if (entry.toolCalls !== undefined) text.push(`工具调用数=${entry.toolCalls}`);
  if (entry.part !== undefined) text.push(`分段=${entry.part}/${entry.parts}`);
  if (entry.waitMs !== undefined) text.push(`排队=${entry.waitMs}ms`);
  if (entry.durationMs !== undefined) text.push(`耗时=${entry.durationMs}ms`);
  if (entry.state) text.push(`状态=${entry.state}`);
  if (entry.errorCode) text.push(`错误=${entry.errorCode}`);
  if (entry.receipt) text.push(`回执=${JSON.stringify(entry.receipt)}`);
  if (entry.plugin) text.push(`插件=${entry.plugin}`);
  if (entry.dependencies?.length) text.push(`缺少依赖=${entry.dependencies.join(',')}`);
  return text.join(' | ');
}

export function apply(ctx, config = {}) {
  const format = config.format ?? 'text';
  if (!['text', 'json'].includes(format)) throw new Error('invalid_log_format');
  ctx.provide('logOutput', {
    write(entry) { console.info(format === 'json' ? JSON.stringify(entry) : formatText(entry)); },
  });
}
