import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function accessFixture(
  page: Page,
  deniedStatus: number,
  uncertainSummary = false,
  viewOnly = false,
  multiplePatients = false,
) {
  const patient = {
    id: "patient-1",
    name: "Synthetic Patient",
    dob: "1980-01-01",
    external_identifier: "SYN-001",
  };
  const secondPatient = {
    ...patient,
    id: "patient-2",
    name: "Another Synthetic Patient",
    external_identifier: "SYN-002",
  };
  const actor = {
    practitionerId: "reviewer-1",
    organizationId: "org-1",
    role: "reviewer",
    displayName: "Dr Synthetic",
  };
  let denied = false;
  await page.route("**/api/practice-auth/session", (route) =>
    route.fulfill({
      json: { configured: true, authenticated: true, organizations: [] },
    }),
  );
  await page.route("**/api/practice/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      denied = true;
      await route.fulfill({ json: { ok: true } });
    } else if (denied) {
      await route.fulfill({
        status: deniedStatus,
        json: { error: "Access unavailable. Sign in again." },
      });
    } else {
      const selectedPatient = req.url().includes("patient-2")
        ? secondPatient
        : patient;
      await route.fulfill({
        json: new URL(req.url()).pathname.endsWith("bootstrap")
          ? {
              actor,
              patients: multiplePatients ? [patient, secondPatient] : [patient],
              members: [],
              provider: { configured: false },
              files: { configured: false },
            }
          : {
              patient: selectedPatient,
              permissions: {
                canWrite: !viewOnly,
                canApprove: !viewOnly,
                canManage: !viewOnly,
              },
              medications: [],
              documents: [],
              summaries: uncertainSummary
                ? [
                    {
                      id: "summary-1",
                      status: "draft",
                      version: 1,
                      created_at: "2026-11-15T00:00:00Z",
                      sources: [],
                      note: {
                        statements: [
                          {
                            id: "s1",
                            section: "Subjective",
                            text: "An uncertain claim",
                            certainty: "Uncertain",
                            evidence: [],
                          },
                        ],
                      },
                    },
                  ]
                : [],
              grants: [],
              audit: [],
              notes: [
                {
                  id: "note-1",
                  content: "Private synthetic clinical content",
                  status: "draft",
                  version: 1,
                  created_at: "2026-11-15T00:00:00Z",
                },
              ],
            },
      });
    }
  });
  await page.goto("/practice");
  const mobileSwitcher = page.getByRole("combobox", {
    name: "Switch patient",
  });
  if (multiplePatients) {
    await mobileSwitcher.selectOption("patient-1");
  } else {
    await page.getByRole("button", { name: /Synthetic Patient/ }).click();
  }
  await expect(
    page.getByText("Private synthetic clinical content", { exact: true }),
  ).toBeVisible();
  if (uncertainSummary || viewOnly) return;
  await page
    .getByLabel("Note text", { exact: true })
    .fill("A synthetic follow-up");
  await page
    .getByRole("button", { name: "Save for review", exact: true })
    .click();
}

test("mobile patient switcher changes the active shared record", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await accessFixture(page, 401, false, true, true);
  const switcher = page.getByRole("combobox", { name: "Switch patient" });
  await expect(switcher).toBeVisible();
  await switcher.selectOption("patient-2");
  await expect(
    page.getByRole("heading", { name: "Another Synthetic Patient" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Notes", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test("view-only practitioners can read records without mutation controls", async ({
  page,
}) => {
  await accessFixture(page, 401, false, true);
  await expect(page.getByText("View only", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save for review", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Review & approve" }),
  ).toHaveCount(0);
  for (const [tab, action] of [
    ["Medications", "Record medication"],
    ["Documents", "Upload privately"],
    ["AI summaries", "Generate review draft"],
    ["Care team", "Grant access"],
  ]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(
      page.getByRole("button", { name: action, exact: true }),
    ).toHaveCount(0);
  }
});

test("requires a Trust audit before a historical summary can be approved", async ({
  page,
}) => {
  await accessFixture(page, 401, true);
  await page.getByRole("button", { name: "AI summaries", exact: true }).click();
  await expect(
    page.getByText(/No audit is available. Run checks before approval/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review & approve" }),
  ).toHaveCount(0);
});

test("clears cached clinical content when session expires during refresh", async ({
  page,
}) => {
  await accessFixture(page, 401);
  await expect(
    page.getByRole("heading", { name: "Sign in with your practice" }),
  ).toBeVisible();
  await expect(
    page.getByText("Private synthetic clinical content", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /Continue with organization sign-in/ }),
  ).toBeVisible();
});

