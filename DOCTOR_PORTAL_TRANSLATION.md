# Doctor portal, transcript translation and report layout

Updated 15 November 2026. Initial implementation for synthetic data; local changes only.

## Doctor access

Open `/doctor` from **Doctor login** in the personal-workspace sidebar. The portal checks the real practice session, offers organization sign-in when configured, and directs authenticated practitioners to shared records. It uses the existing OIDC/MFA/session system and patient-specific view/edit permissions. There is no separate password store or demo impersonation. Unconfigured or unreachable identity services are shown explicitly; retries clear any stale signed-in display.

This machine's hospital database and OIDC connection are not configured. Administrators must complete [PRACTICE_SETUP.md](PRACTICE_SETUP.md), provision verified identities, and assign care access before doctor login works. The portal interface is available now; a successful hospital login was not claimed or tested against a live organization provider.

A separate local sample hospital is now available for demonstrating the complete login flow; see [DEMO_SERVER.md](DEMO_SERVER.md). It uses isolated synthetic records and a clearly labeled demo identity provider, rather than the institution's production configuration.

## Source-preserving translation

In a personal consultation, use **Translate transcript** below the source editor. In shared records, editors can translate their unsaved note/transcription in **Notes**. Select any of the nine supported languages and authorize sending the displayed text to the configured AI provider. The original text remains unchanged. The result is a separate, clearly labeled unreviewed translation with model provenance and a copy action. Changing the source hides an obsolete translation and asks for regeneration. Translations are not automatically saved as notes, substituted for evidence, approved or included in report exports.

The provider is instructed to preserve paragraph breaks, speaker roles, negation, numbers, units, medication names and dosages without adding clinical facts. Output must be valid structured JSON, complete, nonempty and bounded. These checks do not establish translation fidelity. A qualified person must compare the draft with the original before using it.

Personal translation requires an owned consultation and checks its revision again after generation. Shared translation requires an active membership and patient edit access both before provider disclosure and before returning the result. View-only practitioners cannot use the shared translation API. Source-disclosure and completion events are audited without storing text in the audit history. The original record and approval state are never mutated by translation.

## PDF fixes

Report generation now uses PDFKit with bundled OFL-licensed Noto fonts for Latin, Tamil and CJK/Korean text. It preserves paragraphs and native-script glyphs, shapes script runs, wraps long words, and flows long content across A4 pages. Titles, patient details, note sections, provenance, review details and page footers have consistent margins and spacing. Footer placement avoids blank trailing pages and content collisions. The export preserves existing synthetic-data disclosures and approval/version metadata.

Fonts and their licenses are in `assets/fonts`; the Next.js build traces those assets for API deployment. Export does not fetch fonts or send report contents to a provider. Unsupported languages or uncommon symbols outside the bundled coverage still need visual review.

## Verification

- Lint, typecheck and production build passed.
- General unit/integration runner: 43 passed, 2 database-only tests skipped there.
- Isolated PostgreSQL runner: all 7 passed, including translation success, view-only denial and downgrade during generation preventing result disclosure.
- Browser runner: all 12 passed for portal configuration/authentication states, source-preserving translation and stale-preview handling, recording, and care permissions. Sign-in/API responses for the new UI scenarios are mocked; this is not a live OIDC validation.
- Production HTTP runner: all 3 passed, including report export from the built application.
- Live Claude smoke check: one short synthetic French-to-English transcript preserved negation and the stated `5 mg` value. This is connectivity evidence, not a clinical accuracy benchmark.
- PDF QA: one-page short and multilingual reports plus all four pages of a long report were rendered with Poppler and visually inspected. Text extraction verified Latin, Chinese, Japanese, Korean and Tamil content. All extracted text stayed within horizontal margins. A representative synthetic report is in `output/pdf/multilingual-report-example.pdf`.
- End-of-round read-only review subagent: **8.4/10** overall (functionality 8.4, UX/interface 8.2, architecture/security 8.4, PDF layout 8.7), no blockers for this scope. Its two robustness suggestions—normalizing malformed provider responses and clearing stale portal sessions—were incorporated.
