#!/usr/bin/env node
// npm run daily [-- --again]
//
// The daily jobs (src/web/daily.js) by hand: the billing emails and the deletions the privacy policy promises. The
// service runs them by itself once a day from 09:00 Israel time; this is for a look, or to run today's again after a
// fix (--again). It prints what it did and the last runs.

import { requireHome } from '../src/core/paths.js';
import { loadEnv } from '../src/core/env.js';

requireHome();
loadEnv();
const { openDb, closeDb } = await import('../src/db/index.js');
const { lastRuns, runDaily } = await import('../src/web/daily.js');
const { createMailer } = await import('../src/mail/send.js');

const db = openDb();
if (process.argv.includes('--again')) db.run('UPDATE daily_runs SET finished_at = NULL, started_at = ? WHERE day = (SELECT max(day) FROM daily_runs)', '1970-01-01T00:00:00.000Z');
const mailer = createMailer();
const r = await runDaily(db, { mailer });
await mailer.flush();
console.log(r.ran ? JSON.stringify(r, null, 2) : `today (${r.day}) has run already; --again runs it again`);
for (const run of lastRuns(db)) console.log(`${run.day}  ${run.finished_at ? 'done' : 'not finished'}  ${JSON.stringify(run.detail)}`);
closeDb();
