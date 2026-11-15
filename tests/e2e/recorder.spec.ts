import { test, expect, type Page } from "@playwright/test";

async function recorderFixture(page: Page, configured = true, denied = false) {
  await page.addInitScript(
    ({ denied }) => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            if (denied)
              throw new DOMException("Permission denied", "NotAllowedError");
            return { getTracks: () => [{ stop() {} }] };
          },
        },
      });
      // Exercise Safari's MP4 path, including data emitted only when stopped.
      class TestRecorder {
        static isTypeSupported(type: string) {
          return type === "audio/mp4";
        }
        mimeType = "audio/mp4";
        state = "inactive";
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        start() {
          this.state = "recording";
        }
        pause() {
          this.state = "paused";
        }
        resume() {
          this.state = "recording";
        }
        stop() {
          this.state = "inactive";
          this.ondataavailable?.({
            data: new Blob(["synthetic MP4 audio"], { type: this.mimeType }),
          });
          this.onstop?.();
        }
      }
      Object.defineProperty(window, "MediaRecorder", {
        configurable: true,
        value: TestRecorder,
      });
    },
    { denied },
  );
  const patient = {
    id: "patient-1",
    name: "Synthetic Recording Patient",
    dob: "1980-01-01",
    external_identifier: "SYN-REC",
  };
  const actor = {
    practitionerId: "reviewer-1",
    organizationId: "org-1",
    role: "reviewer",
    displayName: "Dr Synthetic",
  };
  const transcriptions: string[] = [];
  await page.route("**/api/practice-auth/session", (route) =>
    route.fulfill({
      json: { configured: true, authenticated: true, organizations: [] },
    }),
  );
  await page.route("**/api/practice/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/transcribe")) {
      transcriptions.push(route.request().postData() || "");
      return route.fulfill({
        json: {
          text: "Le patient dit : j’ai mal à la tête. 日本語 தமிழ் 한국어",
        },
      });
    }
    await route.fulfill({
      json: path.endsWith("/bootstrap")
        ? {
            actor,
            patients: [patient],
            members: [],
            provider: {
              configured: false,
              transcriptionConfigured: configured,
              transcriptionLabel: "Local Whisper",
              transcriptionProvider: "local",
              transcriptionLanguages: [
                "en",
                "fr",
                "zh",
                "ms",
                "ja",
                "ko",
                "es",
                "ta",
                "da",
              ],
            },
            files: { configured: false },
          }
        : {
            patient,
            permissions: { canWrite: true, canApprove: true, canManage: true },
            notes: [],
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
    .getByRole("button", { name: /Synthetic Recording Patient/ })
    .click();
  await page.getByRole("checkbox", { name: /I consent to recording/ }).check();
  return transcriptions;
}

test("records MP4, pauses, previews and sends the selected language to transcription", async ({
  page,
}) => {
  const transcriptions = await recorderFixture(page);
  const language = page.getByLabel("Spoken language", { exact: true });
  await expect(language.locator("option")).toHaveCount(9);
  await language.selectOption("fr");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByText("Recording synthetic audio", { exact: true }),
  ).toBeVisible();
  await expect(language).toBeDisabled();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByLabel("Recorded audio preview")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download recording" }),
  ).toHaveAttribute("download", "consultation.mp4");
  await page
    .getByRole("checkbox", { name: /I consent to recording/ })
    .uncheck();
  await expect(
    page.getByRole("button", { name: "Transcribe locally", exact: true }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: /I consent to recording/ }).check();
  await page
    .getByRole("button", { name: "Transcribe locally", exact: true })
    .click();
  await expect(page.getByLabel("Note text", { exact: true })).toHaveValue(
    "Le patient dit : j’ai mal à la tête. 日本語 தமிழ் 한국어",
  );
  expect(transcriptions).toHaveLength(1);
  expect(transcriptions[0]).toContain('name="language"');
  expect(transcriptions[0]).toContain("\r\nfr\r\n");
  await page.getByRole("button", { name: "Discard recording" }).click();
  await expect(language).toBeEnabled();
});

test("capture remains available when transcription is not configured", async ({
  page,
}) => {
  await recorderFixture(page, false);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Download recording" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Transcribe locally", exact: true }),
  ).toBeDisabled();
});

test("blocked microphone explains Safari permissions and allows retry", async ({
  page,
}) => {
  await recorderFixture(page, true, true);
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Microphone access is blocked" }),
  ).toContainText("Settings for This Website");
  await expect(
    page.getByRole("button", { name: "Record", exact: true }),
  ).toBeEnabled();
});
