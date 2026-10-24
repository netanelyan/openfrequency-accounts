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
  `
  -- A workspace's subscription to a product, as OpenFrequency records it (no payment provider yet): the price agreed,
  -- when it began, the last day already paid for, and the last day of all once it is stopped. Dates are Israel
  -- calendar days (YYYY-MM-DD). What the customer's dashboard says (active, waiting for payment, ending, ended, the
  -- days left, the next charge) is worked out from these (src/accounts/subscriptions.js).
  CREATE TABLE subscriptions (
    workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    product         TEXT NOT NULL CHECK (product IN ('teder', 'toran')),
    monthly         REAL,                          -- ₪ a month
    vat             TEXT CHECK (vat IS NULL OR vat IN ('included', 'excluded')),
    setup           REAL,                          -- ₪ once, in the first month
    started_on      TEXT,
    paid_until      TEXT,                          -- the last day already paid for
    ends_on         TEXT,                          -- set when it is stopped: its last day
    updated_at      TEXT NOT NULL,
    PRIMARY KEY (workspace_id, product)
  );
  -- The products already on: a subscription at the list price (before VAT), from the day each was turned on.
  INSERT INTO subscriptions (workspace_id, product, monthly, vat, setup, started_on, updated_at)
    SELECT workspace_id, product, CASE product WHEN 'toran' THEN 449 ELSE 790 END, 'excluded',
           CASE product WHEN 'toran' THEN 990 ELSE 1490 END, substr(updated_at, 1, 10), updated_at
    FROM workspace_products WHERE enabled = 1;
  `,
  `
  -- A workspace's invoices, for its customer to see and download. The invoice itself is issued by the accountant's
  -- invoicing service, which owns its number and what Israeli law asks of it: Accounts never makes one. The operator
  -- records each on /admin, with the PDF the service produced, and the customer's home lists them. The PDF is kept
  -- here, in the one database file (so the daily backup has it), and is served only through a session in its own
  -- workspace, never from a public link.
  CREATE TABLE invoices (
    id              INTEGER PRIMARY KEY,
    workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    product         TEXT NOT NULL CHECK (product IN ('teder', 'toran')),
    number          TEXT NOT NULL,                 -- as the invoicing service issued it
    issued_on       TEXT NOT NULL,                 -- the date on the invoice, YYYY-MM-DD
    period_from     TEXT,                          -- the days it pays for; both or neither (a setup fee has none)
    period_to       TEXT,
    amount          REAL NOT NULL,                 -- ₪ before VAT
    vat             REAL NOT NULL,                 -- ₪ of VAT on it, 0 when none
    pdf             BLOB NOT NULL,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL,
    CHECK ((period_from IS NULL) = (period_to IS NULL))
  );
  CREATE INDEX invoices_workspace ON invoices(workspace_id, issued_on);
  `,
];
