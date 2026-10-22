import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { dbPath, ensureDir } from '../core/paths.js';
import { MIGRATIONS } from './schema.js';

// One SQLite file holds all state: users, workspaces, sessions, tokens, the
// audit log. node:sqlite is built into Node (22.13+), so there is no native
// module to compile on the VPS and nothing to install. Ported from Teder's.

export class Db {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') ensureDir(path.dirname(file));
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  migrate() {
    const have = this.raw.prepare('PRAGMA user_version').get().user_version;
    for (let v = have; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  run(sql, ...params) {
    return this.raw.prepare(sql).run(...params.map(bind));
  }

  get(sql, ...params) {
    return this.raw.prepare(sql).get(...params.map(bind)) || null;
  }

  all(sql, ...params) {
    return this.raw.prepare(sql).all(...params.map(bind));
  }

  /** Run fn inside a transaction; nested calls join the outer one. */
  tx(fn) {
    if (this.inTx) return fn();
    this.inTx = true;
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    } finally {
      this.inTx = false;
    }
  }

  /** Insert an object as a row; JSON-encodes objects and arrays. Returns lastInsertRowid. */
  insert(table, row) {
    const keys = Object.keys(row);
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
    return Number(this.run(sql, ...keys.map((k) => row[k])).lastInsertRowid);
  }

  update(table, id, patch, key = 'id') {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    this.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${key} = ?`, ...keys.map((k) => patch[k]), id);
  }

  close() {
    this.raw.close();
  }
}

/** Values node:sqlite will not bind directly. */
function bind(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

/** Parse a JSON column, tolerating null and garbage. */
export function j(text, fallback = null) {
  if (text == null || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

let shared = null;

/** The process's database, at $OF_HOME/data/accounts.db unless a file is given. */
export function openDb(file = null) {
  if (file) return new Db(file);
  shared ??= new Db(dbPath());
  return shared;
}

export function closeDb() {
  shared?.close();
  shared = null;
}
