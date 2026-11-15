import { test, expect } from "@playwright/test";
test("complete synthetic workflow, evidence, review, approval, PDF and reopen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Your documentation workspace/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Noticioner research prototype · Synthetic data · Simulated approval", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Patients", exact: true }).click();
  await page.getByRole("button", { name: "Add synthetic patient" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Alex Bennett");
  await page.getByLabel("Date of birth").fill("1988-05-14");
  await page.getByRole("button", { name: "Save synthetic patient" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("button", { name: "Start new consultation", exact: true })
    .click();
  await page.getByRole("button", { name: "Create consultation" }).click();
  await page
    .getByLabel("Paste or type transcript")
    .fill(
      "Patient: I have a sore throat.\nPatient: It started three days ago.\nDoctor: Follow-up: return tomorrow.",
    );
  await page.getByRole("button", { name: "Save transcript" }).click();
  await page.getByLabel("Generation method").selectOption("baseline");
  await page
    .getByRole("button", { name: "Generate draft", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "SOAP draft" })).toBeVisible();
  await page.getByRole("button", { name: "s1", exact: true }).first().click();
  await expect(page.locator("#evidence-s1")).toHaveClass(/highlight/);
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page
    .getByLabel("Edit Subjective statement")
    .first()
    .fill("Patient reports a sore throat.");
  await page.getByRole("button", { name: "Save note edits" }).click();
  await expect(
    page.getByRole("button", { name: "Save note edits" }),
  ).not.toBeVisible();
  while (await page.locator("button.flag:not(.resolved)").count()) {
    await page.locator("button.flag:not(.resolved)").first().click();
    await page
      .getByLabel("Reviewer note")
      .fill(
        "Reviewed against the synthetic source and acknowledged for demonstration.",
      );
    await page.getByRole("button", { name: "Save review action" }).click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await page.getByRole("button", { name: "Review & approve" }).click();
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Confirm simulated approval" })
    .click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export PDF" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  await file.saveAs("test-results/approved-consultation.pdf");
  await page.reload();
  await page
    .getByRole("button", { name: "Open consultation for Alex Bennett" })
    .click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Patient reports a sore throat.", { exact: true }),
  ).toBeVisible();
});
test("API denies unauthenticated requests and cross-account reads, empty generation and premature approval", async ({
  request,
}) => {
  expect((await request.get("/api/consultations")).status()).toBe(401);
  await request.post("/api/session", { data: { consent: true } });
  const patient = await (
    await request.post("/api/patients", {
      data: {
        name: "Test Patient",
        dob: "1988-05-14",
        history: "",
        allergies: "",
        medications: "",
      },
    })
  ).json();
  const c = await (
    await request.post("/api/consultations", {
      data: { patientId: patient.id, type: "General consultation" },
    })
  ).json();
  expect(
    (
      await request.post(`/api/consultations/${c.id}/generate`, {
        data: { mode: "baseline" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/consultations/${c.id}/approve`, {
        data: { confirmed: true, reviewed: true, version: 0 },
      })
    ).ok(),
  ).toBeFalsy();
  expect(
    (
      await request.post("/api/consultations", {
        headers: { Origin: "https://evil.example" },
        data: { patientId: patient.id, type: "General consultation" },
      })
    ).status(),
  ).toBe(403);
});
test("responsive navigation and evaluation", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Your documentation workspace/ }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Open navigation" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Close navigation" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("button", { name: "AI Evaluation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Run baseline", exact: true }).click();
  await expect(page.getByText("Measured", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/mobile-evaluation.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
});

test("search empty states distinguish no matches from an empty workspace", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Your documentation workspace/ }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Patients", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search patients" })
    .fill("no-such-synthetic-patient");
  await expect(
    page.getByRole("heading", { name: "No matching patients" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No patients yet", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Consultations", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Search consultations" })
    .fill("no-match");
  await expect(
    page.getByRole("heading", { name: "No matching consultations" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your first consultation starts here" }),
  ).toBeVisible();
});
