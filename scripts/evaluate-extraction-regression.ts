import { mkdirSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { evaluate } from "../src/lib/evaluation";
nextEnv.loadEnvConfig(process.cwd());
const result = await evaluate("baseline");
const output = "evaluation-results/noticioner-extraction-regression.json";
mkdirSync("evaluation-results", { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, sampleSize: result.sampleSize, precision: result.precision, recall: result.recall, f1: result.f1, fp: result.fp, fn: result.fn }, null, 2));
