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

The existing extraction benchmark contains eight synthetic cases. The stored earlier Claude run recorded 2 false positives and 1 false negative, compared with 3 and 2 for the keyword baseline. These are source-category matching results, not clinical accuracy.

For Trust Engine version `trust-1.4.0`, 24 deterministic fixtures produced 15 matched findings, 0 extras, and 0 misses. Regression checks also cover unrelated duration mentions, numeric duration answers, sleep length, nonclinical appointments and reviews, dated clinical follow-ups, historical visits, provider types, and imaging plans. The previously recorded eight-case provider-backed run used version `trust-1.0.0` and model identifier `claude-sonnet-5-5`: 5 matched findings, 2 extras, 0 misses, and 0 provider errors. Precision was 71.43%, recall 100%, and F1 83.33%. Its measured audit time was 24.63 seconds. This provider result predates the deterministic gap-rule corrections and was not rerun.

A concrete provider failure: the verifier repeated an existing cough contradiction and allergy conflict under different target labels. The strict case/category/target matcher counted those duplicates as two extra findings. A code review also found that a future review interval could hide a missing symptom duration, while a historical “regular follow-up visit” could hide the absence of a future plan. Version 1.1.0 now distinguishes those cases; focused regression tests cover both. The local rules remain narrow, so absence of a warning does not establish safety. All fixtures are author-written, development-visible, and not independently or clinically reviewed. [Evaluation methodology and artifacts](EVALUATION.md) explain the counting rules; [verification evidence](TRUST_IMPLEMENTATION.md) records the software checks.

## Implementation-stage scorecard

These are conservative self-assessments against the stated project gates, not hackathon judge scores or an independent clinical review.

| Area | Score | Evidence and reason |
| --- | ---: | --- |
| Evaluation fidelity | 7.0 / 10 | The frozen baseline captured 15/47 expected pairs; the tuned final run captured 47/47, with no measured quote-link, negation, correction, uncertainty, speaker, or SOAP-placement errors. However, the 12-case set is author-written and was used to tune the rules; the separate provider Trust run had 2 false positives, and neither suite establishes semantic generalization. See [EVALUATION.md](EVALUATION.md) for per-case results and limits. |
| App readiness | 8.0 / 10 | The production build, HTTP workflow, all routes, 98/98 unit/integration tests, 18 browser tests, and responsive screenshots passed. A fresh PostgreSQL 18.7 instance verified all four migrations and the shared-practice integration suite (10/10). Shared-practice browser tests still mock the API, three optional demo identity tests were skipped, and the bundled macOS PostgreSQL binary remains unusable under the host's code-signing policy. See [TRUST_IMPLEMENTATION.md](TRUST_IMPLEMENTATION.md). |

Both scores remain below the 9.5/10 aspiration. The main reasons are limited independent evaluation, mocked shared-workspace browser checks, and the gap between this prototype and institution-specific operational review; a perfect synthetic-set match does not prove a perfect product.

A separate 12-case fictional follow-up evaluation found 15 of 47 supported segment/category pairs in the frozen keyword baseline (29 category extras and 32 omissions). After targeted local rule changes, all 47 pairs matched through the personal workspace API, with no source-link or SOAP-placement errors. Those rules were tuned against these same author-written examples, so the 100% in-set match is not held-out evidence or a measure of clinical accuracy. The answer key and transcript-only test inputs are separate; the complete per-case results are in [EVALUATION.md](EVALUATION.md).

## Limits and credits

Noticioner is a synthetic engineering prototype, not medical advice or a clinically validated product. It has no comprehensive drug-interaction database, independently measured multilingual accuracy, certified electronic signature, real patient deployment, or measured outcome benefit. A larger independently annotated, held-out evaluation and institutional security review would be needed before considering clinical use.

Built with assistance from [OpenAI Codex](https://openai.com/codex/). Models/tools: [Claude](https://platform.claude.com/docs/en/api/messages/create), the [OpenAI-compatible API](https://platform.openai.com/docs/api-reference/chat), [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), and [FFmpeg](https://ffmpeg.org/). Frameworks/libraries: [Next.js](https://nextjs.org/), [React](https://react.dev/), [Zod](https://zod.dev/), [SQLite](https://sqlite.org/), [PostgreSQL](https://postgresql.org/), [Lucide](https://lucide.dev/), [PDFKit](https://pdfkit.org/), and [Playwright](https://playwright.dev/). Synthetic cases and reference labels are project-authored; no external patient dataset is used. Embedded report fonts and their licenses are credited in [assets/fonts/README.md](assets/fonts/README.md). Dependency versions are recorded in the lockfile.
