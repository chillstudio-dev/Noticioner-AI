import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, generateKeyPair, exportJWK } from "jose";

export const demoAccounts = [
  {
    username: "reviewer@demo.local",
    subject: "demo-reviewer",
    name: "Dr Maya Chen",
    role: "reviewer",
    access: "edit",
  },
  {
    username: "doctor@demo.local",
    subject: "demo-doctor",
    name: "Dr Daniel Lim",
    role: "clinician",
    access: "edit",
  },
  {
    username: "viewer@demo.local",
    subject: "demo-viewer",
    name: "Dr Aisha Rahman",
    role: "clinician",
    access: "view",
  },
] as const;
export const demoPassword = "DemoDoctor!2026";
export const demoVerificationCode = "123456";
const token = () => randomBytes(32).toString("base64url");
const equal = (a: string, b: string) => {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
};
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
type Flow = {
  state: string;
  nonce: string;
  challenge: string;
  expires: number;
  csrf: string;
  attempts: number;
};
type Code = {
  nonce: string;
  challenge: string;
  subject: string;
  expires: number;
};

async function formBody(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const data of req) {
    const chunk = Buffer.from(data);
    size += chunk.length;
    if (size > 16384) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export async function startDemoIdentity(options: {
  issuer: string;
  appOrigin: string;
  clientId: string;
  clientSecret: string;
}) {
  const issuer = new URL(options.issuer),
    appOrigin = new URL(options.appOrigin);
  for (const url of [issuer, appOrigin])
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "The demo identity service only supports loopback origins.",
      );
  const redirectUri = options.appOrigin + "/api/practice-auth/callback";
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: token(),
    alg: "RS256",
    use: "sig",
  };
  const flows = new Map<string, Flow>(),
    codes = new Map<string, Code>();
  function clean() {
    for (const [id, flow] of flows)
      if (flow.expires < Date.now()) flows.delete(id);
    for (const [id, code] of codes)
      if (code.expires < Date.now()) codes.delete(id);
  }
  function respond(
    res: ServerResponse,
    status: number,
    body: string,
    html = false,
  ) {
    res.writeHead(status, {
      "Content-Type": html ? "text/html; charset=utf-8" : "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${options.appOrigin}; base-uri 'none'; frame-ancestors 'none'`,
    });
    res.end(body);
  }
  function page(
    id: string,
    flow: Flow,
    message = "",
    username = "reviewer@demo.local",
  ) {
    return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample Hospital · Doctor sign-in</title><style>*{box-sizing:border-box}body{margin:0;background:#f2f7f4;color:#183a37;font:15px system-ui,sans-serif}main{max-width:570px;margin:6vh auto;padding:30px;background:white;border:1px solid #dbe8df;border-radius:20px}h1{font-size:32px;letter-spacing:-1px}p{line-height:1.6;color:#526b60}.tag{background:#fff0d7;border:1px solid #e5cc98;padding:10px;border-radius:8px;font-size:13px}label{display:block;margin:18px 0;font-weight:600}input{display:block;width:100%;margin-top:7px;padding:12px;border:1px solid #c9d9cf;border-radius:8px;font:inherit}button{background:#126e61;color:white;border:0;border-radius:8px;padding:13px 18px;font:inherit;cursor:pointer}.error{color:#9b342c}code{font-size:13px}small{display:block;color:#61776b;margin-top:18px;line-height:1.7}@media(max-width:600px){main{margin:15px;padding:23px}}</style><main><div class="tag">LOCAL DEMONSTRATION · SYNTHETIC PATIENTS ONLY</div><h1>Sample Hospital<br>Doctor sign-in</h1><p>Sign in to demonstrate shared patient records and care-team permissions.</p>${message ? `<p class="error" role="alert">${escape(message)}</p>` : ""}<form method="post" action="/login"><input type="hidden" name="requestId" value="${escape(id)}"><input type="hidden" name="csrf" value="${escape(flow.csrf)}"><label>Email<input name="username" type="email" autocomplete="username" required value="${escape(username)}"></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><label>Demo verification code<input name="verificationCode" inputmode="numeric" autocomplete="one-time-code" required maxlength="6"></label><button type="submit">Sign in to Sample Hospital</button></form><small><b>Sample accounts</b><br><code>reviewer@demo.local</code> — approve and manage care access<br><code>doctor@demo.local</code> — add clinical records<br><code>viewer@demo.local</code> — view assigned patient records<br>Password for all: <code>${demoPassword}</code><br>Demo code: <code>${demoVerificationCode}</code><br>This displayed code simulates identity verification. It is not real MFA.<br><a href="${escape(options.appOrigin)}/doctor">Back to doctor portal</a></small></main></html>`;
  }
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== issuer.host)
        return respond(res, 400, '{"error":"Invalid host"}');
      clean();
      const url = new URL(req.url || "/", options.issuer);
      if (
        req.method === "GET" &&
        url.pathname === "/.well-known/openid-configuration"
      )
        return respond(
          res,
          200,
          JSON.stringify({
            issuer: options.issuer,
            authorization_endpoint: options.issuer + "/authorize",
            token_endpoint: options.issuer + "/token",
            jwks_uri: options.issuer + "/jwks",
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["client_secret_post"],
          }),
        );
      if (req.method === "GET" && url.pathname === "/jwks")
        return respond(res, 200, JSON.stringify({ keys: [jwk] }));
      if (req.method === "GET" && url.pathname === "/authorize") {
        const p = url.searchParams;
        if (
          p.get("client_id") !== options.clientId ||
          p.get("redirect_uri") !== redirectUri ||
          p.get("response_type") !== "code" ||
          p.get("code_challenge_method") !== "S256" ||
          p.get("acr_values") !== "urn:noticioner:demo" ||
          !/^[A-Za-z0-9_-]{43}$/.test(p.get("code_challenge") || "") ||
          !/^[A-Za-z0-9_-]{32,128}$/.test(p.get("state") || "") ||
          !/^[A-Za-z0-9_-]{32,128}$/.test(p.get("nonce") || "")
        )
          return respond(res, 400, '{"error":"Invalid authorization request"}');
        if (flows.size >= 200)
          return respond(res, 429, '{"error":"Too many pending logins"}');
        const id = token(),
          flow = {
            state: p.get("state")!,
            nonce: p.get("nonce")!,
            challenge: p.get("code_challenge")!,
            expires: Date.now() + 300000,
            csrf: token(),
            attempts: 0,
          };
        flows.set(id, flow);
        res.setHeader(
          "Set-Cookie",
          `demo_idp_flow=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`,
        );
        return respond(res, 200, page(id, flow), true);
      }
      if (req.method === "POST" && url.pathname === "/login") {
        if (
          req.headers.origin !== options.issuer ||
          req.headers["sec-fetch-site"] === "cross-site"
        )
          return respond(res, 403, '{"error":"Origin rejected"}');
        const form = await formBody(req),
          id = form.get("requestId") || "",
          flow = flows.get(id);
        const cookie = (req.headers.cookie || "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("demo_idp_flow="))
          ?.slice("demo_idp_flow=".length);
        if (!flow || cookie !== id || !equal(form.get("csrf") || "", flow.csrf))
          return respond(
            res,
            400,
            '{"error":"Login expired. Return to the doctor portal."}',
          );
        flow.attempts++;
        if (flow.attempts > 8) {
          flows.delete(id);
          return respond(
            res,
            429,
            '{"error":"Too many attempts. Start sign-in again."}',
          );
        }
        const account = demoAccounts.find(
          (user) => user.username === form.get("username"),
        );
        if (
          !account ||
          !equal(form.get("password") || "", demoPassword) ||
          !equal(form.get("verificationCode") || "", demoVerificationCode)
        )
          return respond(
            res,
            401,
            page(
              id,
              flow,
              "The email, password or demo verification code is incorrect.",
              form.get("username") || "",
            ),
            true,
          );
        flows.delete(id);
        const code = token();
        codes.set(code, {
          nonce: flow.nonce,
          challenge: flow.challenge,
          subject: account.subject,
          expires: Date.now() + 60000,
        });
        const callback = new URL(redirectUri);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", flow.state);
        res.writeHead(302, {
          Location: callback.href,
          "Cache-Control": "no-store",
          "Set-Cookie":
            "demo_idp_flow=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        });
        return res.end();
      }
      if (req.method === "POST" && url.pathname === "/token") {
        const form = await formBody(req),
          id = form.get("code") || "",
          code = codes.get(id);
        if (
          !equal(form.get("client_secret") || "", options.clientSecret) ||
          form.get("client_id") !== options.clientId
        )
          return respond(res, 401, '{"error":"invalid_client"}');
        if (code) codes.delete(id);
        if (
          !code ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("redirect_uri") !== redirectUri ||
          !equal(
            createHash("sha256")
              .update(form.get("code_verifier") || "")
              .digest("base64url"),
            code.challenge,
          )
        )
          return respond(res, 400, '{"error":"invalid_grant"}');
        const idToken = await new SignJWT({
          nonce: code.nonce,
          acr: "urn:noticioner:demo",
          name: demoAccounts.find((user) => user.subject === code.subject)!
            .name,
        })
          .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
          .setSubject(code.subject)
          .setIssuer(options.issuer)
          .setAudience(options.clientId)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        return respond(
          res,
          200,
          JSON.stringify({
            id_token: idToken,
            access_token: token(),
            token_type: "Bearer",
            expires_in: 300,
          }),
        );
      }
      respond(res, 404, '{"error":"Not found"}');
    } catch {
      if (!res.headersSent)
        respond(res, 400, '{"error":"Invalid demo identity request"}');
      else res.end();
    }
  });
  server.requestTimeout = 15000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(issuer.port), "127.0.0.1", resolve);
  });
  return server;
}
