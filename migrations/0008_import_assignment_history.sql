-- Additive local candidate. No inferred history before this migration.
ALTER TABLE crew ADD COLUMN assignment_rev INTEGER NOT NULL DEFAULT 1;
CREATE TABLE wf_assignment_history (id INTEGER PRIMARY KEY AUTOINCREMENT, crew_id INTEGER NOT NULL REFERENCES crew(id) ON DELETE CASCADE, revision INTEGER NOT NULL, from_vehicle_id INTEGER, to_vehicle_id INTEGER, from_driver_id INTEGER, to_driver_id INTEGER, from_agent_id INTEGER, to_agent_id INTEGER, changed_by INTEGER, changed_at INTEGER NOT NULL, UNIQUE(crew_id,revision));
CREATE TRIGGER wf_assignment_change AFTER UPDATE OF vehicle_id,driver_id,agent_id ON crew
WHEN OLD.vehicle_id IS NOT NEW.vehicle_id OR OLD.driver_id IS NOT NEW.driver_id OR OLD.agent_id IS NOT NEW.agent_id
BEGIN
 UPDATE crew SET assignment_rev=OLD.assignment_rev+1 WHERE id=NEW.id;
 INSERT INTO wf_assignment_history(crew_id,revision,from_vehicle_id,to_vehicle_id,from_driver_id,to_driver_id,from_agent_id,to_agent_id,changed_at) VALUES(NEW.id,OLD.assignment_rev+1,OLD.vehicle_id,NEW.vehicle_id,OLD.driver_id,NEW.driver_id,OLD.agent_id,NEW.agent_id,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER));
END;
CREATE TABLE wf_imports (id TEXT PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, source_ref TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_text TEXT NOT NULL, preview TEXT NOT NULL, crew_type TEXT NOT NULL CHECK(crew_type IN ('on','off')), created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, committed_by INTEGER, committed_at INTEGER, commit_token TEXT, UNIQUE(job_id,source_sha256,crew_type));
CREATE TABLE wf_import_rows (import_id TEXT NOT NULL REFERENCES wf_imports(id) ON DELETE CASCADE, row_number INTEGER NOT NULL, crew_id INTEGER REFERENCES crew(id) ON DELETE SET NULL, verified_by INTEGER NOT NULL, verified_at INTEGER NOT NULL, PRIMARY KEY(import_id,row_number));
