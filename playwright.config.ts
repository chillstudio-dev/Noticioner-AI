import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    ...(process.env.TEST_BROWSER_CHANNEL
      ? { channel: process.env.TEST_BROWSER_CHANNEL }
      : {}),
  },
  reporter: "list",
});
