import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "../src/app/api/[...path]/route";

test("shared-only deployments reject anonymous workspace reads, creation and deletion", async () => {
  const previous = process.env.PRACTICE_ONLY;
  process.env.PRACTICE_ONLY = "true";
  try {
    for (const [method, path, handler] of [
      ["GET", "bootstrap", GET],
      ["POST", "session", POST],
      ["DELETE", "workspace", DELETE],
    ] as const) {
      const result = await handler(
        new NextRequest(`http://localhost/api/${path}`, { method }),
        { params: Promise.resolve({ path: [path] }) },
      );
      assert.equal(result.status, 404);
      assert.equal(result.headers.get("set-cookie"), null);
    }
  } finally {
    if (previous === undefined) delete process.env.PRACTICE_ONLY;
    else process.env.PRACTICE_ONLY = previous;
  }
});

test("practice HTTP routes deny unauthenticated reads and cross-origin writes", async () => {
  const { GET: sharedGet, POST: sharedPost } =
    await import("../src/app/api/practice/[...path]/route");
  const context = { params: Promise.resolve({ path: ["bootstrap"] }) };
  const read = await sharedGet(
    new NextRequest("http://localhost/api/practice/bootstrap"),
    context,
  );
  assert.equal(read.status, 401);
  assert.equal(read.headers.get("cache-control"), "no-store");
  const write = await sharedPost(
    new NextRequest("http://localhost/api/practice/patients", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        host: "localhost",
        "sec-fetch-site": "cross-site",
      },
    }),
    context,
  );
  assert.equal(write.status, 403);
});
