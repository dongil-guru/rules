ALTER TABLE documents ADD COLUMN requirement TEXT NOT NULL DEFAULT '권장'
CHECK(requirement IN ('권장','필수'));

CREATE TABLE access_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  mode TEXT NOT NULL DEFAULT 'all' CHECK(mode IN ('all','allowlist')),
  token TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO access_settings VALUES(1,'all','initial-access-policy',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE allowed_ips (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=200),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX allowed_ips_active ON allowed_ips(active,ip);
