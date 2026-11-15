# Shared-practice installation

This is a separate, authenticated workspace at `/practice`. The original SQLite workspace remains an isolated synthetic-data tool. No anonymous SQLite patients are automatically copied into the shared database.

## Configure the server

Use Node 24.8+, PostgreSQL and an organization-managed OpenID Connect provider. Set these environment variables on the server, outside Git:

```dotenv
PRACTICE_ONLY=true
PRACTICE_DATABASE_URL=postgresql://application:password@database:5432/practice
PRACTICE_APP_ORIGIN=https://records.example.org
PRACTICE_OIDC_ISSUER=https://identity.example.org
PRACTICE_OIDC_CLIENT_ID=registered-client-id
PRACTICE_OIDC_CLIENT_SECRET=registered-client-secret
PRACTICE_OIDC_REQUIRED_ACR=organization-approved-mfa-assurance-value
PRACTICE_FILE_KEY=base64-encoded-32-byte-random-key
# Optional, required to admit PDFs (ClamAV-compatible CLI):
PRACTICE_SCANNER_BIN=/opt/homebrew/bin/clamscan
```

Register the exact callback `https://records.example.org/api/practice-auth/callback` with the provider. The provider must support authorization code with PKCE S256 and issue signed ID tokens with the configured authentication assurance (`acr`) value. ACR values are provider-specific: agree one representing your MFA policy with the identity administrator. The token endpoint supports client-secret-post or a public PKCE client without a secret. Do not invent an assurance value or weaken verification to get a login working.

Set `PRACTICE_ONLY=true` for both the build and server runtime. It redirects the root to `/practice` and blocks legacy anonymous API endpoints. Production app origins and identity-provider endpoints require HTTPS. Use database TLS, a dedicated restricted application role, encrypted storage and protected backups in deployment. Use a separate migration credential for DDL. The app does not configure your infrastructure encryption, firewall or identity provider.

```sh
npm ci
npm run practice:migrate
npm run practice:provision -- "Practice name" "https://identity.example.org" "verified-subject" "Practitioner name" reviewer
npm run build
npm start
```

Commands read process environment variables: export the variables in your shell or use your deployment secret manager. Do not assume the standalone scripts automatically load `.env.local`. Obtain the exact immutable subject from the identity provider; do not substitute an email address unless it actually is that provider's subject. Provision each practitioner separately using `clinician`, `reviewer` or `admin`. Provisioning is an operator capability, never a public registration route. Practitioner accounts require active organization membership and patient-level care relationships to read clinical records. Account administrators do not automatically receive patient access.

## Patient access permissions

In a patient's **Care team** tab, an assigned reviewer with edit access can grant **View only** or **Can edit** access, change an existing member's access using the selector, or revoke it. New grants default to View only. Operator administrators can manage the same assignments through the audited grant API without receiving clinical record access themselves.

| Patient permission | Allowed actions |
| --- | --- |
| View only | Read notes, medication history, AI summaries and activity; download available documents. |
| Can edit | All viewing actions, plus add notes/amendments, record medications, upload documents and generate AI drafts. |
| Can edit + reviewer role | Also approve records, verify medication statements and manage care access. |

Permissions are enforced inside server database transactions for every clinical mutation, including rechecks after file processing or AI generation. A view-only reviewer cannot approve records or upgrade their own assignment. Permission changes apply to subsequent requests; already completed downloads cannot be recalled. Approved records remain immutable even for editors.

Run `npm run practice:migrate` before starting the updated app. Migration 003 adds a constrained access level, preserves existing assignments as Can edit (their previous capability), and defaults future database/API grants to View only. Patient creators and their selected reviewers receive explicit edit assignments. Review existing assignments in Care team after migration and downgrade anyone who should only view. These permissions apply per patient; the existing organization roles still control who can create patients and who can review.

The grant endpoint accepts `POST /api/practice/patients/:patientId/grants` with `{ "practitionerId": "...", "accessLevel": "view" }` or `"edit"`. Omitting the level defaults to `"view"`; posting for an existing assignment updates its permission. All changes and rejected clinical writes are audited.

## Uploaded files and summaries

