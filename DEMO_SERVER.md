# Sample hospital demonstration

This is a local-only sample server for showing doctor sign-in and shared patient records. It uses a separate persistent PostgreSQL database, a small demonstration OIDC identity service, and the application's actual session and care-permission checks. Only synthetic records are seeded.

## Start and open

With Node.js 24.8+ and dependencies installed:

```sh
npm run build
npm run demo:server
```

Alternatively, run `./scripts/demo-start.sh` from this checkout. It can use the Codex bundled Node runtime when Node is not on PATH, and builds the app if no production build exists. Rebuild after application changes. The runner reads `.env.local` for existing optional AI/audio settings, then overrides practice configuration inside its own process; it does not rewrite that file.

On macOS, double-click **Start Noticioner.command** in the project root to start both the personal site (`127.0.0.1:3000`) and this doctor demonstration (`127.0.0.1:3109`), then open both pages automatically. The launcher reuses already-running Noticioner workspaces and leaves its Terminal window open so you can stop services with Control-C.

The demo uses an isolated PostgreSQL cluster in `data/practice/demo/`. When Homebrew is available, the launcher ensures `postgresql@18` is installed and the demo uses its signed native binaries. This avoids macOS code-signing blocks on the bundled database binary. Without Homebrew, the demo falls back to `embedded-postgres`.

Open **http://127.0.0.1:3109/doctor**. Click **Sign in with organization**, then use one of these deliberately public sample credentials:

| Account | Name | Access to Alex's sample record |
| --- | --- | --- |
| `reviewer@demo.local` | Dr Maya Chen | Edit, approve and manage care assignments |
| `doctor@demo.local` | Dr Daniel Lim | Add notes, medication statements, documents and AI drafts |
| `viewer@demo.local` | Dr Aisha Rahman | View and download; no clinical changes or approval |

Password for all accounts: **`DemoDoctor!2026`**. Simulated verification code: **`123456`**. The code is displayed on the sample identity screen; this is a demonstration step, not real MFA. The view-only assignment is patient-specific. These accounts have clinician organization roles; creating a separate synthetic patient remains governed by the existing organization policy.

## Suggested walkthrough

1. Sign in as the reviewer. Open **Alex Tan (synthetic)**. Show the approved note and review draft, medication provenance, encrypted referral document and clearly labeled prewritten summary fixture. **Priya Kumar (synthetic)** is assigned only to the reviewer, demonstrating filtered directories.
2. Use **Care team** to show the colleague's editing assignment and Aisha's view-only assignment. Changes here take effect on subsequent requests.
3. Sign out and sign in as `viewer@demo.local`. Open Alex's record; editing, approval, recording and sharing actions are unavailable. Direct write requests are denied by the server.
4. Sign in as `doctor@demo.local` to demonstrate adding a draft note or recording/transcription. AI generation and translation use the configured provider when available; seeded summaries are explicit prewritten fixtures and are not presented as live AI output.

## Local services and persistence

- App: `127.0.0.1:3109`; root redirects to the doctor portal.
- Sample OIDC service: `127.0.0.1:4111`.
- Embedded PostgreSQL: `127.0.0.1:55433`.
- Persistent demo state: ignored `data/practice/demo/`, including the database, file-encryption key and random service credentials. The local secrets file is created with owner-only permissions. No real hospital database URL is used.

Press **Ctrl+C** in the runner to stop all three services. Synthetic records and any demonstration edits remain for the next start; seeding is idempotent and does not overwrite changed care grants. To start fresh, stop the runner and move the entire dedicated demo folder aside before restarting. Do not point this runner at an existing hospital database. If a port is occupied, stop the prior local demo instance before starting another.

## Isolation and identity behavior

The demo binds to loopback and validates Host headers. Anonymous legacy workspace endpoints are blocked in this process. HTTP identity transport is permitted only with explicit `PRACTICE_DEMO=true`, shared-only mode, loopback origins and the dedicated `urn:noticioner:demo` assurance value. Ordinary deployments retain their HTTPS requirements. Do not publish, tunnel or use this sample identity service for patient records.

The demo exercises authorization-code login, S256 PKCE, state, nonce, short-lived single-use authorization codes, signed RS256 ID tokens, issuer/audience checks, hashed app sessions and database membership/care permissions. Sample login forms check their origin and a flow-bound CSRF token, cap request size and login attempts, and validate exact callback URLs. Real institutional identity integration remains a separate setup path.

## Verification

The real browser login tests run without mocking the identity provider or practice APIs:

```sh
RUN_DEMO_LOGIN=true TEST_BASE_URL=http://127.0.0.1:3109 TEST_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/e2e/demo-login.spec.ts
```

All three passed: incorrect-password rejection followed by reviewer login, seeded record/download access and logout; distinct editing versus patient-view-only permissions; rejection of external callback URLs and unauthenticated token requests. Clean shutdown and a restart preserving the database were also exercised. General tests: 44 passed, 2 database-specific tests skipped in that runner. Isolated PostgreSQL tests: 8 passed. Lint, typecheck and production build passed.

End-of-round read-only subagent review: **8.3/10**, no blockers for the local synthetic demonstration (functionality 8.5, UX 8.1, architecture 8.4, security 8.2). Its suggestions to preserve the submitted email after a failed login and clarify patient-level viewing access were incorporated.
