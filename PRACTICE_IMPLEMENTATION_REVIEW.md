# Shared-practice implementation review

Date: 15 November 2026. Scope: initial synthetic-data implementation at `/practice`; local changes, no deployment or GitHub push.

## Iterative review

The user requested independent subagent review after each round, with another iteration for a score below 8/10.

| Round | Functionality | UX/interface | Database architecture | Security | Overall |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1: inherited implementation | 4.0 | 5.0 | 7.0 | 6.0 | 5.5 |
| 2: corrected and verified implementation | 8.3 | 8.0 | 8.5 | 8.0 | 8.2 |

Round two reviewer verdict: acceptable for the documented synthetic-data implementation; no remaining blockers within that initial scope. This is an engineering assessment, not clinical or institutional certification.

## Delivered behavior

- Separate PostgreSQL shared workspace with versioned transactional migrations and operator provisioning; existing anonymous SQLite data stays isolated.
- Organization OIDC sign-in with PKCE, nonce, signature, issuer, audience and required MFA assurance validation. Hashed, expiring sessions and active membership checks.
- Organization-scoped patients, care assignments, server patient search and explicit reviewer assignment for clinician-created patients.
- Shared clinical notes, reviewer approval with concurrency checks, immutable approved records, amendment history and stale-source detection.
- Medication statements with reported/verified/stopped status, source context and reviewer-only verification.
- Bounded encrypted text-file originals, optional fail-closed scanned PDF ingestion, authorized downloads and source metadata. Extracted text relies on database infrastructure encryption.
- AI drafts from selected approved notes or text documents, preserved source IDs/versions/quotations, human review and approval restrictions for uncertain output.
- Audited clinical reads, changes, denied requests, grants/revocations, downloads and source disclosure; append-only audit and note history triggers.
- Responsive record screens and aligned UI/API contracts for notes, medication entry, review, files, care team and activity.

## Verification

| Check | Result |
| --- | --- |
| ESLint | Pass, no warnings |
| TypeScript | Pass |
| Production build | Pass |
| General unit/integration suite | 38 passed, 2 database-only tests skipped here |
| Isolated PostgreSQL practice suite | 7 passed, no skips; includes both database-only tests |
| Production HTTP regression suite | 3 passed |
| Chrome shared-practice browser workflow | 1 passed; synthetic route fixtures, no browser errors; mobile overflow assertion passed |
| Git diff whitespace check | Pass |

PostgreSQL tests cover organization isolation, missing care assignment, admin clinical denial, same-practice grants and revocation, membership revocation, invalid/valid reviewer assignment, approval payload/role/version checks, competing approvals, immutable records/history, medication verification, encrypted upload/download, scanner absence, binary rejection, mocked AI generation and review, stale summaries, denial auditing and directory search beyond 250 patients. Cryptographic OIDC tests verify signed token acceptance and signature/nonce/audience/MFA rejection. HTTP route tests deny anonymous reads and cross-origin writes.

The environment had no npm on its shell PATH. Equivalent Node entry points ran the repository scripts. A temporary ad-hoc-signed copy of the bundled Node runtime allowed native Next.js modules to load; isolated PostgreSQL and local browser/server checks ran with the necessary sandbox execution permission. No dependency or clinical security policy was weakened to run checks.

## Remaining rollout work

Live institutional OIDC/MFA sign-in and provider connectivity have not been validated. The browser workflow uses synthetic API fixtures; PostgreSQL service behavior is tested separately. Full-history pagination/export, centralized authentication auditing, external protected audit export, private object storage, durable distributed jobs, key rotation, retention/legal holds, EHR integration, migration reconciliation, independent security/clinical assessment and disaster recovery remain rollout work. Approved-record triggers are not protection from a database owner who can alter the schema. Use synthetic data until institution-specific gates are resolved.

See [PRACTICE_SETUP.md](PRACTICE_SETUP.md) for configuration and a walkthrough, and [HOSPITAL_DATA_ARCHITECTURE.md](HOSPITAL_DATA_ARCHITECTURE.md) for the wider target architecture.
