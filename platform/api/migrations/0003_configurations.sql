-- Templates contain only allowlisted reusable choices, never personal builds.
CREATE TABLE configurations (
  id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  title TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  head INTEGER NOT NULL DEFAULT 1,
  source_id TEXT,
  source_revision INTEGER,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX configurations_owner ON configurations(account_id, deleted_at, updated);
CREATE INDEX configurations_public ON configurations(visibility, deleted_at, updated);
CREATE TABLE configuration_revisions (
  configuration_id TEXT NOT NULL REFERENCES configurations(id),
  revision INTEGER NOT NULL,
  recipe TEXT NOT NULL,
  message TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (configuration_id, revision)
);
CREATE TABLE community_reports (
  configuration_id TEXT NOT NULL REFERENCES configurations(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (configuration_id, account_id)
);
