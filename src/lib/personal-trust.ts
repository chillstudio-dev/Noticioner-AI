import { createHash } from "node:crypto";
import type { Patient } from "./db";
import type { Segment, Note } from "./clinical";
import { flagsFor } from "./clinical";
import {
  trustToFlags,
  type TrustAudit,
  type TrustSource,
} from "./trust-engine";
export function patientContextHash(p: Patient) {
  return createHash("sha256")
    .update(JSON.stringify([p.id, p.allergies, p.medications, p.history]))
    .digest("hex");
}
export function personalSources(
  segments: Segment[],
  p: Patient,
  version: number,
): TrustSource[] {
  return [
    ...segments.map((s) => ({
      id: s.id,
      type: "transcript" as const,
      text: s.text,
      version,
    })),
    {
      id: "patient-allergies",
      type: "patient-context",
      text: p.allergies,
      version: patientContextHash(p),
      label: "Recorded allergies",
    },
    {
      id: "patient-medications",
      type: "patient-context",
      text: p.medications,
      version: patientContextHash(p),
      label: "Recorded medications",
    },
  ];
}
export function combinedFlags(
  note: Note,
  segments: Segment[],
  audit: TrustAudit,
) {
  // The new detector replaces overlapping gap/medication prompts, retaining speaker and certainty review.
  return [
    ...flagsFor(note, segments).filter(
      (f) =>
        !["Missing information", "Medication documentation"].includes(
          f.category,
        ),
    ),
    ...trustToFlags(audit),
  ];
}
