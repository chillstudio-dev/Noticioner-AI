import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
const port = Number(process.env.PRACTICE_TEST_PORT || 55432);
const externalUrl = process.env.PRACTICE_TEST_DATABASE_URL;
let directory;
let pg;
let databaseUrl;

if (externalUrl) {
  const parsed = new URL(externalUrl);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  ) {
    throw new Error(
      "PRACTICE_TEST_DATABASE_URL must point to an isolated loopback PostgreSQL database.",
    );
  }
  databaseUrl = externalUrl;
} else {
  directory = await mkdtemp(join(tmpdir(), "noticioner-pg-"));
  const password = randomBytes(24).toString("hex");
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  pg = new EmbeddedPostgres({
    databaseDir: join(directory, "db"),
    user: "practice_test",
    password,
    port,
    persistent: false,
    authMethod: "scram-sha-256",
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  databaseUrl = `postgresql://practice_test:${password}@127.0.0.1:${port}/postgres`;
}
const env = {
  ...process.env,
  PRACTICE_DATABASE_URL: databaseUrl,
};
function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { env, stdio: "inherit" });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Practice check failed: " + code)),
    );
  });
}
try {
  if (pg) {
    await pg.initialise();
    await pg.start();
  }
  await run(["--import", "tsx", "scripts/practice-migrate.ts"]);
  const tests = (await readdir("tests")).filter(
    (name) => name.startsWith("practice-") && name.endsWith(".test.ts"),
  );
  await run([
    "--import",
    "tsx",
    "--test",
    ...tests.map((name) => "tests/" + name),
  ]);
} finally {
  if (pg) await pg.stop().catch(() => {});
  if (directory) await rm(directory, { recursive: true, force: true });
}
