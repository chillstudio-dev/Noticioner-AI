# Noticioner: reviewable documentation for continuing care

A primary-care clinician seeing a patient for repeated follow-up visits needs an understandable record of what was reported, what was observed, and what still needs checking. Noticioner explores that workflow through fictional consultations. Its intended user is the clinician documenting an ongoing-care visit, such as a fictional hypertension follow-up. It does not provide hypertension-specific assessment or treatment logic.

Noticioner turns typed or transcribed conversations into a source-linked SOAP draft: Subjective, Objective, Assessment, and Plan. The clinician can inspect each cited excerpt, correct the draft, resolve review prompts with a rationale, and explicitly approve the record. All diagnostic and prescribing decisions remain with the clinician. Reducing repetitive documentation is a design goal; we have not measured time saved or improved patient outcomes.

## What we built

The distinctive contribution is the **Trust Engine**, a second review layer around the draft:

- **EvidenceGuard** separates an exact quotation's existence from whether it supports the claim. Invalid references and explicit negation reversals cannot be overridden by a model. A failed verifier leaves a visible “not checked” result.
- **Documentation gaps** identify details not established in the audited sources, including allergies, medication history, duration, severity, associated symptoms, examination, and follow-up. Silence is never converted into a negative finding.
- **Consistency checks** retain both sides of conflicting statements, dates, medication details, and corrections for review.
- **Synthetic Safety Guardian** demonstrates only a few code-defined allergy/medication examples. Findings link to the recorded allergy and medication text and preserve reported versus verified provenance.
- **Patient-friendly summaries** derive from one approved clinical note. They are separate English drafts with paragraph-level source references. Edits reset the audit; approval enables copy and print. There is no automatic delivery or patient portal.

Two separate workspaces demonstrate the workflow. Personal synthetic consultations use SQLite and explicitly simulated approval. Shared-practice records use PostgreSQL, organization sign-in, care assignments, and clinician/reviewer permissions. They do not automatically synchronize. This is a shared-practice prototype, not a deployed hospital-wide system.

## How it works

The app uses Next.js, React, TypeScript, and Zod. Optional local speech processing converts temporary audio with FFmpeg and runs whisper.cpp on the application server. The language selector offers nine languages, including English, French, Mandarin, Malay, and Tamil; language availability is not a measured accuracy claim. Temporary audio is removed after processing. Translation uses a separate provider-backed preview and does not overwrite the source.

Configured Claude or OpenAI-compatible providers produce structured notes and semantic audits. Source text is treated as untrusted data. Results must pass schema validation. Generated content is committed only after rechecking record versions and access; shared generation performs provider calls outside database transactions. A revoked or downgraded care assignment prevents saving the result. Approved shared records are immutable, and audit history is append-only.

AES-256-GCM applies to uploaded shared document bytes when the file key is configured. It is not whole-database encryption. SHA-256 is used for specific hashes/checksums, not as a claim that every consultation is cryptographically signed. We make no compliance certification, cost-per-consultation, or “low hallucination rate” claim.

## Evidence and a failure

The eight-case extraction benchmark contains synthetic cases. The latest live Claude run (`claude-sonnet-5-5`, 2026-11-15) matched 24 of 25 expected source/category pairs: 1 false positive and 1 false negative, for 96% precision, recall, and F1. All eight outputs passed schema validation, with no statements labeled Unsupported and mean latency of 2.86 seconds. On the separate 12-case follow-up suite, the real personal-workspace API run matched 35/47 pairs (77.78% precision, 74.47% recall, 76.09% F1); it also exposed one lost negation, one uncertain fact marked Supported, and one SOAP placement error. All 12 drafts remained pending review and all 45 source quotes linked correctly. These authored-set results are not measures of clinical accuracy; see [EVALUATION.md](EVALUATION.md) for methodology and artifacts.

For Trust Engine version `trust-1.4.0`, 24 deterministic fixtures produced 15 matched findings, 0 extras, and 0 misses. Regression checks also cover unrelated duration mentions, numeric duration answers, sleep length, nonclinical appointments and reviews, dated clinical follow-ups, historical visits, provider types, and imaging plans. The previously recorded eight-case provider-backed run used version `trust-1.0.0` and model identifier `claude-sonnet-5-5`: 5 matched findings, 2 extras, 0 misses, and 0 provider errors. Precision was 71.43%, recall 100%, and F1 83.33%. Its measured audit time was 24.63 seconds. This provider result predates the deterministic gap-rule corrections and was not rerun.

