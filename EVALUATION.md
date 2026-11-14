# Evaluation methodology and actual results

## Dataset

Eight fully synthetic, development-visible examples in `src/lib/evaluation-data.ts`. They cover short symptoms, missing information, medication ambiguity, corrections, patient diagnostic guesses, complete medication wording, informal language and unknown speakers. Reference source-category pairs and expected review prompts are authored separately from model output. Labels are **not independently or clinically reviewed**. This is not an unbiased held-out benchmark, and the short examples do not represent the breadth or length of real clinical consultations.

## Metrics

Each fact is a `(source segment ID, extraction category)` pair. Sets remove duplicate predictions. A matching reference pair is a true positive; extra pairs are false positives, missing pairs false negatives. Micro precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2PR/(P+R). Zero denominators yield zero by convention. This metric checks categorization/attribution, not paraphrase meaning, SOAP section correctness, diagnosis, factual clinical accuracy or safety.

Evidence attribution accuracy is the share of submitted evidence-category references matching the reference set. Unsupported statement rate counts statements marked Unsupported after quote verification. Exact quotes establish source existence, not semantic entailment. The extractive baseline copies source text, so its zero unsupported rate is expected and does not establish correctness. Structured validity is the fraction of successful accepted outputs. Latency is wall time per example and depends on the environment.

Missing-information/medication/uncertainty prompt precision and recall are calculated separately per example. Medication prompts test missing dose/route/frequency documentation, not interactions or medication safety. Category-level metrics appear in the dashboard after a run. Audio quality, speaker diarization and clinical error detection are not evaluated.

## Measured baseline

Run timestamp (UTC): 2026-11-14T08:13:34.720Z. Reproduce with `npm run evaluate`; JSON artifact: `evaluation-results/baseline.json`.

| Metric | Measured value |
| --- | --- |
| Sample size | 8 |
| Precision | 88.46% |
| Recall | 92.00% |
| F1 | 90.20% |
| False positives | 3 |
| False negatives | 2 |
| Unsupported statement rate | 0.00% |
| Evidence attribution accuracy | 88.46% |
| Structured validity | 100.00% |
| Mean processing latency | 0.118 ms |

| Category | Precision | Recall | F1 | FP | FN |
| --- | --- | --- | --- | --- | --- |
| complaint | 100.0% | 80.0% | 88.9% | 0 | 1 |
| duration | 75.0% | 100.0% | 85.7% | 1 | 0 |
| followup | 100.0% | 80.0% | 88.9% | 0 | 1 |
| allergy | 100.0% | 100.0% | 100.0% | 0 | 0 |
| examination | 100.0% | 100.0% | 100.0% | 0 | 0 |
| assessment | 100.0% | 100.0% | 100.0% | 0 | 0 |
| medication | 100.0% | 100.0% | 100.0% | 0 | 0 |
| other | 50.0% | 100.0% | 66.7% | 2 | 0 |

## Failure examples

- Correction: the baseline retains the earlier “three days” statement even after an explicit correction to “yesterday”; it produces one extra duration fact.
- Informal language: “My head is pounding” and “Please come back next Tuesday” are not recognized by the narrow complaint/follow-up keyword rules. These cause two false positives and two false negatives.
- A zero pair-matching error on a case does not establish that the note would be clinically appropriate. No unsupported claim of superiority is made.

## AI results

Live Claude run (claude-sonnet-5-5) on 2026-11-14T13:15:53.687Z: precision 92.31%, recall 96.00%, F1 94.12%; 2 false positives and 1 false negative across eight synthetic examples. Full results: `evaluation-results/ai.json`. All eight outputs passed structured validation. This is one run on a development-visible set, not a claim of general superiority or clinical accuracy.

A separate live smoke check used one unlabeled nurse/patient paragraph. Claude assigned symptom/history statements to Patient and temperature/follow-up statements to Nurse; all were marked Inferred and required speaker review. This is not a speaker-attribution benchmark.

## Next validation work

Have independent reviewers annotate a larger, genuinely held-out dataset; assess factual entailment, SOAP placement, corrections, uncertainty and medication documentation separately. Add long encounters, audio transcripts, noise and multiple speakers before making any reliability claim. Do not tune and report on the same dataset as evidence of generalization.
