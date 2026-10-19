PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL
);

CREATE TABLE work_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  parent_id TEXT REFERENCES work_categories(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK(parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX category_names ON work_categories(COALESCE(parent_id,''), name COLLATE NOCASE);
CREATE TRIGGER category_depth_insert BEFORE INSERT ON work_categories
WHEN NEW.parent_id IS NOT NULL AND EXISTS(SELECT 1 FROM work_categories WHERE id=NEW.parent_id AND parent_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, '업무구분은 2단계까지만 등록할 수 있습니다.'); END;
CREATE TRIGGER category_depth_update BEFORE UPDATE OF parent_id ON work_categories
WHEN NEW.parent_id IS NOT NULL AND (
  EXISTS(SELECT 1 FROM work_categories WHERE id=NEW.parent_id AND parent_id IS NOT NULL)
  OR EXISTS(SELECT 1 FROM work_categories WHERE parent_id=NEW.id)
)
BEGIN SELECT RAISE(ABORT, '업무구분은 2단계까지만 등록할 수 있습니다.'); END;

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  category_id TEXT NOT NULL REFERENCES work_categories(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);
CREATE INDEX documents_org ON documents(organization_id);
CREATE INDEX documents_category ON documents(category_id);

CREATE TABLE revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence >= 1),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 50),
  revision_date TEXT NOT NULL CHECK(length(revision_date)=10),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary)<=300),
  manager TEXT NOT NULL CHECK(length(manager) BETWEEN 1 AND 100),
  approval_no TEXT NOT NULL DEFAULT '' CHECK(length(approval_no)<=10),
  token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, sequence)
);
CREATE INDEX revision_latest ON revisions(document_id, sequence DESC);
CREATE INDEX revision_date_idx ON revisions(revision_date);

CREATE TABLE relations (
  source_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  PRIMARY KEY(source_id,target_id),
  CHECK(source_id<>target_id)
);
CREATE INDEX relations_inbound ON relations(target_id);
CREATE TRIGGER relation_cross_org BEFORE INSERT ON relations
WHEN (SELECT d.organization_id FROM documents d JOIN revisions r ON r.document_id=d.id WHERE r.id=NEW.source_id)
   = (SELECT d.organization_id FROM documents d JOIN revisions r ON r.document_id=d.id WHERE r.id=NEW.target_id)
BEGIN SELECT RAISE(ABORT, '연관문서는 다른 기관의 문서만 연결할 수 있습니다.'); END;
CREATE TRIGGER document_cross_org BEFORE UPDATE OF organization_id ON documents
WHEN EXISTS (
  SELECT 1 FROM relations l
  JOIN revisions s ON s.id=l.source_id JOIN documents sd ON sd.id=s.document_id
  JOIN revisions t ON t.id=l.target_id JOIN documents td ON td.id=t.document_id
  WHERE (sd.id=NEW.id AND td.organization_id=NEW.organization_id)
     OR (td.id=NEW.id AND sd.organization_id=NEW.organization_id)
)
BEGIN SELECT RAISE(ABORT, '기관 변경으로 동일 기관의 참조가 발생합니다. 해당 연결을 먼저 수정해 주세요.'); END;

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>=0),
  mime TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX attachment_revision ON attachments(revision_id);
CREATE TABLE file_garbage (storage_key TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TRIGGER attachment_deleted AFTER DELETE ON attachments
BEGIN INSERT OR IGNORE INTO file_garbage VALUES(OLD.storage_key, strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;

CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE login_attempts (ip_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL, blocked_until INTEGER NOT NULL);
