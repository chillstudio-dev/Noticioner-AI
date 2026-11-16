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

Latest live Claude run (`claude-sonnet-5-5`) on 2026-11-15T21:16:34Z: 24 true positives, 1 false positive, and 1 false negative across eight synthetic examples (96.00% precision, recall, and F1). All eight outputs passed structured validation; unsupported rate was 0%, evidence accuracy was 96%, and mean latency was 2.86 seconds. The only category mismatch was the patient diagnostic guess in E5 (`other` expected, `history` predicted). Full results: [`evaluation-results/ai.json`](evaluation-results/ai.json). This is one run on a development-visible set, not a claim of general superiority or clinical accuracy.

A separate live smoke check used one unlabeled nurse/patient paragraph. Claude assigned symptom/history statements to Patient and temperature/follow-up statements to Nurse; all were marked Inferred and required speaker review. This is not a speaker-attribution benchmark.

## Next validation work

Have independent reviewers annotate a larger, genuinely held-out dataset; assess factual entailment, SOAP placement, corrections, uncertainty and medication documentation separately. Add long encounters, audio transcripts, noise and multiple speakers before making any reliability claim. Do not tune and report on the same dataset as evidence of generalization.

## Trust Engine suites — 15 November 2026

The extraction suite above remains separate. New extraction JSON includes `suite: extraction` and `suiteVersion: extraction-1`; historical JSON without `suite` is interpreted as extraction. Trust results use `suite: trust`, `suiteVersion: synthetic-author-1`, and the current deterministic rules identify themselves as `checkerVersion: trust-1.4.0`.

`src/lib/trust-fixtures.ts` contains **24 deterministic fixtures**, six each for evidence, documentation gaps, consistency, and limited synthetic safety. Positive, negative, and ambiguous cases are included. The optional provider-backed suite selects **eight fixed authored drafts**, two per category; it audits these drafts directly and never calls note generation. There is at most one audit call per case, sequentially, with a 60-second request timeout and no automatic retry. All cases are synthetic, development-visible and not independently or clinically reviewed.

A result key is `(case ID, finding category, target statement/source)`. A matching expected key is TP; an extra or incorrectly categorized/targeted key is FP; an expected key absent from the output is FN. Duplicates of the exact same key are deduplicated; different target keys remain extras. The per-category and overall dashboard metrics use these keys. Precision = TP/(TP+FP), recall = TP/(TP+FN), F1 = 2PR/(P+R), with zero denominators reported as zero. Supported and not-checked evidence statuses are not detected issues. Provider errors are recorded separately per case; expected findings absent after failure still count as FN. Failed cases are never counted as completed successes.

| Run | Cases | TP | FP | FN | Precision | Recall | F1 | Provider errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Deterministic Trust `trust-1.4.0` | 24 | 15 | 0 | 0 | 100% | 100% | 100% | 0 |
| Provider-backed Trust `trust-1.0.0` | 8 | 5 | 2 | 0 | 71.43% | 100% | 83.33% | 0 |

Provider run: `anthropic / claude-sonnet-5-5`, completed `2026-11-15T14:57:27.328Z`; summed case latency **24,630 ms**. These are one run's results for the configured model identifier, not an independent model benchmark. Inspect [local results](evaluation-results/trust-deterministic.json) and [provider results](evaluation-results/trust-ai.json) for per-category counts and case details.

**Observed failure:** cases `c1` and `s1` each acquired a duplicate semantic concern under a different target (`cough` and `allergy`). Both were counted as FP. Passing the local suite means the authored rule examples behaved as expected; it does not imply general semantic understanding, clinical accuracy, broad allergy coverage, safe medication use, saved time, or improved outcomes.

Personal history remains in `evaluation_runs`. Organization history is in `practice_quality_runs`; `/api/practice/quality` authorizes an active clinician/reviewer and evaluates fixtures only, without selecting or loading patients. The browser supports cancellation and shows elapsed progress; case-level results are returned on completion. Cancelled provider suites record remaining cases as errors where the server can finish persistence; a disconnected browser may need to reload history.

