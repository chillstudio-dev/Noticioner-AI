import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
  onLog: () => {},
  onError: () => {},
});
let identity: Server | undefined, server: Server | undefined;
let app: Awaited<ReturnType<(typeof import("next"))["default"]>> | undefined;
let stopping = false;
let pgStarted = false;
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
  await app?.close().catch(() => {});
  if (pgStarted) await pg.stop().catch(() => {});
}
try {
  if (
    !(await access(join(root, "postgres", "PG_VERSION")).then(
      () => true,
      () => false,
    ))
  )
    await pg.initialise();
  await pg.start();
  pgStarted = true;
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
  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Demo startup failed.",
  );
  await shutdown();
  process.exitCode = 1;
}
