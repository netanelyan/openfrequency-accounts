import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Where everything lives.
//
// The repository is public and holds only code. The database (every customer's
// email and business), the keys and the backups live in OF_HOME, which defaults
// to ./private/ inside the repo and is gitignored entirely. Every path below is
// derived from ofHome(), so nothing real is ever written anywhere else.

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The private folder. Relative values are resolved against the repo root, not the cwd. */
export function ofHome(env = process.env) {
  const raw = String(env.OF_HOME || '').trim();
  return raw ? path.resolve(ROOT, raw) : path.join(ROOT, 'private');
}

export const dataDir = (env) => path.join(ofHome(env), 'data');
export const dbPath = (env) => path.join(dataDir(env), 'accounts.db');
export const outboxDir = (env) => path.join(dataDir(env), 'outbox');
export const backupsDir = (env) => path.join(dataDir(env), 'backups');

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A clear stop when the private folder has not been created yet. */
export function requireHome(env = process.env) {
  const home = ofHome(env);
  if (!existsSync(home)) {
    const err = new Error(`No private folder at ${home}.\n  Run \`npm run init-private\` to create it (or set OF_HOME).`);
    err.code = 'no_home';
    throw err;
  }
  return home;
}
