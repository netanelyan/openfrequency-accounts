import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ofHome } from './paths.js';

// Keys live in $OF_HOME/.env and nowhere else. A tiny parser rather than a
// dependency: KEY=value lines, # comments, optional quotes. Values already in the
// environment win, so pm2 or a test can override the file.

export function parseEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

let loaded = false;

/** Load $OF_HOME/.env into process.env once. Returns the file's path, or null. */
export function loadEnv(env = process.env) {
  if (loaded) return null;
  loaded = true;
  const file = path.join(ofHome(env), '.env');
  if (!existsSync(file)) return null;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (env[k] === undefined) env[k] = v;
  }
  return file;
}

/** Every secret the service reads: check:public refuses any of them assigned a value. */
export const SECRET_KEYS = ['OF_INTERNAL_TOKEN', 'SESSION_SECRET', 'RESEND_API_KEY', 'OF_ADMIN_PASSWORD', 'GOOGLE_CLIENT_SECRET'];
