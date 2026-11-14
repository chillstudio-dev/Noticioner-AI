# Judge guide

Run the repository using README.md. No application login or access code is required. The baseline works without credentials; real AI calls require your own server-side provider key.

## Unlabeled conversation to try

Paste this as one paragraph, without inserting speaker labels:

> Hello, I am the nurse looking after you today. What brings you in? I have had a headache for two days. Do you have any allergies? I am not sure whether I have any allergies. Are you taking regular medication? No, I take no regular medications. I have checked your temperature; it is 36.8 degrees Celsius. We will arrange a review tomorrow.

The observed live Claude run attributed symptoms/history to Patient and the temperature/follow-up to Nurse. All assignments were labeled Inferred and a speaker-review prompt was created. A model may vary across runs. The allergy uncertainty should remain visible, and no diagnosis should be invented.

## Code map

| Area | Files |
| --- | --- |
| Interface and state | `src/app/page.tsx`, `src/components/recorder.tsx`, `src/components/ui.tsx` |
| Server workflow and authorization | `src/app/api/[...path]/route.ts` |
| Schema, evidence checking, baseline, review rules | `src/lib/clinical.ts` |
| Claude and compatible APIs | `src/lib/provider.ts` |
| Local speech recognition | `src/lib/local-transcription.ts` |
| SQLite and immutable note versions | `src/lib/db.ts`, `migrations/001_initial.sql` |
| PDF generation | `src/lib/pdf.ts` |
| Evaluation and reference labels | `src/lib/evaluation.ts`, `src/lib/evaluation-data.ts` |
| Regression checks | `tests/`, `.github/workflows/ci.yml` |

The main page remains a large component; further view extraction would help maintainability. The project prioritizes a working, reviewable pipeline with explicit failure handling over pretending to have production clinical validation.

## Suggested inspection

Check an unlabeled conversation; inspect a quote; edit a note; resolve flags; approve; export; reopen; run evaluation; inspect false positives and negatives. Empty inputs, invalid dates, stale edits and cross-workspace access are rejected server-side. Deleting a workspace creates a fresh empty workspace when the app opens again.

This guide is a testing aid in the repository, not a built-in demo or prewritten AI output.
