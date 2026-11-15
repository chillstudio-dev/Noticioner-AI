import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseline,
  parseTranscript,
  validateEvidence,
  noteSchema,
  flagsFor,
  assertApproval,
} from "../src/lib/clinical";
import { metrics, evaluate } from "../src/lib/evaluation";
test("speaker assignment never invents identities", () => {
  assert.equal(parseTranscript("Unlabeled voice")[0].speaker, "Unknown");
  assert.equal(parseTranscript("Doctor: Hello")[0].speaker, "Doctor");
});
test("nurse labels are recognized and explicit roles override model guesses", () => {
  assert.equal(
    parseTranscript("Nurse: Your temperature is 37 C.")[0].speaker,
    "Nurse",
  );
  const source = parseTranscript("Patient: My temperature is normal.");
  const note = baseline(source);
  note.statements[0].speaker = "Nurse";
  note.statements[0].section = "Objective";
  const checked = validateEvidence(note, source).statements[0];
  assert.equal(checked.speaker, "Patient");
  assert.equal(checked.speakerBasis, "Explicit");
  assert.equal(checked.certainty, "Uncertain");
});
test("unlabeled role inference is visible and requires a review action", () => {
  const source = parseTranscript(
    "I am your nurse. Your temperature is 37 C. I have a headache.",
  );
  const note = baseline(source);
  Object.assign(note.statements[0], {
    speaker: "Nurse",
    speakerBasis: "Explicit",
    section: "Objective",
  });
  const checked = validateEvidence(note, source);
  assert.equal(checked.statements[0].speakerBasis, "Inferred");
  assert.equal(checked.statements[0].certainty, "Uncertain");
  assert.ok(flagsFor(checked, source).some((f) => f.id === "speaker-review"));
});
test("unverifiable evidence cannot establish an inferred identity", () => {
  const source = parseTranscript("Hello.");
  const note = baseline(source);
  note.statements[0].speaker = "Nurse";
  note.statements[0].evidence[0].quote = "fabricated";
  const checked = validateEvidence(note, source).statements[0];
  assert.equal(checked.speaker, "Unknown");
  assert.equal(checked.certainty, "Unsupported");
});
test("fabricated quote loses support", () => {
  const s = parseTranscript("Patient: A cough.");
  const n = baseline(s);
  n.statements[0].evidence[0].quote = "Normal blood pressure";
  assert.equal(validateEvidence(n, s).statements[0].certainty, "Unsupported");
});
test("patient cannot support objective findings", () => {
  const s = parseTranscript("Patient: My temperature is normal.");
  const n = baseline(s);
  n.statements[0].section = "Objective";
  assert.equal(validateEvidence(n, s).statements[0].certainty, "Uncertain");
});
test("malformed and empty model outputs rejected", () => {
  assert.throws(() => noteSchema.parse({ statements: [] }));
  assert.throws(() => noteSchema.parse({ statements: [{ text: "hello" }] }));
});
test("baseline retains negation and does not fabricate missing exam", () => {
  const n = baseline(parseTranscript("Patient: I have no known allergies."));
  assert.equal(n.statements[0].text, "I have no known allergies.");
  assert.equal(n.statements.filter((s) => s.section === "Objective").length, 0);
});
test("baseline separates symptom and duration, and captures spoken follow-up as Plan", () => {
  const source = parseTranscript("Patient: I've had dry mouth for two days.\nClinician: We'll meet again in three months.");
  const note = baseline(source);
  assert.ok(note.statements.some((s) => s.category === "complaint" && s.evidence[0]?.segmentId === "s1"));
  assert.ok(note.statements.some((s) => s.category === "duration" && s.text === "Duration: two days" && s.evidence[0]?.quote === "for two days"));
  assert.ok(note.statements.some((s) => s.category === "followup" && s.section === "Plan" && s.evidence[0]?.segmentId === "s2"));
});
test("baseline uses a patient's explicit correction as the current duration", () => {
  const note = baseline(parseTranscript("Patient: It started three days ago.\nPatient: Actually, it started yesterday."));
  assert.equal(note.statements.length, 1);
  assert.match(note.statements[0].text, /yesterday/);
  assert.equal(note.statements[0].category, "duration");
});
test("baseline limits medication context to the immediately connected turn and scopes corrections by their evidence", () => {
  const note = baseline(parseTranscript("Patient: I take a tablet.\nPatient: My throat hurts.\nPatient: I don't know its name.\nPatient: My headache began three days ago.\nPatient: My cough began three days ago.\nPatient: Correction: my headache began yesterday, not three days ago."));
  assert.equal(note.statements.find((s) => s.text === "I don't know its name.")?.category, "other");
  assert.ok(note.statements.some((s) => s.text === "My cough began three days ago."));
  assert.ok(!note.statements.some((s) => s.text === "My headache began three days ago."));
});
test("baseline keeps patient diagnostic guesses uncertain and medication context across adjacent turns", () => {
  const note = baseline(parseTranscript("Patient: I take a small white tablet.\nPatient: I don't know its name.\nPatient: I think my numb toes mean I have nerve damage."));
  assert.ok(note.statements.some((s) => s.category === "medication" && s.text.includes("don't know") && s.certainty === "Uncertain"));
  assert.ok(note.statements.some((s) => s.category === "other" && s.text.startsWith("Patient's guess:") && s.certainty === "Uncertain"));
  assert.ok(note.statements.some((s) => s.category === "complaint" && s.text === "Reports numb toes" && s.certainty === "Supported" && s.evidence[0]?.quote === "my numb toes"));
  assert.ok(note.statements.every((s) => s.evidence.every((e) => e.quote.length > 0)));
});
test("medication omissions are transparent documentation flags", () => {
  const s = parseTranscript("Patient: I take a tablet.");
  const f = flagsFor(baseline(s), s);
  assert.ok(f.some((x) => x.message.includes("dose, route, frequency")));
});
test("approval requires explicit review and closed flags", () => {
  const s = parseTranscript("Patient: I have a cough.");
  const n = baseline(s),
    f = flagsFor(n, s);
  assert.throws(() => assertApproval(n, f, true, true));
  assert.throws(() => assertApproval(n, [], false, true));
  assert.doesNotThrow(() => assertApproval(n, [], true, true));
});
test("metrics count false positives and negatives, deduplicate", () => {
  assert.deepEqual(metrics(["a", "b"], ["a", "a", "c"]), {
    tp: 1,
    fp: 1,
    fn: 1,
    precision: 0.5,
    recall: 0.5,
    f1: 0.5,
  });
});
test("baseline evaluation is reproducible except timing", async () => {
  const a = await evaluate("baseline"),
    b = await evaluate("baseline");
  assert.equal(a.f1, b.f1);
  assert.equal(a.fp, b.fp);
  assert.equal(a.sampleSize, 8);
  assert.ok(a.fn > 0);
});
