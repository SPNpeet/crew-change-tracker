ALTER TABLE photos ADD COLUMN upload_id TEXT;
ALTER TABLE photos ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX photos_upload ON photos(user_id, upload_id);