A concrete provider failure: the verifier repeated an existing cough contradiction and allergy conflict under different target labels. The strict case/category/target matcher counted those duplicates as two extra findings. A code review also found that a future review interval could hide a missing symptom duration, while a historical “regular follow-up visit” could hide the absence of a future plan. Version 1.1.0 now distinguishes those cases; focused regression tests cover both. The local rules remain narrow, so absence of a warning does not establish safety. All fixtures are author-written, development-visible, and not independently or clinically reviewed. [Evaluation methodology and artifacts](EVALUATION.md) explain the counting rules; [verification evidence](TRUST_IMPLEMENTATION.md) records the software checks.

## Implementation-stage scorecard

These are conservative self-assessments against the stated project gates, not hackathon judge scores or an independent clinical review.

| Area | Score | Evidence and reason |
| --- | ---: | --- |
| Evaluation fidelity | 7.0 / 10 | The frozen baseline captured 15/47 expected pairs and the tuned local-rule comparator captured 47/47 on the same author-written set. The live Claude API run captured 35/47, with 10 category extras, 12 omissions, one lost negation, one uncertain fact marked Supported, and one SOAP placement error; its 45 source quotes linked correctly. The set is development-visible and does not establish semantic generalization or clinical accuracy. See [EVALUATION.md](EVALUATION.md) for per-case results and limits. |
| App readiness | 8.0 / 10 | The production build, HTTP workflow, all routes, 98/98 unit/integration tests, 18 browser tests, and responsive screenshots passed. A fresh PostgreSQL 18.7 instance verified all four migrations and the shared-practice integration suite (10/10). Shared-practice browser tests still mock the API, three optional demo identity tests were skipped, and the bundled macOS PostgreSQL binary remains unusable under the host's code-signing policy. See [TRUST_IMPLEMENTATION.md](TRUST_IMPLEMENTATION.md). |

Both scores remain below the 9.5/10 aspiration. The main reasons are limited independent evaluation, mocked shared-workspace browser checks, and the gap between this prototype and institution-specific operational review; a perfect synthetic-set match does not prove a perfect product.

A separate 12-case fictional follow-up evaluation found 15 of 47 supported segment/category pairs in the frozen keyword baseline (29 category extras and 32 omissions). The tuned local-rule comparator matched all 47; the Claude API run matched 35, with zero source-quote or speaker mismatches. The local keyword implementation remains an evaluation comparator; consultation drafts in the app use Claude API only. Both sets of labels are author-written, and the local rules were tuned against the same examples, so these results are not held-out evidence or a measure of clinical accuracy. The answer key, transcript-only inputs, and per-case results are listed in [EVALUATION.md](EVALUATION.md).

## Limits and credits

Noticioner is a synthetic engineering prototype, not medical advice or a clinically validated product. It has no comprehensive drug-interaction database, independently measured multilingual accuracy, certified electronic signature, real patient deployment, or measured outcome benefit. A larger independently annotated, held-out evaluation and institutional security review would be needed before considering clinical use.

Built with assistance from [OpenAI Codex](https://openai.com/codex/). Models/tools: [Claude](https://platform.claude.com/docs/en/api/messages/create), the [OpenAI-compatible API](https://platform.openai.com/docs/api-reference/chat), [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), and [FFmpeg](https://ffmpeg.org/). Frameworks/libraries: [Next.js](https://nextjs.org/), [React](https://react.dev/), [Zod](https://zod.dev/), [SQLite](https://sqlite.org/), [PostgreSQL](https://postgresql.org/), [Lucide](https://lucide.dev/), [PDFKit](https://pdfkit.org/), and [Playwright](https://playwright.dev/). Synthetic cases and reference labels are project-authored; no external patient dataset is used. Embedded report fonts and their licenses are credited in [assets/fonts/README.md](assets/fonts/README.md). Dependency versions are recorded in the lockfile.
