-- Preserve category IDs, names, documents and file references while flattening
-- every former child into an independent category.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE work_categories_flat (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL CHECK(sort_order>=0)
);
INSERT INTO work_categories_flat(id,name,created_at,sort_order)
SELECT id,name,created_at,ROW_NUMBER() OVER (ORDER BY name COLLATE NOCASE,created_at,id)-1
FROM work_categories;
DROP TABLE work_categories;
ALTER TABLE work_categories_flat RENAME TO work_categories;
PRAGMA defer_foreign_keys=OFF;
CREATE INDEX category_order ON work_categories(sort_order,id);

-- Previously separate branches may already contain the same category name.
-- Preserve them while preventing any new duplicate names.
CREATE TRIGGER category_name_insert BEFORE INSERT ON work_categories
WHEN EXISTS(SELECT 1 FROM work_categories WHERE name=NEW.name COLLATE NOCASE)
BEGIN SELECT RAISE(ABORT,'동일한 이름의 업무구분이 있습니다.'); END;
CREATE TRIGGER category_name_update BEFORE UPDATE OF name ON work_categories
WHEN NEW.name<>OLD.name COLLATE NOCASE
  AND EXISTS(SELECT 1 FROM work_categories WHERE id<>OLD.id AND name=NEW.name COLLATE NOCASE)
BEGIN SELECT RAISE(ABORT,'동일한 이름의 업무구분이 있습니다.'); END;
