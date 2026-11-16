# Noticioner Trust Engine — implementation and verification

## Implemented scope

The prototype has personal SQLite and shared-practice PostgreSQL workspaces. They are separate data paths and do not synchronize automatically.

- The shared domain contracts and deterministic rules live in `src/lib/trust-engine.ts`. They validate source IDs and exact excerpts before semantic checking; surface unsupported, contradicted, unclear and not-checked claims; identify documentation gaps without treating silence as a negative; and retain both sides of deterministic conflicts. Rules for synthetic allergy/medication examples are limited and do not provide treatment advice.
- The personal consultation API runs the audit around generation and note edits, rechecks record and recorded patient-context versions before saving, stores findings with review flags, and blocks approval while required findings remain unresolved. Reviewer dispositions require a rationale.
- Shared-practice summary generation checks access and source versions around provider calls, applies versioned finding dispositions and reviewer approval, and records audit events. The workspace quality endpoint uses synthetic fixtures and does not select patient records.
- Patient-friendly summaries are separate derivative records from one approved source note. Provider generation requires consent; paragraphs retain source references; editing invalidates prior audit results; approval is required before copy/print; no sending or patient portal is implemented.
- SQLite migrations are version-aware and transactional. PostgreSQL migrations are numbered and run under the existing advisory lock. Evaluation has a 24-case deterministic Trust suite and a separate optional eight-case provider suite.

These descriptions match the current source and tests; they do not establish clinical validity, security certification, or production readiness. More product limits are in [LIMITATIONS.md](LIMITATIONS.md).

## Verification performed — 16 November 2026

All test data and transcripts used in this task are synthetic. The built server ran on loopback with a fresh SQLite file at `/private/tmp/noticioner-evaluation-runtime/workspace.sqlite`. Verification included live Claude API requests from the eight-case extraction evaluation, the 12-case personal-workspace API evaluation, and one browser-generated consultation draft. Provider credentials were read from local configuration and were not included in the artifacts. Other browser tests use intercepted or mocked responses.

| Command or check | Result |
| --- | --- |
| `npm run typecheck` | Passed (`tsc --noEmit`). |
| `npm run lint` | Passed; one unused-variable warning was fixed and lint was rerun. |
| `npm test` (rerun without PostgreSQL configured) | 94 passed, 0 failed, 4 PostgreSQL-only tests skipped. The PostgreSQL-enabled run was previously verified at 98 passed, 0 failed, 0 skipped. |
| `npm run build -- --webpack` | Production build passed. Default `npm run build` fails on this host because the signed native Turbopack binding is blocked; Next falls back to WASM, which Turbopack cannot use. |
| `npm run test:server` | 3/3 production HTTP tests passed: personal workflow, stale concurrent updates, and anonymous judge workspace. |
| `TEST_BROWSER_CHANNEL=chrome TEST_BASE_URL=http://127.0.0.1:3110 npm run test:e2e -- --workers=1` | 18 passed, 3 skipped. The skips are optional demo identity sign-in tests. The shared-practice browser tests use mocked API responses; they are not live PostgreSQL integration evidence. |
| `PRACTICE_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/postgres npm run test:practice` | Passed 10/10, 0 failed, 0 skipped against a fresh PostgreSQL 18.7 database. The suite applied all four numbered migrations and covered fresh and populated upgrades, shared practice workflow and authorization, Trust review, patient summaries, quality, staleness, and access revocation. The harness accepts only loopback PostgreSQL URLs for this fallback. |
| `npm run evaluate:trust` | Current `trust-1.4.0`: 24/24 deterministic Trust fixtures completed, 0 errors; 15 TP, 0 FP, 0 FN. This measures the authored local rules only. |
| `npm run evaluate -- --ai` | Live `claude-sonnet-5-5` run on eight synthetic cases: 24 TP, 1 FP, 1 FN; precision/recall/F1 96%; 8/8 structured outputs valid; 0 statements labeled Unsupported; mean latency 2.86 seconds. The run also writes the 24-case deterministic Trust result. |
| `npm run evaluate:12-case` | Validated 12 cases, 44 segments and 47 exact gold facts; regenerated isolated transcript-only inputs and baseline/final results. |
| `EVALUATION_BASE_URL=http://127.0.0.1:3110 node scripts/evaluate-12-case-http.mjs` plus `node scripts/score-12-case.mjs --run=evaluation-results/noticioner-12-final-http.json --output=evaluation-results/noticioner-12-final-http-score.json` | Live Claude through the personal API: 12/12 drafts returned and stayed `Needs Review`; 35/47 supported pairs, 10 category extras, 12 omissions (P 77.78%, R 74.47%, F1 76.09%); 45/45 exact source links, 0 quote or speaker mismatches, 1 uncertain fact marked Supported, 1 lost negation, 0 lost active numeric details, 0 stale corrected durations, 0 forbidden-detail matches, and 1 SOAP placement error. This is an author-written development-visible set, not held-out evidence. |
| `node --import tsx scripts/evaluate-extraction-regression.ts` | Existing eight-case suite: precision 92%, recall 92%, F1 92%, 2 FP and 2 FN. |
| Earlier 12-case local-rule API run (`fictional-followup-2`) | 12/12 drafts returned with `Needs Review`; 47/47 exact segment/category pairs and 47/47 source links, with 0 quote or speaker mismatches, 0 uncertain claims promoted to Supported, 0 lost negations, 0 lost active numeric details, 0 stale corrected durations, and 0 SOAP placement errors. This tuned local-rule result is an in-set comparator, not held-out evaluation. |
| Brand scan | Product UI copy uses Noticioner; the existing GitHub repository slug remains unchanged. |

The 12-case JSON, transcript-only input, scorecards and per-case results are listed in [EVALUATION.md](EVALUATION.md).

## Review findings

- An independent accuracy review found and corrected missing ongoing-care context in eight cases; it also recommended clarifying C02's time window, separating the C05 symptom from the patient's guess, and correcting C10's SOAP/category label. The answer key and all scores were regenerated afterward.
- An independent code review caught overly broad medication-context and correction rules. Medication references now use the immediately preceding turn; corrections are scoped to a matching symptom or an adjacent explicit reference. Regression tests cover unrelated dialogue and two symptoms with the same earlier duration.
- Independent Trust Engine reviews found duration and follow-up false positives and false negatives. The current rules distinguish unrelated dates and sleep length from symptom duration, accept numeric duration answers and dated care follow-ups, and distinguish nonclinical targets from provider, rehabilitation, imaging, and care-setting plans. Targeted regressions cover those examples; deterministic evaluation remains 24/24 on its authored fixture set.
- An independent product review confirmed the clinician workflow and source navigation in the browser tests. Shared-practice browser checks mock the API; the separate PostgreSQL integration suite passed against the loopback fallback described above.

The eight-case provider-backed Trust suite was not rerun as part of this pass; the live provider calls above evaluate note generation. The earlier stored Trust result remains the only provider-backed Trust-suite result.

## Host verification notes

The bundled PostgreSQL runner remains blocked by this host's macOS code-signing policy. To verify the shared-practice integration suite, official PostgreSQL 18.7 source was checksum-verified and built on a temporary RAM disk; a fresh cluster bound only to `127.0.0.1:55432`. The loopback-only fallback passed all 10 practice tests and applied migrations 1–4. The temporary cluster and RAM disk were stopped and removed after verification. The production app remains available locally at `http://127.0.0.1:3110`.
