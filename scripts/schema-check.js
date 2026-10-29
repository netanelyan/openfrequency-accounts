#!/usr/bin/env node
// node scripts/schema-check.js [<database file>]
//
// Can this build open that database (the live one by default)? deploy/rollback.sh asks it of the release it is about
// to go back to, before it switches (PRA-OPS-005). Read-only: it changes nothing.
//
//   exit 0   yes: the database is at this build's migrations, or behind them (the build runs the rest when it starts)
//   exit 3   no: a newer build migrated it (restore the backup taken before that deploy, or go forward)
//   exit 4   no: a migration it ran is not this build's at the same place
//   exit 1   it could not be read

import { DatabaseSync } from 'node:sqlite';
import { dbPath } from '../src/core/paths.js';
import { checksum } from '../src/db/index.js';
import { MIGRATIONS } from '../src/db/schema.js';

const file = process.argv[2] || dbPath();
let db;
try {
  db = new DatabaseSync(file, { readOnly: true });
} catch (e) {
  console.error(`schema-check: cannot open ${file}: ${e.message}`);
  process.exit(1);
}
const have = db.prepare('PRAGMA user_version').get().user_version;
const want = MIGRATIONS.length;
const kept = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_checksums'").get()
  ? new Map(db.prepare('SELECT position, sha256 FROM schema_checksums').all().map((r) => [r.position, r.sha256]))
  : new Map();
db.close();
if (have > want) {
  console.log(`schema-check: the database is at migration ${have}, this build knows ${want}: it would not start`);
  process.exit(3);
}
for (let v = 1; v <= have; v++) {
  if (kept.has(v) && kept.get(v) !== checksum(MIGRATIONS[v - 1])) {
    console.log(`schema-check: migration ${v} is not the one the database ran: it would not start`);
    process.exit(4);
  }
}
console.log(`schema-check: ok (the database at ${have}, this build at ${want})`);
