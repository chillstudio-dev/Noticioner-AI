import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { baseline, parseTranscript, validateEvidence } from "../src/lib/clinical";
nextEnv.loadEnvConfig(process.cwd());

type Input = { id: string; segments: { id: string; speaker: string; text: string }[] };
const input = JSON.parse(readFileSync("evaluation/transcript-inputs-12.json", "utf8")) as { suite: string; suite_version: string; cases: Input[] };
const examples = input.cases.map((sample) => {
  const transcript = sample.segments.map((s) => s.speaker === "Unknown" ? s.text : `${s.speaker}: ${s.text}`).join("\n");
  const parsed = parseTranscript(transcript);
  const note = validateEvidence(baseline(parsed), parsed);
  return {
    id: sample.id,
    transcript,
    segmentMap: sample.segments.map((s, index) => ({ sourceId: s.id, generatedId: parsed[index]?.id })),
    note,
  };
});
const result = {
  suite: input.suite,
  suiteVersion: input.suite_version,
  mode: "local-keyword-baseline",
  createdAt: new Date().toISOString(),
  sampleSize: examples.length,
  examples,
};
mkdirSync("evaluation-results", { recursive: true });
const outputPath = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length) ?? "evaluation-results/noticioner-12-baseline.json";
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  suite: result.suite,
  suiteVersion: result.suiteVersion,
  sampleSize: result.sampleSize,
  output: outputPath,
  sourceLinkedStatements: examples.reduce((n, e) => n + e.note.statements.filter((s) => s.evidence.length > 0).length, 0),
}, null, 2));
