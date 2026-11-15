-- Tenant-consistent authorship and amendment links are enforced below the API.
ALTER TABLE practice_notes ADD CONSTRAINT practice_note_patient_identity UNIQUE(organization_id,patient_id,id);
ALTER TABLE practice_notes ADD CONSTRAINT practice_note_same_patient_amendment FOREIGN KEY(organization_id,patient_id,amends_id) REFERENCES practice_notes(organization_id,patient_id,id);
ALTER TABLE practice_notes ADD CONSTRAINT practice_note_author_membership FOREIGN KEY(organization_id,author_id) REFERENCES memberships(organization_id,practitioner_id);
ALTER TABLE practice_notes ADD CONSTRAINT practice_note_reviewer_membership FOREIGN KEY(organization_id,approved_by) REFERENCES memberships(organization_id,practitioner_id);
ALTER TABLE practice_documents ADD CONSTRAINT practice_document_author_membership FOREIGN KEY(organization_id,uploaded_by) REFERENCES memberships(organization_id,practitioner_id);
ALTER TABLE practice_medications ADD CONSTRAINT practice_medication_author_membership FOREIGN KEY(organization_id,recorded_by) REFERENCES memberships(organization_id,practitioner_id);
ALTER TABLE practice_summaries ADD CONSTRAINT practice_summary_author_membership FOREIGN KEY(organization_id,created_by) REFERENCES memberships(organization_id,practitioner_id);
ALTER TABLE practice_summaries ADD CONSTRAINT practice_summary_reviewer_membership FOREIGN KEY(organization_id,approved_by) REFERENCES memberships(organization_id,practitioner_id);
ALTER TABLE practice_note_versions ADD CONSTRAINT practice_version_author_membership FOREIGN KEY(organization_id,author_id) REFERENCES memberships(organization_id,practitioner_id);
ALTER TABLE practice_sessions ADD CONSTRAINT practice_session_membership FOREIGN KEY(organization_id,practitioner_id) REFERENCES memberships(organization_id,practitioner_id);
ALTER TABLE practice_notes ADD CONSTRAINT practice_note_approval CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL));
ALTER TABLE practice_summaries ADD CONSTRAINT practice_summary_approval CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL));
CREATE FUNCTION protect_approved_practice_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='approved' THEN RAISE EXCEPTION 'Approved records are immutable; create an amendment'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER practice_note_immutable BEFORE UPDATE OR DELETE ON practice_notes FOR EACH ROW EXECUTE FUNCTION protect_approved_practice_record();
CREATE TRIGGER practice_summary_immutable BEFORE UPDATE OR DELETE ON practice_summaries FOR EACH ROW EXECUTE FUNCTION protect_approved_practice_record();
CREATE FUNCTION protect_practice_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'History is append only';
END;
$$;
CREATE TRIGGER practice_versions_append_only BEFORE UPDATE OR DELETE ON practice_note_versions FOR EACH ROW EXECUTE FUNCTION protect_practice_history();
CREATE TRIGGER practice_audit_append_only BEFORE UPDATE OR DELETE ON practice_audit FOR EACH ROW EXECUTE FUNCTION protect_practice_history();
CREATE INDEX practice_notes_patient ON practice_notes(organization_id,patient_id,created_at);
CREATE INDEX practice_documents_patient ON practice_documents(organization_id,patient_id,created_at);
CREATE INDEX practice_medications_patient ON practice_medications(organization_id,patient_id,created_at);
CREATE INDEX practice_summaries_patient ON practice_summaries(organization_id,patient_id,created_at);
INSERT INTO practice_migrations(version) VALUES(2);
