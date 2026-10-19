ALTER TABLE documents ADD COLUMN document_type TEXT NOT NULL DEFAULT '지침'
CHECK(document_type IN ('지침','매뉴얼','가이드라인','기타'));

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(login_id) BETWEEN 1 AND 100),
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  last_login_at TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)),
  token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX single_administrator ON users(is_admin) WHERE is_admin=1;
CREATE TRIGGER protect_administrator_delete BEFORE DELETE ON users
WHEN OLD.is_admin=1
BEGIN SELECT RAISE(ABORT,'관리자 계정은 삭제할 수 없습니다.'); END;
CREATE TRIGGER protect_administrator_status BEFORE UPDATE OF active,is_admin ON users
WHEN OLD.is_admin=1 AND (NEW.active<>1 OR NEW.is_admin<>1)
BEGIN SELECT RAISE(ABORT,'관리자 계정은 비활성화할 수 없습니다.'); END;

-- Legacy anonymous sessions cannot identify an account. New sign-ins use this
-- table; document data and the previous schema remain intact during rollout.
CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX user_sessions_account ON user_sessions(user_id);
