import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message, ModelMessage, SendRecord, Store, ToolCall, Turn, TurnState } from './contracts.js';
import { render } from './messages.js';
import { Failure } from './errors.js';

export class SqliteStore implements Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get()!;
    if (Number(version.user_version) > 1) { this.db.close(); throw new Failure('unsupported_database_version'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
        session TEXT NOT NULL, direction TEXT NOT NULL, source_seq INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_session ON messages(session, seq);
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, message_key TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
        reason TEXT NOT NULL, code TEXT, draft TEXT, protocol TEXT, updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sends (
        turn_id TEXT NOT NULL REFERENCES turns(id), part INTEGER NOT NULL,
        text TEXT NOT NULL, state TEXT NOT NULL, platform_id TEXT,
        PRIMARY KEY(turn_id, part)
      );
      CREATE TABLE IF NOT EXISTS tools (
        turn_id TEXT NOT NULL REFERENCES turns(id), call_id TEXT NOT NULL,
        name TEXT NOT NULL, arguments TEXT NOT NULL, state TEXT NOT NULL, result TEXT,
        PRIMARY KEY(turn_id, call_id)
      );
      PRAGMA user_version=1;
      UPDATE sends SET state='unknown' WHERE state='sending';
      UPDATE tools SET state='unknown' WHERE state='running';
      UPDATE turns SET state=CASE WHEN state='sending' OR EXISTS
        (SELECT 1 FROM tools WHERE tools.turn_id=turns.id AND tools.state='unknown') THEN 'unknown' ELSE 'cancelled' END,
        code='process_interrupted' WHERE state IN ('queued','running','sending');
    `);
  }
  close(): void { this.db.close(); }
  admit(message: Message): Message | undefined {
    const result = this.db.prepare('INSERT OR IGNORE INTO messages(key,session,direction,source_seq,payload) VALUES (?,?,\'in\',0,?)')
      .run(message.key, message.session, JSON.stringify(message));
    return Number(result.changes) ? { ...message, seq: Number(result.lastInsertRowid) } : undefined;
  }
  history(message: Message, limit: number): ModelMessage[] {
    const rows = this.db.prepare(`SELECT direction,payload FROM messages
      WHERE session=? AND key!=? AND ((direction='in' AND seq<?) OR (direction='out' AND source_seq<?))
      ORDER BY seq DESC LIMIT ?`).all(message.session, message.key, message.seq, message.seq, limit);
    return rows.reverse().flatMap(row => {
      if (row.direction === 'in') return [{ role: 'user' as const, content: render(JSON.parse(String(row.payload)) as Message) }];
      const data = JSON.parse(String(row.payload)) as { protocol: ModelMessage[] };
      return data.protocol;
    });
  }
  createTurn(message: Message, reason: string): Turn {
    const id = randomUUID();
    this.db.prepare('INSERT INTO turns(id,message_key,state,reason,updated) VALUES (?,?,\'queued\',?,?)')
      .run(id, message.key, reason, Date.now());
    return { id, message, reason };
  }
  state(id: string, state: TurnState, code?: string): void {
    this.db.prepare('UPDATE turns SET state=?,code=?,updated=? WHERE id=?').run(state, code ?? null, Date.now(), id);
  }
  draft(id: string, text: string, protocol: ModelMessage[]): void {
    this.db.prepare('UPDATE turns SET draft=?,protocol=?,updated=? WHERE id=?').run(text, JSON.stringify(protocol), Date.now(), id);
  }
  prepareSend(id: string, parts: string[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const statement = this.db.prepare('INSERT INTO sends(turn_id,part,text,state) VALUES (?,?,?,\'pending\')');
      parts.forEach((text, part) => statement.run(id, part, text));
      this.state(id, 'sending');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  sendState(id: string, part: number, state: SendRecord['state'], platformId?: string): void {
    this.db.prepare('UPDATE sends SET state=?,platform_id=? WHERE turn_id=? AND part=?').run(state, platformId ?? null, id, part);
  }
  delivered(turn: Turn, text: string, protocol: ModelMessage[], platformIds: string[]): void {
    this.db.prepare('INSERT INTO messages(key,session,direction,source_seq,payload) VALUES (?,?,\'out\',?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload')
      .run(`reply:${turn.id}`, turn.message.session, turn.message.seq, JSON.stringify({ text, protocol, platformIds }));
  }
  confirmSend(turn: Turn, part: number, platformId: string, text: string, protocol: ModelMessage[], platformIds: string[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.sendState(turn.id, part, 'sent', platformId);
      this.delivered(turn, text, protocol, platformIds);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  toolStart(turn: string, call: ToolCall): void {
    this.db.prepare('INSERT INTO tools(turn_id,call_id,name,arguments,state) VALUES (?,?,?,?,\'running\')')
      .run(turn, call.id, call.function.name, call.function.arguments);
  }
  toolEnd(turn: string, call: string, state: string, result: string): void {
    this.db.prepare('UPDATE tools SET state=?,result=? WHERE turn_id=? AND call_id=?').run(state, result, turn, call);
  }
  inspectTurn(id: string) { return this.db.prepare('SELECT * FROM turns WHERE id=?').get(id); }
  inspectSends(id: string) { return this.db.prepare('SELECT * FROM sends WHERE turn_id=? ORDER BY part').all(id); }
  inspectTools(id: string) { return this.db.prepare('SELECT * FROM tools WHERE turn_id=?').all(id); }
}
