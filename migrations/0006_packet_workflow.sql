-- LOCAL CANDIDATE ONLY. Reconcile the applied ledger and Claude's 0005 before release.
-- Additive tables/triggers; existing rows are not relabelled as reviewed or approved.
CREATE TABLE wf_clock (job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE, rev INTEGER NOT NULL DEFAULT 1);
INSERT INTO wf_clock(job_id) SELECT id FROM jobs;
CREATE TABLE wf_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, name TEXT NOT NULL, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(job_id,name));
CREATE TABLE wf_people (crew_id INTEGER PRIMARY KEY REFERENCES crew(id) ON DELETE CASCADE, group_id INTEGER REFERENCES wf_groups(id) ON DELETE SET NULL, source_ref TEXT NOT NULL, source_sha256 TEXT NOT NULL, identity_hash TEXT NOT NULL, flight_legs TEXT NOT NULL, verified_by INTEGER NOT NULL, verified_at INTEGER NOT NULL);
CREATE TABLE wf_file_reviews (file_id INTEGER PRIMARY KEY REFERENCES crew_files(id) ON DELETE CASCADE, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, pages INTEGER NOT NULL, reviewed_by INTEGER NOT NULL, reviewed_at INTEGER NOT NULL);
CREATE TABLE wf_packets (id TEXT PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, source_rev INTEGER NOT NULL, snapshot TEXT NOT NULL, prepared_by INTEGER NOT NULL, prepared_at INTEGER NOT NULL, byte_size INTEGER NOT NULL, request_key TEXT NOT NULL, UNIQUE(prepared_by,request_key));
CREATE TABLE wf_packet_files (packet_id TEXT NOT NULL REFERENCES wf_packets(id) ON DELETE CASCADE, file_id INTEGER NOT NULL, crew_id INTEGER NOT NULL, object_key TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(packet_id,file_id));
CREATE TABLE wf_approvals (packet_id TEXT PRIMARY KEY REFERENCES wf_packets(id) ON DELETE CASCADE, revision TEXT NOT NULL, approved_by INTEGER NOT NULL, approved_role TEXT NOT NULL, approved_at INTEGER NOT NULL);
CREATE TABLE wf_submissions (packet_id TEXT PRIMARY KEY REFERENCES wf_packets(id) ON DELETE CASCADE, destination TEXT NOT NULL, evidence_ref TEXT NOT NULL, submitted_at INTEGER NOT NULL, recorded_by INTEGER NOT NULL, recorded_at INTEGER NOT NULL);
CREATE INDEX wf_packets_job ON wf_packets(job_id,prepared_at);
CREATE TRIGGER wf_job_insert AFTER INSERT ON jobs BEGIN INSERT INTO wf_clock(job_id) VALUES(NEW.id); END;
CREATE TRIGGER wf_job_change AFTER UPDATE OF vessel,port,eta,etb,etd,oktb ON jobs BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=NEW.id; END;
CREATE TRIGGER wf_crew_insert AFTER INSERT ON crew BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER wf_crew_change AFTER UPDATE ON crew BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id IN (OLD.job_id,NEW.job_id); END;
CREATE TRIGGER wf_crew_delete AFTER DELETE ON crew BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=OLD.job_id; END;
CREATE TRIGGER wf_file_insert AFTER INSERT ON crew_files BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=(SELECT job_id FROM crew WHERE id=NEW.crew_id); END;
CREATE TRIGGER wf_file_delete BEFORE DELETE ON crew_files BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=(SELECT job_id FROM crew WHERE id=OLD.crew_id); END;
CREATE TRIGGER wf_file_change AFTER UPDATE ON crew_files BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=(SELECT job_id FROM crew WHERE id=NEW.crew_id); END;
CREATE TRIGGER wf_group_insert AFTER INSERT ON wf_groups BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=NEW.job_id; END;
CREATE TRIGGER wf_person_insert AFTER INSERT ON wf_people BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=(SELECT job_id FROM crew WHERE id=NEW.crew_id); END;
CREATE TRIGGER wf_person_change AFTER UPDATE ON wf_people BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=(SELECT job_id FROM crew WHERE id=NEW.crew_id); END;
CREATE TRIGGER wf_review_insert AFTER INSERT ON wf_file_reviews BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=(SELECT c.job_id FROM crew_files f JOIN crew c ON c.id=f.crew_id WHERE f.id=NEW.file_id); END;
CREATE TRIGGER wf_review_change AFTER UPDATE ON wf_file_reviews BEGIN UPDATE wf_clock SET rev=rev+1 WHERE job_id=(SELECT c.job_id FROM crew_files f JOIN crew c ON c.id=f.crew_id WHERE f.id=NEW.file_id); END;
CREATE TRIGGER wf_settings_insert AFTER INSERT ON settings BEGIN UPDATE wf_clock SET rev=rev+1; END;
CREATE TRIGGER wf_settings_change AFTER UPDATE ON settings BEGIN UPDATE wf_clock SET rev=rev+1; END;
CREATE TRIGGER wf_settings_delete AFTER DELETE ON settings BEGIN UPDATE wf_clock SET rev=rev+1; END;
