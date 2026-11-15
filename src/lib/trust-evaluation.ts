import { z } from "zod";
import { metrics } from "./evaluation";
import { CHECKER_VERSION, deterministicAudit } from "./trust-engine";
import { runTrustAudit } from "./trust-provider";
import { providerStatus } from "./provider";
import { trustFixtures, providerTrustFixtures } from "./trust-fixtures";
export const TRUST_SUITE_VERSION = "synthetic-author-1";
const metricsSchema = z.object({
  tp: z.number(),
  fp: z.number(),
  fn: z.number(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
});
export const trustEvaluationSchema = z.object({
  suite: z.literal("trust"),
  suiteVersion: z.string(),
  checkerVersion: z.string(),
  mode: z.enum(["deterministic", "ai"]),
  model: z.string(),
  provider: z.string(),
  createdAt: z.string(),
  sampleSize: z.number(),
  completed: z.number(),
  errors: z.number(),
  latencyMs: z.number(),
  overall: metricsSchema,
  byCategory: z.array(metricsSchema.extend({ category: z.string() })),
  examples: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.string(),
      expected: z.array(z.string()),
      predicted: z.array(z.string()),
      missing: z.array(z.string()),
      extra: z.array(z.string()),
      metrics: metricsSchema,
      latencyMs: z.number(),
      error: z.string().optional(),
    }),
  ),
});
export type TrustEvaluation = z.infer<typeof trustEvaluationSchema>;
export async function evaluateTrust(
  mode: "deterministic" | "ai",
  signal?: AbortSignal,
): Promise<TrustEvaluation> {
  const examples: TrustEvaluation["examples"] = [];
  for (const sample of mode === "ai" ? providerTrustFixtures : trustFixtures) {
    const start = Date.now();
    let error: string | undefined,
      predicted: string[] = [];
    try {
      signal?.throwIfAborted();
      const audit =
        mode === "ai"
          ? await runTrustAudit(sample.input, true, signal)
          : deterministicAudit(sample.input);
      predicted = [
        ...new Set(
          audit.findings
            .filter((f) => !["supported", "not checked"].includes(f.status))
            .map((f) => `${f.kind}:${f.target}`),
        ),
      ];
      if (mode === "ai" && audit.errors.length) error = audit.errors.join(" ");
    } catch (e) {
      error = e instanceof Error ? e.message : "Case failed";
    }
    examples.push({
      id: sample.id,
      name: sample.name,
      category: sample.category,
      expected: sample.expected,
      predicted,
      missing: sample.expected.filter((k) => !predicted.includes(k)),
      extra: predicted.filter((k) => !sample.expected.includes(k)),
      metrics: metrics(sample.expected, predicted),
      latencyMs: Date.now() - start,
      ...(error ? { error } : {}),
    });
  }
  const expected = examples.flatMap((e) =>
      e.expected.map((k) => `${e.id}/${k}`),
    ),
    predicted = examples.flatMap((e) => e.predicted.map((k) => `${e.id}/${k}`));
  return trustEvaluationSchema.parse({
    suite: "trust",
    suiteVersion: TRUST_SUITE_VERSION,
    checkerVersion: CHECKER_VERSION,
    mode,
    model: mode === "ai" ? providerStatus().model : CHECKER_VERSION,
    provider: mode === "ai" ? providerStatus().provider : "local",
    createdAt: new Date().toISOString(),
    sampleSize: examples.length,
    completed: examples.filter((e) => !e.error).length,
    errors: examples.filter((e) => e.error).length,
    latencyMs: examples.reduce((n, e) => n + e.latencyMs, 0),
    overall: metrics(expected, predicted),
    byCategory: ["evidence", "gaps", "consistency", "safety"].map(
      (category) => ({
        category,
        ...metrics(
          expected.filter((k) => k.split("/")[1].startsWith(category + ":")),
          predicted.filter((k) => k.split("/")[1].startsWith(category + ":")),
        ),
      }),
    ),
    examples,
  });
}
