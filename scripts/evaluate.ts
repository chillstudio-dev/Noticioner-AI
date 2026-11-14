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