Reproduce local suites with `npm run evaluate`. Use `npm run evaluate -- --trust-ai` for the eight provider checks with explicitly configured credentials and synthetic-data processing consent. `--ai` retains the original extraction run. No provider result is fabricated when configuration or a request fails.

## 12-case continuing-care fidelity suite — 16 November 2026

The separate suite `evaluation/noticioner-12-case-evaluation.json` contains **exactly 12** fictional primary-care follow-ups for people managing an ongoing condition. The suite covers straightforward symptoms/history, explicit negation, a correction, uncertain medication details, a patient diagnostic guess, a clinician observation, an aloud follow-up plan, an unknown speaker, and plausible details that were not stated. It has 44 ordered transcript segments and 47 gold facts. The gold JSON includes exact quotes, category, SOAP section, speaker, certainty, normalization, forbidden inferences and grounded review prompts.

The model-input file `evaluation/transcript-inputs-12.json` contains only case IDs and transcript segments. The validator regenerates it from the gold artifact after checking the 12-case count, ordered segment IDs, complete scenario coverage, every exact quote, source speakers, required fields, prompt grounding and separation from the answer key. Run `npm run evaluate:12-case` to validate the files, compare a frozen copy of the original local keyword baseline with the local-rule comparator, and write both results. A separate live Claude run went through the built personal-workspace HTTP API using only this transcript-input file; all 12 drafts remained `Needs Review`. The Claude-only UI/API path and the local comparator are distinct evaluation paths.

### Exact segment/category results

The match key is `(case ID, cited transcript segment ID, extraction category)`. This measures segment/category capture, not semantic paraphrase quality or clinical correctness. The frozen baseline is checked against actual pre-change app outputs on unchanged source segments before it is extended to the complete 44-segment suite. The final gold review clarified C06's ongoing-condition context, so its changed segment is not compared with the earlier text; the other 35 original segments are checked for equality.

| Run | Supported pairs | Correct | Category extras | Missing pairs | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen local keyword baseline v1 | 47 | 15 | 29 | 32 | 34.09% | 31.91% | 32.97% |
| Final local rules through personal API | 47 | 47 | 0 | 0 | 100% | 100% | 100% |
| Claude API through personal API (`claude-sonnet-5-5`) | 47 | 35 | 10 | 12 | 77.78% | 74.47% | 76.09% |

The live Claude run completed at `2026-11-15T21:18:37Z`; raw output is [`evaluation-results/noticioner-12-final-http.json`](evaluation-results/noticioner-12-final-http.json) and the score is [`evaluation-results/noticioner-12-final-http-score.json`](evaluation-results/noticioner-12-final-http-score.json). It returned 45 statements with 45 exact source quotes, zero quote-link errors, and zero speaker mismatches. It had one overconfident capture of an uncertain fact, one lost negation across 11 negation-bearing segments, no lost active numeric details, no stale corrected duration, no forbidden-detail matches, and one SOAP placement error. All 12 notes remained pending clinician review.

The scorer also flags a statement when its normalized claim text is not a literal substring of the cited transcript. It flagged 41 of 45 statement texts in this run. This is a strict lexical mismatch count, not a semantic determination that 41 claims are unsupported; paraphrases can trigger it. Exact quote links establish source-text existence, not whether the quote entails the generated claim. The separate overconfidence, negation, and SOAP checks above are rule-based checks against this author-written answer key.

Separate integrity checks on the final API run found 47/47 source links resolving to an exact quote, 0 source-link errors, 0 speaker errors, 0 overconfident captures of facts labeled uncertain, 0 lost negations across 11 source segments, 0 lost numeric details across 8 active numeric segments, no stale corrected duration, and no SOAP section errors. One numeric segment was intentionally superseded by the explicit correction and is not counted as a loss. The baseline retained that superseded duration and produced two SOAP placement errors.

