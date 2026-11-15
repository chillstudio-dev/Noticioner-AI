ALTER TABLE practice_summaries ADD COLUMN trust_findings jsonb NOT NULL DEFAULT '[]';
ALTER TABLE practice_summaries ADD COLUMN trust_audit jsonb NOT NULL DEFAULT '{}';
ALTER TABLE practice_summaries ADD COLUMN trust_sources jsonb NOT NULL DEFAULT '[]';
CREATE TABLE practice_patient_summaries (
 id uuid NOT NULL,
 organization_id uuid NOT NULL,
 patient_id uuid NOT NULL,
 source_note_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version>0),
 source_fingerprint text NOT NULL,
 content jsonb NOT NULL,
 trust jsonb NOT NULL,
 model text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL,
 approved_by uuid,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,id),
 FOREIGN KEY(organization_id,patient_id) REFERENCES practice_patients(organization_id,id),
 FOREIGN KEY(organization_id,patient_id,source_note_id) REFERENCES practice_notes(organization_id,patient_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,practitioner_id),
 FOREIGN KEY(organization_id,approved_by) REFERENCES memberships(organization_id,practitioner_id),
 CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX practice_patient_summaries_patient ON practice_patient_summaries(organization_id,patient_id,created_at);
CREATE TRIGGER practice_patient_summary_immutable BEFORE UPDATE OR DELETE ON practice_patient_summaries FOR EACH ROW EXECUTE FUNCTION protect_approved_practice_record();
CREATE TABLE practice_quality_runs (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 actor_id uuid NOT NULL,
 suite_version text NOT NULL,
 results jsonb NOT NULL CHECK(results->>'suite'='trust'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,actor_id) REFERENCES memberships(organization_id,practitioner_id)
);
CREATE INDEX practice_quality_runs_org ON practice_quality_runs(organization_id,created_at);
INSERT INTO practice_migrations(version) VALUES(4);
