import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
const dir = await mkdtemp(join(tmpdir(), "noticioner-server-check-"));
const mockProvider = createServer((request, response) => {
  let raw = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    raw += chunk;
  });
  request.on("end", () => {
    try {
      const body = JSON.parse(raw);
      const input = JSON.parse(body.messages?.[0]?.content ?? "null");
      const result = Array.isArray(input)
        ? {
            statements: input.map((segment, index) => ({
              id: `test-${index + 1}`,
              section: "Subjective",
              text: segment.text,
              speaker: segment.speaker,
              speakerBasis: segment.speaker === "Unknown" ? "Unknown" : "Explicit",
              evidence: [{ segmentId: segment.id, quote: segment.text }],
              certainty: segment.speaker === "Unknown" ? "Uncertain" : "Supported",
              category: "other",
            })),
          }
        : {
            claims: (input?.claims ?? []).map((claim) => ({
              statementId: claim.id,
              status: "supported",
              reason: "Synthetic mock provider response for the workflow test.",
            })),
            concerns: [],
          };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(result) }],
          stop_reason: "end_turn",
        }),
      );
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Invalid mock provider input." }));
    }
  });
});
await new Promise((resolve) => mockProvider.listen(0, "127.0.0.1", resolve));
const providerPort = mockProvider.address().port;
const env = {
  ...process.env,
  DATABASE_PATH: join(dir, "test.sqlite"),
  AI_PROVIDER: "anthropic",
  ANTHROPIC_API_KEY: "synthetic-test-key",
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${providerPort}/v1`,
  OPENAI_API_KEY: "",
  STT_API_KEY: "",
  STT_PROVIDER: "openai",
};
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3107",
  ],
  { env, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
server.stdout.on("data", (b) => {
  logs += b;
});
server.stderr.on("data", (b) => {
  logs += b;
});
const exit = once(server, "exit");
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      if ((await fetch("http://127.0.0.1:3107")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready)
    throw new Error("Production test server did not become ready. " + logs);
  const test = spawn(process.execPath, ["--test", "tests/http.test.mjs"], {
    env: { ...env, TEST_BASE_URL: "http://127.0.0.1:3107" },
    stdio: "inherit",
  });
  const [code] = await once(test, "exit");
  process.exitCode = code ?? 1;
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await exit;
  await new Promise((resolve) => mockProvider.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
