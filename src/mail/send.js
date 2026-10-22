import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureDir, outboxDir } from '../core/paths.js';

// Email: magic links and invites, through Resend.
//
// With RESEND_API_KEY unset (a laptop, the tests, the demo), each email is
// written to $OF_HOME/data/outbox/ as JSON and its link is printed, so the whole
// flow works without sending anything.
//
// send() returns at once and delivers in the background. The login page answers
// in the same time whether or not the address has an account, because the slow
// part (the call to Resend) never happens while the browser waits.

const RESEND = 'https://api.resend.com/emails';

export function createMailer({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const from = String(env.MAIL_FROM || '').trim() || 'OpenFrequency <accounts@openfrequency.co.il>';
  const replyTo = String(env.MAIL_REPLY_TO || '').trim() || null;
  const pending = new Set();

  async function viaResend(msg) {
    const r = await fetchImpl(RESEND, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) throw new Error(`Resend answered ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }

  function toOutbox(msg) {
    const dir = ensureDir(outboxDir(env));
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.json`);
    writeFileSync(file, JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, link: msg.link ?? null }, null, 2));
    log(`mail (outbox, not sent) to ${msg.to}: ${msg.subject}${msg.link ? `\n  ${msg.link}` : ''}`);
  }

  return {
    sending: key ? 'resend' : 'outbox',
    /** Queue one email: { to, subject, text, html, link }. Never throws; a failure is logged. */
    send(msg) {
      const p = (async () => (key ? viaResend(msg) : toOutbox(msg)))().catch((e) => log(`mail to ${msg.to} failed: ${e.message}`));
      pending.add(p);
      p.finally(() => pending.delete(p));
    },
    /** Wait for everything queued (the tests, and a clean shutdown). */
    flush: () => Promise.all([...pending]),
  };
}
