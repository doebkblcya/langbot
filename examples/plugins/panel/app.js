'use strict';
const $ = id => document.getElementById(id);
const words = { connected: '已连接', disconnected: '已断开', starting: '启动中', ready: '已就绪', stopping: '停止中', failed: '失败', error: '连接异常',
  completed: '已完成', queued: '等待处理', running: '处理中', sending: '发送中', unknown: '结果未知', expired: '已过期', cancelled: '已取消',
  active: '已启用', disabled: '已停用', pending: '等待激活', sent: '已确认发送', succeeded: '已成功', private: '私聊', mention: '@机器人', keyword: '触发词' };
const stages = { application_ready: '小狼已就绪', application_stopping: '小狼正在停止', application_failed: '启动失败', qq_connected: 'QQ 已连接', qq_disconnected: 'QQ 已断开',
  qq_connection_error: 'QQ 连接异常', qq_connection_failed: 'QQ 连接失败', adapter_group_messages_limited: '非 @ 群消息推送权限待验证', panel_listening: '面板已启动',
  message_received: '收到消息', message_ignored: '忽略消息', trigger_matched: '触发回复', turn_queued: '等待调度', turn_started: '开始处理',
  model_started: '调用模型', model_completed: '模型返回', model_failed: '模型调用失败', reply_generated: '生成回复',
  tool_started: '调用工具', tool_completed: '工具完成', tool_failed: '工具失败', tool_unknown: '工具结果未知',
  send_started: '发送回复', send_confirmed: 'QQ 已确认发送', send_failed: '发送失败', send_unknown: '发送结果未知', turn_completed: '本轮完成' };
