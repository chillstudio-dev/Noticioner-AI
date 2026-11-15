import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runTrustAudit,
  generatePatientSummary,
} from "../src/lib/trust-provider";
import { trustFixtures } from "../src/lib/trust-fixtures";
import { evaluateTrust } from "../src/lib/trust-evaluation";
const keys = ["AI_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
async function isolated(fn: () => Promise<void>) {
  const fetch = globalThis.fetch;
  const saved = keys.map((k) => process.env[k]);
  try {
    keys.forEach((k) => delete process.env[k]);
    await fn();
  } finally {
    globalThis.fetch = fetch;
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
}
const output = {
  claims: [
    {
      statementId: "c1",
      status: "supported",
      reason: "Excerpt supports the synthetic claim.",
    },
  ],
  concerns: [],
};
const response = (value: unknown) =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(value) } },
    ],
  });
test("both provider transports validate semantic output without resolving findings", () =>
  isolated(async () => {
    for (const provider of ["openai", "anthropic"]) {
      process.env.AI_PROVIDER = provider;
      process.env.OPENAI_API_KEY = "synthetic";
      process.env.ANTHROPIC_API_KEY = "synthetic";
      globalThis.fetch = async (url, options) => {
        assert.ok(
          String(url).endsWith(
            provider === "anthropic" ? "/messages" : "/chat/completions",
          ),
        );
        const b = JSON.parse(String(options?.body));
        assert.ok(JSON.stringify(b).includes("untrusted data"));
        return provider === "anthropic"
          ? Response.json({
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify(output) }],
            })
          : response(output);
      };
      const audit = await runTrustAudit(trustFixtures[3].input, true);
      assert.equal(audit.findings[0].status, "supported");
      assert.equal(audit.findings[0].resolution, "Open");
      assert.equal(audit.errors.length, 0);
    }
  }));
test("refusal truncation empty malformed timeout and duplicate IDs cannot produce support", () =>
  isolated(async () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "synthetic";
    const variants = [
      () =>
        Response.json({
          choices: [
            {
              finish_reason: "length",
              message: { content: JSON.stringify(output) },
            },
          ],
        }),
      () =>
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: { refusal: "No", content: JSON.stringify(output) },
            },
          ],
        }),
      () => response({}),
      () =>
        Response.json({
          choices: [{ finish_reason: "stop", message: { content: "" } }],
        }),
      () => {
        throw new DOMException("Timed out", "TimeoutError");
      },
      () =>
        response({ ...output, claims: [...output.claims, ...output.claims] }),
    ];
    for (const variant of variants) {
      globalThis.fetch = async () => variant();
      const audit = await runTrustAudit(trustFixtures[3].input, true);
      assert.equal(audit.findings[0].status, "not checked");
      assert.equal(audit.errors.length, 1);
    }
  }));
test("Claude refuses incomplete and malformed semantic responses", () =>
  isolated(async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "synthetic";
    for (const reason of ["max_tokens", "refusal", "end_turn"]) {
      globalThis.fetch = async () =>
        Response.json({
          stop_reason: reason,
          content: [
            {
              type: "text",
              text: reason === "end_turn" ? "{}" : JSON.stringify(output),
            },
          ],
        });
      const audit = await runTrustAudit(trustFixtures[3].input, true);
      assert.equal(audit.findings[0].status, "not checked");
      assert.equal(audit.errors.length, 1);
    }
  }));
test("partial batch failure retains completed checks with no automatic retry", () =>
  isolated(async () => {
    process.env.OPENAI_API_KEY = "synthetic";
    let calls = 0;
    const input = structuredClone(trustFixtures[3].input);
    input.note.statements = Array.from({ length: 25 }, (_, i) => ({
      ...input.note.statements[0],
      id: `c${i}`,
    }));
    globalThis.fetch = async () => {
      calls++;
      if (calls === 2) throw new Error("Offline");
      return response({
        ...output,
        claims: input.note.statements
          .slice(0, 20)
          .map((s) => ({ ...output.claims[0], statementId: s.id })),
      });
    };
    const audit = await runTrustAudit(input, true);
    assert.equal(calls, 2);
    assert.equal(
      audit.findings.filter((f) => f.status === "supported").length,
      20,
    );
    assert.equal(
      audit.findings.filter((f) => f.status === "not checked").length,
      5,
    );
  }));
test("cancellation propagates and unavailable provider never claims support", () =>
  isolated(async () => {
    const unavailable = await runTrustAudit(trustFixtures[3].input, true);
    assert.equal(unavailable.findings[0].status, "not checked");
    process.env.OPENAI_API_KEY = "synthetic";
    const controller = new AbortController();
    globalThis.fetch = async () => {
      controller.abort();
      throw new DOMException("Cancelled", "AbortError");
    };
    await assert.rejects(
      () => runTrustAudit(trustFixtures[3].input, true, controller.signal),
      /abort/i,
    );
  }));
test("patient summary requires validated paragraphs and exact references are audited", () =>
  isolated(async () => {
    process.env.OPENAI_API_KEY = "synthetic";
    globalThis.fetch = async () =>
      response({
        paragraphs: [
          {
            id: "p1",
            text: "You reported a cough.",
            evidence: [{ segmentId: "s1", quote: "Cough." }],
          },
        ],
      });
    const content = await generatePatientSummary(
      trustFixtures[3].input.sources[0],
    );
    assert.equal(content.paragraphs.length, 1);
    globalThis.fetch = async () => response({ paragraphs: [] });
    await assert.rejects(
      () => generatePatientSummary(trustFixtures[3].input.sources[0]),
      /schema/,
    );
  }));
test("provider evaluation makes eight calls, records errors and continues", () =>
  isolated(async () => {
    process.env.OPENAI_API_KEY = "synthetic";
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("Synthetic provider failure");
    };
    const r = await evaluateTrust("ai");
    assert.equal(calls, 8);
    assert.equal(r.errors, 8);
    assert.equal(r.completed, 0);
    assert.ok(r.examples.every((e) => e.error));
  }));