test("clears cached patient after care access is revoked", async ({ page }) => {
  await accessFixture(page, 404);
  await expect(
    page.getByRole("alert").filter({ hasText: "Access unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("Private synthetic clinical content", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Authorized access", { exact: true }),
  ).toHaveCount(0);
});

test("explains rejected organization sign-in", async ({ page }) => {
  await page.route("**/api/practice-auth/session", (route) =>
    route.fulfill({
      json: { configured: true, authenticated: false },
    }),
  );
  await page.goto(
    "/practice?authError=" +
      encodeURIComponent("Identity assurance validation failed."),
  );
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Identity assurance validation failed." }),
  ).toBeVisible();
});

test("shared practice renders records and sends valid review, medication and grant requests", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const patient = {
    id: "patient-1",
    name: "Synthetic Patient",
    dob: "1980-01-01",
    external_identifier: "SYN-001",
  };
  const actor = {
    practitionerId: "reviewer-1",
    organizationId: "org-1",
    role: "reviewer",
    displayName: "Dr Synthetic",
  };
  const members = [
    {
      practitioner_id: "reviewer-1",
      display_name: "Dr Synthetic",
      role: "reviewer",
    },
    {
      practitioner_id: "clinician-2",
      display_name: "Dr Colleague",
      role: "clinician",
    },
  ];
  const detail = {
    patient,
    permissions: { canWrite: true, canApprove: true, canManage: true },
    notes: [
      {
        id: "note-1",
        content: "Patient reports headache.",
        status: "draft",
        version: 1,
        created_at: "2026-11-15T00:00:00Z",
      },
    ],
    medications: [],
    documents: [],
    summaries: [],
    grants: [
      {
        practitioner_id: "reviewer-1",
        display_name: "Dr Synthetic",
        active: true,
        access_level: "edit",
      },
    ],
    audit: [
      {
        id: "audit-1",
        action: "patient.created",
        created_at: "2026-11-15T00:00:00Z",
      },
    ],
  };
  const mutations: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/api/practice-auth/session", (route) =>
    route.fulfill({
      json: {
        configured: true,
        authenticated: true,
        actor,
        organizations: [
          { id: "org-1", name: "Synthetic Practice", role: "reviewer" },
        ],
      },
    }),
  );
  await page.route("**/api/practice/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      mutations.push({ path, body });
      if (path.endsWith("/approve")) {
        detail.notes[0].status = "approved";
        detail.notes[0].version = 2;
      }
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({
      json: path.endsWith("/bootstrap")
        ? {
            actor,
            patients: [patient],
            members,
            provider: { configured: true, label: "Test AI" },
            files: { configured: true, pdfEnabled: false, maxBytes: 5242880 },
          }
        : detail,
    });
  });
  await page.goto("/practice");
  await page.getByRole("button", { name: /Synthetic Patient/ }).click();
  await expect(
    page.getByText("Patient reports headache.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review & approve" }).click();
  await expect(page.getByText("Note approved.", { exact: true })).toBeVisible();
  expect(mutations[0].body).toEqual({ version: 1, reviewed: true });
  await page.getByRole("button", { name: "AI summaries", exact: true }).click();
  await expect(
    page.getByText("Patient reports headache.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Medications", exact: true }).click();
  await page
    .getByLabel("Medication", { exact: true })
    .fill("Synthetic medicine");
  await page.getByLabel("Dose", { exact: true }).fill("reported dose");
  await page.getByLabel("Route", { exact: true }).fill("oral");
  await page.getByLabel("Frequency", { exact: true }).fill("daily");
  await page
    .getByLabel("Source / verification context")
    .fill("Synthetic report");
  await page
    .getByRole("button", { name: "Record medication", exact: true })
    .click();
  await expect(
    page.getByText("Medication statement recorded.", { exact: true }),
  ).toBeVisible();
  expect(
    mutations.find((x) => x.path.endsWith("/medications"))?.body.status,
  ).toBe("reported");
  await page.getByRole("button", { name: "Care team", exact: true }).click();
  await page.getByLabel("Active practitioner").selectOption("clinician-2");
  await page.getByRole("button", { name: "Grant access", exact: true }).click();
  await expect(
    page.getByText("Care access granted.", { exact: true }),
  ).toBeVisible();
  expect(
    mutations.find((x) => x.path.endsWith("/grants"))?.body.practitionerId,
  ).toBe("clinician-2");
  expect(
    mutations.find((x) => x.path.endsWith("/grants"))?.body.accessLevel,
  ).toBe("view");
  await page
    .getByLabel("Access for Dr Synthetic", { exact: true })
    .selectOption("view");
  await expect(
    page.getByText("Patient access updated.", { exact: true }),
  ).toBeVisible();
  expect(
    mutations.filter((x) => x.path.endsWith("/grants")).at(-1)?.body,
  ).toEqual({ practitionerId: "reviewer-1", accessLevel: "view" });
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await expect(page.getByText(/up to 5 MB/)).toBeVisible();
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(
    page.getByText("patient.created", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/private/tmp/noticioner-practice-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "/private/tmp/noticioner-practice-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
