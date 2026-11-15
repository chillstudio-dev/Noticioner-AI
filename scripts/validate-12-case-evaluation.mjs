import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const sourcePath = "evaluation/noticioner-12-case-evaluation.json";
const inputPath = "evaluation/transcript-inputs-12.json";
const suite = JSON.parse(await readFile(sourcePath, "utf8"));
assert.equal(suite.suite, "noticioner-fidelity-12");
assert.equal(suite.cases.length, 12, "suite must contain exactly 12 cases");
const allowedCategories = new Set([
  "complaint", "duration", "history", "allergy", "medication",
  "examination", "assessment", "followup", "other",
]);
const allowedSections = new Set(["Subjective", "Objective", "Assessment", "Plan"]);
const allowedSpeakers = new Set(["Patient", "Clinician", "Unknown"]);
const allIds = new Set(suite.cases.map((c) => c.id));
assert.equal(allIds.size, 12, "case IDs must be unique");
const cases = [];

for (const c of suite.cases) {
  assert.ok(c.id && c.name && c.why_useful);
  assert.ok(Array.isArray(c.segments) && c.segments.length > 0);
  assert.ok(Array.isArray(c.gold_facts));
  assert.ok(Array.isArray(c.must_not_infer));
  assert.ok(Array.isArray(c.expected_review_prompts));
  const segmentIds = new Set();
  for (const [i, segment] of c.segments.entries()) {
    assert.equal(segment.id, `S${String(i + 1).padStart(2, "0")}`, `${c.id}: ordered segment IDs`);
    assert.ok(!segmentIds.has(segment.id), `${c.id}: duplicate segment ${segment.id}`);
    assert.ok(allowedSpeakers.has(segment.speaker), `${c.id}/${segment.id}: invalid speaker`);
    assert.ok(segment.text.trim());
    segmentIds.add(segment.id);
  }
  const transcriptText = c.segments.map((s) => s.text).join("\n");
  for (const fact of c.gold_facts) {
    const segment = c.segments.find((s) => s.id === fact.source_segment_id);
    assert.ok(segment, `${c.id}: missing source segment ${fact.source_segment_id}`);
    assert.ok(segment.text.includes(fact.quote), `${c.id}/${fact.source_segment_id}: quote is not an exact substring`);
    assert.equal(fact.speaker, segment.speaker, `${c.id}/${fact.source_segment_id}: speaker mismatch`);
    assert.ok(allowedCategories.has(fact.category), `${c.id}: invalid category ${fact.category}`);
    assert.ok(allowedSections.has(fact.soap_section), `${c.id}: invalid SOAP section`);
    assert.ok(["Supported", "Uncertain"].includes(fact.certainty), `${c.id}: invalid certainty`);
    assert.ok(fact.normalized_statement.trim());
  }
  for (const absent of c.must_not_infer) {
    assert.ok(absent.trim());
    assert.ok(!transcriptText.toLowerCase().includes(absent.toLowerCase()), `${c.id}: forbidden detail occurs in transcript: ${absent}`);
  }
  for (const prompt of c.expected_review_prompts) {
    assert.ok(prompt.trim());
    const words = prompt.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    assert.ok(words.some((word) => transcriptText.toLowerCase().includes(word)), `${c.id}: review prompt is not grounded in transcript wording`);
  }
  cases.push({ id: c.id, segments: c.segments });
}

for (const [requirement, ids] of Object.entries(suite.coverage_map)) {
  assert.ok(ids.length > 0, `${requirement}: coverage is empty`);
  for (const id of ids) assert.ok(allIds.has(id), `${requirement}: unknown case ${id}`);
}
for (const required of [
  "straightforward_symptoms_and_history", "clear_negation", "patient_correction",
  "uncertain_or_incomplete_medication", "patient_diagnostic_guess",
  "explicit_clinician_observation", "spoken_followup_plan",
  "ambiguous_speaker_or_statement", "plausible_but_unstated_detail",
]) assert.ok(suite.coverage_map[required]?.length, `missing scenario coverage: ${required}`);

await mkdir("evaluation", { recursive: true });
await writeFile(inputPath, `${JSON.stringify({ suite: suite.suite, suite_version: suite.suite_version, cases }, null, 2)}\n`);
const inputs = JSON.parse(await readFile(inputPath, "utf8"));
assert.equal(inputs.cases.length, 12);
for (const c of inputs.cases) {
  assert.deepEqual(Object.keys(c).sort(), ["id", "segments"], "model input must contain only IDs and transcript segments");
  assert.ok(!JSON.stringify(c).match(/gold_facts|must_not_infer|expected_review_prompts|why_useful/));
}
console.log(`Validated 12 cases; ${suite.cases.reduce((n, c) => n + c.segments.length, 0)} ordered transcript segments; all quotes, speakers, categories, coverage, and answer-key separation checks passed.`);
