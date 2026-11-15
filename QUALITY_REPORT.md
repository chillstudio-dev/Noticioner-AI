# Noticioner AI — judge readiness review

For the newer shared-practice implementation and its two subagent review rounds, see [PRACTICE_REVIEW.md](PRACTICE_REVIEW.md). The historical assessment below covers the original SQLite hackathon workspace.

Review date: 14 November 2026 (Asia/Singapore).

**Self-assessment: 8.0/10 for the hackathon implementation.** This is an engineering judgment, not an independent score. Browser click-through verification is still blocked by a saved local-browser permission, so this is not a claim that every visible control was exercised. That remains the main completion gap.

## Review and correction rounds

1. Earlier implementation review: 6.95/10. Live AI had not been verified, entry required a demo workspace step, and the presentation flow obscured the underlying product.
2. Judge-access revision: removed the login and access-code gate, Demo studio, scenario controls and seeded records. Added automatic isolated workspaces, empty-state handling, contextual speaker attribution, updated tests and a concise judge guide. Fixed outdated test fixtures and removed unused presentation CSS and source files.
3. Final implementation review: 8.0/10 after live Claude generation, the eight-case AI evaluation, local transcription smoke checks and repository verification. No score increase is claimed for browser behavior that could not be observed.

| Category | Score / 10 | Weight | Evidence and limits |
| --- | --- | --- | --- |
| Functionality | 8.5 | 25% | Consultation persistence, editing, evidence, review, approval, export and isolation verified through HTTP. Browser interactions remain unverified. |
| AI implementation | 8.0 | 20% | Actual Claude note generation and contextual Nurse/Patient attribution passed a synthetic smoke check. Eight-case extraction evaluation completed. Ambiguous roles still require review. |
| UI/UX | 6.0 | 15% | Direct entry, empty states, readable source/draft layout, semantic controls and focused navigation; no visual certification without browser access. |
| Reliability | 9.0 | 15% | Unit/integration and production HTTP checks, lint, TypeScript and production build. Bounded local audio processing and stale-write protection. |
| Security boundaries | 8.0 | 10% | Visitor isolation, exact source checking, origin rejection, bounded inputs and server-only credentials. No independent security audit. |
| Judge presentation | 8.0 | 10% | Direct product workflow, judge guide, actual evaluation artifacts and visible role attribution. No built-in demo mode. |
| Repository documentation | 9.0 | 5% | README, code map, architecture, evaluation, security, limitations and automated CI definition. |

Weighted score: 8.025/10, rounded to 8.0.

## Verified evidence

- 33 unit/integration tests cover output validation, exact evidence, nurse labels, explicit-role precedence, inferred-role review, anonymous workspace creation, private sessions, revisions, concurrency, PDF pagination, API errors and local audio cleanup/cancellation.
- Three HTTP suites cover the full consultation workflow, concurrent mutations and empty credential-free judge access. The production harness runs with no AI key and no access code in an isolated temporary database.
- Actual Claude request on one unlabeled nurse/patient paragraph: symptom/history attributed to Patient, temperature/follow-up to Nurse. The app preserved original source text, marked roles Inferred and required speaker review. Model outcomes can vary; this is not an acoustic diarization benchmark.
- Actual eight-case Claude extraction evaluation: precision 92.31%, recall 96.00%, F1 94.12%, 2 false positives and 1 false negative. Full outputs are in evaluation-results/ai.json. This small development-visible dataset does not establish clinical accuracy or generalization.
- Local Whisper transcribed synthetic WebM/Opus and MP4/AAC audio through the authenticated app endpoint. Temporary audio and disposable workspaces were removed. Physical microphone behavior remains unverified.
- Earlier generated PDFs were rendered and inspected for routine and multi-page cases. Automated PDF checks continue to pass; the new speaker metadata is covered by generation/build checks but not a fresh visual PDF review.
- Browser tests are authored and updated for direct entry, but were not executed because of the saved permission block. No alternate browser route was used to bypass it.

## Remaining limitations

The main page remains large and would benefit from further component extraction. Speaker roles are contextual estimates, not voice identification. Clinical meaning, errors and review decisions need human inspection. Docker, other operating systems, independent accessibility assessment and public hosting are not verified. A clean clone can exercise the baseline without credentials; real AI requires the judge's own provider key. The author's key, local database, recordings, model binaries and build tools are excluded from Git.

## Follow-up verification — 16 November 2026

This addendum supersedes the earlier browser-test status above; the original review remains a historical snapshot. Follow-up checks used fictional data and local or mocked providers.

- `npm run typecheck` and `npm run lint` pass.
- With the temporary loopback PostgreSQL test database, `npm test` passes 98/98 with no skips. The bundled PostgreSQL runner remains blocked by this host's code-signing policy.
- `npm run build -- --webpack` passes. The default Turbopack build remains blocked on this host by the native binding signature policy.
- `npm run test:server` passes all 3 production HTTP workflow checks.
- Playwright passes 18 tests, with 3 optional demo sign-in tests skipped. Shared-practice UI checks mock the API.
- The `fictional-followup-2` personal-workspace HTTP evaluation processed all 12 fictional follow-ups. Every draft remained `Needs Review`; all 47 expected facts and source links matched with no quote, speaker, uncertainty, negation, correction, or SOAP-placement errors. This is an in-set result, not held-out or clinical accuracy evidence.
- Trust Engine `trust-1.4.0` passed 24 deterministic fixtures with 15 TP, 0 FP, 0 FN. Independent code review led to additional duration and follow-up boundary tests; this authored set does not establish clinical generalization.
- The bundled PostgreSQL runner remains blocked by the host's code-signing policy. To verify service integration, official PostgreSQL 18.7 source was checksum-verified and built on a temporary RAM disk; a fresh cluster bound only to `127.0.0.1:55432` passed `npm run test:practice` (10/10, 0 failed, 0 skipped), applying migrations 1–4. The test harness now permits an explicit loopback-only `PRACTICE_TEST_DATABASE_URL` fallback and rejects remote database URLs. This verifies the shared-practice service against PostgreSQL, while browser checks still mock its API. Quarantine restoration details and the exact metadata uncertainty are recorded in [TRUST_IMPLEMENTATION.md](TRUST_IMPLEMENTATION.md).
- The production server is running at `http://127.0.0.1:3110` against a fresh temporary SQLite database. The routes `/`, `/practice`, and `/doctor` returned HTTP 200 after PostgreSQL test cleanup. Desktop and 390px mobile screenshots were inspected; text wraps and cards stack without visible overlap or clipping. The research-prototype banner uses the Noticioner name.

## Recovery checkpoints

- Pre-task tracked changes: `/tmp/noticioner-pre-task-tracked.patch`.
- Pre-task untracked files: `/tmp/noticioner-pre-task-untracked.tar.gz`.
- Task-only tracked changes relative to the pre-task baseline: `/tmp/noticioner-task-final-tracked.patch`.
- New or changed untracked task artifacts relative to the pre-task baseline: `/tmp/noticioner-task-final-untracked-delta.tar.gz` (22 files, with a manifest).
