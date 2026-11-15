import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const suite = JSON.parse(readFileSync("evaluation/noticioner-12-case-evaluation.json", "utf8"));
const inputs = JSON.parse(readFileSync("evaluation/transcript-inputs-12.json", "utf8"));

test("12-case fidelity set is structurally valid and keeps the answer key out of model inputs", () => {
  assert.equal(suite.cases.length, 12);
  assert.equal(inputs.cases.length, 12);
  assert.deepEqual(inputs.cases.map((c: { id: string }) => c.id), suite.cases.map((c: { id: string }) => c.id));
  for (const [index, c] of suite.cases.entries()) {
    const input = inputs.cases[index];
    assert.deepEqual(Object.keys(input).sort(), ["id", "segments"]);
    assert.deepEqual(input.segments, c.segments);
    assert.equal(new Set(c.segments.map((s: { id: string }) => s.id)).size, c.segments.length);
    assert.ok(c.gold_facts.length > 0 && c.why_useful.length > 0);
    for (const fact of c.gold_facts) {
      const source = c.segments.find((s: { id: string }) => s.id === fact.source_segment_id);
      assert.ok(source);
      assert.ok(source.text.includes(fact.quote));
      assert.equal(source.speaker, fact.speaker);
    }
  }
  assert.doesNotMatch(JSON.stringify(inputs), /gold_facts|must_not_infer|expected_review_prompts|why_useful/);
  assert.equal(Object.keys(suite.coverage_map).length, 9);
});
