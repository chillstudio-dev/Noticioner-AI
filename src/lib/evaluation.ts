import { performance } from "node:perf_hooks";
import { baseline, flagsFor, parseTranscript, type Note } from "./clinical";
import { generateNote, providerStatus } from "./provider";
import { evaluationCases } from "./evaluation-data";
export function metrics(expected: string[], predicted: string[]) {
  const gold = new Set(expected),
    got = new Set(predicted),
    tp = [...got].filter((v) => gold.has(v)).length,
    fp = got.size - tp,
    fn = gold.size - tp;
  const precision = tp + fp ? tp / (tp + fp) : 0,
    recall = tp + fn ? tp / (tp + fn) : 0;
  return {
    tp,
    fp,
    fn,
    precision,
    recall,
    f1:
      precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
  };
}
export async function evaluate(mode: "baseline" | "ai") {
  if (mode === "ai" && !providerStatus().configured)
    throw new Error("AI evaluation requires a configured provider.");
  const examples: {
    id: string;
    name: string;
    expected: string[];
    predicted: string[];
    missing: string[];
    extra: string[];
    facts: ReturnType<typeof metrics>;
    flags: ReturnType<typeof metrics>;
    valid: boolean;
    unsupported: number;
    statements: number;
    evidenceTotal: number;
    evidenceCorrect: number;
    latencyMs: number;
    error?: string;
  }[] = [];
  for (const sample of evaluationCases) {
    const segments = parseTranscript(sample.text),
      start = performance.now();
    let note: Note | null = null,
      error: string | undefined;
    try {
      note = mode === "ai" ? await generateNote(segments) : baseline(segments);
    } catch (e) {
      error = e instanceof Error ? e.message : "Invalid output";
    }
    const predicted =
      note?.statements.flatMap((s) =>
        s.evidence.map((e) => `${e.segmentId}:${s.category}`),
      ) || [];
    const flagKeys = [
      ...new Set(
        note
          ? flagsFor(note, segments).map((f) =>
              f.id.startsWith("med-")
                ? "medication-details"
                : f.id.startsWith("uncertain-")
                  ? "uncertainty"
                  : f.id,
            )
          : [],
      ),
    ];
    examples.push({
      id: sample.id,
      name: sample.name,
      expected: sample.gold,
      predicted,
      missing: sample.gold.filter((x) => !predicted.includes(x)),
      extra: predicted.filter((x) => !sample.gold.includes(x)),
      facts: metrics(sample.gold, predicted),
      flags: metrics(sample.flags, flagKeys),
      valid: !!note,
      unsupported:
        note?.statements.filter((s) => s.certainty === "Unsupported").length ||
        0,
      statements: note?.statements.length || 0,
      evidenceTotal:
        note?.statements.reduce((n, s) => n + s.evidence.length, 0) || 0,
      evidenceCorrect:
        note?.statements.reduce(
          (n, s) =>
            n +
            s.evidence.filter((e) =>
              sample.gold.includes(`${e.segmentId}:${s.category}`),
            ).length,
          0,
        ) || 0,
      latencyMs: performance.now() - start,
      error,
    });
  }
  const sum = (key: "tp" | "fp" | "fn") =>
      examples.reduce((a, e) => a + e.facts[key], 0),
    tp = sum("tp"),
    fp = sum("fp"),
    fn = sum("fn");
  const precision = tp + fp ? tp / (tp + fp) : 0,
    recall = tp + fn ? tp / (tp + fn) : 0;
  const statements = examples.reduce((a, e) => a + e.statements, 0),
    evidence = examples.reduce((a, e) => a + e.evidenceTotal, 0);
  const categories = [
    ...new Set(
      examples
        .flatMap((e) => [...e.expected, ...e.predicted])
        .map((k) => k.split(":")[1]),
    ),
  ];
  const byCategory = categories.map((category) => ({
    category,
    ...metrics(
      examples.flatMap((e) =>
        e.expected
          .filter((k) => k.endsWith(":" + category))
          .map((k) => e.id + ":" + k),
      ),
      examples.flatMap((e) =>
        e.predicted
          .filter((k) => k.endsWith(":" + category))
          .map((k) => e.id + ":" + k),
      ),
    ),
  }));
  return {
    byCategory,
    mode,
    model: mode === "ai" ? providerStatus().model : "Keyword baseline v1",
    createdAt: new Date().toISOString(),
    sampleSize: examples.length,
    precision,
    recall,
    f1:
      precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    fp,
    fn,
    unsupportedRate: statements
      ? examples.reduce((a, e) => a + e.unsupported, 0) / statements
      : null,
    evidenceAccuracy: evidence
      ? examples.reduce((a, e) => a + e.evidenceCorrect, 0) / evidence
      : null,
    validity: examples.filter((e) => e.valid).length / examples.length,
    latencyMs: examples.reduce((a, e) => a + e.latencyMs, 0) / examples.length,
    examples,
  };
}
export type Evaluation = Awaited<ReturnType<typeof evaluate>>;
