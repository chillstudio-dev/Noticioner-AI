import { NextRequest, NextResponse } from "next/server";
import {
  discovery,
  hashToken,
  practiceConfig,
  practiceCookie,
  randomToken,
  requirePracticeSession,
  verifyPracticeIdToken,
} from "@/lib/practice-auth";
import {
  auditPractice,
  PracticeError,
  query,
  withPracticeTransaction,
} from "@/lib/practice-store";
import { createHash, timingSafeEqual } from "node:crypto";
export const runtime = "nodejs";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  let callbackOrigin: string | undefined;
  try {
    const config = practiceConfig();
    callbackOrigin = config?.origin;
    if (action === "session" && req.method === "GET") {
      if (!config) return json({ configured: false, authenticated: false });
      try {
        const actor = await requirePracticeSession(req);
        const organizations = await query(
          "SELECT o.id,o.name,m.role FROM organizations o JOIN memberships m ON m.organization_id=o.id WHERE m.practitioner_id=$1 AND m.active ORDER BY o.name",
          [actor.practitionerId],
        );
        return json({
          configured: true,
          authenticated: true,
          demo: config.demo,
          actor,
          organizations: organizations.rows,
        });
      } catch (e) {
        if (e instanceof PracticeError && e.status === 401)
          return json({
            configured: true,
            authenticated: false,
            demo: config.demo,
          });
        throw e;
      }
    }
    if (!config)
      throw new PracticeError(
        503,
        "Shared practice identity provider is not configured.",
      );
    if (
      req.method !== "GET" &&
      (req.headers.get("origin") !== config.origin ||
        req.headers.get("sec-fetch-site") === "cross-site")
    )
      throw new PracticeError(403, "Origin rejected.");
    if (action === "login" && req.method === "GET") {
      const { metadata } = await discovery();
      const state = randomToken(),
        nonce = randomToken(),
        verifier = randomToken();
      await withPracticeTransaction(async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(7259123)");
        await client.query("DELETE FROM oidc_flows WHERE expires_at<now()");
        const pending = await client.query(
          "SELECT count(*)::int AS count FROM oidc_flows",
        );
        if (pending.rows[0].count >= 200)
          throw new PracticeError(
            429,
            "Too many pending sign-ins. Try again shortly.",
          );
        await client.query(
          "INSERT INTO oidc_flows(state_hash,verifier,nonce,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
          [hashToken(state), verifier, nonce],
        );
      });
      const url = new URL(metadata.authorization_endpoint);
      Object.entries({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: "openid profile",
        state,
        nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        acr_values: config.requiredAcr,
      }).forEach(([k, v]) => url.searchParams.set(k, v));
      const response = NextResponse.redirect(url);
      response.cookies.set("cs_oidc_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secure,
        path: "/api/practice-auth",
        maxAge: 600,
      });
      return response;
    }
    if (action === "callback" && req.method === "GET") {
      const state = req.nextUrl.searchParams.get("state") || "",
        cookie = req.cookies.get("cs_oidc_state")?.value || "",
        code = req.nextUrl.searchParams.get("code");
      if (
        !code ||
        !state ||
        state.length !== cookie.length ||
        !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))
      )
        throw new PracticeError(401, "Invalid sign-in state.");
      const { rows } = await query(
        "DELETE FROM oidc_flows WHERE state_hash=$1 AND expires_at>now() RETURNING verifier,nonce",
        [hashToken(state)],
      );
      if (!rows.length)
        throw new PracticeError(401, "Sign-in expired. Try again.");
      const { metadata } = await discovery();
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: rows[0].verifier,
      });
      if (config.secret) body.set("client_secret", config.secret);
      const tokenResponse = await fetch(metadata.token_endpoint, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!tokenResponse.ok)
        throw new PracticeError(401, "Identity provider rejected sign-in.");
      const tokens = await tokenResponse.json();
      if (typeof tokens.id_token !== "string")
        throw new PracticeError(401, "Missing identity token.");
      const payload = await verifyPracticeIdToken(
        tokens.id_token,
        metadata.jwks_uri,
        rows[0].nonce,
      );
      const member = await query(
        "SELECT p.id,m.organization_id FROM practitioners p JOIN memberships m ON m.practitioner_id=p.id WHERE p.issuer=$1 AND p.subject=$2 AND m.active ORDER BY m.organization_id LIMIT 1",
        [config.issuer, payload.sub],
      );
      if (!member.rows.length)
        throw new PracticeError(
          403,
          "Your practice administrator must provision your account.",
        );
      const token = randomToken();
      await query(
        "INSERT INTO practice_sessions(token_hash,practitioner_id,organization_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
        [hashToken(token), member.rows[0].id, member.rows[0].organization_id],
      );
      const response = NextResponse.redirect(config.origin + "/practice");
      response.cookies.set("cs_oidc_state", "", {
        path: "/api/practice-auth",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
        secure: config.secure,
      });
      response.cookies.set(practiceCookie, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.secure,
        path: "/",
        maxAge: 3600,
      });
      return response;
    }
    if (action === "logout" && req.method === "POST") {
      await query("DELETE FROM practice_sessions WHERE token_hash=$1", [
        hashToken(req.cookies.get(practiceCookie)?.value || ""),
      ]);
      const response = json({ ok: true });
      response.cookies.delete(practiceCookie);
      return response;
    }
    if (action === "organization" && req.method === "POST") {
      const actor = await requirePracticeSession(req),
        body = await req.json();
      if (
        typeof body.organizationId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.organizationId)
      )
        throw new PracticeError(400, "Choose a valid organization.");
      await withPracticeTransaction(async (client) => {
        const member = await client.query(
          "SELECT 1 FROM memberships WHERE organization_id=$1 AND practitioner_id=$2 AND active",
          [body.organizationId, actor.practitionerId],
        );
        if (!member.rows.length)
          throw new PracticeError(403, "Membership unavailable.");
        await client.query(
          "UPDATE practice_sessions SET organization_id=$1 WHERE token_hash=$2",
          [
            body.organizationId,
            hashToken(req.cookies.get(practiceCookie)!.value),
          ],
        );
        await auditPractice(
          client,
          actor,
          "Organization switched",
          body.organizationId,
        );
      });
      return json({ ok: true });
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    const status = error instanceof PracticeError ? error.status : 503;
    const message =
      error instanceof PracticeError
        ? error.message
        : "Practice sign-in unavailable. Contact your administrator.";
    if (action === "callback") {
      if (callbackOrigin)
        return NextResponse.redirect(
          callbackOrigin + "/practice?authError=" + encodeURIComponent(message),
        );
    }
    return json({ error: message }, status);
  }
}
export { handle as GET, handle as POST };
