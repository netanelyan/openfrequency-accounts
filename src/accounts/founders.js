import { nowIso } from '../core/clock.js';
import { audit } from '../core/audit.js';

// The founders' offer (the owner, 2026-11-09: "lets do a founders sale for all of the products: no דמי הקמה for the
// next 10 people"): the next OF_FOUNDERS_SPOTS workspaces opened at sign-up (10 by default, 0 turns the offer off) pay
// no setup fee for any product they signed up for. A workspace that signs up for Teder and Toran together takes one
// spot. The spots are counted in `founders` from the day it was created (migration 14), never from a number written
// anywhere, so the website's counter (GET /public/founders.json, src/web/app.js) says only what is true: the owner asked
// for "8/10 spots left to boost confidence", and a count that is not real would mislead a buyer about the offer.
//
// The waiver is the subscriptions' own setup fee set to 0 in the same transaction as the sign-up, so billing, /setup,
// the payment email and the Morning invoice, which already leave out a setup of 0, need nothing more. A product turned
// on later pays its setup fee as listed; /admin can still set any subscription's fee by hand.

/** How many spots the offer has: OF_FOUNDERS_SPOTS, 10 when unset, 0 (or anything that is not a whole number) for off. */
export function foundersSpots(env = process.env) {
  const raw = String(env.OF_FOUNDERS_SPOTS ?? '').trim();
  if (raw === '') return 10;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : 0;
}

/**
 * The businesses already using OpenFrequency before the offer opened, each holding one of its spots: OF_FOUNDERS_EARLIER,
 * their names comma-separated (the owner, 2026-11-09: "change it to 8/10 because brickdealil and tiyulplus use
 * openfrequency"). Named here, not made up as a number, so the counter still counts only real businesses.
 */
export const foundersEarlier = (env = process.env) => String(env.OF_FOUNDERS_EARLIER ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** { spots, taken, left }: left is 0 when the offer is off or full. */
export function foundersState(db, env = process.env) {
  const spots = foundersSpots(env);
  const taken = foundersEarlier(env).length + db.get('SELECT COUNT(*) AS n FROM founders').n;
  return { spots, taken, left: Math.max(0, spots - taken) };
}

/** Whether a workspace took one of the spots. */
export const isFounder = (db, workspaceId) => Boolean(db.get('SELECT 1 FROM founders WHERE workspace_id = ?', Number(workspaceId)));

/**
 * Give a workspace just opened at sign-up the next spot, when one is left: its subscriptions' setup fees go to 0 and the
 * spot is kept. Called inside the sign-up's transaction (src/accounts/signup.js completeSignup), so two sign-ups at once
 * cannot take the same spot (the spot number is the table's key). Returns the spot's number, or null.
 */
export function takeFoundersSpot(db, workspaceId, { env = process.env, by = null, ip = null } = {}) {
  const { spots, left } = foundersState(db, env);
  if (!left || isFounder(db, workspaceId)) return null;
  const spot = spots - left + 1;
  db.run('INSERT INTO founders (spot, workspace_id, taken_at) VALUES (?, ?, ?)', spot, Number(workspaceId), nowIso());
  db.run('UPDATE subscriptions SET setup = 0, updated_at = ? WHERE workspace_id = ?', nowIso(), Number(workspaceId));
  audit(db, { actor: by, action: 'founders_spot', workspaceId: Number(workspaceId), ip, detail: { spot, of: spots } });
  return spot;
}
