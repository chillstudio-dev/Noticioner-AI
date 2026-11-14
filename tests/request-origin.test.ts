import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameRequestOrigin } from "../src/lib/request-origin";
test("origin check uses the browser-facing host and exact port", () => {
  assert.equal(
    isSameRequestOrigin("http://127.0.0.1:3000", "127.0.0.1:3000", "http:"),
    true,
  );
  assert.equal(
    isSameRequestOrigin("http://localhost:3000", "localhost:3000", "http:"),
    true,
  );
  assert.equal(
    isSameRequestOrigin("http://localhost:3000", "127.0.0.1:3000", "http:"),
    false,
  );
  assert.equal(
    isSameRequestOrigin("http://127.0.0.1:3001", "127.0.0.1:3000", "http:"),
    false,
  );
  assert.equal(
    isSameRequestOrigin("https://evil.example", "127.0.0.1:3000", "http:"),
    false,
  );
  assert.equal(isSameRequestOrigin("null", "127.0.0.1:3000", "http:"), false);
  assert.equal(
    isSameRequestOrigin("https://example.com", "example.com", "http:"),
    false,
  );
});
