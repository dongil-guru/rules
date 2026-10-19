-- Owner requested unlimited login retries until explicitly reinstated.
-- Retain the table for compatibility while removing every existing IP block.
DELETE FROM login_attempts;
