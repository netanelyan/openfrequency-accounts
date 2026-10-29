import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// A backup of the database, and the check that it can be used (PRA-DB-003). scripts/backup.js runs it nightly
// (openfrequency-accounts-backup.service) and deploy/deploy.sh before each deploy.
//
//   1. VACUUM INTO: a consistent copy while the service runs (it reads a snapshot).
//   2. The copy is opened read-only and checked: PRAGMA integrity_check says "ok", its user_version is the live
//      database's, and it has the main tables (the workspaces are counted, and the count printed). An empty or
//      broken copy is found the night it is made, not the day it is needed.
//   3. A copy that fails is renamed <name>.bad, kept for a look, and never counted among the copies kept.
//   4. Rotation: the plain nightly copies (accounts-<iso>.db), the newest `keep`; the ones taken before a deploy
//      (accounts-pre-<commit>-<iso>.db), the newest 5.

const PLAIN = /^accounts-\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/;
const TAGGED = /^accounts-pre-[\w.-]+-\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/;
export const KEEP_TAGGED = 5;

/** A copy's problems, checked against the live database's user_version: [] when it can be restored. */
export function checkCopy(file, wantVersion = null) {
  const problems = [];
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => Object.values(r)[0]);
    if (integrity.join() !== 'ok') problems.push(`integrity_check: ${integrity.slice(0, 3).join('; ')}`);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (wantVersion != null && version !== wantVersion) problems.push(`user_version ${version}, the live database's is ${wantVersion}`);
    const counts = Object.fromEntries(['workspaces', 'users', 'subscriptions'].map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
    return { problems, counts, version };
  } catch (e) {
    problems.push(String(e?.message || e));
    return { problems, counts: null, version: null };
  } finally {
    try {
      db?.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Copy `source` into `dir` and check the copy. Returns { file, counts, kept } or throws an Error saying what failed
 * (the bad copy renamed .bad). `tag` names a copy taken before a deploy: accounts-<tag>-<iso>.db.
 */
export function backup(source, dir, { keep = 14, tag = null, at = new Date() } = {}) {
  if (!existsSync(source)) throw new Error(`no database at ${source}`);
  if (tag != null && !/^pre-[\w.-]{1,64}$/.test(tag)) throw new Error(`a tag is pre-<commit>, not ${tag}`);
  const stamp = at.toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `accounts-${tag ? `${tag}-` : ''}${stamp}.db`);
  const live = new DatabaseSync(source, { readOnly: true });
  let version;
  try {
    version = live.prepare('PRAGMA user_version').get().user_version;
    live.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  } finally {
    live.close();
  }
  const { problems, counts } = checkCopy(file, version);
  if (problems.length) {
    renameSync(file, `${file}.bad`);
    throw new Error(`the copy ${path.basename(file)} is not usable (${problems.join('; ')}); kept as ${path.basename(file)}.bad`);
  }
  const names = readdirSync(dir);
  const drop = (re, n) => {
    const all = names.filter((f) => re.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - n))) rmSync(path.join(dir, f));
    return Math.min(all.length, n);
  };
  const kept = drop(PLAIN, keep);
  drop(TAGGED, KEEP_TAGGED);
  return { file, counts, kept };
}

/**
 * Tell a person (PRA-OPS-007): /usr/local/bin/of-alert "<title>" "<body>", the server's alert script, or OF_ALERT to
 * name another (a .js file is run with this Node, for the tests). Never throws; says so when there is none.
 */
export function alert(title, body, env = process.env) {
  const bin = String(env.OF_ALERT || '/usr/local/bin/of-alert');
  if (!existsSync(bin)) {
    console.error(`(no ${bin}: nobody was alerted)`);
    return false;
  }
  const [cmd, args] = bin.endsWith('.js') ? [process.execPath, [bin, title, body]] : [bin, [title, body]];
  const r = spawnSync(cmd, args, { stdio: 'inherit', timeout: 30_000 });
  return r.status === 0;
}
