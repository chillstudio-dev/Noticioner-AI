import { mkdirSync, writeFileSync } from "node:fs";
import { evaluateTrust } from "../src/lib/trust-evaluation";
const result = await evaluateTrust("deterministic");
const output = "evaluation-results/trust-deterministic-final.json";
mkdirSync("evaluation-results", { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, sampleSize: result.sampleSize, completed: result.completed, errors: result.errors, overall: result.overall, latencyMs: result.latencyMs }, null, 2));
