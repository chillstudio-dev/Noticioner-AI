import { test } from "node:test";
import assert from "node:assert/strict";
import { translateTranscript } from "../src/lib/translation";

test("translation preserves the source and validates provider output, consent and target language", async () => {
  const names = ["AI_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  const originalFetch = globalThis.fetch;
  const input = {
    sourceText: "Patient: Je ne prends pas ce médicament.\nDoctor: 5 mg.",
    targetLanguage: "en" as const,
    consent: true as const,
  };
  try {
    names.forEach((name) => delete process.env[name]);
    await assert.rejects(() => translateTranscript(input), /not configured/);
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "synthetic-test-key";
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      assert.ok(body.messages[0].content.includes("negation"));
      assert.equal(
        JSON.parse(body.messages[1].content).sourceText,
        input.sourceText,
      );
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                text: "Patient: I do not take this medication.\nDoctor: 5 mg.",
              }),
            },
          },
        ],
      });
    };
    const result = await translateTranscript(input);
    assert.match(result.text, /do not take/);
    assert.equal(result.sourceHash.length, 64);
    assert.equal(
      input.sourceText,
      "Patient: Je ne prends pas ce médicament.\nDoctor: 5 mg.",
    );
    await assert.rejects(() =>
      translateTranscript({ ...input, consent: false as true }),
    );
    await assert.rejects(() =>
      translateTranscript({ ...input, targetLanguage: "invalid" as "en" }),
    );
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            finish_reason: "length",
            message: { content: '{"text":"partial"}' },
          },
        ],
      });
    await assert.rejects(() => translateTranscript(input), /incomplete/);
    globalThis.fetch = async () =>
      Response.json({ choices: [{ message: { content: '{"text":""}' } }] });
    await assert.rejects(() => translateTranscript(input), /invalid draft/);
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "synthetic-claude-key";
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      assert.equal(body.output_config.format.type, "json_schema");
      return Response.json({
        stop_reason: "end_turn",
        content: [{ type: "text", text: '{"text":"日本語の翻訳"}' }],
      });
    };
    assert.equal(
      (await translateTranscript({ ...input, targetLanguage: "ja" })).text,
      "日本語の翻訳",
    );
    globalThis.fetch = async () =>
      Response.json({ stop_reason: "end_turn", content: {} });
    await assert.rejects(
      () => translateTranscript(input),
      /AI translation returned an invalid draft/,
    );
    globalThis.fetch = async () => new Response("not JSON");
    await assert.rejects(
      () => translateTranscript(input),
      /AI translation returned an invalid draft/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    names.forEach((name) =>
      previous[name] === undefined
        ? delete process.env[name]
        : (process.env[name] = previous[name]),
    );
  }
});
