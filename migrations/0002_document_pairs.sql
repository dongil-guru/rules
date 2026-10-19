-- Keep documents, revisions, attachments and work categories while replacing
-- editable organization categories with two fixed document sides.
DROP TRIGGER IF EXISTS document_cross_org;
DROP TRIGGER IF EXISTS relation_cross_org;

CREATE TABLE _document_side_migration (document_id TEXT PRIMARY KEY, side TEXT NOT NULL);
INSERT INTO _document_side_migration
SELECT d.id, CASE WHEN o.id='kwwa' OR instr(o.name,'상하수도협회')>0 OR o.name='협회' THEN 'kwwa' ELSE 'upper' END
FROM documents d JOIN organizations o ON o.id=d.organization_id;
UPDATE organizations SET name='이전 기관 '||substr(id,1,60)
WHERE name IN ('한국상하수도협회','상위기관') AND id NOT IN ('kwwa','upper');
INSERT INTO organizations(id,name,created_at) VALUES('kwwa','한국상하수도협회',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(id) DO UPDATE SET name=excluded.name;
INSERT INTO organizations(id,name,created_at) VALUES('upper','상위기관',strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(id) DO UPDATE SET name=excluded.name;
UPDATE documents SET organization_id=(SELECT side FROM _document_side_migration WHERE document_id=documents.id);
DELETE FROM organizations WHERE id NOT IN ('kwwa','upper');
DROP TABLE _document_side_migration;

CREATE TABLE document_pairs (
  kwwa_id TEXT NOT NULL PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  upper_id TEXT NOT NULL UNIQUE REFERENCES documents(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK(kwwa_id<>upper_id)
);

-- Retain one eligible legacy connection per document, preferring recent links.
-- Documents whose extra links cannot be retained remain visible as single rows.
INSERT OR IGNORE INTO document_pairs(kwwa_id,upper_id,created_at)
SELECT CASE WHEN sd.organization_id='kwwa' THEN sd.id ELSE td.id END,
       CASE WHEN sd.organization_id='upper' THEN sd.id ELSE td.id END,
       s.updated_at
FROM relations l JOIN revisions s ON s.id=l.source_id JOIN documents sd ON sd.id=s.document_id
JOIN revisions t ON t.id=l.target_id JOIN documents td ON td.id=t.document_id
WHERE sd.organization_id<>td.organization_id AND sd.category_id=td.category_id
ORDER BY s.updated_at DESC,s.sequence DESC,sd.id,td.id;

CREATE TRIGGER document_pair_insert BEFORE INSERT ON document_pairs
WHEN (SELECT organization_id FROM documents WHERE id=NEW.kwwa_id)<>'kwwa'
  OR (SELECT organization_id FROM documents WHERE id=NEW.upper_id)<>'upper'
  OR (SELECT category_id FROM documents WHERE id=NEW.kwwa_id)<>(SELECT category_id FROM documents WHERE id=NEW.upper_id)
BEGIN SELECT RAISE(ABORT,'연관문서는 서로 다른 기관 구분의 같은 업무구분 문서끼리 연결해 주세요.'); END;
CREATE TRIGGER document_pair_update BEFORE UPDATE ON document_pairs
WHEN (SELECT organization_id FROM documents WHERE id=NEW.kwwa_id)<>'kwwa'
  OR (SELECT organization_id FROM documents WHERE id=NEW.upper_id)<>'upper'
  OR (SELECT category_id FROM documents WHERE id=NEW.kwwa_id)<>(SELECT category_id FROM documents WHERE id=NEW.upper_id)
BEGIN SELECT RAISE(ABORT,'연관문서는 서로 다른 기관 구분의 같은 업무구분 문서끼리 연결해 주세요.'); END;
CREATE TRIGGER paired_document_update BEFORE UPDATE OF organization_id,category_id ON documents
WHEN EXISTS (
  SELECT 1 FROM document_pairs p JOIN documents other ON other.id=CASE WHEN p.kwwa_id=OLD.id THEN p.upper_id ELSE p.kwwa_id END
  WHERE (p.kwwa_id=OLD.id OR p.upper_id=OLD.id)
    AND (other.organization_id=NEW.organization_id OR other.category_id<>NEW.category_id)
)
BEGIN SELECT RAISE(ABORT,'연관문서 연결을 해제하거나 동일한 업무구분을 선택해 주세요.'); END;
CREATE TRIGGER organization_side_insert BEFORE INSERT ON documents
WHEN NEW.organization_id NOT IN ('kwwa','upper')
BEGIN SELECT RAISE(ABORT,'기관 구분은 한국상하수도협회 또는 상위기관을 선택해 주세요.'); END;
CREATE TRIGGER organization_side_update BEFORE UPDATE OF organization_id ON documents
WHEN NEW.organization_id NOT IN ('kwwa','upper')
BEGIN SELECT RAISE(ABORT,'기관 구분은 한국상하수도협회 또는 상위기관을 선택해 주세요.'); END;
CREATE TRIGGER fixed_organization_insert BEFORE INSERT ON organizations
BEGIN SELECT RAISE(ABORT,'기관 구분은 고정 항목입니다.'); END;
CREATE TRIGGER fixed_organization_update BEFORE UPDATE ON organizations
BEGIN SELECT RAISE(ABORT,'기관 구분은 고정 항목입니다.'); END;
CREATE TRIGGER fixed_organization_delete BEFORE DELETE ON organizations
BEGIN SELECT RAISE(ABORT,'기관 구분은 고정 항목입니다.'); END;
