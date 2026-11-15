import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseTranscript, validateEvidence, type Segment, type Note, type Statement } from "../src/lib/clinical";

// Frozen copy of the original local keyword baseline used before the measured fixes.
function baselineV1(segments: Segment[]): Note {
  const statements: Statement[] = segments.map((s) => {
    let category: Statement["category"] = "other";
    let section: Statement["section"] = "Subjective";
    if (/allerg/i.test(s.text)) category = "allergy";
    else if (/medication|tablet|\bmg\b|taking|inhaler/i.test(s.text)) category = "medication";
    else if (["Doctor", "Nurse", "Clinician"].includes(s.speaker) && /assessment|impression|suspect/i.test(s.text)) {
      category = "assessment";
      section = "Assessment";
    } else if (["Doctor", "Nurse", "Clinician"].includes(s.speaker) && /follow.up|return|review in|plan:|refer|arrange/i.test(s.text)) {
      category = "followup";
      section = "Plan";
    } else if (["Doctor", "Nurse", "Clinician"].includes(s.speaker) && /examination|temperature|blood pressure|on exam|pulse/i.test(s.text)) {
      category = "examination";
      section = "Objective";
    } else if (/days|weeks|months|since|yesterday/i.test(s.text)) category = "duration";
    else if (/history|previous/i.test(s.text)) category = "history";
    else if (/pain|cough|headache|feel|sore/i.test(s.text)) category = "complaint";
    return {
      id: `f-${s.id}`,
      section,
      text: s.text,
      category,
      speaker: s.speaker,
      speakerBasis: s.speaker === "Unknown" ? "Unknown" : "Explicit",
      evidence: [{ segmentId: s.id, quote: s.text }],
      certainty: /maybe|not sure|perhaps|think|actually|don't remember/i.test(s.text) ? "Uncertain" : "Supported",
    };
  });
  return { statements };
}

type InputSegment = { id: string; speaker: string; text: string };
type InputCase = { id: string; segments: InputSegment[] };
const input = JSON.parse(readFileSync("evaluation/transcript-inputs-12.json", "utf8")) as { suite: string; suite_version: string; cases: InputCase[] };
const prior = JSON.parse(readFileSync("evaluation-results/noticioner-12-baseline-initial-36.json", "utf8"));
const priorById = new Map(prior.examples.map((e: { id: string }) => [e.id, e]));
const examples: { id: string; transcript: string; segmentMap: { sourceId: string; generatedId: string | undefined }[]; note: Note }[] = input.cases.map((sample) => {
  const transcript = sample.segments.map((s) => s.speaker === "Unknown" ? s.text : `${s.speaker}: ${s.text}`).join("\n");
  const parsed = parseTranscript(transcript);
  const note = validateEvidence(baselineV1(parsed), parsed);
  // Check the frozen implementation against pre-change output only for unchanged source segments.
  const previous = priorById.get(sample.id) as { note: Note } | undefined;
  if (previous) {
    const priorSegmentToSource = new Map(
      (previous as typeof previous & { segmentMap?: { generatedId: string; sourceId: string }[] }).segmentMap?.map((m) => [m.generatedId, m.sourceId]) ?? [],
    );
    const originalBySource = new Map<string, { sourceText: string; facts: unknown[][] }>();
    for (const statement of previous.note.statements) {
      for (const evidence of statement.evidence) {
        const sourceId = priorSegmentToSource.get(evidence.segmentId);
        if (!sourceId) continue;
        const existing = originalBySource.get(sourceId) ?? { sourceText: evidence.quote, facts: [] };
        existing.facts.push([statement.text, statement.category, statement.section]);
        originalBySource.set(sourceId, existing);
      }
    }
    const currentSegmentToSource = new Map(
      sample.segments.map((s, index) => [parsed[index]?.id, s.id]),
    );
    const currentBySource = new Map<string, unknown[][]>();
    for (const statement of note.statements) {
      for (const evidence of statement.evidence) {
        const sourceId = currentSegmentToSource.get(evidence.segmentId);
        if (!sourceId) continue;
        const facts = currentBySource.get(sourceId) ?? [];
        facts.push([statement.text, statement.category, statement.section]);
        currentBySource.set(sourceId, facts);
      }
    }
    for (const [sourceId, original] of originalBySource) {
      const currentSource = sample.segments.find((s) => s.id === sourceId);
      if (currentSource?.text === original.sourceText) {
        const repeatedFacts = currentBySource.get(sourceId) ?? [];
        if (JSON.stringify(original.facts) !== JSON.stringify(repeatedFacts))
          throw new Error(`${sample.id}/${sourceId}: frozen baseline differs from original output for unchanged transcript text`);
      }
    }
  }
  return { id: sample.id, transcript, segmentMap: sample.segments.map((s, index) => ({ sourceId: s.id, generatedId: parsed[index]?.id })), note };
});
const result = {
  suite: input.suite,
  suiteVersion: input.suite_version,
  mode: "frozen-local-keyword-baseline-v1",
  createdAt: new Date().toISOString(),
  sampleSize: examples.length,
  examples,
};
mkdirSync("evaluation-results", { recursive: true });
writeFileSync("evaluation-results/noticioner-12-baseline-v1.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output: "evaluation-results/noticioner-12-baseline-v1.json", sampleSize: result.sampleSize, sourceLinkedStatements: examples.reduce((n, e) => n + e.note.statements.filter((s) => s.evidence.length).length, 0) }, null, 2));
