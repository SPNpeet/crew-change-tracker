-- Keep the pinned 0005 migration unchanged. Never infer an old photo's checkpoint
-- from a mutable positional index. Legacy photos remain available as unlinked evidence.
ALTER TABLE photos ADD COLUMN cp_id INTEGER;
CREATE INDEX photos_checkpoint_identity ON photos(crew_id, cp_id);
