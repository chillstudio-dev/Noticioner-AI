import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { once } from "node:events";
import EmbeddedPostgres from "embedded-postgres";
import {
  startDemoIdentity,
  demoAccounts,
  demoPassword,
  demoVerificationCode,
} from "./demo-identity";

const root = resolve("data/practice/demo");
const execFileAsync = promisify(execFile);
await mkdir(root, { recursive: true, mode: 0o700 });
try {
  process.loadEnvFile(".env.local");
} catch {}
const statePath = join(root, "local-secrets.json");
let state: { databasePassword: string; fileKey: string; clientSecret: string };
try {
  state = JSON.parse(await readFile(statePath, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  state = {
    databasePassword: randomBytes(32).toString("hex"),
    fileKey: randomBytes(32).toString("base64"),
    clientSecret: randomBytes(32).toString("base64url"),
  };
  await writeFile(statePath, JSON.stringify(state), {
    flag: "wx",
    mode: 0o600,
  });
}
if (!state.databasePassword || !state.fileKey || !state.clientSecret)
  throw new Error(
    "Demo state is invalid; do not point this runner at other database files.",
  );
const appOrigin = "http://127.0.0.1:3109",
  issuer = "http://127.0.0.1:4111";
Object.assign(process.env, {
  NODE_ENV: "production",
  PRACTICE_DEMO: "true",
  PRACTICE_ONLY: "true",
  PRACTICE_APP_ORIGIN: appOrigin,
  PRACTICE_OIDC_ISSUER: issuer,
  PRACTICE_OIDC_CLIENT_ID: "noticioner-local-demo",
  PRACTICE_OIDC_CLIENT_SECRET: state.clientSecret,
  PRACTICE_OIDC_REQUIRED_ACR: "urn:noticioner:demo",
  PRACTICE_FILE_KEY: state.fileKey,
  PRACTICE_DATABASE_URL: `postgresql://practice_demo:${state.databasePassword}@127.0.0.1:55433/postgres`,
});
await access(".next/BUILD_ID").catch(() => {
  throw new Error("Run npm run build before npm run demo:server.");
});
const pg = new EmbeddedPostgres({
  databaseDir: join(root, "postgres"),
  user: "practice_demo",
  password: state.databasePassword,
  port: 55433,
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: (message) => process.stderr.write(`[sample-postgres] ${message}`),
  onError: (error) =>
    console.error(
      `[sample-postgres] ${error instanceof Error ? error.message : "PostgreSQL process error"}`,
    ),
});
const nativePgBinDirs = [
  process.env.NOTICIONER_POSTGRES_BIN_DIR,
  "/opt/homebrew/opt/postgresql@18/bin",
  "/usr/local/opt/postgresql@18/bin",
].filter((value): value is string => !!value);
let nativePgCtl: string | undefined;
let nativeInitdb: string | undefined;
for (const directory of nativePgBinDirs) {
  try {
    await Promise.all([
      access(join(directory, "pg_ctl")),
      access(join(directory, "initdb")),
    ]);
    nativePgCtl = join(directory, "pg_ctl");
    nativeInitdb = join(directory, "initdb");
    break;
  } catch {}
}
let postgresDir = join(root, "postgres");
if (nativePgCtl) {
  const version = await readFile(join(postgresDir, "PG_VERSION"), "utf8").catch(
    () => "",
  );
  if (!version.trim().startsWith("18"))
    postgresDir = join(root, "postgres-homebrew-18");
}
let identity: Server | undefined, server: Server | undefined;
let app: Awaited<ReturnType<(typeof import("next"))["default"]>> | undefined;
let stopping = false;
let pgStarted = false;
let nativePgStarted = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log(
    "Stopping the local demonstration server; synthetic records are retained.",
  );
  server?.closeAllConnections();
  if (server?.listening)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  identity?.closeAllConnections();
  if (identity?.listening)
    await new Promise<void>((resolve) => identity!.close(() => resolve()));
  if (pgStarted) await pg.stop().catch(() => {});
  if (nativePgStarted && nativePgCtl)
    await execFileAsync(
      nativePgCtl,
      ["-D", postgresDir, "-m", "fast", "-w", "stop"],
      { timeout: 60000 },
    ).catch(() => {});
  await app?.close().catch(() => {});
}
try {
  if (nativePgCtl && nativeInitdb) {
    const versionFile = join(postgresDir, "PG_VERSION");
    const version = await readFile(versionFile, "utf8").catch(() => "");
    if (!version.trim()) {
      const passwordFile = join(root, ".initdb-password");
      await writeFile(passwordFile, `${state.databasePassword}\n`, {
        mode: 0o600,
      });
      try {
        await execFileAsync(
          nativeInitdb,
          [
            "-D",
            postgresDir,
            "-U",
            "practice_demo",
            "--pwfile",
            passwordFile,
            "--auth-local=scram-sha-256",
            "--auth-host=scram-sha-256",
            "--encoding=UTF8",
            "--locale=C",
          ],
          { timeout: 120000 },
        );
      } finally {
        await unlink(passwordFile).catch(() => {});
      }
    }
    const running = await execFileAsync(nativePgCtl, ["-D", postgresDir, "status"])
      .then(() => true)
      .catch(() => false);
    if (!running) {
      await execFileAsync(
        nativePgCtl,
        [
          "-D",
          postgresDir,
          "-o",
          "-p 55433 -h 127.0.0.1",
          "-l",
          join(root, "postgres.log"),
          "-w",
          "start",
        ],
        { timeout: 60000 },
      );
      nativePgStarted = true;
    }
    console.log("Sample PostgreSQL 18 is ready in the isolated demo data folder.");
  } else {
    if (
      !(await access(join(postgresDir, "PG_VERSION")).then(
        () => true,
        () => false,
      ))
    )
      await pg.initialise();
    await pg.start();
    pgStarted = true;
    console.log("Sample PostgreSQL is ready in the isolated demo data folder.");
  }
  console.log("Applying migrations and seeding synthetic records.");
  const { migratePractice } = await import("./practice-migrate");
  const { closePracticePool } = await import("../src/lib/practice-store");
  await migratePractice();
  const { seedDemo } = await import("./demo-seed");
  await seedDemo(issuer);
  await closePracticePool();
  identity = await startDemoIdentity({
    issuer,
    appOrigin,
    clientId: process.env.PRACTICE_OIDC_CLIENT_ID!,
    clientSecret: state.clientSecret,
  });
  const next = (await import("next")).default;
  app = next({ dev: false, hostname: "127.0.0.1", port: 3109 });
  await app.prepare();
  const handler = app.getRequestHandler();
  server = createServer((req, res) => {
    if (req.headers.host !== "127.0.0.1:3109") {
      res.writeHead(400);
      res.end("Invalid demo host");
      return;
    }
    if (new URL(req.url || "/", appOrigin).pathname === "/") {
      res.writeHead(302, { Location: "/doctor", "Cache-Control": "no-store" });
      res.end();
      return;
    }
    void handler(req, res);
  });
  server.listen(3109, "127.0.0.1");
  await once(server, "listening");
  console.log(`\nSample Hospital is ready: ${appOrigin}/doctor`);
  for (const account of demoAccounts)
    console.log(
      `${account.username} — ${account.name} — ${account.access === "view" ? "View only on assigned sample patients" : account.role === "reviewer" ? "Review, edit and manage access" : "Edit clinical records"}`,
    );
  console.log(
    `Demo password: ${demoPassword}\nSimulated verification code: ${demoVerificationCode}\nSynthetic data only. Loopback-bound HTTP; this is not a real hospital identity provider or real MFA.\nPress Ctrl+C to stop.\n`,
  );
  const stopOnSignal = () => {
    // Terminal Ctrl-C and the parent launcher may signal us together. Let the
    // first shutdown finish stopping PostgreSQL before exiting the process.
    if (stopping) return;
    void shutdown().then(() => process.exit(0));
  };
  process.on("SIGINT", stopOnSignal);
  process.on("SIGTERM", stopOnSignal);
} catch (error) {
  console.error(
    `Demo startup failed: ${error instanceof Error ? error.message : "unknown startup error"}`,
  );
  await shutdown();
  process.exitCode = 1;
}
