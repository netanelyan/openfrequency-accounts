import { PRODUCTS } from '../db/schema.js';

/** Each product's own site: TEDER_URL, TORAN_URL (localhost in development), else its name under openfrequency.co.il. */
export function productUrls(env = process.env) {
  return Object.fromEntries(PRODUCTS.map((p) => [p, String(env[`${p.toUpperCase()}_URL`] || '').trim() || `https://${p}.openfrequency.co.il/`]));
}