Practitioners with edit access can record in **Notes**, select a spoken language and append a reviewed transcript to an unsaved note. View-only access cannot submit transcription requests. Recording itself can run before transcription is configured; see [RECORDING_LANGUAGES.md](RECORDING_LANGUAGES.md) for languages, Safari permissions and audio setup.

The initial implementation stores bounded, encrypted file payloads in PostgreSQL alongside organization-scoped metadata. This is an intentional first storage implementation; the larger-scale object-storage service in the architecture plan remains a later migration. Backups must include the database and a separately protected file-encryption key. Losing the key loses access to encrypted files; key management and recovery require an operational procedure.

Generate a file key once with `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64"))'` and put the output into `PRACTICE_FILE_KEY` through your secret manager. Never commit the key. Changing the key makes existing files unreadable; coordinated key rotation is not implemented. The encrypted originals use AES-256-GCM; extracted text, notes, medications and summaries rely on infrastructure database/backup encryption.

`PRACTICE_SCANNER_BIN` must be the absolute path of a trusted ClamAV-compatible scanner accepting `--no-summary <file>` and returning zero only for a clean scan. Maintain its signatures separately. Uploads are capped at 5 MB and request bodies are bounded. PDF admission requires a configured trusted antivirus scanner; a missing or failing scanner must not silently admit the file. Text ingestion is constrained to plain UTF-8. PDF originals can be shared after scanning, but automatic PDF text extraction is not implied. AI summaries use supported source text and preserve evidence references. Human review is required; model output does not update a medication list or create a prescription automatically.

## Verification and operational rollout

`npm run test:practice` normally starts an isolated temporary PostgreSQL instance, applies migrations and executes the practice test suite, then removes the database. On hosts where the bundled development binary cannot run, set `PRACTICE_TEST_DATABASE_URL` to a disposable PostgreSQL database bound to loopback; the harness rejects non-loopback URLs. Never point this test variable at a shared or production database. `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` and `npm run test:server` check the rest of the app.

Before migrating an existing workspace, freeze writes and take a consistent SQLite backup. Create an inventory of record counts and IDs; have an authorized person map each browser workspace to a verified organization and each patient to an institution-approved identifier. Keep unmapped records quarantined. Reconcile imported counts, relationships, versions and checksums in staging; rehearse rollback before cutover. An automatic import or demographic-based patient merge is deliberately not included.

Institutional EHR integration, external protected audit export, a durable distributed processing queue, automated retention/legal holds, emergency access, independent penetration testing and disaster-recovery sign-off are separate rollout gates. The implementation does not claim clinical certification or legal compliance. Use synthetic data until these institution-specific gates have been resolved.

## First shared record walkthrough

1. Provision an initial **reviewer** and a second clinician, then sign in as the reviewer at `/practice`.
2. Add a synthetic patient with an organization-approved identifier. The creator receives a care assignment.
3. In Care team, grant the second clinician **Can edit** access. They can now open that patient after signing in, record reported medications, write draft notes and upload allowed documents. Choose **View only** instead when they should only read records and download documents.
4. The assigned reviewer reviews and approves the exact note version. Approved notes are immutable; corrections create amendments.
5. Select approved notes or available text documents in AI summaries, confirm authorization to send them to the configured provider, and generate a draft. Review source quotations and version references before approving. Approved amendments mark summaries based on the old note stale.
6. Revoke the colleague in Care team and verify their next read/download fails. An administrator has no clinical directory; assigned reviewers manage sharing through this interface. Operators can assign care via audited administrative API operations when institutional policy permits.

Database triggers prevent ordinary updates/deletes to approved records, note versions and audit events. This is defense in depth, not an independently protected audit service: a database owner can alter triggers. Use least-privilege runtime credentials and export audits to a separately managed service before clinical rollout.

Clinicians creating a patient must explicitly choose an active practice reviewer; that reviewer receives a care assignment so the record can be reviewed and shared. Reviewers may create records with their own assignment. Directory search runs on the server over all assigned patients, with at most 250 matches per query. Patient sections show recent history (200 notes/medications/documents and 100 summaries), with a visible notice at the limit; full-history pagination/export remains a follow-up. Authentication failures, login and logout are not yet included in the clinical audit table; use identity-provider authentication logs alongside application events until centralized audit integration is implemented.
