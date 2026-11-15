import { test } from "node:test";
import assert from "node:assert/strict";
import { practiceDemoMode } from "../src/lib/practice-demo";
import { practiceConfig, discovery } from "../src/lib/practice-auth";

test("synthetic HTTP identity is opt-in, loopback-only and cannot weaken normal deployment", async () => {
  const keys = [
    "PRACTICE_DEMO",
    "PRACTICE_ONLY",
    "PRACTICE_APP_ORIGIN",
    "PRACTICE_OIDC_ISSUER",
    "PRACTICE_OIDC_REQUIRED_ACR",
    "PRACTICE_DATABASE_URL",
    "PRACTICE_OIDC_CLIENT_ID",
  ];
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, {
      PRACTICE_DEMO: "false",
      PRACTICE_ONLY: "true",
      PRACTICE_APP_ORIGIN: "http://127.0.0.1:3109",
      PRACTICE_OIDC_ISSUER: "http://127.0.0.1:4111",
      PRACTICE_OIDC_REQUIRED_ACR: "urn:noticioner:demo",
      PRACTICE_DATABASE_URL: "postgresql://unused",
      PRACTICE_OIDC_CLIENT_ID: "demo",
    });
    assert.equal(practiceDemoMode(), false);
    assert.throws(() => practiceConfig(), /invalid/);
    process.env.PRACTICE_DEMO = "true";
    assert.equal(practiceDemoMode(), true);
    assert.equal(practiceConfig()!.demo, true);
    process.env.PRACTICE_APP_ORIGIN = "http://0.0.0.0:3109";
    assert.throws(() => practiceDemoMode(), /loopback/);
    process.env.PRACTICE_APP_ORIGIN = "http://127.0.0.1:3109";
    process.env.PRACTICE_ONLY = "false";
    assert.throws(() => practiceDemoMode(), /shared-only/);
    process.env.PRACTICE_ONLY = "true";
    process.env.PRACTICE_OIDC_REQUIRED_ACR = "mfa";
    assert.throws(() => practiceDemoMode(), /loopback/);
    process.env.PRACTICE_OIDC_REQUIRED_ACR = "urn:noticioner:demo";
    globalThis.fetch = async () =>
      Response.json({
        issuer: process.env.PRACTICE_OIDC_ISSUER,
        authorization_endpoint: "http://remote.example/authorize",
        token_endpoint: "http://127.0.0.1:4111/token",
        jwks_uri: "http://127.0.0.1:4111/jwks",
      });
    await assert.rejects(discovery, /metadata/);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key) =>
      old[key] === undefined
        ? delete process.env[key]
        : (process.env[key] = old[key]),
    );
  }
});
