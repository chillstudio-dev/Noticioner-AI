import { test, expect } from "@playwright/test";
import {
  deterministicAudit,
  patientSummaryToNote,
  type PatientSummary,
  type TrustAudit,
} from "../../src/lib/trust-engine";
import { evaluateTrust } from "../../src/lib/trust-evaluation";
test("workspace Quality needs no patient and patient-summary review gates export on desktop and mobile", async ({
  page,
}) => {
  const patient = {
    id: "patient-test",
    name: "Fictional Follow-up",
    dob: "1980-01-01",
    external_identifier: "SYN-TRUST",
  };
  const source = {
    id: "approved-note",
    type: "note" as const,
    version: 2,
    text: "No fever. Follow-up in two weeks.",
  };
  const note = {
    id: source.id,
    content: source.text,
    status: "approved",
    version: 2,
    created_at: new Date().toISOString(),
  };
  let patientReads = 0;
  let summaries: {
    id: string;
    version: number;
    source_version: number;
    source_note_id: string;
    status: string;
    content: PatientSummary;
    trust: TrustAudit;
  }[] = [];
  const bootstrap = {
    actor: {
      role: "reviewer",
      displayName: "Fictional reviewer",
      organizationId: "org",
      practitionerId: "reviewer",
    },
    patients: [patient],
    members: [],
    provider: {
      configured: true,
      label: "Synthetic test provider",
      transcriptionConfigured: false,
    },
    files: { configured: false },
  };
  await page.route("**/api/practice-auth/session", (r) =>
    r.fulfill({ json: { configured: true, authenticated: true } }),
  );
  await page.route("**/api/practice/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname.replace("/api/practice/", ""),
      body = request.method() === "GET" ? {} : request.postDataJSON();
    if (path === "bootstrap") {
      await route.fulfill({ json: bootstrap });
      return;
    }
    if (path === "quality") {
      await route.fulfill({
        json:
          request.method() === "GET"
            ? []
            : await evaluateTrust("deterministic"),
      });
      return;
    }
    if (path.endsWith("patient-summaries") && request.method() === "GET") {
      await route.fulfill({ json: summaries });
      return;
    }
    if (path.endsWith("patient-summaries") && request.method() === "POST") {
      expect(body.consent).toBe(true);
      expect(body.sourceVersion).toBe(2);
      const content = {
        paragraphs: [
          {
            id: "p1",
            text: "You did not report a fever.",
            evidence: [{ segmentId: source.id, quote: "No fever." }],
          },
        ],
      };
      summaries = [
        {
          id: "summary",
          version: 1,
          source_version: 2,
          source_note_id: source.id,
          status: "draft",
          content,
          trust: deterministicAudit({
            note: patientSummaryToNote(content),
            sources: [source],
            includeGaps: false,
          }),
        },
      ];
      await route.fulfill({ json: summaries[0] });
      return;
    }
    if (path.includes("patient-summaries/summary")) {
      const summary = summaries[0];
      expect(body.version).toBe(summary.version);
      if (path.endsWith("/findings")) {
        expect(body.note.length).toBeGreaterThan(2);
        summary.trust.findings = summary.trust.findings.map((f) =>
          f.id === body.id
            ? { ...f, resolution: body.resolution, note: body.note }
            : f,
        );
      } else if (path.endsWith("/approve")) summary.status = "approved";
      else {
        summary.content = body.content;
        summary.trust = deterministicAudit({
          note: patientSummaryToNote(summary.content),
          sources: [source],
          includeGaps: false,
        });
      }
      summary.version++;
      await route.fulfill({ json: summary });
      return;
    }
    patientReads++;
    await route.fulfill({
      json: {
        patient,
        permissions: { canWrite: true, canApprove: true, canManage: true },
        notes: [note],
        medications: [],
        documents: [],
        summaries: [],
        grants: [],
        audit: [],
      },
    });
  });
  await page.goto("/practice");
  await page
    .getByRole("button", { name: "Quality · synthetic evaluation" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Trust Engine Quality" }),
  ).toBeVisible();
  expect(patientReads).toBe(0);
  await page.getByRole("button", { name: "Run 24 local checks" }).click();
  await expect(page.getByText(/24\/24 cases completed/)).toBeVisible();
  await page.screenshot({
    path: "test-results/trust-quality-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Fictional Follow-up/ }).click();
  await page
    .getByRole("button", { name: "Patient summaries", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Generate patient summary" }),
  ).toBeDisabled();
  await page.getByLabel(/I consent to send this approved note/).check();
  await page.getByRole("button", { name: "Generate patient summary" }).click();
  await expect(
    page.getByRole("button", { name: "Copy approved summary" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Approve patient summary", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Edit summary", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Paragraph 1", exact: true })
    .fill("You reported no fever.");
  await page.getByRole("button", { name: "Save and rerun checks" }).click();
  await page
    .getByLabel("Review rationale")
    .fill("Compared meaning and negation with the approved source.");
  await page.getByRole("button", { name: "Addressed", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Approve patient summary", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Copy approved summary" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Print approved summary" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit summary", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/trust-patient-summary-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/trust-patient-summary-mobile.png",
    fullPage: true,
  });
});
