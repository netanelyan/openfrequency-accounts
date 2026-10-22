import { createHash, randomBytes } from 'node:crypto';

// Session ids, magic-link tokens and invite tokens are all 32 random bytes,
// base64url. Only their SHA-256 is stored: the value itself exists in the
// cookie or the email, never in the database. A plain hash is enough here,
// unlike a password, because 256 random bits cannot be guessed.

export const newToken = () => randomBytes(32).toString('base64url');

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

/** The shape every token has. Anything else is refused before the database is asked. */
export const looksLikeToken = (value) => /^[A-Za-z0-9_-]{43}$/.test(String(value || ''));
