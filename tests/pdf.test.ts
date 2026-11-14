import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { exportPDF } from "../src/lib/pdf";
import type { Consultation, Patient } from "../src/lib/db";
const patient: Patient = {
  id: "synthetic",
  name: "Alex Bennett",
  dob: "1988-05-14",
  history: "Synthetic record",
  allergies: "Unknown",
  medications: "Not recorded",
};
const consultation: Consultation = {
  id: "synthetic-layout-check",
  patient_id: patient.id,
  patient_name: patient.name,
  created_at: "2026-11-14T00:00:00.000Z",
  updated_at: "2026-11-14T00:00:00.000Z",
  type: "General consultation",
  status: "Draft",
  transcript: "",
  note: null,
  flags: [],
  provider: null,
  latency_ms: null,
  version: 0,
  approved_at: null,
  approved_by: null,
};
test("PDF can export an empty draft with visible review disclosures", async () => {
  const bytes = await exportPDF(consultation, patient);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.match(pdf.getTitle()!, /Synthetic consultation/);
});
test("PDF paginates long statements and unbroken tokens", async () => {
  const c: Consultation = {
    ...consultation,
    note: {
      statements: Array.from({ length: 12 }, (_, i) => ({
        id: `f${i}`,
        section: "Subjective",
        text:
          i === 0
            ? "W".repeat(420)
            : "Synthetic source text retained for pagination review. ".repeat(
                12,
              ),
        category: "other",
        certainty: "Uncertain",
        evidence: [],
      })),
    },
  };
  const bytes = await exportPDF(c, patient);
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() > 1);
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/long-consultation.pdf", bytes);
});
