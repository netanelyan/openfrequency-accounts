import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../core/paths.js';

// Is this process ready to serve (GET /readyz)? /healthz says only that the process answers; this one also asks the
// database (PRA-OPS-006): a query, and the schema at this build's migrations. deploy/deploy.sh waits for it after a
// restart and rolls back when it does not come, and the uptime monitor watches it.
//
//   200 { ok: true, db: "ok", schema: { have, want, ok }, commit }     ready
//   503 { ok: false, db: "ok" | <the error>, schema, commit }          not ready
//
// `commit` is the release's REVISION file (deploy/deploy.sh writes it), or null in a git checkout.

let revision;
/** The deployed commit, from REVISION at the release's root, read once. */
export function commitOf() {
  if (revision === undefined) {
    try {
      revision = readFileSync(path.join(ROOT, 'REVISION'), 'utf8').trim().slice(0, 64) || null;
    } catch {
      revision = null;
    }
  }
  return revision;
}

export function readiness(db) {
  let dbState = 'ok';
  let schema = null;
  try {
    db.get('SELECT count(*) AS n FROM workspaces');
    schema = db.schemaState();
  } catch (e) {
    dbState = String(e?.message || e).slice(0, 200);
  }
  return { ok: dbState === 'ok' && Boolean(schema?.ok), db: dbState, schema, commit: commitOf() };
}
