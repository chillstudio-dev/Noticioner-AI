import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  practiceConfig,
  requirePracticeSession,
  hashToken,
  randomToken,
} from "../src/lib/practice-auth";
import { query, closePracticePool } from "../src/lib/practice-store";
const enabled = !!process.env.PRACTICE_DATABASE_URL;
after(async () => {
  await closePracticePool();
});
test("shared session rejects absent credentials before querying storage", async () => {
  await assert.rejects(
    requirePracticeSession(
      new NextRequest("http://localhost/api/practice/bootstrap"),
    ),
    /Sign in/,
  );
});
test("OIDC requires all identity assurance configuration", () => {
  const names = [
    "PRACTICE_OIDC_ISSUER",
    "PRACTICE_OIDC_CLIENT_ID",
    "PRACTICE_APP_ORIGIN",
    "PRACTICE_OIDC_REQUIRED_ACR",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  try {
    names.forEach((name) => delete process.env[name]);
    assert.equal(practiceConfig(), null);
  } finally {
    names.forEach((name) =>
      previous[name] === undefined
        ? delete process.env[name]
        : (process.env[name] = previous[name]),
    );
  }
});
test(
  "session hashes only, expiry and immediate membership revocation",
  { skip: !enabled },
  async () => {
    const organizationId = randomUUID(),
      practitionerId = randomUUID(),
      token = randomToken();
    await query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
      organizationId,
      "Auth test",
    ]);
    await query(
      "INSERT INTO practitioners(id,issuer,subject,display_name) VALUES($1,$2,$3,$4)",
      [
        practitionerId,
        "https://identity.example",
        randomUUID(),
        "Test practitioner",
      ],
    );
    await query(
      "INSERT INTO memberships(organization_id,practitioner_id,role) VALUES($1,$2,'clinician')",
      [organizationId, practitionerId],
    );
    await query(
      "INSERT INTO practice_sessions(token_hash,practitioner_id,organization_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [hashToken(token), practitionerId, organizationId],
    );
    const req = new NextRequest("http://localhost/api/practice/bootstrap", {
      headers: { cookie: "cs_practice_session=" + token },
    });
    assert.equal(
      (await requirePracticeSession(req)).practitionerId,
      practitionerId,
    );
    await query(
      "UPDATE memberships SET active=false WHERE practitioner_id=$1",
      [practitionerId],
    );
    await assert.rejects(requirePracticeSession(req), /revoked/);
    await query("UPDATE memberships SET active=true WHERE practitioner_id=$1", [
      practitionerId,
    ]);
    await query(
      "UPDATE practice_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
      [hashToken(token)],
    );
    await assert.rejects(requirePracticeSession(req), /expired/);
  },
);

test("OIDC verifies signature, nonce, issuer, audience and MFA assurance", async () => {
  const { generateKeyPair, exportJWK, SignJWT } = await import("jose");
  const { verifyPracticeIdToken } = await import("../src/lib/practice-auth");
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const names = [
    "PRACTICE_DATABASE_URL",
    "PRACTICE_APP_ORIGIN",
    "PRACTICE_OIDC_ISSUER",
    "PRACTICE_OIDC_CLIENT_ID",
    "PRACTICE_OIDC_REQUIRED_ACR",
  ];
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    PRACTICE_DATABASE_URL: "postgresql://unused",
    PRACTICE_APP_ORIGIN: "https://records.example",
    PRACTICE_OIDC_ISSUER: "https://identity.example",
    PRACTICE_OIDC_CLIENT_ID: "practice",
    PRACTICE_OIDC_REQUIRED_ACR: "mfa",
  });
  globalThis.fetch = async () =>
    Response.json({
      keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }],
    });
  async function token(claims = {}) {
    return new SignJWT({ nonce: "nonce", acr: "mfa", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("verified-subject")
      .setIssuer("https://identity.example")
      .setAudience("practice")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }
  try {
    assert.equal(
      (
        await verifyPracticeIdToken(
          await token(),
          "https://identity.example/jwks",
          "nonce",
        )
      ).sub,
      "verified-subject",
    );
    await assert.rejects(
      verifyPracticeIdToken(
        await token({ nonce: "wrong" }),
        "https://identity.example/jwks",
        "nonce",
      ),
    );
    await assert.rejects(
      verifyPracticeIdToken(
        await token({ acr: "password-only" }),
        "https://identity.example/jwks",
        "nonce",
      ),
    );
    const wrongAudience = await new SignJWT({ nonce: "nonce", acr: "mfa" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject("subject")
      .setIssuer("https://identity.example")
      .setAudience("another-app")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await assert.rejects(
      verifyPracticeIdToken(
        wrongAudience,
        "https://identity.example/jwks",
        "nonce",
      ),
    );
    const forged = (await token()).split(".");
    forged[1] = Buffer.from(JSON.stringify({ sub: "attacker" })).toString(
      "base64url",
    );
    await assert.rejects(
      verifyPracticeIdToken(
        forged.join("."),
        "https://identity.example/jwks",
        "nonce",
      ),
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
