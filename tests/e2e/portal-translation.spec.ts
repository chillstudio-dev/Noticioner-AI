import { test, expect } from "@playwright/test";

test("doctor portal uses organization sign-in and exposes no local password form", async ({
  page,
}) => {
  await page.route("**/api/practice-auth/session", (route) =>
    route.fulfill({ json: { configured: true, authenticated: false } }),
  );
  await page.goto("/doctor");
  await expect(
    page.getByRole("heading", { name: "Doctor sign-in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with organization" }),
  ).toHaveAttribute("href", "/api/practice-auth/login");
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("doctor portal explains missing configuration and recognizes authenticated doctors", async ({
  page,
}) => {
  let authenticated = false;
  let unavailable = false;
  await page.route("**/api/practice-auth/session", (route) =>
    route.fulfill({
      status: unavailable ? 503 : 200,
      json: authenticated
        ? {
            configured: true,
            authenticated: true,
            actor: { displayName: "Dr Synthetic", role: "reviewer" },
            organizations: [{ id: "org-1", name: "Synthetic Hospital" }],
          }
        : { configured: false, authenticated: false },
    }),
  );
  await page.goto("/doctor");
  await expect(
    page.getByRole("heading", { name: "Organization sign-in needs setup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in with organization" }),
  ).toHaveCount(0);
  authenticated = true;
  await page.getByRole("button", { name: "Check connection again" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Dr Synthetic" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open patient records" }),
  ).toHaveAttribute("href", "/practice");
  unavailable = true;
  await page.getByRole("button", { name: "Check connection again" }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome, Dr Synthetic" }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "doctor sign-in service is unavailable" }),
  ).toBeVisible();
});

test("translation keeps the source intact and invalidates preview when source changes", async ({
  page,
}) => {
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    if (data.provider) data.provider.configured = true;
    await route.fulfill({ status: response.status(), json: data });
  });
  const source = "Patient: Je ne prends pas ce médicament.\nDoctor: 5 mg.";
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/consultations/*/translate", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: {
        text: "Patient: I do not take this medication.\nDoctor: 5 mg.",
        targetLanguage: "en",
        model: "synthetic-model",
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page.getByRole("button", { name: "Add synthetic patient" }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Synthetic Translation Patient");
  await page.getByLabel("Date of birth").fill("1990-01-01");
  await page.getByRole("button", { name: "Save synthetic patient" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "Start new consultation", exact: true })
    .click();
  await page.getByRole("button", { name: "Create consultation" }).click();
  await page.getByLabel("Paste or type transcript").fill(source);
  await expect(
    page.getByRole("button", { name: "Translate", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: /authorized to send this text/ })
    .check();
  await page.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(
    page.getByLabel("Translated transcript", { exact: true }),
  ).toHaveValue("Patient: I do not take this medication.\nDoctor: 5 mg.");
  await expect(page.getByLabel("Paste or type transcript")).toHaveValue(source);
  expect(submitted).toEqual({
    sourceText: source,
    targetLanguage: "en",
    consent: true,
  });
  await page
    .getByLabel("Paste or type transcript")
    .fill(source + "\nCorrection.");
  await expect(
    page.getByText(
      "The source has changed. Translate again to review the current text.",
    ),
  ).toBeVisible();
  await expect(
    page.getByLabel("Translated transcript", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => fetch("/api/workspace", { method: "DELETE" }));
});
