import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deterministicAudit,
  mergeSemantic,
  eligibleClaims,
  MAX_CLAIMS,
  assertTrustApproval,
} from "../src/lib/trust-engine";
import { trustFixtures } from "../src/lib/trust-fixtures";
import { evaluateTrust } from "../src/lib/trust-evaluation";
import { metrics } from "../src/lib/evaluation";
for (const sample of trustFixtures)
  test(`synthetic ${sample.id}: ${sample.name}`, () => {
    const audit = deterministicAudit(sample.input);
    assert.deepEqual(
      [
        ...new Set(
          audit.findings
            .filter((f) => !["not checked", "supported"].includes(f.status))
            .map((f) => `${f.kind}:${f.target}`),
        ),
      ].sort(),
      [...sample.expected].sort(),
    );
    assert.ok(audit.findings.every((f) => f.resolution === "Open"));
  });
test("deterministic invalid evidence and contradiction cannot be overridden", () => {
  for (const i of [0, 2]) {
    const input = trustFixtures[i].input;
    const audit = deterministicAudit(input);
    const before = audit.findings[0].status;
    mergeSemantic(
      audit,
      {
        claims: [
          { statementId: "c1", status: "supported", reason: "Model disagrees" },
        ],
        concerns: [],
      },
      input,
      "mock",
      "mock",
    );
    assert.equal(audit.findings[0].status, before);
    assert.equal(audit.findings[0].explanations.length, 2);
    assert.equal(audit.findings[0].resolution, "Open");
  }
});
test("omitted and over-limit claims remain visible and unchecked", () => {
  const input = structuredClone(trustFixtures[3].input);
  input.note.statements = Array.from({ length: MAX_CLAIMS + 2 }, (_, i) => ({
    ...input.note.statements[0],
    id: `c${i}`,
  }));
  const audit = deterministicAudit(input);
  assert.equal(eligibleClaims(input).length, MAX_CLAIMS);
  assert.equal(
    audit.findings.filter((f) => f.kind === "evidence").length,
    MAX_CLAIMS + 2,
  );
  mergeSemantic(audit, { claims: [], concerns: [] }, input, "mock", "mock");
  assert.ok(audit.findings.every((f) => f.status === "not checked"));
});
test("approval requires rationale and unchanged source and note", () => {
  const input = trustFixtures[3].input,
    audit = deterministicAudit(input);
  assert.throws(() => assertTrustApproval(audit, input));
  audit.findings.forEach((f) => {
    f.resolution = "Addressed";
    f.note = "Checked against fictional source";
  });
  assert.doesNotThrow(() => assertTrustApproval(audit, input));
  assert.throws(() =>
    assertTrustApproval(audit, {
      ...input,
      sources: [{ ...input.sources[0], version: 2 }],
    }),
  );
});
test("metrics match case/category/target, suite is versioned and synthetic", async () => {
  assert.deepEqual(metrics(["a", "b"], ["a", "c"]), {
    tp: 1,
    fp: 1,
    fn: 1,
    precision: 0.5,
    recall: 0.5,
    f1: 0.5,
  });
  const result = await evaluateTrust("deterministic");
  assert.equal(result.sampleSize, 24);
  assert.equal(result.errors, 0);
  assert.equal(result.overall.fp, 0);
  assert.equal(result.overall.fn, 0);
  assert.equal(result.byCategory.length, 4);
});
test("negation scope and canonical JSON survive mixed clauses and JSONB key order", async () => {
  const { explicitContradiction, sourceFingerprint, noteFingerprint } =
    await import("../src/lib/trust-engine");
  assert.equal(
    explicitContradiction("No cough but fever present.", "Fever present."),
    false,
  );
  assert.equal(explicitContradiction("No fever.", "Fever present."), true);
  const input = trustFixtures[3].input;
  const reordered = JSON.parse(
    JSON.stringify(input, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    ),
  );
  assert.equal(
    sourceFingerprint(input.sources),
    sourceFingerprint(reordered.sources),
  );
  assert.equal(noteFingerprint(input.note), noteFingerprint(reordered.note));
});
test("recorded unknown personal context is documented and ambiguity cannot be promoted", () => {
  const input = structuredClone(trustFixtures[3].input);
  input.includeGaps = true;
  input.sources.push({
    id: "allergy",
    type: "patient-context",
    text: "Unknown",
    label: "Recorded allergies",
    version: "snapshot",
  });
  assert.ok(
    !deterministicAudit(input).findings.some(
      (f) => f.kind === "gaps" && f.target === "allergy",
    ),
  );
  input.sources[0].text = "Maybe a fever.";
  input.note.statements[0].text = "Fever.";
  input.note.statements[0].evidence = [
    { segmentId: "s1", quote: "Maybe a fever." },
  ];
  const audit = deterministicAudit(input);
  mergeSemantic(
    audit,
    {
      claims: [
        {
          statementId: "c1",
          status: "supported",
          reason: "Verifier disagrees",
        },
      ],
      concerns: [],
    },
    input,
    "mock",
    "mock",
  );
  assert.equal(audit.findings[0].status, "unclear");
});
test("follow-up timing does not fill the symptom-duration gap", () => {
  const input = structuredClone(
    trustFixtures.find((sample) => sample.id === "g5")!.input,
  );
  const text = "I have dry mouth. We will review again in two weeks.";
  input.sources[0].text = text;
  input.note.statements[0].text = text;
  input.note.statements[0].evidence = [{ segmentId: "s1", quote: text }];
  const findings = deterministicAudit(input).findings.filter(
    (finding) => finding.kind === "gaps",
  );
  assert.ok(findings.some((finding) => finding.target === "duration"));
  assert.ok(!findings.some((finding) => finding.target === "followup"));

  const durationText = "I have dry mouth for two weeks.";
  input.sources[0].text = durationText;
  input.note.statements[0].text = durationText;
  input.note.statements[0].evidence = [
    { segmentId: "s1", quote: durationText },
  ];
  assert.ok(
    !deterministicAudit(input).findings.some(
      (finding) => finding.kind === "gaps" && finding.target === "duration",
    ),
  );
});
test("a historical follow-up visit does not count as an upcoming plan", () => {
  const input = structuredClone(
    trustFixtures.find((sample) => sample.id === "g5")!.input,
  );
  const text = "This is my regular follow-up visit.";
  input.sources[0].text = text;
  input.note.statements[0].text = text;
  input.note.statements[0].evidence = [{ segmentId: "s1", quote: text }];
  assert.ok(
    deterministicAudit(input).findings.some(
      (finding) => finding.kind === "gaps" && finding.target === "followup",
    ),
  );
});
test("duration and follow-up gaps require evidence about the symptom and care", () => {
  const input = structuredClone(
    trustFixtures.find((sample) => sample.id === "g5")!.input,
  );
  const hasGap = (target: "duration" | "followup") =>
    deterministicAudit(input).findings.some(
      (finding) => finding.kind === "gaps" && finding.target === target,
    );
  const setSource = (text: string) => {
    input.sources[0].text = text;
    input.note.statements[0].text = text;
    input.note.statements[0].evidence = [{ segmentId: "s1", quote: text }];
  };

  setSource("I started a new job two weeks ago. I have dry mouth.");
  assert.ok(hasGap("duration"));

  setSource("Dry mouth, two weeks in duration.");
  assert.ok(!hasGap("duration"));

  setSource("Dry mouth. I will return to work in two weeks.");
  assert.ok(hasGap("followup"));

  setSource("I will review the invoice in two weeks.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. Return to clinic on Monday.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. Follow-up Monday.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. Appointment Friday.");
  assert.ok(!hasGap("followup"));

  setSource("Appointment with my lawyer Friday.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. Appointment with my primary care doctor next Monday.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. Follow-up with my endocrinologist next month.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. Follow-up with my therapist next week.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. Appointment with my psychologist next week.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. Appointment with my physiotherapist next week.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. Appointment with my midwife next week.");
  assert.ok(!hasGap("followup"));

  setSource("I will see my midwife next week.");
  assert.ok(!hasGap("followup"));

  setSource("I will see my therapist next week.");
  assert.ok(!hasGap("followup"));

  setSource("I will see Dr Smith next week.");
  assert.ok(!hasGap("followup"));

  setSource("The doctor will see me in two weeks.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. I will see my friend next week.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. I will see a movie tomorrow.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. I will review my MRI next week.");
  assert.ok(!hasGap("followup"));

  setSource("I will review my MRI next week.");
  assert.ok(!hasGap("followup"));

  setSource("I will review the scan next week.");
  assert.ok(!hasGap("followup"));

  setSource("I will review my CT scan next week.");
  assert.ok(!hasGap("followup"));

  setSource("Appointment at the outpatient clinic next Monday.");
  assert.ok(!hasGap("followup"));

  setSource("Appointment at our clinic next Monday.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. I will follow up with my employer next week.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. I have an appointment with my friend next Monday.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. We will visit my sister next Monday.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. Appointment with my parents next Monday.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. We will visit my daughter next Monday.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. Appointment with my grandmother next Monday.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. We will visit my grandma next Monday.");
  assert.ok(hasGap("followup"));

  setSource("Dry mouth. I attended a follow-up appointment last Monday.");
  assert.ok(hasGap("followup"));

  setSource("Dry mouth. I had a follow-up appointment on Monday.");
  assert.ok(hasGap("followup"));

  setSource("Dry mouth. I was seen for follow-up on Monday.");
  assert.ok(hasGap("followup"));

  setSource(
    "I attended a follow-up last Monday and will return to clinic next Tuesday.",
  );
  assert.ok(!hasGap("followup"));

  setSource(
    "I attended a follow-up last Monday, I will return to clinic next Tuesday.",
  );
  assert.ok(!hasGap("followup"));

  setSource(
    "I attended a follow-up last Monday, with another appointment next Friday.",
  );
  assert.ok(!hasGap("followup"));

  setSource("Follow-up with cardiology next month.");
  assert.ok(!hasGap("followup"));

  setSource("I will see the doctor next Monday.");
  assert.ok(!hasGap("followup"));

  setSource("I have dry mouth. I will review the report tomorrow.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. Appointment with my accountant Friday.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. I will review the timetable tomorrow.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. I will return from vacation in two weeks.");
  assert.ok(hasGap("followup"));

  setSource("I have dry mouth. I sleep for eight hours.");
  assert.ok(hasGap("duration"));

  setSource("How long have you had the cough? 3 days.");
  assert.ok(!hasGap("duration"));

  setSource("I have cough. It started 3 days ago.");
  assert.ok(!hasGap("duration"));
});
test("partial invalid evidence remains unsupported after the existing quote filter", async () => {
  const { validateEvidence, parseTranscript, baseline } =
    await import("../src/lib/clinical");
  const segments = parseTranscript("Patient: Cough.");
  const note = baseline(segments);
  note.statements[0].evidence.push({ segmentId: "missing", quote: "Invented" });
  const checked = validateEvidence(note, segments);
  assert.equal(checked.statements[0].evidence.length, 1);
  assert.equal(checked.statements[0].rejectedEvidence?.length, 1);
  const input = {
    note: checked,
    sources: trustFixtures[3].input.sources,
    includeGaps: false,
  };
  const audit = deterministicAudit(input);
  mergeSemantic(
    audit,
    {
      claims: [
        { statementId: "f-s1", status: "supported", reason: "Claims support" },
      ],
      concerns: [],
    },
    input,
    "mock",
    "mock",
  );
  assert.equal(audit.findings[0].status, "unsupported");
});