const reasons = { private: '私聊默认回复', mention: '@机器人', keyword: '命中触发词', no_trigger: '未触发回复', duplicate: '重复消息', own_message: '机器人自身消息', group_not_allowed: '群不在白名单', chat_disabled: '聊天已停用', invalid_message: '格式无效', account_mismatch: '账号不匹配' };
const descriptions = { overview: ['运行概览', '看看小狼现在怎么样。'], chats: ['最近聊天', '收到的消息、生成的回复，以及每一轮的处理结果。'], logs: ['过程日志', '从收到消息到发送回复，跟着每一步看。'], plugins: ['插件列表', '查看当前的小狼由哪些插件组成。'] };
const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
let logs = [], cursor = 0, before, next = null, busy = false, turnRequest = 0, selected, runStarted;
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function time(value, full = false) { const date = new Date(value); return Number.isFinite(date.getTime()) ? (full ? dateFormat : timeFormat).format(date) : '—'; }
function tone(state) { return ['completed', 'connected', 'active', 'sent', 'succeeded', 'ready'].includes(state) ? 'good' : ['failed', 'error', 'unknown'].includes(state) ? 'bad' : ['queued', 'running', 'sending', 'pending', 'starting'].includes(state) ? 'waiting' : 'neutral'; }
function badge(state) { return element('span', `badge ${tone(state)}`, words[state] ?? state); }
function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
async function get(path) { const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(7000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
function showView(view) {
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  for (const button of document.querySelectorAll('.nav')) { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
  [$('page-title').textContent, $('page-description').textContent] = descriptions[view];
  if (view === 'chats') refreshTurns();
  if (view === 'logs') renderLogs();
}
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => showView(button.dataset.view));
function renderStatus(status) {
  $('qq-state').textContent = words[status.connection] ?? status.connection;
  $('platform').textContent = status.platform?.includes('sandbox') ? 'QQ 官方机器人 · 沙箱' : status.platform ?? '正在启动接入';
  $('model').textContent = status.model;
  $('chat-state').textContent = status.chatEnabled ? '聊天链路已启用' : '聊天链路已停用';
  $('pending').textContent = `${(status.counts.running ?? 0) + (status.counts.sending ?? 0)} / ${status.counts.queued ?? 0}`;
  $('completed').textContent = `已完成 ${status.counts.completed ?? 0} 轮`;
  const seconds = Math.floor(status.uptimeMs / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  $('uptime').textContent = hours ? `${hours} 小时 ${minutes % 60} 分` : minutes ? `${minutes} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
  $('memory').textContent = `进程内存 ${(status.memoryBytes / 1048576).toFixed(1)} MB`;
  $('app-state').textContent = words[status.state] ?? status.state;
  $('failures').textContent = ['failed', 'unknown', 'cancelled', 'expired'].reduce((total, key) => total + (status.counts[key] ?? 0), 0);
  $('last-message').textContent = status.lastMessage ? time(status.lastMessage, true) : '本次启动尚无消息';
  const active = status.plugins.filter(plugin => plugin.state === 'active').length;
  $('plugin-count').textContent = `${active} / ${status.plugins.length}`;
  $('plugins-summary').textContent = `${active} 个已启用`;
  $('plugin-empty').hidden = status.plugins.length > 0;
  $('plugin-rows').replaceChildren(...status.plugins.map(plugin => {
    const row = element('tr'); row.append(element('td', '', plugin.id), element('td', 'module', plugin.module));
    const cell = element('td'); cell.append(badge(plugin.state)); row.append(cell); return row;
  }));
}
function logMeta(entry) {
  const values = [];
  if (entry.reason) values.push(reasons[entry.reason] ?? entry.reason);
  if (entry.model) values.push(entry.model);
  if (entry.step) values.push(`步骤 ${entry.step}`);
  if (entry.tool) values.push(`工具 ${entry.tool}`);
  if (entry.waitMs !== undefined) values.push(`排队 ${entry.waitMs} ms`);
  if (entry.durationMs !== undefined) values.push(`耗时 ${entry.durationMs} ms`);
  if (entry.part) values.push(`第 ${entry.part}/${entry.parts} 段`);
  if (entry.errorCode) values.push(entry.errorCode);
  if (entry.turn) values.push(`turn=${entry.turn}`);
  return values.join(' · ');
}
function renderLogs() {
  const filter = $('log-filter').value.trim().toLowerCase();
  const matched = logs.filter(({ entry }) => !filter || [stages[entry.code], JSON.stringify(entry)].join(' ').toLowerCase().includes(filter));
  $('log-count').textContent = matched.length;
  $('log-list').replaceChildren(...matched.map(({ entry }) => {
    const row = element('div', `log-line ${entry.level ?? 'info'}`), body = element('div');
    row.append(element('time', '', time(entry.time))); body.append(element('strong', '', stages[entry.code] ?? entry.code));
    if (entry.preview !== undefined) body.append(element('p', 'log-preview', entry.preview));
    body.append(element('div', 'log-meta', logMeta(entry))); row.append(body); return row;
  }));
  if (!matched.length) $('log-list').append(element('p', 'empty', '暂无匹配日志（仅显示本次启动的最近 500 条）'));
  if ($('follow').checked) $('log-list').scrollTop = $('log-list').scrollHeight;
  $('recent-events').replaceChildren(...logs.slice(-6).reverse().map(({ entry }) => {
    const row = element('div', 'activity'), body = element('div');
    body.append(element('div', '', stages[entry.code] ?? entry.code), element('p', '', entry.preview ?? logMeta(entry) ?? ''));
    row.append(element('span', 'dot'), body, element('time', '', time(entry.time))); return row;
  }));
  if (!logs.length) $('recent-events').append(element('p', 'empty', '等待小狼的第一条动态'));
}
async function refreshTurns() {
  const version = ++turnRequest;
  const params = new URLSearchParams({ limit: '25', failures: $('failures-only').checked ? '1' : '0' });
  if (before) params.set('before', before);
  try {
    const result = await get(`/api/turns?${params}`);
    if (version !== turnRequest) return;
    next = result.next; $('older').disabled = next === null; $('chat-empty').hidden = result.items.length > 0;
    $('page-note').textContent = before ? '更早的 25 轮' : '最近 25 轮';
    $('turns').replaceChildren(...result.items.map(turn => {
      const row = element('tr', 'turn-row'); row.tabIndex = 0; row.setAttribute('aria-label', `查看对话：${turn.input.slice(0, 30)}`);
      const source = element('td', '', time(turn.received, true)); source.append(element('span', 'source', `${words[turn.scope] ?? '群聊'} · ${turn.sender}`));
      const input = element('td'), reply = element('td'), state = element('td');
      input.append(element('div', 'snippet', turn.input || '（非文字消息）'));
      reply.append(element('div', 'snippet', turn.reply || '—')); state.append(badge(turn.state));
      row.append(source, input, reply, state); row.addEventListener('click', () => openDetail(turn.id));
      row.addEventListener('keydown', event => { if (event.key === 'Enter') openDetail(turn.id); }); return row;
    }));
  } catch { notice('暂时无法读取聊天记录。请检查 SSH 隧道连接。'); }
}
function detailSection(title, text, className = '') {
  const section = element('section', 'detail-section'); section.append(element('h3', '', title), element('div', `bubble ${className}`, text)); return section;
}
async function openDetail(id) {
  selected = id; $('detail-body').replaceChildren(element('p', 'empty', '正在读取…'));
  if (!$('detail').open) $('detail').showModal();
  try {
    const detail = await get(`/api/turns/${encodeURIComponent(id)}`);
    if (selected !== id) return;
    const body = $('detail-body'), meta = element('div', 'detail-meta');
    meta.append(badge(detail.state), element('span', '', time(detail.received, true)), element('span', '', reasons[detail.reason] ?? detail.reason));
    body.replaceChildren(meta, element('p', 'mono', `轮次 ${detail.id}`));
    if (detail.errorCode) body.append(element('p', 'error-box', `失败原因：${detail.errorCode}。发送结果未知时不会自动重发，请核对 QQ。`));
    body.append(detailSection(`收到消息${detail.inputTruncated ? '（已截断）' : ''}`, detail.input || '（非文字消息）'));
    body.append(detailSection(`已确认回复${detail.replyTruncated ? '（已截断）' : ''}`, detail.reply || '尚无已确认发送的回复', 'reply'));
    if (detail.sends.length) {
      const section = element('section', 'detail-section'); section.append(element('h3', '', '逐段发送结果'));
      for (const send of detail.sends) { const row = element('div', 'send-line'); row.append(element('span', 'muted', `第 ${send.part} 段 `), badge(send.state), element('p', '', send.text)); if (send.receipt) row.append(element('div', 'mono', `回执 ${send.receipt}`)); section.append(row); }
      body.append(section);
    }
    if (detail.tools.length) body.append(detailSection('工具调用', detail.tools.map(tool => `${tool.name} · ${words[tool.state] ?? tool.state}`).join('\n')));
    const button = element('button', 'secondary detail-log-button', '查看这一轮的过程日志');
    button.addEventListener('click', () => { $('detail').close(); selected = undefined; $('log-filter').value = detail.id; showView('logs'); }); body.append(button);
  } catch { $('detail-body').replaceChildren(element('p', 'error-box', '暂时无法读取详情，请关闭后重试。')); }
}
$('close-detail').addEventListener('click', () => { selected = undefined; $('detail').close(); });
$('detail').addEventListener('close', () => { selected = undefined; });
$('log-filter').addEventListener('input', renderLogs);
$('clear-filter').addEventListener('click', () => { $('log-filter').value = ''; renderLogs(); });
$('follow').addEventListener('change', renderLogs);
$('failures-only').addEventListener('change', () => { before = undefined; refreshTurns(); });
$('latest').addEventListener('click', () => { before = undefined; refreshTurns(); });
$('older').addEventListener('click', () => { if (next !== null) { before = next; refreshTurns(); } });
async function poll() {
  if (busy) return; busy = true;
  try {
    const [status, initialPage] = await Promise.all([get('/api/status'), get(`/api/logs?after=${cursor}`)]);
    let page = initialPage;
    if (runStarted !== undefined && runStarted !== status.started) { logs = []; page = await get('/api/logs?after=0'); }
    runStarted = status.started;
    renderStatus(status);
    if (page.reset) logs = [];
    if (page.items.length || page.reset) { logs = [...logs, ...page.items].slice(-500); renderLogs(); }
    cursor = page.cursor;
    $('connection').textContent = '面板在线'; $('connection').className = 'badge good'; $('synced').textContent = time(Date.now()); notice('');
    if (!before && !$('chats').hidden) await refreshTurns();
  } catch { $('connection').textContent = '面板连接中断'; $('connection').className = 'badge bad'; notice('无法连接面板，当前保留上次显示的数据。请检查 SSH 隧道，连接恢复后会自动更新。'); }
  finally { busy = false; }
}
poll();
const timer = setInterval(poll, 2000);
window.addEventListener('pagehide', () => clearInterval(timer));
