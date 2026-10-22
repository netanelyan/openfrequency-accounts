// The schema, as an append-only list of migrations. Once a migration has been
// pushed, never edit it: add a new one. PRAGMA user_version records how many
// have run.
//
// Times are ISO strings in UTC. JSON columns are TEXT and end in _json. Emails
// compare without case. A session id or a link's token is never stored, only its
// SHA-256, so a copy of the database cannot be used to sign in.

export const PRODUCTS = ['teder', 'toran'];
export const ROLES = ['client_owner', 'client_member'];

export const MIGRATIONS = [
  `
  CREATE TABLE users (
    id              INTEGER PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name            TEXT NOT NULL DEFAULT '',
    is_superadmin   INTEGER NOT NULL DEFAULT 0 CHECK (is_superadmin IN (0, 1)),
    password_hash   TEXT,                          -- superadmin only: scrypt$salt$key
    totp_secret     TEXT,                          -- superadmin only
    totp_last_step  INTEGER,                       -- the last TOTP step accepted: a code works once
    created_at      TEXT NOT NULL,
    last_login_at   TEXT,
    disabled_at     TEXT,
    CHECK (is_superadmin = 0 OR (password_hash IS NOT NULL AND totp_secret IS NOT NULL))
  );

  -- The superadmin's one-time codes for a lost phone. Hashes only.
  CREATE TABLE recovery_codes (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash       TEXT NOT NULL,
    used_at         TEXT
  );

  -- One per customer business.
  CREATE TABLE workspaces (
    id              INTEGER PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
    name            TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    disabled_at     TEXT,
    disabled_reason TEXT
  );

  CREATE TABLE memberships (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('client_owner', 'client_member')),
    created_at      TEXT NOT NULL,
    PRIMARY KEY (user_id, workspace_id)
  );
  CREATE INDEX memberships_workspace ON memberships(workspace_id);

  -- Which products a workspace may open. No row means off.
  CREATE TABLE workspace_products (
    workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    product         TEXT NOT NULL CHECK (product IN ('teder', 'toran')),
    enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (workspace_id, product)
  );

  CREATE TABLE sessions (
    id                    INTEGER PRIMARY KEY,
    id_hash               TEXT NOT NULL UNIQUE,     -- SHA-256 of the cookie value
    user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id          INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,  -- the one chosen, for a member of several
    view_as_workspace_id  INTEGER REFERENCES workspaces(id) ON DELETE SET NULL,  -- superadmin, read-only
    view_as_since         TEXT,
    created_at            TEXT NOT NULL,
    last_seen_at          TEXT NOT NULL,
    expires_at            TEXT NOT NULL,            -- the absolute end; idleness ends it sooner
    revoked_at            TEXT,
    revoked_reason        TEXT,                     -- 'sign_out' | 'sign_out_all' | 'user_disabled' | ...
    ip                    TEXT,
    user_agent            TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- Magic links and invites: single use, short-lived, hashes only.
  CREATE TABLE tokens (
    id              INTEGER PRIMARY KEY,
    token_hash      TEXT NOT NULL UNIQUE,
    kind            TEXT NOT NULL CHECK (kind IN ('magic', 'invite')),
    email           TEXT NOT NULL COLLATE NOCASE,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    workspace_id    INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,    -- invite: where to
    role            TEXT CHECK (role IS NULL OR role IN ('client_owner', 'client_member')),
    next_url        TEXT,                                                   -- checked when stored
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    used_at         TEXT,
    ip              TEXT,
    CHECK (kind = 'magic' OR (workspace_id IS NOT NULL AND role IS NOT NULL))
  );
  CREATE INDEX tokens_email ON tokens(email, created_at);

  CREATE TABLE audit (
    id              INTEGER PRIMARY KEY,
    at              TEXT NOT NULL,
    actor_id        INTEGER,                       -- the user, or NULL for the system
    actor           TEXT NOT NULL,                 -- an email, or 'system'
    action          TEXT NOT NULL,
    workspace_id    INTEGER,
    ip              TEXT,
    detail_json     TEXT
  );
  CREATE INDEX audit_at ON audit(at);
  CREATE INDEX audit_workspace ON audit(workspace_id, at);
  `,
];
