/** Explicit localhost-only transport exception for the synthetic demonstration runner. */
export function practiceDemoMode() {
  if (process.env.PRACTICE_DEMO !== "true") return false;
  const app = new URL(process.env.PRACTICE_APP_ORIGIN || "invalid:");
  const issuer = new URL(process.env.PRACTICE_OIDC_ISSUER || "invalid:");
  if (
    process.env.PRACTICE_ONLY !== "true" ||
    process.env.PRACTICE_OIDC_REQUIRED_ACR !== "urn:noticioner:demo" ||
    [app, issuer].some(
      (url) =>
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash,
    )
  )
    throw new Error(
      "The synthetic demonstration requires shared-only mode and loopback HTTP origins.",
    );
  return true;
}
