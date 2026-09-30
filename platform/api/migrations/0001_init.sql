-- The install plane. Times are unix seconds. Secrets are stored as SHA-256 hex only.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  iss TEXT NOT NULL,
  sub TEXT NOT NULL,
  created INTEGER NOT NULL,
  UNIQUE (iss, sub)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_expires ON sessions (expires);

-- state is the SHA-256 of the state parameter. The verifier is needed raw for the exchange.
CREATE TABLE oidc_pending (
  state TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires INTEGER NOT NULL
);

-- A deleted label keeps its row, so the 30-day hold and version history survive.
-- next_version only climbs: a number is never reused, even after a delete.
CREATE TABLE labels (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  created INTEGER NOT NULL,
  deleted_at INTEGER,
  next_version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX labels_live ON labels (label) WHERE deleted_at IS NULL;
CREATE INDEX labels_label ON labels (label, deleted_at);
CREATE INDEX labels_account ON labels (account_id, deleted_at);

CREATE TABLE builds (
  id INTEGER PRIMARY KEY,
  label_id INTEGER NOT NULL REFERENCES labels (id),
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  created INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (label_id, version)
);

CREATE TABLE api_keys (
  fingerprint TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts (id),
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,
  created INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX api_keys_account ON api_keys (account_id);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  event TEXT NOT NULL,
  label TEXT,
  version INTEGER,
  sha256 TEXT,
  key_fingerprint TEXT
);
CREATE INDEX audit_account ON audit (account_id, at);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  win INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);
