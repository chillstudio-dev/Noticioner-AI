import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const gold = JSON.parse(await readFile("evaluation/noticioner-12-case-evaluation.json", "utf8"));
const runPath = process.argv.find((arg) => arg.startsWith("--run="))?.slice("--run=".length) ?? "evaluation-results/noticioner-12-baseline.json";
const outputPath = process.argv.find((arg) => arg.startsWith("--output="))?.slice("--output=".length) ?? "evaluation-results/noticioner-12-baseline-score.json";
const run = JSON.parse(await readFile(runPath, "utf8"));
assert.equal(run.sampleSize, 12);
const byId = new Map(gold.cases.map((c) => [c.id, c]));
let tp = 0, fp = 0, fn = 0, sourceLinks = 0, sourceLinkErrors = 0, speakerErrors = 0, unsupportedAdditions = 0, forbiddenMentions = 0, soapCorrect = 0, soapTotal = 0, overconfidentUncertainFacts = 0, negationSegments = 0, negationLosses = 0, numericSegments = 0, numericLosses = 0, numericSupersededSegments = 0, correctionStatements = 0, staleCorrectionFacts = 0;
const cases = [];
for (const example of run.examples) {
  const expectedCase = byId.get(example.id);
  assert.ok(expectedCase, `unknown generated case ${example.id}`);
  const segmentByGenerated = new Map(example.segmentMap.map((m) => [m.generatedId, m.sourceId]));
  const segmentBySource = new Map(expectedCase.segments.map((s) => [s.id, s]));
  const expectedKeys = new Set(expectedCase.gold_facts.map((f) => `${f.source_segment_id}:${f.category}`));
  const predictedKeys = new Set();
  const incorrectQuotes = [];
  const extraClaims = [];
  const sectionErrors = [];
  for (const statement of example.note.statements) {
    if (!statement.evidence.length) {
      extraClaims.push(statement.text);
      continue;
    }
    for (const evidence of statement.evidence) {
      const sourceId = segmentByGenerated.get(evidence.segmentId);
      const source = segmentBySource.get(sourceId);
      const valid = !!source && source.text.includes(evidence.quote);
      sourceLinks++;
      if (!valid) {
        sourceLinkErrors++;
        incorrectQuotes.push({ segmentId: evidence.segmentId, quote: evidence.quote });
      }
      if (source && statement.speaker !== source.speaker) speakerErrors++;
      const claimText = statement.text.replace(/^(?:Duration:|Patient's guess:|Reports)\s*/i, "");
      if (!source || !source.text.includes(claimText)) extraClaims.push(statement.text);
      if (sourceId) predictedKeys.add(`${sourceId}:${statement.category}`);
      const matchingFacts = expectedCase.gold_facts.filter((f) => f.source_segment_id === sourceId && f.category === statement.category);
      if (matchingFacts.some((f) => f.certainty === "Uncertain") && statement.certainty === "Supported") overconfidentUncertainFacts++;
      if (matchingFacts.length) {
        soapTotal++;
        if (matchingFacts.some((f) => f.soap_section === statement.section)) soapCorrect++;
        else sectionErrors.push({ sourceId, category: statement.category, section: statement.section, expected: matchingFacts.map((f) => f.soap_section) });
      }
    }
  }
  const caseTP = [...predictedKeys].filter((k) => expectedKeys.has(k)).length;
  const caseFP = [...predictedKeys].filter((k) => !expectedKeys.has(k)).length;
  const caseFN = [...expectedKeys].filter((k) => !predictedKeys.has(k)).length;
  for (const [sourceIndex, source] of expectedCase.segments.entries()) {
    const sourceId = source.id;
    const linked = example.note.statements.filter((statement) => statement.evidence.some((e) => segmentByGenerated.get(e.segmentId) === sourceId));
    if (/\b(?:no|not|never|denies|without|haven't|hasn't|didn't|don't|doesn't)\b/i.test(source.text)) {
      negationSegments++;
      if (!linked.some((statement) => /\b(?:no|not|never|denies|without|haven't|hasn't|didn't|don't|doesn't)\b/i.test(statement.text))) negationLosses++;
    }
    const numericTokens = [...source.text.matchAll(/\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi)].map((m) => m[0]);
    if (numericTokens.length) {
      const superseded = expectedCase.segments.some((later, laterIndex) => {
        if (laterIndex <= sourceIndex || !/\b(?:correction|actually)\b/i.test(later.text)) return false;
        const priorValue = later.text.match(/\bnot\s+((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?)|yesterday)\b/i)?.[1];
        if (!priorValue || !source.text.toLowerCase().includes(priorValue.toLowerCase())) return false;
        const topics = ["headache", "cough", "tingling", "numbness", "numb toes", "dry mouth", "dizziness", "appetite", "tiredness", "rash", "sore throat"];
        const priorTopic = topics.find((topic) => source.text.toLowerCase().includes(topic));
        const correctionTopic = topics.find((topic) => later.text.toLowerCase().includes(topic));
        if (priorTopic && correctionTopic) return priorTopic === correctionTopic;
        return laterIndex === sourceIndex + 1 && (!priorTopic || !correctionTopic) && /\b(?:it|this)\s+(?:started|began)\b/i.test(later.text);
      });
      if (superseded) numericSupersededSegments++;
      else {
        numericSegments++;
        if (!numericTokens.every((token) => linked.some((statement) => new RegExp(`\\b${token}\\b`, "i").test(statement.text)))) numericLosses++;
      }
    }
    if (/\b(?:correction|actually)\b/i.test(source.text)) {
      correctionStatements++;
      const oldValue = source.text.match(/\bnot\s+((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?)|yesterday)\b/i)?.[1];
      if (oldValue) {
        const superseded = expectedCase.segments.filter((candidate) => candidate.id !== sourceId && candidate.text.toLowerCase().includes(oldValue.toLowerCase()));
        if (superseded.some((candidate) => example.note.statements.some((statement) => statement.category === "duration" && statement.evidence.some((e) => segmentByGenerated.get(e.segmentId) === candidate.id)))) staleCorrectionFacts++;
      }
    }
  }
  tp += caseTP; fp += caseFP; fn += caseFN;
  unsupportedAdditions += extraClaims.length;
  const allText = example.note.statements.map((s) => s.text).join("\n").toLowerCase();
  const forbidden = expectedCase.must_not_infer.filter((item) => allText.includes(item.toLowerCase()));
  forbiddenMentions += forbidden.length;
  cases.push({ id: example.id, expectedFacts: expectedKeys.size, predictedFacts: predictedKeys.size, tp: caseTP, fp: caseFP, fn: caseFN, sourceLinks: example.note.statements.reduce((n, s) => n + s.evidence.length, 0), sourceLinkErrors: incorrectQuotes.length, speakerErrors: example.note.statements.filter((s) => { const id = segmentByGenerated.get(s.evidence[0]?.segmentId); return id && segmentBySource.get(id)?.speaker !== s.speaker; }).length, unsupportedAdditions: extraClaims.length, forbiddenMentions: forbidden.length, soapPlacementErrors: sectionErrors, missing: [...expectedKeys].filter((k) => !predictedKeys.has(k)), extra: [...predictedKeys].filter((k) => !expectedKeys.has(k)) });
}
const precision = tp + fp ? tp / (tp + fp) : 0;
const recall = tp + fn ? tp / (tp + fn) : 0;
const result = {
  suite: gold.suite,
  suiteVersion: gold.suite_version,
  mode: run.mode,
  createdAt: new Date().toISOString(),
  matchingRule: "Exact (case, cited transcript segment, extraction category) pairs; this does not assess semantic paraphrase quality or clinical correctness.",
  overall: { tp, fp, fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 },
  totals: { supportedFacts: tp + fn, capturedSupportedFacts: tp, omissions: fn, incorrectCategoryAssignments: fp, literalUnsupportedStatements: unsupportedAdditions, inventedForbiddenDetails: forbiddenMentions, sourceLinks, sourceLinkErrors, speakerErrors, overconfidentUncertainFacts, negationSegments, negationLosses, numericSegments, numericLosses, numericSupersededSegments, correctionStatements, staleCorrectionFacts, soapPlacements: soapTotal, soapPlacementErrors: soapTotal - soapCorrect },
  cases,
  limits: ["Author-written fictional set; not independently or clinically reviewed.", "Local keyword baseline copies transcript segments and scores segment/category matching only.", "A literal source quote is evidence of text existence, not semantic support."]
};
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output: outputPath, sampleSize: cases.length, overall: result.overall, totals: result.totals }, null, 2));
