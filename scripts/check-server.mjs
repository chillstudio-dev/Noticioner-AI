import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
const dir = await mkdtemp(join(tmpdir(), "cliniscribe-server-check-"));
const env = {
  ...process.env,
  DATABASE_PATH: join(dir, "test.sqlite"),
  AI_PROVIDER: "openai",
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
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
  await rm(dir, { recursive: true, force: true });
}
