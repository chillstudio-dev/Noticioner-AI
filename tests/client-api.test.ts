import { test } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, loadWorkspace } from "../src/lib/client-api";
test("client rejects malformed successful server responses instead of treating them as workspace data", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<html>Error</html>");
    await assert.rejects(
      () => api("bootstrap"),
      (e) => e instanceof ApiError && e.message.includes("unexpected response"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("concurrent anonymous loads create one workspace without a login", async () => {
  const original = globalThis.fetch;
  let opened = false,
    requests = 0;
  try {
    globalThis.fetch = async (url) => {
      if (url === "/api/session") {
        requests++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        opened = true;
        return new Response('{"ok":true}');
      }
      return opened
        ? new Response('{"patients":[]}')
        : new Response('{"error":"Open workspace"}', { status: 401 });
    };
    const results = await Promise.all([loadWorkspace(), loadWorkspace()]);
    assert.equal(requests, 1);
    assert.deepEqual(results, [{ patients: [] }, { patients: [] }]);
    await loadWorkspace();
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("client preserves actionable server validation errors", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: "Invalid input",
          details: ["Name is required"],
        }),
        { status: 400 },
      );
    await assert.rejects(
      () => api("patients", "POST", {}),
      (e) =>
        e instanceof ApiError &&
        e.status === 400 &&
        e.message === "Name is required",
    );
  } finally {
    globalThis.fetch = original;
  }
});
