import { evaluateTrust } from "../src/lib/trust-evaluation";
import { evaluate } from "../src/lib/evaluation";
import { mkdirSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const mode = process.argv.includes("--ai") ? "ai" : "baseline";
const result = await evaluate(mode);
mkdirSync("evaluation-results", { recursive: true });
writeFileSync(
  `evaluation-results/${mode}.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
const trust = await evaluateTrust(
  process.argv.includes("--trust-ai") ? "ai" : "deterministic",
);
writeFileSync(
  `evaluation-results/trust-${trust.mode}.json`,
  JSON.stringify(trust, null, 2),
);
console.log(
  JSON.stringify(
    {
      suite: trust.suite,
      sampleSize: trust.sampleSize,
      overall: trust.overall,
      errors: trust.errors,
    },
    null,
    2,
  ),
);
