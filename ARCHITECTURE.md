# Architecture

This document describes the original SQLite workspace. The separate PostgreSQL shared-practice workspace is described in [HOSPITAL_DATA_ARCHITECTURE.md](HOSPITAL_DATA_ARCHITECTURE.md), with setup in [PRACTICE_SETUP.md](PRACTICE_SETUP.md) and verification in [PRACTICE_REVIEW.md](PRACTICE_REVIEW.md).

Browser → Next.js route handlers → SQLite repository / provider adapter / PDF renderer.

The client is a responsive React application. Shared recorder and dialog/badge components live in `src/components`; `src/lib/client-api.ts` handles bounded API requests and actionable response errors. Fontsource fonts are bundled locally. Protected data is never embedded in the public shell. Every data endpoint resolves a random, opaque, HttpOnly session cookie to a server-side user and applies ownership checks. Sessions expire after seven days. A new session starts empty; no fixture records are injected.

`src/lib/db.ts` owns SQL access. `migrations/001_initial.sql` creates users, sessions, patients, consultations, immutable note_versions, audit_events, evaluation_runs and rate_limits, with foreign keys and indexes. Transcript segments and notes use validated JSON/string fields rather than separate ORM entities. Database migration is idempotent. Transactions wrap multi-record mutations. API timestamps are generated on the server.

`clinical.ts` provides transcript parsing, note schemas, quote validation, baseline rules, review flag rules and approval validation. `provider.ts` sends transcript segments as untrusted JSON data to a configurable server-side endpoint. Outputs must parse as JSON and pass Zod. Evidence quotes must exist verbatim in their referenced segment. Assessment, plan and objective statements linked to non-doctor speech are flagged as uncertain. This does not guarantee semantic entailment or clinical correctness.

The provider adapter supports native Claude Messages structured output and OpenAI-compatible Chat Completions JSON mode. Schema constraints unsupported by Claude's structured output are removed from the request schema and retained in local Zod validation. Claude generation credentials are separate from optional OpenAI-compatible file transcription. Secrets never enter bootstrap responses. A configured provider indicates key presence, not verified connectivity.

With `STT_PROVIDER=local`, `local-transcription.ts` runs FFmpeg and whisper.cpp through bounded, shell-free child processes. Each request uses a private temporary directory and removes it on success or failure. Child environments omit provider credentials. Conversion accepts a restricted set of audio containers and rejects silent or over-three-minute decoded audio before inference. A validated language code is passed to the multilingual Whisper model; English-only models reject non-English requests. A process-local guard allows one transcription at a time; cancellations and timeouts terminate the child process. The engine never silently falls back to a cloud API. Model and executable paths are server configuration, not request inputs.

`evaluation-data.ts` stores reference labels separately from extraction. `evaluation.ts` runs a deterministic baseline or the configured AI provider on the same cases and computes measured metrics. The dashboard reads persisted actual outputs. The CLI writes versionable JSON artifacts.

## State and versions

New consultation → Draft. Saving transcript increments its revision and invalidates the current note. Generation → Needs Review. Saving note creates a new version, preserves the prior one and resets documentation review. Closing all prompts → Reviewed. Explicit reviewed + confirmed approval with zero open flags → Approved. Approved records reject changes other than deletion/export. The original generated note is never overwritten in note_versions. Approval records actor, server time and exact version.

Generation checks the consultation revision again after the asynchronous provider call, so a stale result cannot replace a transcript edit or approved record. API clients submit a revision on edits and approvals. The latest record, revision and approval state are re-read inside the same SQLite write transaction, after request parsing. Concurrent flag actions merge against current flags rather than replacing another review with an earlier snapshot. This is single-server SQLite concurrency, not a distributed locking architecture.

## API

- POST /api/session: automatically create/reuse an isolated browser workspace; no credentials
- DELETE /api/session: end session
- GET /api/bootstrap: owned patients, records, provider configuration and activity
- POST /api/patients, PATCH /api/patients/:id
- POST /api/consultations, GET /api/consultations
- GET/PATCH/DELETE /api/consultations/:id
- POST /api/consultations/:id/generate: mode ai or baseline
- PATCH /api/consultations/:id/note
- PATCH /api/consultations/:id/flags
- POST /api/consultations/:id/approve
- GET /api/consultations/:id/audit, /versions, /pdf
- POST /api/consultations/:id/event: bounded recording event names
- POST /api/transcribe: multipart audio, consent and consultation ID
- POST /api/evaluation/run
- DELETE /api/workspace: cascade owned data and end session

API naming consolidates the suggested generate-note and analyze-documentation endpoints under each consultation. These are functional route differences, not missing hidden services.

## Deployment boundaries

Node 24+ is required for built-in SQLite. The Docker image uses one Node instance and an external data volume. No ORM, cloud auth, PostgreSQL, D1, streaming audio, background queue or third-party medication knowledge source is included. Local SQL access is concentrated in the repository and route handlers; a PostgreSQL migration needs actual adapter work and concurrency testing.
