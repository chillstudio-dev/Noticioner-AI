# Noticioner AI

Clinician-reviewed documentation for fictional continuing-care visits. Record or paste a conversation, generate a source-linked SOAP draft, inspect Trust Engine findings, edit and review with a rationale, then approve. Diagnostic and prescribing decisions remain with the clinician. This synthetic prototype has no clinical validation or measured time-saving claim.

**Submission write-up:** [WRITEUP.md](WRITEUP.md). **Current implementation and verification:** [TRUST_IMPLEMENTATION.md](TRUST_IMPLEMENTATION.md).

The app opens directly: **no account, password, access code, or demo mode**. Each browser gets an isolated workspace behind the scenes. New workspaces are empty; add a fictional patient to begin. This is a research prototype using synthetic data, not a clinical product.

## Trust Engine and patient summaries

Both workspaces use the same deterministic audit and optional provider verifier: EvidenceGuard, documentation gaps, consistency checks, and a limited synthetic allergy/medication rule set. Quotes establish text existence; a semantic “supported” result does not certify clinical correctness. Provider failure retains a valid draft with visible “not checked” findings. Review-required findings begin open, and each disposition requires a rationale. Note edits rerun checks and reset dispositions. Source/context changes and stale request versions block saving or approval.

After approving a clinical note, open **Patient-friendly summaries** in the personal note or **Patient summaries** in the practice tabs. Consent to provider processing, generate from one approved note, edit paragraphs and their exact supporting quotes, review findings, then approve. Copy/print are enabled after approval. There is no automatic sending or patient portal.

**AI Evaluation** includes the original eight extraction cases, a separate 12-case follow-up fidelity suite, and Trust Quality. Shared **Quality · synthetic evaluation** works without selecting a patient. The deterministic Trust suite has 24 cases; the optional provider suite has eight fixed drafts. Results show TP, FP, FN, precision, recall, F1, latency, errors, versions, and case-level details. The 12-case transcript inputs are stored separately from their gold answers. See [EVALUATION.md](EVALUATION.md) for measurements and limits.

SQLite migrations apply only newer numbered files in individual rollback-safe transactions. PostgreSQL migrations run under the existing advisory lock. Patient summaries are separate derivative records; approved source notes remain unchanged.

## Shared practice records

To demonstrate doctor sign-in locally, run `./scripts/demo-start.sh` and open **http://127.0.0.1:3109/doctor**. This starts an isolated sample hospital, identity service and PostgreSQL database with synthetic records. Sample credentials and the walkthrough are in [DEMO_SERVER.md](DEMO_SERVER.md).

The `/doctor` portal provides organization sign-in and opens the shared `/practice` workspace. It reuses the organization OIDC account and requires provisioning; it does not create an anonymous doctor account. The separate `/practice` workspace adds PostgreSQL records, organization OIDC sign-in with an MFA assurance requirement, patient care assignments, shared documents, medication provenance, and reviewed AI summaries. Follow [PRACTICE_SETUP.md](PRACTICE_SETUP.md) for configuration and [HOSPITAL_DATA_ARCHITECTURE.md](HOSPITAL_DATA_ARCHITECTURE.md) for the implementation scope and rollout plan. Set `PRACTICE_ONLY=true` at build and runtime for a shared-only deployment. The anonymous behavior described below applies to the original synthetic SQLite workspace.

## Run from this repository

Requires Node.js 24.8+ and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. SQLite creates its schema automatically. No environment file is required to explore the workspace, use the labeled keyword baseline, review notes, run baseline evaluation or export PDFs.

