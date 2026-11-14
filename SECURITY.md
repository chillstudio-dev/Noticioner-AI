# Prototype security

Synthetic data only. No claim of HIPAA/GDPR compliance, clinical safety certification, or a tamper-proof audit log.

- Random 256-bit session token; only SHA-256 token hashes are stored in SQLite. HttpOnly, SameSite=Strict cookies; Secure on HTTPS. Seven-day expiry enforced server-side.
- Each automatically created browser session maps to an isolated workspace. Every consultation and patient operation checks ownership. There is no login or access-code gate. The session token isolates visitors; it does not establish clinician identity.
- Parameterized SQL, foreign keys, mutation transactions with in-transaction version and approval-state rechecks, Zod input/output validation, transcript and audio size limits, same-origin mutation checks and per-workspace rate limiting.
- No provider credentials in the client. Provider URLs are server configuration, never user-controlled requests. Configure only trusted HTTPS providers. Requests time out; invalid model output is rejected before saving.
- API errors omit raw database/provider bodies and logs omit transcript text. Audit metadata is minimal. Audit events are application activity, not immutable medical records.
- Source quote verification is not an AI security or correctness guarantee. Prompt injection can still affect model output; review all statements.
- Audio is kept in browser memory until leaving the recording component. Local transcription temporarily writes private audio files and removes them after processing. Provider retention follows the configured provider's policy.
- Delete individual consultations or the entire workspace from the UI. Deletion cascades versions, audit entries and evaluations. SQLite physical erasure and provider-side deletion are not guaranteed. Orphaned expired workspaces require maintenance; automatic retention cleanup is not implemented.
- Before exposing the demo: configure TLS, durable storage, filesystem permissions, request body limits at the reverse proxy, resource limits and backups. Single-node rate limits are not a substitute for edge abuse protection.
- Expiring or clearing the browser cookie removes access without deleting records. There is no account recovery. Do not clear session cookies before exporting/deleting work you need.

Known gaps: no independent penetration test, no enterprise identity/RBAC, no encryption-at-rest management, no disaster-recovery exercise, no multi-instance database support. See QUALITY_REPORT.md for tested boundaries.
