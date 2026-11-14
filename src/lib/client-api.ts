export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let workspaceOpening: Promise<unknown> | null = null;
export async function loadWorkspace<T>(): Promise<T> {
  try {
    return await api<T>("bootstrap");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    if (!workspaceOpening) {
      workspaceOpening = api("session", "POST", {}).finally(() => {
        workspaceOpening = null;
      });
    }
    await workspaceOpening;
    return api<T>("bootstrap");
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    signal: AbortSignal.timeout(path === "evaluation/run" ? 540000 : 120000),
    method,
    headers:
      body instanceof FormData
        ? undefined
        : body
          ? { "Content-Type": "application/json" }
          : undefined,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const v = await r.json().catch(() => {
    throw new ApiError(
      r.status,
      "The server returned an unexpected response. Please retry.",
    );
  });
  if (!r.ok)
    throw new ApiError(
      r.status,
      v.details?.join(" · ") || v.error || "Request failed",
    );
  return v;
}