For the actual AI features, copy `.env.example` to `.env.local` and supply your own provider credential. Credentials are server-only and are deliberately excluded from Git. The repository cannot distribute the author's private API key.

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key-here
CLAUDE_MODEL=claude-sonnet-5-5
```

Restart after changing configuration. OpenAI-compatible generation is also supported with `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` and `AI_MODEL`. See `.env.example` for optional endpoint and audio settings.

## Judge walkthrough

1. Open Patients → Add synthetic patient. Enter a fictional name and date of birth.
2. Open Overview → Start new consultation, choose the patient, and create the record.
3. Paste a conversation or record and transcribe audio. Speaker labels are optional. Save the transcript.
4. Choose the configured AI provider and Generate draft. Speaker badges distinguish explicit labels, inferred roles and unknown roles. The original text remains unchanged.
5. Click a source reference. Compare the quote with the draft, edit if needed, and address review prompts.
6. Review & approve explicitly, then Export PDF. Approved records become read-only.
7. Open AI Evaluation to run the synthetic benchmark; Analytics reflects actual workspace activity.

Use [JUDGE_GUIDE.md](JUDGE_GUIDE.md) for an unlabeled test conversation and a concise code map. Recorded source text need not be manually split between nurse and patient. The model infers roles from conversational context; it is not identifying voices or people from audio. Ambiguous roles remain unknown, and inferred roles require review.

## Transcript translation and report PDFs

Choose **Translate transcript** beside the source editor, select a target language and authorize provider processing. The reviewed source is retained; translations are separate, unreviewed previews and can be copied without overwriting the original. PDF exports preserve paragraph breaks, wrap long text, paginate automatically and embed fonts for the supported languages. See [DOCTOR_PORTAL_TRANSLATION.md](DOCTOR_PORTAL_TRANSLATION.md) for scope and verification.

## Optional local multilingual audio — no transcription key

Install [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and FFmpeg, then download the multilingual model:

```sh
# macOS with supported Homebrew
brew install whisper.cpp ffmpeg
npm run setup:transcription
```

Set `STT_PROVIDER=local`, then restart. `LOCAL_WHISPER_BIN`, `LOCAL_WHISPER_MODEL` and `FFMPEG_BIN` can specify paths. The setup script verifies the model checksum. Build instructions for other systems are in the whisper.cpp project. Models and native binaries are not committed.

Local mode handles English, French, Mandarin, Malay, Japanese, Korean, Spanish, Tamil and Danish recordings up to three minutes, one at a time. Choose Spoken language before recording. Capture, playback and download remain available even when transcription needs setup. In the shared practice workspace, editors can record in Notes; view-only practitioners cannot submit audio for transcription. See [RECORDING_LANGUAGES.md](RECORDING_LANGUAGES.md) for Safari permissions, setup and scope. Temporary audio is removed after processing. Audio is processed on the app server with no cloud fallback. Claude receives saved text only when generating a note. For a cloud transcription API, use `STT_PROVIDER=openai` with `STT_API_KEY`, `STT_BASE_URL` and `STT_MODEL`.

## Checks and evidence

```sh
npm run lint
npm run typecheck
npm test
npm run test:practice
npm run build
npm run test:server
npm run evaluate
npm run evaluate:12-case
npm run evaluate:trust
# Uses the configured provider and incurs its normal API usage:
npm run evaluate -- --ai
npm run evaluate -- --trust-ai
```

GitHub Actions runs lint, type checking, unit/integration tests, production build and isolated server workflow tests. Browser tests are available with `npm run test:e2e` after installing Playwright Chromium and starting the server. See [TRUST_IMPLEMENTATION.md](TRUST_IMPLEMENTATION.md) for current checks. Earlier review reports are historical snapshots.

Measured evaluation artifacts are in `evaluation-results/`. Eight synthetic development-visible cases test source-category matching, not clinical accuracy or voice identification. Definitions and failures are in [EVALUATION.md](EVALUATION.md).

## Architecture and deployment

Next.js App Router, React, TypeScript, Zod, Node SQLite, PostgreSQL, Lucide, responsive SVG charts and PDFKit with embedded Noto fonts. [ARCHITECTURE.md](ARCHITECTURE.md) describes the source validation, persistence and revision checks; [SECURITY.md](SECURITY.md) describes access boundaries; [LIMITATIONS.md](LIMITATIONS.md) describes what is not established.

`npm run build && npm start` starts the production app without an entry code. Use a persistent Node server and a durable SQLite volume. GitHub Pages cannot execute this server application. No hosted deployment is included in this submission. Docker is supplied but has not been verified in this environment.

## Attribution

Built with assistance from OpenAI Codex. Synthetic examples and reference labels were authored for this project and have not been independently reviewed. Fonts: DM Sans and Manrope via Fontsource (OFL-1.1); icons: Lucide. Native Claude integration follows the [Messages API](https://platform.claude.com/docs/en/api/messages/create) and [structured output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Dependency versions are locked in `package-lock.json`.