| Case | Baseline TP / facts | Baseline FP | Baseline FN | Final TP / facts | Final FP | Final FN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C01 | 1 / 4 | 2 | 3 | 4 / 4 | 0 | 0 |
| C02 | 2 / 6 | 2 | 4 | 6 / 6 | 0 | 0 |
| C03 | 1 / 2 | 2 | 1 | 2 / 2 | 0 | 0 |
| C04 | 1 / 4 | 3 | 3 | 4 / 4 | 0 | 0 |
| C05 | 1 / 5 | 3 | 4 | 5 / 5 | 0 | 0 |
| C06 | 1 / 3 | 2 | 2 | 3 / 3 | 0 | 0 |
| C07 | 1 / 4 | 3 | 3 | 4 / 4 | 0 | 0 |
| C08 | 2 / 4 | 2 | 2 | 4 / 4 | 0 | 0 |
| C09 | 2 / 4 | 2 | 2 | 4 / 4 | 0 | 0 |
| C10 | 2 / 4 | 2 | 2 | 4 / 4 | 0 | 0 |
| C11 | 1 / 4 | 3 | 3 | 4 / 4 | 0 | 0 |
| C12 | 0 / 3 | 3 | 3 | 3 / 3 | 0 | 0 |

The observed baseline failures led to focused changes: symptom recognition and duration extraction, classification of spoken follow-up plans, correction handling tied to the same symptom or an explicit adjacent reference, contextual medication references limited to the immediately preceding turn, and separate treatment of a patient's symptom report and diagnostic guess. Regression checks cover a correction with two symptoms having the same duration and an intervening unrelated medication turn. The 8-case extraction regression suite changed from its stored earlier baseline of 3 FP / 2 FN (F1 90.20%) to 2 FP / 2 FN (F1 92.00%) after these changes.

The 100% final result is an **in-set result on author-written examples used to tune these narrow local rules**, not held-out evidence. The author labels are not clinically or independently reviewed. Matching can still miss semantic errors that preserve the same segment and category. It does not establish clinical accuracy, safety, real-world generalization, improved outcomes, or time saved.

#### Gold-set corrections

Review found that eight cases initially lacked explicit ongoing-care context; each now includes a short fictional follow-up statement and a supported history fact. A final audit then found that C06's “regular follow-up visit” still did not state the condition being followed. C06 now explicitly says “for my ongoing asthma care,” and the suite version advanced to `fictional-followup-2`. C02 records “this week” as the timeframe of the dizziness denial. C05 separates the numb-toes statement from the patient's uncertain theory. C10's statement “I have recorded what you told me” is labeled `other` / `Subjective`, rather than a clinical assessment. Inputs, baseline and final scores were regenerated after these corrections.

The earlier `noticioner-12-baseline-initial-36.json` artifact retains the pre-correction 36-segment capture for historical comparison. The table above uses the frozen baseline v1 output and its score, regenerated against the corrected suite.

#### Artifacts

- Answer key and full specifications: `evaluation/noticioner-12-case-evaluation.json`
- Transcript-only input: `evaluation/transcript-inputs-12.json`
- Validator: `scripts/validate-12-case-evaluation.mjs`
- Frozen baseline output and score: `evaluation-results/noticioner-12-baseline-v1.json`, `evaluation-results/noticioner-12-baseline-score.json`
- Final direct and HTTP outputs/scores: `evaluation-results/noticioner-12-final.json`, `evaluation-results/noticioner-12-final-score.json`, `evaluation-results/noticioner-12-final-http.json`, `evaluation-results/noticioner-12-final-http-score.json`
- Eight-case regression output: `evaluation-results/noticioner-extraction-regression.json`
- Deterministic Trust suite output: `evaluation-results/trust-deterministic-final.json`
