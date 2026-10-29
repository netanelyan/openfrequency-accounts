#!/usr/bin/env node
// npm run backup [-- --keep 14] [-- --tag pre-<commit>]
//
// A consistent copy of the database while the service runs, checked before it counts (src/db/backup.js), into
// $OF_HOME/data/backups/, keeping the newest --keep nightly copies and the newest 5 taken before a deploy (--tag).
// On the server it runs nightly at 03:30 UTC from openfrequency-accounts-backup.service, and deploy/deploy.sh runs it
// with --tag before each deploy. A failed backup exits 1 and calls /usr/local/bin/of-alert, so a person hears of it.
// The copies stay on this machine: the off-site copy is the server's job (docs/deploy.md, "Backups").
//
// To restore one: docs/deploy.md, "Restore".

import { backupsDir, dbPath, ensureDir, requireHome } from '../src/core/paths.js';
import { alert, backup } from '../src/db/backup.js';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);

try {
  requireHome();
  const r = backup(dbPath(), ensureDir(backupsDir()), { keep: Number(arg('--keep', 14)), tag: arg('--tag', null) });
  console.log(`backup: ${r.file} (checked: ${r.counts.workspaces} workspaces, ${r.counts.users} people; ${r.kept} nightly copies kept)`);
} catch (e) {
  console.error(`backup failed: ${e.message}`);
  alert('accounts: the backup failed', e.message);
  process.exit(1);
}
