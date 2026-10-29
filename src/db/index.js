import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { dbPath, ensureDir } from '../core/paths.js';
import { MIGRATIONS } from './schema.js';

/** A migration's fingerprint: SHA-256 of its text. */
export const checksum = (sql) => createHash('sha256').update(sql).digest('hex');

/** The database cannot be used by this build: `code` 'ahead' (a newer build migrated it) or 'changed' (see migrate()). */
export class SchemaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SchemaError';
    this.code = code;
  }
}

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

  /**
   * Run the migrations this database has not had, after two checks that stop the process instead of starting it
   * wrong (PRA-OPS-005):
   *   - the database is ahead of this build (an older build started after a newer one migrated it): SchemaError
   *     'ahead'. Go forward again, or restore the backup taken before the newer build (deploy/rollback.sh).
   *   - a migration this database already ran is not the one at the same place in this build (edited, or moved by a
   *     merge): SchemaError 'changed'. Each migration's SHA-256 is kept by its place, in schema_checksums; one this
   *     database ran before the table existed is taken as it is now, the first time this check sees it.
   */
  migrate() {
    const have = this.raw.prepare('PRAGMA user_version').get().user_version;
    if (have > MIGRATIONS.length) throw new SchemaError('ahead', `the database is at migration ${have} and this build knows ${MIGRATIONS.length}: deploy the newer build, or restore the backup taken before it (deploy/rollback.sh)`);
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_checksums (position INTEGER PRIMARY KEY, sha256 TEXT NOT NULL, recorded_at TEXT NOT NULL)');
    const kept = new Map(this.raw.prepare('SELECT position, sha256 FROM schema_checksums').all().map((r) => [r.position, r.sha256]));
    const record = this.raw.prepare('INSERT OR IGNORE INTO schema_checksums (position, sha256, recorded_at) VALUES (?, ?, ?)');
    for (let v = 0; v < have; v++) {
      const sum = checksum(MIGRATIONS[v]);
      if (!kept.has(v + 1)) record.run(v + 1, sum, new Date().toISOString());
      else if (kept.get(v + 1) !== sum) throw new SchemaError('changed', `migration ${v + 1} is not the one this database ran: a shipped migration was edited or moved (src/db/schema.js is append-only)`);
    }
    for (let v = have; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
        record.run(v + 1, checksum(MIGRATIONS[v]), new Date().toISOString());
      });
    }
  }

  /** Where the schema stands: { have (migrations run), want (this build's), ok }. */
  schemaState() {
    const have = this.raw.prepare('PRAGMA user_version').get().user_version;
    return { have, want: MIGRATIONS.length, ok: have === MIGRATIONS.length };
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
