import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Fields, Gateway } from './contracts.js';
import { id, object } from './contracts.js';
import { check, Failure } from './errors.js';

interface Pending {
  resolve: (data: Fields) => void;
  reject: (error: Failure) => void;
  cleanup: () => void;
  sideEffect: boolean;
}
export type SocketFactory = (url: string, options: WebSocket.ClientOptions) => WebSocket;

export class OneBotConnection implements Gateway {
  private socket?: WebSocket;
  private pending = new Map<string, Pending>();
  private reconnect?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private stopped = true;
  private verified = false;
  private accountOnline = false;
  private failures = 0;
  private pong = true;
  private beforeReady: Fields[] = [];
  constructor(
    private config: Config['onebot'], private account: string, private token: string,
    private receive: (event: unknown) => void, private report: (code: string) => void,
    private factory: SocketFactory = (url, options) => new WebSocket(url, options),
  ) {}
  get ready(): boolean { return !this.stopped && this.verified && this.accountOnline && this.socket?.readyState === WebSocket.OPEN; }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }
  private connect(): void {
    if (this.stopped) return;
    const socket = this.factory(this.config.endpoint, { headers: { Authorization: `Bearer ${this.token}` },
      perMessageDeflate: false, maxPayload: 2 * 1024 * 1024, handshakeTimeout: this.config.timeoutMs });
    this.socket = socket;
    socket.on('error', () => { this.report('onebot_connection_error'); socket.terminate(); });
    socket.on('unexpected-response', (_request, response) => {
      response.resume();
      this.report('onebot_handshake_failed');
      socket.terminate();
    });
    socket.on('open', () => {
      if (this.stopped || this.socket !== socket) { socket.terminate(); return; }
      this.pong = true;
      this.heartbeat = setInterval(() => {
        if (!this.pong) { socket.terminate(); return; }
        this.pong = false;
        socket.ping();
      }, 20_000);
      const signal = AbortSignal.timeout(this.config.timeoutMs);
      void this.request('get_login_info', {}, signal).then(info => {
        if (this.socket !== socket || this.stopped) return;
        if (id(info.user_id) !== this.account) {
          this.report('onebot_account_mismatch');
          this.close();
          return;
        }
        this.verified = true;
        this.accountOnline = true;
        this.failures = 0;
        this.report('onebot_connected');
        for (const event of this.beforeReady.splice(0)) this.handleEvent(event);
      }).catch(() => { if (this.socket === socket) socket.terminate(); });
    });
    socket.on('pong', () => { if (this.socket === socket) this.pong = true; });
    socket.on('message', raw => {
      if (this.socket !== socket || this.stopped) return;
      let payload: Fields | undefined;
      try { payload = object(JSON.parse(raw.toString())); }
      catch { this.report('onebot_invalid_json'); return; }
      if (!payload) return;
      if (typeof payload.echo === 'string') {
        const pending = this.pending.get(payload.echo);
        if (!pending) return;
        this.pending.delete(payload.echo);
        pending.cleanup();
        if (payload.status === 'ok' && payload.retcode === 0) pending.resolve(object(payload.data) ?? {});
        else pending.reject(new Failure('onebot_api_rejected', pending.sideEffect && (payload.status === 'async' || payload.retcode === 1)));
        return;
      }
      if (!this.verified) {
        if (this.beforeReady.length < 100) this.beforeReady.push(payload);
        else this.report('onebot_startup_event_capacity');
        return;
      }
      this.handleEvent(payload);
    });
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.verified = false;
      this.accountOnline = false;
      this.beforeReady = [];
      clearInterval(this.heartbeat);
      this.rejectPending('onebot_disconnected');
      if (!this.stopped) {
        this.report('onebot_disconnected');
        const wait = Math.min(this.config.reconnectMs * 2 ** Math.min(this.failures++, 5), 30_000);
        this.reconnect = setTimeout(() => this.connect(), wait);
      }
    });
  }
  private handleEvent(payload: Fields): void {
    if (payload.self_id !== undefined && id(payload.self_id) !== this.account) return;
    if (payload.post_type === 'meta_event' && payload.meta_event_type === 'heartbeat') {
      const status = object(payload.status);
      if (typeof status?.online === 'boolean') this.accountOnline = status.online;
    }
    if (payload.notice_type === 'bot_offline') this.accountOnline = false;
    try { this.receive(payload); }
    catch { this.report('onebot_event_failed'); }
  }
  request(action: string, params: Fields, signal: AbortSignal): Promise<Fields> {
    check(signal);
    const socket = this.socket;
    const sideEffect = !action.startsWith('get_');
    if (!socket || socket.readyState !== WebSocket.OPEN || (!this.ready && action !== 'get_login_info')) return Promise.reject(new Failure('onebot_not_ready'));
    if (this.pending.size >= 256) return Promise.reject(new Failure('onebot_request_capacity'));
    const echo = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const pending = this.pending.get(echo);
        if (!pending) return;
        this.pending.delete(echo);
        pending.cleanup();
        reject(new Failure(signal.aborted ? 'cancelled' : 'onebot_timeout', sideEffect));
      };
      const timeout = setTimeout(cancel, this.config.timeoutMs);
      const cleanup = () => { clearTimeout(timeout); signal.removeEventListener('abort', cancel); };
      this.pending.set(echo, { resolve, reject, cleanup, sideEffect });
      signal.addEventListener('abort', cancel, { once: true });
      try {
        socket.send(JSON.stringify({ action, params, echo }), error => {
          if (!error) return;
          const pending = this.pending.get(echo);
          if (!pending) return;
          this.pending.delete(echo);
          cleanup();
          reject(new Failure('onebot_write_failed', sideEffect));
        });
      } catch {
        this.pending.delete(echo);
        cleanup();
        reject(new Failure('onebot_write_failed', sideEffect));
      }
    });
  }
  private rejectPending(reason: string): void {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(new Failure(reason, pending.sideEffect));
    }
    this.pending.clear();
  }
  close(): void {
    this.stopped = true;
    this.verified = false;
    this.beforeReady = [];
    clearTimeout(this.reconnect);
    clearInterval(this.heartbeat);
    this.rejectPending('onebot_closed');
    this.socket?.terminate();
    this.socket = undefined;
  }
}
