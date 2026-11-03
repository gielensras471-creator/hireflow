// DEV-02: not wired into the V2 application or startup. No migration or seed.
// Cross-table command prerequisites, authorization and write/event atomicity belong
// to later services; CHECK constraints enforce stored state, not transition history.
const v3SchemaSql = `
CREATE TABLE users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 name TEXT NOT NULL, role TEXT NOT NULL, department TEXT NOT NULL,
 email TEXT NOT NULL, phone TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE schema_migrations (
 version TEXT PRIMARY KEY NOT NULL CHECK(length(trim(version))>0),
 script_sha256 TEXT NOT NULL CHECK(length(script_sha256)=64),
 source_fingerprint TEXT NOT NULL CHECK(length(trim(source_fingerprint))>0),
 applied_at INTEGER NOT NULL CHECK(applied_at>=0),
 executor TEXT NOT NULL CHECK(length(trim(executor))>0),
 report_json TEXT NOT NULL CHECK(json_valid(report_json))
) STRICT;

CREATE TABLE positions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL CHECK(length(trim(title))>0),
 department TEXT NOT NULL, location TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('open','closed')),
 publish_date TEXT NOT NULL, description TEXT NOT NULL,
 deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at>=0),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1)
) STRICT;
CREATE INDEX idx_positions_status ON positions(status,deleted_at);
CREATE INDEX idx_positions_title ON positions(title);

CREATE TABLE candidates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
 name TEXT NOT NULL CHECK(length(trim(name))>0),
 education TEXT NOT NULL, school TEXT NOT NULL, phone TEXT NOT NULL,
 email TEXT NOT NULL, owner TEXT NOT NULL,
 skills TEXT NOT NULL DEFAULT '', experience TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '', applied_date TEXT NOT NULL,
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 stage TEXT NOT NULL CHECK(stage IN ('screening','first_interview','second_interview','offer')),
 application_status TEXT NOT NULL CHECK(application_status IN ('active','closed')),
 outcome TEXT CHECK(outcome IS NULL OR outcome IN ('hired','company_rejected','candidate_withdrew','offer_declined')),
 offer_status TEXT CHECK(offer_status IS NULL OR offer_status IN ('preparing','sent','accepted','declined')),
 closed_reason TEXT, closed_at INTEGER,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 CHECK((
  (application_status='active' AND outcome IS NULL AND closed_reason IS NULL AND closed_at IS NULL)
  OR (application_status='closed' AND outcome IS NOT NULL
   AND closed_reason IS NOT NULL AND length(trim(closed_reason))>0
   AND closed_at IS NOT NULL AND closed_at>=created_at)
 ) IS TRUE),
 CHECK((
  (application_status='active' AND stage IN ('screening','first_interview','second_interview') AND offer_status IS NULL AND outcome IS NULL)
  OR (application_status='active' AND stage='offer' AND offer_status IN ('preparing','sent','accepted') AND outcome IS NULL)
  OR (application_status='closed' AND stage IN ('screening','first_interview','second_interview') AND offer_status IS NULL AND outcome IN ('company_rejected','candidate_withdrew'))
  OR (application_status='closed' AND stage='offer' AND offer_status='accepted' AND outcome='hired')
  OR (application_status='closed' AND stage='offer' AND offer_status='declined' AND outcome='offer_declined')
  OR (application_status='closed' AND stage='offer' AND offer_status IN ('preparing','sent','accepted') AND outcome IN ('company_rejected','candidate_withdrew'))
 ) IS TRUE)
) STRICT;
CREATE INDEX idx_candidates_position ON candidates(position_id);
CREATE INDEX idx_candidates_work ON candidates(application_status,stage,offer_status);
CREATE INDEX idx_candidates_applied ON candidates(applied_date,id);
CREATE TRIGGER candidates_position_immutable BEFORE UPDATE OF position_id ON candidates
 WHEN NEW.position_id IS NOT OLD.position_id
 BEGIN SELECT RAISE(ABORT,'application position is immutable'); END;

CREATE TABLE interviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
 stage_scope TEXT NOT NULL CHECK(stage_scope IN ('first_interview','second_interview')),
 scheduled_at INTEGER NOT NULL CHECK(scheduled_at>=0),
 interviewer_name TEXT NOT NULL CHECK(length(trim(interviewer_name))>0),
 note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('scheduled','completed','cancelled')),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 completed_at INTEGER, cancelled_at INTEGER, cancel_reason TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 UNIQUE(id,candidate_id), UNIQUE(id,candidate_id,stage_scope),
 CHECK((
  (status='scheduled' AND completed_at IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)
  OR (status='completed' AND completed_at IS NOT NULL AND completed_at>=created_at AND cancelled_at IS NULL AND cancel_reason IS NULL)
  OR (status='cancelled' AND completed_at IS NULL AND cancelled_at IS NOT NULL AND cancelled_at>=created_at AND cancel_reason IS NOT NULL AND length(trim(cancel_reason))>0)
 ) IS TRUE)
) STRICT;
CREATE UNIQUE INDEX uq_interviews_one_scheduled ON interviews(candidate_id) WHERE status='scheduled';
CREATE INDEX idx_interviews_candidate_stage ON interviews(candidate_id,stage_scope,status);
CREATE INDEX idx_interviews_schedule ON interviews(status,scheduled_at);
CREATE TRIGGER interviews_scope_immutable BEFORE UPDATE OF candidate_id,stage_scope ON interviews
 WHEN NEW.candidate_id IS NOT OLD.candidate_id OR NEW.stage_scope IS NOT OLD.stage_scope
 BEGIN SELECT RAISE(ABORT,'interview ownership and stage are immutable'); END;

CREATE TABLE feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 interview_id INTEGER NOT NULL UNIQUE REFERENCES interviews(id) ON DELETE RESTRICT,
 reviewer_name TEXT NOT NULL CHECK(length(trim(reviewer_name))>0),
 recorded_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 recommendation TEXT NOT NULL CHECK(recommendation IN ('recommend','not_recommend','undecided')),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 submitted_at INTEGER NOT NULL CHECK(submitted_at>=0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 UNIQUE(id,interview_id)
) STRICT;
CREATE INDEX idx_feedback_recorder ON feedback(recorded_by_user_id);
CREATE TRIGGER feedback_original_submission_immutable BEFORE UPDATE ON feedback
 WHEN NEW.interview_id IS NOT OLD.interview_id
 OR NEW.recorded_by_user_id IS NOT OLD.recorded_by_user_id
 OR NEW.submitted_at IS NOT OLD.submitted_at
 BEGIN SELECT RAISE(ABORT,'original submission is immutable'); END;

CREATE TABLE command_receipts (
 command_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(command_id))>0),
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 idempotency_key TEXT NOT NULL CHECK(length(trim(idempotency_key))>0),
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 committed_at INTEGER NOT NULL CHECK(committed_at>=0),
 UNIQUE(actor_user_id,idempotency_key)
) STRICT;
CREATE TABLE business_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 aggregate_type TEXT NOT NULL CHECK(aggregate_type IN ('position','candidate')),
 position_id INTEGER REFERENCES positions(id) ON DELETE RESTRICT,
 candidate_id INTEGER REFERENCES candidates(id) ON DELETE RESTRICT,
 interview_id INTEGER, feedback_id INTEGER,
 command_id TEXT NOT NULL UNIQUE REFERENCES command_receipts(command_id) ON DELETE RESTRICT,
 aggregate_version INTEGER NOT NULL CHECK(aggregate_version>=1),
 event_type TEXT NOT NULL CHECK(event_type IN (
 'position_created','position_updated','position_status_changed','position_deleted',
 'candidate_created','candidate_updated','stage_advanced','application_closed',
 'interview_scheduled','interview_rescheduled','interview_completed','interview_cancelled',
 'feedback_submitted','feedback_supplemented','feedback_corrected',
 'offer_sent','offer_accepted','offer_declined','candidate_hired')),
 actor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 actor_name_snapshot TEXT NOT NULL CHECK(length(trim(actor_name_snapshot))>0),
 occurred_at INTEGER NOT NULL CHECK(occurred_at>=0),
 reason TEXT,
 old_values_json TEXT NOT NULL CHECK(json_valid(old_values_json)),
 new_values_json TEXT NOT NULL CHECK(json_valid(new_values_json)),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 UNIQUE(id,candidate_id),
 FOREIGN KEY(interview_id,candidate_id) REFERENCES interviews(id,candidate_id) ON DELETE RESTRICT,
 FOREIGN KEY(feedback_id,interview_id) REFERENCES feedback(id,interview_id) ON DELETE RESTRICT,
 CHECK((
  (aggregate_type='position' AND position_id IS NOT NULL AND candidate_id IS NULL
   AND interview_id IS NULL AND feedback_id IS NULL
   AND event_type IN ('position_created','position_updated','position_status_changed','position_deleted'))
  OR (aggregate_type='candidate' AND candidate_id IS NOT NULL AND position_id IS NULL
   AND event_type NOT IN ('position_created','position_updated','position_status_changed','position_deleted'))
 ) IS TRUE),
 CHECK(feedback_id IS NULL OR interview_id IS NOT NULL),
 CHECK(event_type NOT IN ('feedback_submitted','feedback_supplemented','feedback_corrected') OR feedback_id IS NOT NULL),
 CHECK(event_type<>'feedback_corrected' OR
  (reason IS NOT NULL AND length(trim(reason))>0))
) STRICT;
CREATE UNIQUE INDEX uq_events_position_version ON business_events(position_id,aggregate_version) WHERE aggregate_type='position';
CREATE UNIQUE INDEX uq_events_candidate_version ON business_events(candidate_id,aggregate_version) WHERE aggregate_type='candidate';
CREATE INDEX idx_events_position_time ON business_events(position_id,occurred_at,id);
CREATE INDEX idx_events_candidate_time ON business_events(candidate_id,occurred_at,id);
CREATE INDEX idx_events_interview ON business_events(interview_id);
CREATE INDEX idx_events_feedback ON business_events(feedback_id);
CREATE INDEX idx_events_actor ON business_events(actor_user_id);

CREATE TABLE advancement_missing_feedback (
 event_id INTEGER NOT NULL,
 interview_id INTEGER NOT NULL,
 candidate_id INTEGER NOT NULL,
 stage_scope TEXT NOT NULL CHECK(stage_scope IN ('first_interview','second_interview')),
 PRIMARY KEY(event_id,interview_id),
 FOREIGN KEY(event_id,candidate_id) REFERENCES business_events(id,candidate_id) ON DELETE RESTRICT,
 FOREIGN KEY(interview_id,candidate_id,stage_scope) REFERENCES interviews(id,candidate_id,stage_scope) ON DELETE RESTRICT
) STRICT;
CREATE INDEX idx_missing_interview ON advancement_missing_feedback(interview_id,candidate_id,stage_scope);
CREATE TRIGGER missing_requires_advance BEFORE INSERT ON advancement_missing_feedback
 WHEN NOT EXISTS(SELECT 1 FROM business_events WHERE id=NEW.event_id
 AND candidate_id=NEW.candidate_id AND event_type='stage_advanced'
 AND reason IS NOT NULL AND length(trim(reason))>0)
 BEGIN SELECT RAISE(ABORT,'missing feedback requires explained advancement'); END;

CREATE TABLE legacy_records (
 source_key TEXT NOT NULL CHECK(length(trim(source_key))>0),
 entity_type TEXT NOT NULL CHECK(entity_type IN ('positions','candidates','interviews')),
 legacy_id INTEGER NOT NULL,
 raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
 facts_json TEXT NOT NULL CHECK(json_valid(facts_json)),
 mapped_position_id INTEGER REFERENCES positions(id) ON DELETE RESTRICT,
 mapping_status TEXT NOT NULL CHECK(mapping_status IN ('unique_match','no_match','ambiguous','not_applicable')),
 imported_at INTEGER NOT NULL CHECK(imported_at>=0),
 PRIMARY KEY(source_key,entity_type,legacy_id),
 CHECK((
  (entity_type='candidates' AND
    ((mapping_status='unique_match' AND mapped_position_id IS NOT NULL)
    OR (mapping_status IN ('no_match','ambiguous') AND mapped_position_id IS NULL)))
  OR (entity_type IN ('positions','interviews') AND mapping_status='not_applicable' AND mapped_position_id IS NULL)
 ) IS TRUE)
) STRICT;
CREATE INDEX idx_legacy_position ON legacy_records(mapped_position_id,entity_type);
CREATE TRIGGER legacy_no_insert_after_migration BEFORE INSERT ON legacy_records
 WHEN EXISTS(SELECT 1 FROM schema_migrations WHERE version='003_v3_import')
 BEGIN SELECT RAISE(ABORT,'legacy import is sealed'); END;

CREATE TRIGGER business_events_no_update BEFORE UPDATE ON business_events
BEGIN SELECT RAISE(ABORT,'business_events is immutable'); END;

CREATE TRIGGER business_events_no_delete BEFORE DELETE ON business_events
BEGIN SELECT RAISE(ABORT,'business_events is immutable'); END;

CREATE TRIGGER advancement_missing_feedback_no_update BEFORE UPDATE ON advancement_missing_feedback
BEGIN SELECT RAISE(ABORT,'advancement_missing_feedback is immutable'); END;

CREATE TRIGGER advancement_missing_feedback_no_delete BEFORE DELETE ON advancement_missing_feedback
BEGIN SELECT RAISE(ABORT,'advancement_missing_feedback is immutable'); END;

CREATE TRIGGER legacy_records_no_update BEFORE UPDATE ON legacy_records
BEGIN SELECT RAISE(ABORT,'legacy_records is immutable'); END;

CREATE TRIGGER legacy_records_no_delete BEFORE DELETE ON legacy_records
BEGIN SELECT RAISE(ABORT,'legacy_records is immutable'); END;

CREATE TRIGGER schema_migrations_no_update BEFORE UPDATE ON schema_migrations
BEGIN SELECT RAISE(ABORT,'schema_migrations is immutable'); END;

CREATE TRIGGER schema_migrations_no_delete BEFORE DELETE ON schema_migrations
BEGIN SELECT RAISE(ABORT,'schema_migrations is immutable'); END;

CREATE TRIGGER command_receipts_no_update BEFORE UPDATE ON command_receipts
BEGIN SELECT RAISE(ABORT,'command_receipts is immutable'); END;

CREATE TRIGGER command_receipts_no_delete BEFORE DELETE ON command_receipts
BEGIN SELECT RAISE(ABORT,'command_receipts is immutable'); END;
`

export const createV3Schema = (db) => {
  if (db.isTransaction) throw new Error('V3 schema requires its own transaction')
  const databases = db.prepare('PRAGMA database_list').all()
  if (databases.some((item) => item.file !== '')) {
    throw new Error('DEV-02 V3 schema is restricted to fresh in-memory test databases')
  }
  if (databases.some((item) => !['main', 'temp'].includes(item.name))) {
    throw new Error('V3 schema does not allow attached databases')
  }
  if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) {
    throw new Error('Foreign keys must be enabled before creating V3 schema')
  }
  if (
    ['main', 'temp'].some((schema) =>
      db
        .prepare(
          'SELECT 1 FROM ' + schema + ".sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1"
        )
        .get()
    )
  )
    throw new Error('V3 schema requires an empty test database; existing schema is never migrated')
  // REPLACE must run delete guards too, preserving append-only history.
  db.exec('PRAGMA recursive_triggers = ON')
  db.exec('BEGIN')
  try {
    db.exec(v3SchemaSql)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
