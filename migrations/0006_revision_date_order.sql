-- Keep revision IDs, registration sequence, attachments, and document links.
-- Support effective-date ordering independently of the registration sequence.
CREATE INDEX revision_chronological ON revisions(document_id,revision_date DESC,sequence DESC);
