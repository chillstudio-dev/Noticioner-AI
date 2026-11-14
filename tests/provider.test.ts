import { test } from "node:test";
import assert from "node:assert/strict";
import { baseline, parseTranscript } from "../src/lib/clinical";
import {
  claudeOutputSchema,
  generateNote,
  providerStatus,
  transcribe,
} from "../src/lib/provider";
const keys = [
  "AI_PROVIDER",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_MODEL",
  "ANTHROPIC_WORKSPACE_ID",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "STT_API_KEY",
  "STT_PROVIDER",
  "STT_BASE_URL",
] as const;
async function isolated(fn: () => Promise<void>) {
  const original = globalThis.fetch,
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    keys.forEach((k) => delete process.env[k]);
    await fn();
  } finally {
    globalThis.fetch = original;
    keys.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  }
}
test("Claude uses native Messages with structured JSON and validates source evidence", () =>
  isolated(async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-claude-key";
    process.env.CLAUDE_MODEL = "test-model";
    process.env.ANTHROPIC_WORKSPACE_ID = "test-workspace";
    const segments = parseTranscript("Patient: I have a headache.");
    const note = baseline(segments);
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      const headers = options!.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer test-claude-key");
      assert.equal(headers["anthropic-workspace-id"], "test-workspace");
      assert.equal(headers["anthropic-version"], "2026-10-21");
      const body = JSON.parse(options!.body as string);
      assert.equal(body.model, "test-model");
      assert.equal(body.output_config.format.type, "json_schema");
      assert.ok(body.system.includes("SYNTHETIC"));
      assert.equal(body.response_format, undefined);
      return new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify(note) }],
        }),
      );
    };
    assert.equal(
      (await generateNote(segments)).statements[0].certainty,
      "Supported",
    );
    assert.equal(providerStatus().label, "Claude");
  }));
test("Claude rejects truncated, refused and invalid outputs", () =>
  isolated(async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
    for (const reason of ["max_tokens", "refusal"]) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            stop_reason: reason,
            content: [{ type: "text", text: "{}" }],
          }),
        );
      await assert.rejects(
        () => generateNote(parseTranscript("Patient: Cough.")),
        /did not finish/,
      );
    }
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [{ type: "text", text: '{"statements":[]}' }],
        }),
      );
    await assert.rejects(
      () => generateNote(parseTranscript("Patient: Cough.")),
      /schema validation/,
    );
  }));
test("Claude schema omits unsupported bounds but preserves required properties", () => {
  const schema = claudeOutputSchema();
  const json = JSON.stringify(schema);
  assert.ok(!json.includes("maxLength"));
  assert.ok(!json.includes("minLength"));
  assert.ok(!json.includes("maxItems"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["statements"]);
});
test("Claude key alone does not enable audio; explicit STT credentials stay separate", () =>
  isolated(async () => {
    process.env.ANTHROPIC_API_KEY = "test-claude-key";
    assert.equal(providerStatus().provider, "anthropic");
    assert.equal(providerStatus().transcriptionConfigured, false);
    const audio = new File(["fixture"], "synthetic.webm", {
      type: "audio/webm",
    });
    await assert.rejects(
      () => transcribe(audio),
      /Transcription is not configured/,
    );
    process.env.STT_API_KEY = "test-stt-key";
    process.env.STT_BASE_URL = "https://stt.example/v1";
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://stt.example/v1/audio/transcriptions");
      assert.equal(
        (options!.headers as Record<string, string>).Authorization,
        "Bearer test-stt-key",
      );
      return new Response(JSON.stringify({ text: "Synthetic transcript." }));
    };
    assert.equal(await transcribe(audio), "Synthetic transcript.");
  }));
