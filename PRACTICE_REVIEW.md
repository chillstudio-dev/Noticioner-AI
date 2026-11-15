# Shared-practice implementation review

Reviewed 15 November 2026 (Asia/Singapore). Accepted scope: an initial shared-practice implementation for synthetic data. This review does not approve clinical deployment.

## Review rounds

At the user's request, separate review subagents assessed functionality, UX/interface, database architecture and security at the end of each round. Reviewers inspected code and available artifacts; test execution was performed by the implementing agent.

| Round | Functionality | UX/interface | Database | Security | Overall |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 8.0 | 7.5 | 8.0 | 7.5 | 7.8 |
| 2 | 8.4 | 8.0 | 8.3 | 8.1 | 8.2 |

Round 1 required another iteration. Failed refreshes could retain cached clinical content after access loss; sign-in callback errors were hidden; and uncertain summaries offered approval that the server rejected. Round 2 clears selected clinical content on authorization failures, returns expired/revoked sessions to sign-in, displays callback errors, and explains why uncertain summaries need a corrected clinical note. Browser regression tests cover these behaviors.

The implementation also includes organization-scoped search with an explicit directory result limit, reviewer assignment when a clinician creates a patient, tenant-consistent database constraints, immutable approved notes and amendments, medication provenance, encrypted originals, fail-closed PDF scanning, source-linked summaries and application audit history. Setup and scope are in [PRACTICE_SETUP.md](PRACTICE_SETUP.md).

## Verification

- ESLint and TypeScript checks passed.
- Production Next.js build passed.
- Unit/integration runner: 38 passed, 2 database-dependent tests skipped in that runner; no failures.
- Isolated PostgreSQL runner: 7 passed, none skipped. It applies migrations and checks shared records, cross-tenant denial, revoked access, encrypted downloads, concurrent approvals, immutable history, summaries, membership/session expiry and route guards.
- Practice browser runner: 5 passed using isolated headless Chrome profiles against the production build. It uses mocked API responses to verify UI behavior, not a live organization identity provider. Desktop and 390px mobile screenshots were captured; horizontal overflow is checked.
- Production HTTP runner: 3 passed using a disposable synthetic SQLite database to check the existing workspace remains functional.

The local environment had no `node`/`npm` on PATH. Checks used the available Node 24.22.1 binary at `/private/tmp/noticioner-node` and the installed package entrypoints. Transcription test fixture executables now use `process.execPath`, avoiding reliance on a separate Node PATH entry. PostgreSQL, loopback servers and Chrome required approved sandbox escalation; all resulting test runs passed. No real patient material was used for these checks.

## Remaining rollout gates

Configure and validate the actual PostgreSQL deployment, organization identity provider/MFA policy, file key and trusted scanner before a connected pilot. Live OIDC/provider integration was not exercised in this round. Private object storage, durable AI jobs, protected external audit export, full-history pagination, key rotation, migration reconciliation, recovery drills and institutional approval remain as documented in the architecture and setup guides. No automatic SQLite patient import or demographic matching is enabled.

Changes remain local; no GitHub push or hosted deployment was performed.

## Patient view/edit access follow-up

Added patient-specific View only and Can edit grants in migration 003, server authorization, and Care team controls. New grants default to View only; existing assignments retain their previous editing capability during migration. Reviewers need edit access to approve records or manage assignments. Patient creation remains governed by organization role.

The separate read-only review subagent scored this follow-up **8.3/10**: functionality 8.5, UX/interface 8.0, database architecture 8.3, security 8.5, with no blockers in the synthetic-data scope. Its walkthrough clarification was incorporated.

Verification passed: lint, typecheck, production build, 38 general tests (2 database-dependent tests skipped in that runner), all 7 isolated PostgreSQL tests, and all 6 practice browser tests. PostgreSQL coverage now exercises view-only reading/downloads, denial of every clinical write and approval/sharing attempt, invalid permission values, and immediate upgrades/downgrades. Browser coverage checks hidden mutation controls, default view-only grants and permission selector requests. Browser APIs are mocked; the PostgreSQL suite exercises the actual service and database.
