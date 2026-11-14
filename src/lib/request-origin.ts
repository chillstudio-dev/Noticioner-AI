/** Compare the browser origin with the incoming Host, not Next's internal hostname.
 * Do not trust arbitrary forwarded-host headers or allow all loopback origins.
 */
export function isSameRequestOrigin(
  origin: string | null,
  host: string | null,
  protocol: string,
): boolean {
  if (!origin) return true; // Non-browser clients still require authentication.
  if (!host) return false;
  try {
    const expected = new URL(`${protocol}//${host}`).origin;
    return origin === expected;
  } catch {
    return false;
  }
}
