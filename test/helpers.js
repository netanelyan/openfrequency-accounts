import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Db } from '../src/db/index.js';
import { setNow } from '../src/core/clock.js';

// Every test runs against a throwaway OF_HOME and a fresh database, never
// against ./private/. No key is ever set, so no email can leave the machine.

delete process.env.RESEND_API_KEY;

/** Databases opened by a test, closed before its folder is removed (Windows will not delete an open file). */
const opened = [];

/** A fresh private folder with an empty, migrated database. */
export function tempHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'of-accounts-test-'));
  process.env.OF_HOME = home;
  const db = new Db(path.join(home, 'data', 'accounts.db'));
  opened.push(db);
  return {
    home,
    db,
    cleanup: () => {
      setNow(null);
      while (opened.length) {
        try {
          opened.pop().close();
        } catch {
          /* already closed */
        }
      }
      try {
        rmSync(home, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* a leftover temp folder is harmless */
      }
    },
  };
}
