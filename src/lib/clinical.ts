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
  rejectedEvidence: z
    .array(z.object({ segmentId: z.string(), quote: z.string() }))
    .max(20)
    .optional(),
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
  trust?: import("./trust-engine").TrustFinding;
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
        rejectedEvidence: s.evidence.filter((e) => !evidence.includes(e)),
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
  const activeSegments = segments.filter((segment, index) => {
    const later = segments.slice(index + 1);
    return !later.some((correction, offset) => {
      if (!/\b(?:correction|actually)\b/i.test(correction.text)) return false;
      const durationPattern = /\b(?:yesterday|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|years?))\b/i;
      const oldDuration = segment.text.match(durationPattern)?.[0];
      const correctedDuration = correction.text.match(durationPattern)?.[0];
      if (!oldDuration || !correctedDuration || oldDuration.toLowerCase() === correctedDuration.toLowerCase()) return false;
      const topics = ["headache", "cough", "tingling", "numbness", "numb toes", "dry mouth", "dizziness", "appetite", "tiredness", "rash", "sore throat"];
      const priorTopic = topics.find((topic) => segment.text.toLowerCase().includes(topic));
      const correctionTopic = topics.find((topic) => correction.text.toLowerCase().includes(topic));
      const explicitlyRejectsPrior = correction.text.toLowerCase().includes(oldDuration.toLowerCase());
      if (priorTopic && correctionTopic) return priorTopic === correctionTopic && explicitlyRejectsPrior;
      if (priorTopic || correctionTopic) {
        return offset === 0 && explicitlyRejectsPrior &&
          /\b(?:it|this)\s+(?:started|began)\b/i.test(correction.text);
      }
      return offset === 0 &&
        /\b(?:it|this)\s+(?:started|began)\b/i.test(segment.text) &&
        /\b(?:it|this)\s+(?:started|began)\b/i.test(correction.text);
    });
  });
  const statements: Statement[] = activeSegments.map((s, index) => {
    let category: Statement["category"] = "other";
    let section: Statement["section"] = "Subjective";
    const previousText = activeSegments[index - 1]?.text ?? "";
    const medicationContext = /\b(?:its|the)\s+(?:name|dose|strength|amount)\b/i.test(s.text) && /medication|tablet|\bmg\b|inhaler/i.test(previousText);
    const patientTheory = s.speaker === "Patient" && /\bI think\b/i.test(s.text) && /\b(?:means?|might|could|diagnosis|disease|condition)\b/i.test(s.text);
    const symptomPhrase = patientTheory ? s.text.match(/\b(?:my|I have|I feel)\s+(?:[a-z]+\s+){0,2}(?:numb(?:ness)?(?:\s+toes?)?|tingling|cough|headache|pain|rash|dizziness|sore throat)\b/i)?.[0] : undefined;
    const symptomPrefix = symptomPhrase ? s.text.slice(0, s.text.indexOf(symptomPhrase)) : "";
    const safelyAssertedSymptom = symptomPhrase && !/\b(?:no|not|never|don't|do not|denies)\b/i.test(symptomPrefix.slice(-40)) ? symptomPhrase : undefined;
    if (/allerg/i.test(s.text)) category = "allergy";
    else if (/medication|tablet|\bmg\b|taking|inhaler/i.test(s.text) || medicationContext)
      category = "medication";
    else if (
      ["Doctor", "Nurse", "Clinician"].includes(s.speaker) &&
      /assessment|assessed|impression|suspect/i.test(s.text)
    ) {
      category = "assessment";
      section = "Assessment";
    } else if (
      /^(?:Patient|Doctor|Nurse|Clinician)$/.test(s.speaker) &&
      (/\b(?:follow.up\s*:\s*|return in|review in|plan:|refer|arrange|meet again|next visit is scheduled|come back then|bring .* next time)\b/i.test(s.text) ||
        (["Doctor", "Nurse", "Clinician"].includes(s.speaker) && /\b(?:review|return|follow.up)\b/i.test(s.text)))
    ) {
      category = "followup";
      section = "Plan";
    } else if (
      ["Doctor", "Nurse", "Clinician"].includes(s.speaker) &&
      /examination|temperature|blood pressure|on exam|pulse|recorded weight/i.test(s.text)
    ) {
      category = "examination";
      section = "Objective";
    } else if (
      /\b(?:regular|usual|routine|continuing.care|attend|attendance).{0,50}(?:follow.up|visit|diabetes)|(?:follow.up|visit).{0,50}\b(?:regular|usual|routine)\b|here for .*follow.up|usual routine|not noticed a change/i.test(s.text)
    )
      category = "history";
    else if (/\b(?:correction|actually)\b/i.test(s.text) && /\b(?:days?|weeks?|months?|years?|yesterday)\b/i.test(s.text))
      category = "duration";
    else if (/history|previous/i.test(s.text)) category = "history";
    else if (/pain|cough|headache|feel|sore|dry mouth|dizz|appetite|tingling|numb|tired|rash|breathing trouble|nausea|vomit/i.test(s.text))
      category = "complaint";
    else if (/\b(?:days?|weeks?|months?|years?|since|yesterday|when it started|when that happened|onset)\b/i.test(s.text))
      category = "duration";
    if (
      category === "medication" &&
      ["Doctor", "Nurse", "Clinician"].includes(s.speaker) &&
      /\b(?:not discussed|unclear|not established)\b/i.test(s.text)
    ) section = "Assessment";
    return {
      id: `f-${s.id}`,
      section,
      text: safelyAssertedSymptom ? `Reports ${safelyAssertedSymptom.replace(/^(?:my|I have|I feel)\s+/i, "")}` : s.text,
      category,
      speaker: s.speaker,
      speakerBasis: s.speaker === "Unknown" ? "Unknown" : "Explicit",
      evidence: [{ segmentId: s.id, quote: safelyAssertedSymptom ?? s.text }],
      certainty: safelyAssertedSymptom ? "Supported" : /maybe|not sure|perhaps|think|don't remember|can't remember|can't recall|don't know|do not know|uncertain/i.test(
        s.text,
      )
        ? "Uncertain"
        : "Supported",
    };
  });
  for (const s of activeSegments) {
    const hasComplaint = statements.some((statement) => statement.id === `f-${s.id}` && statement.category === "complaint");
    if (!hasComplaint) continue;
    const duration = s.text.match(/\b(?:for|since|about|around)\s+(?:this\s+|last\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:days?|weeks?|months?|years?)\b|\bsince\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:yesterday|this week|last week)\b/i)?.[0];
    if (!duration) continue;
    const normalizedDuration = duration.replace(/^(?:for|about|around)\s+/i, "");
    statements.push({
      id: `f-${s.id}-duration`,
      section: "Subjective",
      text: `Duration: ${normalizedDuration}`,
      category: "duration",
      speaker: s.speaker,
      speakerBasis: s.speaker === "Unknown" ? "Unknown" : "Explicit",
      evidence: [{ segmentId: s.id, quote: duration }],
      certainty: /maybe|not sure|perhaps|actually|don't know|do not know|uncertain/i.test(s.text) ? "Uncertain" : "Supported",
    });
  }
  for (const s of activeSegments) {
    if (s.speaker !== "Patient" || !/\bI think\b/i.test(s.text) || !/\b(?:means?|might|could|diagnosis|disease|condition)\b/i.test(s.text)) continue;
    statements.push({
      id: `f-${s.id}-patient-theory`,
      section: "Subjective",
      text: `Patient's guess: ${s.text}`,
      category: "other",
      speaker: "Patient",
      speakerBasis: "Explicit",
      evidence: [{ segmentId: s.id, quote: s.text }],
      certainty: "Uncertain",
    });
  }
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
  if (
    flags.some(
      (f) =>
        f.trust?.required !== false &&
        (f.resolution === "Open" ||
          (f.trust?.required && f.note.trim().length < 3)),
    )
  )
    throw new Error(
      "Address or acknowledge every review flag before approval.",
    );
}
