# CliniScribe AI — judge readiness review

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
