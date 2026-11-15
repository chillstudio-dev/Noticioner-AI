import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { PracticeError, query, type PracticeActor } from "./practice-store";
import { practiceDemoMode } from "./practice-demo";
export const practiceCookie = "cs_practice_session";
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export function practiceConfig() {
  const issuer = process.env.PRACTICE_OIDC_ISSUER,
    clientId = process.env.PRACTICE_OIDC_CLIENT_ID,
    secret = process.env.PRACTICE_OIDC_CLIENT_SECRET,
    origin = process.env.PRACTICE_APP_ORIGIN,
    requiredAcr = process.env.PRACTICE_OIDC_REQUIRED_ACR;
  if (
    !issuer ||
    !clientId ||
    !origin ||
    !requiredAcr ||
    !process.env.PRACTICE_DATABASE_URL
  )
    return null;
  const issuerURL = new URL(issuer),
    appURL = new URL(origin);
  const demo = practiceDemoMode();
  if (
    (issuerURL.protocol !== "https:" && !demo) ||
    appURL.origin !== origin ||
    (appURL.protocol !== "https:" &&
      !demo &&
      !(
        process.env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1"].includes(appURL.hostname)
      ))
  )
    throw new PracticeError(503, "Shared practice configuration is invalid.");
  return {
    issuer,
    clientId,
    secret,
    origin,
    requiredAcr,
    demo,
    redirectUri: origin + "/api/practice-auth/callback",
    secure: appURL.protocol === "https:",
  };
}
export async function requirePracticeSession(
  req: NextRequest,
): Promise<PracticeActor> {
  const token = req.cookies.get(practiceCookie)?.value;
  if (!token)
    throw new PracticeError(401, "Sign in with your practice account.");
  const { rows } = await query(
    "SELECT p.id,p.display_name,s.organization_id,m.role FROM practice_sessions s JOIN practitioners p ON p.id=s.practitioner_id JOIN memberships m ON m.organization_id=s.organization_id AND m.practitioner_id=p.id WHERE s.token_hash=$1 AND s.expires_at>now() AND m.active",
    [hashToken(token)],
  );
  if (!rows.length)
    throw new PracticeError(401, "Session expired or membership revoked.");
  const r = rows[0];
  return {
    practitionerId: r.id,
    organizationId: r.organization_id,
    role: r.role,
    displayName: r.display_name,
  };
}
export async function discovery() {
  const config = practiceConfig();
  if (!config)
    throw new PracticeError(
      503,
      "Shared practice identity provider is not configured.",
    );
  const response = await fetch(
    config.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
    {
      signal: AbortSignal.timeout(10000),
      redirect: "error",
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new PracticeError(503, "Identity provider unavailable.");
  const metadata = await response.json();
  if (metadata.issuer !== config.issuer)
    throw new PracticeError(503, "Identity provider issuer mismatch.");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
    if (
      typeof metadata[key] !== "string" ||
      (new URL(metadata[key]).protocol !== "https:" &&
        !(
          config.demo &&
          new URL(metadata[key]).origin === new URL(config.issuer).origin
        ))
    )
      throw new PracticeError(503, "Invalid identity provider metadata.");
  }
  return { config, metadata };
}
export async function verifyPracticeIdToken(
  token: string,
  jwksUri: string,
  nonce: string,
) {
  const config = practiceConfig();
  if (!config)
    throw new PracticeError(503, "Identity provider is not configured.");
  const { payload } = await jwtVerify(
    token,
    createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 10000 }),
    {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["sub", "exp", "iat", "nonce", "acr"],
      maxTokenAge: "10m",
    },
  );
  if (
    payload.nonce !== nonce ||
    payload.acr !== config.requiredAcr ||
    (Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== config.clientId)
  )
    throw new PracticeError(401, "Identity assurance validation failed.");
  return payload;
}
