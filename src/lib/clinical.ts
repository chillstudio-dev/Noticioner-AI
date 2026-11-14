import { z } from "zod";
export const segmentSchema = z.object({
  id: z.string(),
  speaker: z.enum(["Doctor", "Nurse", "Clinician", "Patient", "Unknown"]),
  text: z.string().min(1).max(12000),
});
export type Segment = z.infer<typeof segmentSchema>;
export const statementSchema = z.object({
  id: z.string().min(1),
  section: z.enum(["Subjective", "Objective", "Assessment", "Plan"]),
  text: z.string().min(1).max(3000),
  speaker: z
    .enum(["Doctor", "Nurse", "Clinician", "Patient", "Unknown"])
    .optional(),
  speakerBasis: z.enum(["Explicit", "Inferred", "Unknown"]).optional(),
  evidence: z
    .array(z.object({ segmentId: z.string(), quote: z.string().min(1) }))
    .max(20),
  certainty: z.enum(["Supported", "Uncertain", "Unsupported"]),
  category: z.enum([
    "complaint",
    "duration",
    "history",
    "allergy",
    "medication",
    "examination",
    "assessment",
    "followup",
    "other",
  ]),
});
export const noteSchema = z.object({
  statements: z.array(statementSchema).min(1).max(80),
});
export type Statement = z.infer<typeof statementSchema>;
export type Note = z.infer<typeof noteSchema>;
export type Flag = {
  id: string;
  category: string;
  message: string;
  priority: "Review" | "High";
  segmentId?: string;
  resolution: "Open" | "Addressed" | "Not applicable";
  note: string;
};
export const sections = [
  "Subjective",
  "Objective",
  "Assessment",
  "Plan",
] as const;
export function parseTranscript(text: string): Segment[] {
  return text
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((line, i): Segment => {
      const match = line.match(/^(Doctor|Nurse|Clinician|Patient):\s*(.*)$/i);
      return {
        id: `s${i + 1}`,
        speaker: match
          ? ((match[1][0].toUpperCase() +
              match[1].slice(1).toLowerCase()) as Segment["speaker"])
          : "Unknown",
        text: match ? match[2] : line,
      };
    })
    .filter((s) => s.text);
}
export function validateEvidence(note: Note, segments: Segment[]): Note {
  const ids = new Set<string>();
  return {
    statements: note.statements.map((s) => {
      if (ids.has(s.id)) throw new Error("Duplicate statement identifiers");
      ids.add(s.id);
      const evidence = s.evidence.filter((e) =>
        segments.some((t) => t.id === e.segmentId && t.text.includes(e.quote)),
      );
      const doctorOnly =
        s.section === "Assessment" ||
        s.section === "Plan" ||
        s.section === "Objective";
      const attributed =
        !doctorOnly ||
        evidence.every(
          (e) =>
            ["Doctor", "Nurse", "Clinician"].includes(
              segments.find((t) => t.id === e.segmentId)?.speaker || "",
            ) ||
            (segments.find((t) => t.id === e.segmentId)?.speaker ===
              "Unknown" &&
              ["Doctor", "Nurse", "Clinician"].includes(s.speaker || "")),
        );
      const explicitRoles = [
        ...new Set(
          evidence
            .map((e) => segments.find((t) => t.id === e.segmentId)?.speaker)
            .filter((role) => role && role !== "Unknown"),
        ),
      ];
      const speaker =
        !evidence.length || explicitRoles.length > 1
          ? "Unknown"
          : explicitRoles.length === 1
            ? explicitRoles[0]
            : s.speaker || "Unknown";
      const speakerBasis =
        explicitRoles.length === 1
          ? "Explicit"
          : speaker === "Unknown"
            ? "Unknown"
            : "Inferred";
      // Exact quotes prove source existence, not semantic entailment. All summaries require review.
      return {
        ...s,
        evidence,
        speaker,
        speakerBasis,
        certainty: !evidence.length
          ? "Unsupported"
          : !attributed ||
              evidence.length !== s.evidence.length ||
              (doctorOnly && speakerBasis !== "Explicit")
            ? "Uncertain"
            : s.certainty,
      };
    }),
  };
}
export function baseline(segments: Segment[]): Note {
  const statements: Statement[] = segments.map((s) => {
    let category: Statement["category"] = "other";
    let section: Statement["section"] = "Subjective";
    if (/allerg/i.test(s.text)) category = "allergy";
    else if (/medication|tablet|\bmg\b|taking|inhaler/i.test(s.text))
      category = "medication";
    else if (
      ["Doctor", "Nurse", "Clinician"].includes(s.speaker) &&
      /assessment|impression|suspect/i.test(s.text)
    ) {
      category = "assessment";
      section = "Assessment";
    } else if (
      ["Doctor", "Nurse", "Clinician"].includes(s.speaker) &&
      /follow.up|return|review in|plan:|refer|arrange/i.test(s.text)
    ) {
      category = "followup";
      section = "Plan";
    } else if (
      ["Doctor", "Nurse", "Clinician"].includes(s.speaker) &&
      /examination|temperature|blood pressure|on exam|pulse/i.test(s.text)
    ) {
      category = "examination";
      section = "Objective";
    } else if (/days|weeks|months|since|yesterday/i.test(s.text))
      category = "duration";
    else if (/history|previous/i.test(s.text)) category = "history";
    else if (/pain|cough|headache|feel|sore/i.test(s.text))
      category = "complaint";
    return {
      id: `f-${s.id}`,
      section,
      text: s.text,
      category,
      speaker: s.speaker,
      speakerBasis: s.speaker === "Unknown" ? "Unknown" : "Explicit",
      evidence: [{ segmentId: s.id, quote: s.text }],
      certainty: /maybe|not sure|perhaps|think|actually|don't remember/i.test(
        s.text,
      )
        ? "Uncertain"
        : "Supported",
    };
  });
  return { statements };
}
export function flagsFor(note: Note, segments: Segment[]): Flag[] {
  if (!segments.length) return [];
  const flags: Flag[] = [];
  const add = (
    id: string,
    category: string,
    message: string,
    segmentId?: string,
    priority: Flag["priority"] = "Review",
  ) =>
    flags.push({
      id,
      category,
      message,
      segmentId,
      priority,
      resolution: "Open",
      note: "",
    });
  const cats = new Set(
    note.statements.filter((s) => s.evidence.length).map((s) => s.category),
  );
  if (note.statements.some((s) => s.speakerBasis === "Inferred"))
    add(
      "speaker-review",
      "Speaker attribution",
      "AI inferred speaker roles from the wording. Verify nurse/clinician and patient attribution against the conversation before approval.",
    );
  if (!cats.has("allergy"))
    add(
      "missing-allergy",
      "Missing information",
      "Allergy status is not documented in this conversation. Confirm or mark not applicable.",
    );
  if (!cats.has("medication"))
    add(
      "missing-medication",
      "Missing information",
      "Medication history is not documented in this conversation.",
    );
  if (cats.has("complaint") && !cats.has("duration"))
    add(
      "missing-duration",
      "Missing information",
      "Symptom duration is not clearly documented.",
    );
  if (!cats.has("followup"))
    add(
      "missing-followup",
      "Missing information",
      "Follow-up instructions are not documented. Confirm whether applicable.",
    );
  if (!cats.has("examination"))
    add(
      "missing-examination",
      "Missing information",
      "Examination findings are not documented. Review whether an examination was relevant.",
    );
  for (const s of note.statements) {
    if (s.certainty !== "Supported")
      add(
        `uncertain-${s.id}`,
        "Evidence review",
        `${s.certainty}: verify this statement against the source.`,
        s.evidence[0]?.segmentId,
        "High",
      );
    if (
      s.category === "medication" &&
      !/no (current |regular )?medication|not taking|none/i.test(s.text)
    ) {
      const missing = [
        !/\d+\s*(mg|mcg|g|ml|puff|tablet)/i.test(s.text) && "dose",
        !/oral|by mouth|topical|inhaled|intravenous/i.test(s.text) && "route",
        !/daily|twice|once|every|weekly|as needed/i.test(s.text) && "frequency",
      ].filter(Boolean);
      if (missing.length)
        add(
          `med-${s.id}`,
          "Medication documentation",
          `Medication ${missing.join(", ")} not documented in this statement. This is a documentation prompt, not an interaction check.`,
          s.evidence[0]?.segmentId,
        );
    }
  }
  return flags;
}
export function assertApproval(
  note: Note | null,
  flags: Flag[],
  confirmed: boolean,
  reviewed: boolean,
) {
  if (!note) throw new Error("Generate a draft first.");
  if (!confirmed || !reviewed)
    throw new Error(
      "Review the document and explicitly confirm simulated approval.",
    );
  if (flags.some((f) => f.resolution === "Open"))
    throw new Error(
      "Address or acknowledge every review flag before approval.",
    );
}
