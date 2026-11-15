CREATE TABLE patient_summaries (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 consultation_id TEXT NOT NULL REFERENCES consultations(id) ON DELETE CASCADE,
 source_version INTEGER NOT NULL,
 source_fingerprint TEXT NOT NULL,
 content TEXT NOT NULL,
 trust TEXT NOT NULL,
 model TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,
 approved_at TEXT,
 approved_by TEXT
);
CREATE INDEX patient_summaries_owner ON patient_summaries(user_id,consultation_id,created_at);
CREATE TRIGGER patient_summaries_immutable BEFORE UPDATE ON patient_summaries
WHEN OLD.status='approved' BEGIN SELECT RAISE(ABORT,'Approved patient summaries are immutable'); END;
ALTER TABLE consultations ADD COLUMN trust_context_hash TEXT;
