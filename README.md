# CliniScribe AI

Clinical documentation project for the Veritas AI hackathon. Record or paste a conversation, generate a SOAP draft, inspect its sources and inferred speaker roles, review uncertainty, and export a PDF.

The app opens directly: **no account, password, access code, or demo mode**. Each browser gets an isolated workspace behind the scenes. New workspaces are empty; add a fictional patient to begin. This is a research prototype using synthetic data, not a clinical product.

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

## Optional local audio — no transcription key

Install [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and FFmpeg, then download the English model:

```sh
# macOS with supported Homebrew
brew install whisper.cpp ffmpeg
npm run setup:transcription
```

Set `STT_PROVIDER=local`, then restart. `LOCAL_WHISPER_BIN`, `LOCAL_WHISPER_MODEL` and `FFMPEG_BIN` can specify paths. The setup script verifies the model checksum. Build instructions for other systems are in the whisper.cpp project. Models and native binaries are not committed.

Local mode handles English recordings up to three minutes, one at a time. Temporary audio is removed after processing. Audio is processed on the app server with no cloud fallback. Claude receives saved text only when generating a note. For a cloud transcription API, use `STT_PROVIDER=openai` with `STT_API_KEY`, `STT_BASE_URL` and `STT_MODEL`.

## Checks and evidence

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:server
npm run evaluate
# Uses the configured provider and incurs its normal API usage:
npm run evaluate -- --ai
```

GitHub Actions runs lint, type checking, unit/integration tests, production build and isolated server workflow tests. Browser tests are available with `npm run test:e2e` after installing Playwright Chromium and starting the server, but were not run in the authoring session because local browser access was blocked. See [QUALITY_REPORT.md](QUALITY_REPORT.md) for verified outcomes, remaining limits and the self-assessment.

Measured evaluation artifacts are in `evaluation-results/`. Eight synthetic development-visible cases test source-category matching, not clinical accuracy or voice identification. Definitions and failures are in [EVALUATION.md](EVALUATION.md).

## Architecture and deployment

Next.js App Router, React, TypeScript, Zod, Node SQLite, Lucide, Recharts and pdf-lib. [ARCHITECTURE.md](ARCHITECTURE.md) describes the source validation, persistence and revision checks; [SECURITY.md](SECURITY.md) describes access boundaries; [LIMITATIONS.md](LIMITATIONS.md) describes what is not established.

`npm run build && npm start` starts the production app without an entry code. Use a persistent Node server and a durable SQLite volume. GitHub Pages cannot execute this server application. No hosted deployment is included in this submission. Docker is supplied but has not been verified in this environment.

## Attribution

Built with assistance from OpenAI Codex. Synthetic examples and reference labels were authored for this project and have not been independently reviewed. Fonts: DM Sans and Manrope via Fontsource (OFL-1.1); icons: Lucide. Native Claude integration follows the [Messages API](https://platform.claude.com/docs/en/api/messages/create) and [structured output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Dependency versions are locked in `package-lock.json`.
