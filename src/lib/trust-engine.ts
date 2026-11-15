import { z } from "zod";
import type { Note, Flag } from "./clinical";

export const CHECKER_VERSION = "trust-1.4.0";
export const MAX_CLAIMS = 60;
export const MAX_CROSSCHECK_SOURCES = 80;
export const MAX_EXCERPT_CHARS = 40000;
export const sourceSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    "transcript",
    "note",
    "document",
    "medication",
    "patient-context",
  ]),
  text: z.string(),
  version: z.union([z.number().int(), z.string()]),
  recordId: z.string().optional(),
  label: z.string().optional(),
  verification: z.enum(["reported", "verified", "stopped"]).optional(),
});
export type TrustSource = z.infer<typeof sourceSchema>;
export const sourceReferenceSchema = sourceSchema
  .omit({ text: true })
  .extend({ quote: z.string() });
export const findingSchema = z.object({
  id: z.string(),
  kind: z.enum(["evidence", "gaps", "consistency", "safety"]),
  status: z.enum([
    "supported",
    "unsupported",
    "contradicted",
    "unclear",
    "not checked",
    "not established",
    "potential conflict",
  ]),
  priority: z.enum(["High", "Review"]),
  message: z.string(),
  target: z.string(),
  statementId: z.string().optional(),
  sources: z.array(sourceReferenceSchema),
  resolution: z.enum(["Open", "Addressed", "Not applicable"]),
  note: z.string(),
  required: z.boolean(),
  checkerVersion: z.string(),
  model: z.string().optional(),
  provider: z.string().optional(),
  explanations: z.array(z.string()),
  rule: z.string().optional(),
});
export type TrustFinding = z.infer<typeof findingSchema>;
export const auditSchema = z.object({
  checkerVersion: z.string(),
  sourceFingerprint: z.string(),
  noteFingerprint: z.string(),
  createdAt: z.string(),
  findings: z.array(findingSchema),
  model: z.string().optional(),
  provider: z.string().optional(),
  errors: z.array(z.string()),
});
export type TrustAudit = z.infer<typeof auditSchema>;
export type AuditInput = {
  note: Note;
  sources: TrustSource[];
  includeGaps?: boolean;
};
export const providerAuditSchema = z.object({
  claims: z
    .array(
      z.object({
        statementId: z.string(),
        status: z.enum(["supported", "unsupported", "contradicted", "unclear"]),
        reason: z.string().min(1).max(1500),
      }),
    )
    .max(MAX_CLAIMS),
  concerns: z
    .array(
      z.object({
        kind: z.enum(["gaps", "consistency", "safety"]),
        target: z.string(),
        statementIds: z.array(z.string()).max(10),
        sourceIds: z.array(z.string()).max(10),
        reason: z.string().min(1).max(1500),
      }),
    )
    .max(60),
});
export type ProviderAudit = z.infer<typeof providerAuditSchema>;
export const patientSummarySchema = z
  .object({
    paragraphs: z
      .array(
        z.object({
          id: z.string().min(1),
          text: z.string().trim().min(1).max(3000),
          evidence: z
            .array(
              z.object({
                segmentId: z.string().min(1),
                quote: z.string().min(1).max(12000),
              }),
            )
            .max(20),
        }),
      )
      .min(1)
      .max(30),
  })
  .refine(
    (x) => new Set(x.paragraphs.map((p) => p.id)).size === x.paragraphs.length,
    "Duplicate paragraph identifiers",
  );
export type PatientSummary = z.infer<typeof patientSummarySchema>;
export function patientSummaryToNote(content: PatientSummary): Note {
  return {
    statements: content.paragraphs.map((p) => ({
      ...p,
      section: "Subjective",
      category: "other",
      certainty: "Uncertain",
    })),
  };
}
// Retain the exact canonical audited values, rather than a collision-prone noncryptographic hash.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function sourceFingerprint(sources: TrustSource[]) {
  return JSON.stringify(
    canonical([...sources].sort((a, b) => a.id.localeCompare(b.id))),
  );
}
export function noteFingerprint(note: Note) {
  return JSON.stringify(canonical(note));
}
export function reference(source: TrustSource, quote = source.text) {
  const { text: _text, ...metadata } = source;
  void _text;
  return { ...metadata, quote };
}
export function makeFinding(
  kind: TrustFinding["kind"],
  target: string,
  status: TrustFinding["status"],
  message: string,
  sources: TrustFinding["sources"],
  statementId?: string,
): TrustFinding {
  return {
    id: `${kind}:${target}`,
    kind,
    target,
    status,
    message,
    sources,
    statementId,
    priority: ["unsupported", "contradicted", "potential conflict"].includes(
      status,
    )
      ? "High"
      : "Review",
    resolution: "Open",
    note: "",
    required: status !== "supported",
    checkerVersion: CHECKER_VERSION,
    explanations: [message],
  };
}
const concepts = [
  "fever",
  "cough",
  "rash",
  "chest pain",
  "headache",
  "nausea",
  "vomiting",
  "breathlessness",
  "penicillin allergy",
];
function polarity(text: string, concept: string): boolean | undefined {
  const clauses = text
    .toLowerCase()
    .split(/[.!?;\n]|\bbut\b|\bhowever\b/)
    .filter((t) => new RegExp(`\\b${concept}\\b`).test(t));
  const values = clauses.map((sentence) => {
    if (
      /\b(maybe|may|possible|unsure|uncertain|not sure|don't know|do not know|cannot recall)\b/.test(
        sentence,
      )
    )
      return undefined;
    const before = sentence.slice(0, sentence.indexOf(concept));
    // Restrict negation to the immediate phrase, not a different symptom earlier in a sentence.
    if (
      /\b(?:no|denies|denied|without|negative for)\s+(?:any\s+|a\s+)?$/.test(
        before,
      ) ||
      /\bnot\s+(?:(?:report(?:ed)?|have|having|experienc(?:e|ing))\s+)?(?:a\s+|any\s+)?$/.test(
        before,
      )
    )
      return false;
    if (/\b(no|denies|denied|without|not)\b/.test(before)) return undefined;
    return true;
  });
  return values.length &&
    values.every((v) => v !== undefined && v === values[0])
    ? values[0]
    : undefined;
}
export function explicitContradiction(a: string, b: string) {
  return concepts.some((c) => {
    const x = polarity(a, c),
      y = polarity(b, c);
    return x !== undefined && y !== undefined && x !== y;
  });
}
const medicationNames = [
  "amoxicillin",
  "penicillin",
  "ibuprofen",
  "aspirin",
  "metformin",
  "lisinopril",
];
function detailsConflict(a: string, b: string) {
  for (const name of medicationNames)
    if (
      new RegExp(`\\b${name}\\b`, "i").test(a) &&
      new RegExp(`\\b${name}\\b`, "i").test(b)
    ) {
      const dose = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml)\b/i;
      const frequency =
        /\b(?:once daily|twice daily|three times daily|weekly)\b/i;
      const route = /\b(?:oral|topical|inhaled|intravenous)\b/i;
      if (
        [dose, frequency, route].some(
          (re) =>
            a.match(re) &&
            b.match(re) &&
            a.match(re)![0].toLowerCase() !== b.match(re)![0].toLowerCase(),
        )
      )
        return true;
    }
  const date = /\b\d{4}-\d{2}-\d{2}\b/;
  return (
    /follow.up|appointment|review date/i.test(a) &&
    /follow.up|appointment|review date/i.test(b) &&
    !!a.match(date) &&
    !!b.match(date) &&
    a.match(date)![0] !== b.match(date)![0]
  );
}
export function eligibleClaims(input: AuditInput) {
  let size = 0;
  return input.note.statements.filter((s, i) => {
    const length =
      s.text.length + s.evidence.reduce((n, e) => n + e.quote.length, 0);
    if (i >= MAX_CLAIMS || size + length > MAX_EXCERPT_CHARS) return false;
    size += length;
    return true;
  });
}
function hasDocumentedDuration(sources: TrustSource[]) {
  const words = "one|two|three|four|five|six|seven|eight|nine|ten|a|an|several|few|couple of";
  const amountWords = `(?:\\d+|${words})`;
  const amount = new RegExp(
    `\\b${amountWords}\\s+(?:minutes?|hours?|days?|weeks?|months?|years?)\\b`,
    "i",
  );
  const relative = /\b(?:yesterday|last night|this morning|this afternoon|last week|last month|last year)\b/i;
  const symptom =
    /\b(?:symptoms?|complaints?|pain\w*|ache\w*|cough\w*|headache\w*|dizz\w*|nausea\w*|vomit\w*|dry mouth|thirst\w*|fever\w*|rash\w*|fatigue|tired\w*|sore throat|shortness of breath|breathless\w*|tingl\w*|numb\w*|appetite|swelling|weakness|itch\w*|sick|unwell|side effects?|cramp\w*|blurred vision|insomnia|poor sleep|trouble sleeping|difficulty sleeping|sleep(?:ing)? (?:problem|difficulty|disturbance|issue)s?|urination|burning|constipat\w*|diarrh\w*|stomach|blood pressure|glucose|worsening|worse)\b/i;
  const explicitUnknown =
    /\b(?:symptom|complaint)\s+duration\b[^.!?;]{0,50}\b(?:unknown|unclear|not established|not documented|not recorded|not discussed|not specified|not sure|do not know|don't know)\b|\b(?:do not know|don't know|not sure)\b[^.!?;]{0,40}\b(?:how long|duration)\b/i;
  const explicitDurationStatus =
    /\bduration\b[^.!?;]{0,50}\b(?:unknown|unclear|not established|not documented|not recorded|not discussed|not specified|not sure|do not know|don't know)\b/i;
  const durationAnswer = new RegExp(
    `^(?:(?:for|since|about|around|approximately|roughly)\\s+)?${amountWords}\\s+(?:minutes?|hours?|days?|weeks?|months?|years?)(?:\\s+(?:ago|in duration|duration|long))?$`,
    "i",
  );
  const durationContinuation = new RegExp(
    `^(?:it|this|they)\\s+(?:has|have|is|was|were|started|began|lasted|been)(?:\\s+(?:for|since))?\\s+${amountWords}\\s+(?:minutes?|hours?|days?|weeks?|months?|years?)(?:\\s+ago)?$`,
    "i",
  );
  const clauses = sources.flatMap((source) =>
    source.text
      .split(/[.!?;,\n]+|\b(?:and|but|while)\b/i)
      .map((clause) => clause.trim())
      .filter(Boolean),
  );
  for (const source of sources) {
    const labelMeansDuration = /\b(?:symptom|complaint)\s+duration\b/i.test(
      source.label || "",
    );
    const unknown = /\b(?:unknown|unclear|not established|not documented|not recorded|not discussed|not specified|not sure|do not know|don't know)\b/i.test(
      source.text,
    );
    if (
      labelMeansDuration &&
      (unknown || amount.test(source.text) || relative.test(source.text))
    )
      return true;
    if (
      explicitUnknown.test(source.text) &&
      (symptom.test(source.text) || labelMeansDuration)
    )
      return true;
    if (explicitDurationStatus.test(source.text)) return true;
  }
  for (const clause of clauses) {
    const hasTime = amount.test(clause) || relative.test(clause);
    if (hasTime && symptom.test(clause)) return true;
  }
  for (let i = 1; i < clauses.length; i++) {
    const priorHasSymptom = symptom.test(clauses[i - 1]);
    const priorAskedDuration = /\b(?:how long|since when|what duration)\b/i.test(
      clauses[i - 1],
    );
    if (
      (priorHasSymptom || priorAskedDuration) &&
      (durationAnswer.test(clauses[i]) ||
        durationContinuation.test(clauses[i]))
    )
      return true;
  }
  return false;
}
function hasDocumentedFollowupPlan(sources: TrustSource[]) {
  const interval =
    /\b(?:in|after|within)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an|several|few)\s+(?:days?|weeks?|months?|years?)\b/i;
  const date =
    /\b(?:on\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bnext\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\btomorrow\b|\bon\s+\d{4}-\d{2}-\d{2}\b/i;
  const careAction =
    /\b(?:follow[ -]?up|appointment|visit(?:ing)?|revisit|check in|see|talk again|meet again|call again)\b/i;
  const clinicalContext =
    /\b(?:symptoms?|complaints?|pain|condition|treatment|medication|health|medical|care|clinic|outpatient clinic|doctor|physician|gp|provider|nurse|midwi(?:fe|ves)|patient|specialist|therapist|psychologist|counsel[eo]r|physiotherapist|physical therapist|occupational therapist|speech therapist|dietitian|nutritionist|audiologist|podiatrist|optometrist|surgeon|radiologist|social worker|dr\.?|md|follow[ -]?up|cardiolog\w*|oncolog\w*|neurolog\w*|dermatolog\w*|endocrinolog\w*|gastroenterolog\w*|urolog\w*|orthop\w*|psychiatr\w*|pulmonolog\w*|rheumatolog\w*|gynecolog\w*|obstetric\w*|ophthalmolog\w*|otolaryngolog\w*|hematolog\w*|nephrolog\w*|insomnia|cough|headache|fever|rash|nausea|dry mouth|breathlessness|mri|ct|pet|scan|imaging|x-?ray|ultrasound|ecg|ekg|bloodwork|biopsy)\b/i;
  const medicalProviderTarget =
    /^(?:(?:my|our|their|the|a|an|this|that)\s+)?(?:primary care doctor|primary care physician|primary care provider|family doctor|family physician|doctor|physician|gp|clinician|provider|nurse(?: practitioner)?|midwi(?:fe|ves)|specialist|therapist|psychologist|counsel[eo]r|physiotherapist|physical therapist|occupational therapist|speech therapist|dietitian|nutritionist|audiologist|podiatrist|optometrist|surgeon|radiologist|social worker|cardiolog\w*|oncolog\w*|neurolog\w*|dermatolog\w*|endocrinolog\w*|gastroenterolog\w*|urolog\w*|orthop\w*|psychiatr\w*|pulmonolog\w*|rheumatolog\w*|gynecolog\w*|obstetric\w*|ophthalmolog\w*|otolaryngolog\w*|hematolog\w*|nephrolog\w*|dentist|outpatient clinic|clinic|hospital|practice|healthcare|care team|urgent care|medical center|dr\.?|md)\b/i;
  const medicalProviderContext =
    /\b(?:primary care doctor|primary care physician|primary care provider|family doctor|family physician|doctor|physician|gp|clinician|provider|nurse|midwi(?:fe|ves)|specialist|therapist|psychologist|counsel[eo]r|physiotherapist|physical therapist|occupational therapist|speech therapist|dietitian|nutritionist|audiologist|podiatrist|optometrist|surgeon|radiologist|social worker|cardiolog\w*|oncolog\w*|neurolog\w*|dermatolog\w*|endocrinolog\w*|gastroenterolog\w*|urolog\w*|orthop\w*|psychiatr\w*|pulmonolog\w*|rheumatolog\w*|gynecolog\w*|obstetric\w*|ophthalmolog\w*|otolaryngolog\w*|hematolog\w*|nephrolog\w*|dentist|outpatient clinic|clinic|hospital|practice|healthcare|care team|urgent care|medical center|dr\.?|md)\b/i;
  const medicalReviewTarget =
    /^(?:symptoms?|condition|treatment|medication|results?|patient|case|care|progress|wound|blood|tests?|labs?|health|recovery|examination|plan|notes?|summary|measurements?|mri|ct|pet|scan|imaging|x-?ray|bloodwork|ultrasound|ecg|ekg|biopsy)$/i;
  const future =
    /\b(?:will|shall|should|must|need to|have to|plan(?:ned)?|schedule(?:d)?|book(?:ed)?|arrange(?:d)?|upcoming|next|tomorrow)\b/i;
  const unrelatedTarget =
    /\b(?:to\s+(?:work|school|the office|home)|return\s+from\s+(?:vacation|holiday|travel|a trip|work|school)|(?:the\s+)?(?:invoice|bill|contract|project|report|file|document|proposal|work schedule|sales report|schoolwork|assignment|meeting minutes))\b/i;
  const pastDate =
    /\b(?:last|previous)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|day|week|month|year)\b|\b\d+\s+(?:days?|weeks?|months?|years?)\s+ago\b/i;
  const pastAction =
    /\b(?:attended|had|was seen|were seen|saw|went to|visited|completed|already had)\b/i;
  const explicitFutureAction =
    /\b(?:will|shall|plan(?:ned)?|schedule(?:d)?|book(?:ed)?|arrange(?:d)?|upcoming|need to|have to)\b/i;
  const explicitStatus =
    /\b(?:follow[ -]?up|review|return|appointment)\b[^.!?;]{0,50}\b(?:unknown|not decided|not planned|not scheduled|not arranged|not set|not established|not documented|no plan)\b|\b(?:unknown|not decided|not planned|not scheduled|not set|no plan)\b[^.!?;]{0,50}\b(?:follow[ -]?up|review|return|appointment)\b/i;
  return sources.some((source) => {
    const text = `${source.label || ""}: ${source.text}`;
    if (explicitStatus.test(text)) return true;
    return text
      .split(/[.!?;\n]+|,\s*(?=(?:i|we|they|he|she|you|the patient|patient|return|come back|follow[ -]?up|appointment|visit(?:ing)?|review|see|call|check in|with (?:another|an|the) (?:follow[ -]?up|appointment|visit))\b)|\b(?:and|but|while)\b/i)
      .some((clause) => {
      if (
        unrelatedTarget.test(clause) ||
        pastDate.test(clause) ||
        (pastAction.test(clause) && !explicitFutureAction.test(clause))
      )
        return false;
      const appointmentTarget = clause.match(
        /\b(?:appointment|follow[ -]?up|visit)\s+(?:with|for)\s+((?:(?:my|our|their|the|a|an|this|that)\s+)?[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})\b/i,
      )?.[1];
      const visitTarget = clause.match(
        /\bvisit(?:ing)?\s+(?:with\s+)?((?:(?:my|the|a|an)\s+)?[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})\b/i,
      )?.[1];
      const seeTarget = clause.match(
        /\bsee\s+((?:(?:my|our|their|the|a|an)\s+)?[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})\b/i,
      )?.[1];
      const locationTarget = clause.match(
        /\b(?:appointment|follow[ -]?up|visit)\s+(?:at|in)\s+((?:(?:my|our|their|the|a|an|this|that)\s+)?[a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,3})\b/i,
      )?.[1];
      if (
        (appointmentTarget && !medicalProviderTarget.test(appointmentTarget)) ||
        (visitTarget && !medicalProviderTarget.test(visitTarget.trim())) ||
        (seeTarget &&
          !/^(?:you|me)\b/i.test(seeTarget) &&
          !medicalProviderTarget.test(seeTarget)) ||
        (locationTarget && !medicalProviderTarget.test(locationTarget))
      )
        return false;
      const reviewObject = clause.match(
        /\breview\s+(?:(?:the|a|an|my|your|our|their|this|these|those)\s+)?([a-z][a-z'-]*)\b/i,
      )?.[1];
      if (
        reviewObject &&
        !/^(?:again|in|after|on|at|with|for|next|tomorrow|soon|back|here)$/i.test(
          reviewObject,
        ) &&
        !medicalReviewTarget.test(reviewObject)
      )
        return false;
      const hasTime = interval.test(clause) || date.test(clause);
      const scheduled = future.test(clause) || hasTime;
      if (!scheduled) return false;
      const hasClinicalContext =
        clinicalContext.test(clause) || clinicalContext.test(text);
      if (
        /\bvisit(?:ing)?\b/i.test(clause) &&
        !medicalProviderContext.test(clause) &&
        !/\bfollow[ -]?up\s+visit\b/i.test(clause)
      )
        return false;
      if (careAction.test(clause)) return hasClinicalContext;
      const review = /\breview\b/i.test(clause);
      const returnToCare =
        /\b(?:return|come back)\b/i.test(clause) &&
        /\b(?:clinic|doctor|provider|care|appointment|visit|see me|see us)\b/i.test(clause);
      return (
        returnToCare ||
        ((review || /\b(?:return|come back|check in)\b/i.test(clause)) &&
          !unrelatedTarget.test(clause) &&
          hasClinicalContext)
      );
    });
  });
}
export function deterministicAudit(input: AuditInput): TrustAudit {
  const { note, sources } = input;
  const ids = new Set<string>();
  for (const s of note.statements) {
    if (ids.has(s.id)) throw new Error("Duplicate statement identifiers");
    ids.add(s.id);
  }
  if (new Set(sources.map((s) => s.id)).size !== sources.length)
    throw new Error("Duplicate source identifiers");
  const findings: TrustFinding[] = [];
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const crosscheckSources = sources.slice(0, MAX_CROSSCHECK_SOURCES);
  if (sources.length > MAX_CROSSCHECK_SOURCES) {
    for (const kind of ["consistency", "safety"] as const)
      findings.push(
        makeFinding(
          kind,
          "input-limit",
          "not checked",
          `Cross-source review is limited to ${MAX_CROSSCHECK_SOURCES} sources; remaining sources were not checked by these rules.`,
          [],
        ),
      );
  }
  const eligible = new Set(eligibleClaims(input).map((s) => s.id));
  for (const s of note.statements) {
    const refs = [...s.evidence, ...(s.rejectedEvidence || [])].flatMap((e) => {
      const source = sourceMap.get(e.segmentId);
      return source ? [reference(source, e.quote)] : [];
    });
    const invalid =
      !!s.rejectedEvidence?.length ||
      !s.evidence.length ||
      s.evidence.some(
        (e) =>
          !e.quote.trim() ||
          !sourceMap.get(e.segmentId)?.text.includes(e.quote),
      );
    const contradicted =
      !invalid &&
      s.evidence.some((e) => explicitContradiction(s.text, e.quote));
    const ambiguous =
      !invalid &&
      s.evidence.some(
        (e) =>
          detailsConflict(s.text, e.quote) ||
          (/maybe|possible|not sure|uncertain/i.test(e.quote) &&
            !/maybe|possible|not sure|uncertain/i.test(s.text)),
      );
    const status = invalid
      ? "unsupported"
      : contradicted
        ? "contradicted"
        : ambiguous
          ? "unclear"
          : "not checked";
    findings.push(
      makeFinding(
        "evidence",
        s.id,
        status,
        invalid
          ? "A source ID or exact quoted excerpt is missing or invalid. Text existence does not establish semantic support."
          : contradicted
            ? "The claim reverses an explicit source negation. Review both texts."
            : !eligible.has(s.id)
              ? "Semantic input limit exceeded; this claim was not checked."
              : "Source excerpt exists; semantic support has not been checked.",
        refs,
        s.id,
      ),
    );
  }
  if (input.includeGaps !== false) {
    const text = sources
      .map((s) => (s.text.trim() ? `${s.label || ""} ${s.text}` : ""))
      .join("\n");
    const prompts: [string, boolean, string][] = [
      ["allergy", /allerg|no known allergies/i.test(text), "Allergy status"],
      [
        "medication",
        /medication|taking|\bmg\b|tablets|inhaler/i.test(text),
        "Medication history",
      ],
      [
        "duration",
        hasDocumentedDuration(sources),
        "Symptom duration",
      ],
      ["followup", hasDocumentedFollowupPlan(sources), "Follow-up"],
      ["examination", /exam|blood pressure|pulse|temperature/i.test(text), "Examination"],
      [
        "severity",
        /severity|mild|moderate|severe|\d+\s*\/\s*10/i.test(text),
        "Symptom severity",
      ],
      [
        "associated",
        /associated|accompanied|no other symptoms|other symptoms/i.test(text),
        "Associated symptoms",
      ],
    ];
    for (const [key, established, label] of prompts)
      if (!established)
        findings.push(
          makeFinding(
            "gaps",
            key,
            "not established",
            `${label} not established in the audited sources. Missing documentation is not a negative finding.`,
            sources.map((s) => reference(s, s.text.slice(0, 200))),
          ),
        );
    for (const s of note.statements)
      if (
        s.category === "medication" &&
        !/no (current |regular )?medication|not taking|none|unknown|don't know|do not know|not sure/i.test(
          s.text,
        )
      ) {
        const missing = [
          !/\d+\s*(mg|mcg|g|ml|puff|tablet)/i.test(s.text) && "dose",
          !/oral|by mouth|topical|inhaled|intravenous/i.test(s.text) && "route",
          !/daily|twice|once|every|weekly|as needed/i.test(s.text) &&
            "frequency",
        ].filter(Boolean);
        if (missing.length)
          findings.push(
            makeFinding(
              "gaps",
              `medication-details:${s.id}`,
              "not established",
              `Medication ${missing.join(", ")} not documented.`,
              findings.find((f) => f.statementId === s.id)!.sources,
              s.id,
            ),
          );
      }
  }
  const items = [
    ...note.statements.slice(0, MAX_CLAIMS).map((s) => ({
      id: s.id,
      text: s.text,
      refs: findings.find((f) => f.statementId === s.id)!.sources,
    })),
    ...crosscheckSources.map((s) => ({
      id: `source:${s.id}`,
      text: s.text,
      refs: [reference(s)],
    })),
  ];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i],
        b = items[j];
      if (a.text === b.text) continue;
      if (
        explicitContradiction(a.text, b.text) ||
        detailsConflict(a.text, b.text)
      )
        findings.push(
          makeFinding(
            "consistency",
            [a.id, b.id].sort().join("|"),
            "potential conflict",
            `Conflicting statements: “${a.text.slice(0, 250)}” / “${b.text.slice(0, 250)}”. Neither has been selected as correct.`,
            [...a.refs, ...b.refs],
            ids.has(a.id) ? a.id : undefined,
          ),
        );
    }
  for (const source of sources)
    if (/\b(actually|correction|correct that|rather than)\b/i.test(source.text))
      findings.push(
        makeFinding(
          "consistency",
          `correction:${source.id}`,
          "unclear",
          "An explicit correction needs review in context; preserve the original and corrected wording.",
          [reference(source)],
        ),
      );
  for (const [allergen, drug, rule] of [
    ["penicillin", "amoxicillin", "synthetic-penicillin-amoxicillin"],
    ["ibuprofen", "ibuprofen", "synthetic-same-drug"],
    ["aspirin", "aspirin", "synthetic-same-drug"],
  ]) {
    const allergies = crosscheckSources.filter(
      (s) =>
        new RegExp(`\\b${allergen}\\b`, "i").test(s.text) &&
        (s.label === "Recorded allergies" || /allerg/i.test(s.text)) &&
        !/no known|no .*allerg|denies .*allerg|not allergic|unknown|unsure|not sure/i.test(
          s.text,
        ),
    );
    const medications = crosscheckSources.filter(
      (s) =>
        s.verification !== "stopped" &&
        new RegExp(`\\b${drug}\\b`, "i").test(s.text) &&
        (s.type === "medication" ||
          s.label === "Recorded medications" ||
          /taking|prescrib|medication|\bmg\b|started/i.test(s.text)) &&
        !/not taking|stopped|avoid/i.test(s.text),
    );
    for (const a of allergies)
      for (const m of medications) {
        const f = makeFinding(
          "safety",
          `${rule}:${a.id}:${m.id}`,
          "potential conflict",
          "Potential conflict to review in a limited synthetic allergy/medication rule. This is not treatment advice or comprehensive interaction checking.",
          [reference(a), reference(m)],
        );
        f.rule = rule;
        findings.push(f);
      }
  }
  return {
    checkerVersion: CHECKER_VERSION,
    sourceFingerprint: sourceFingerprint(sources),
    noteFingerprint: noteFingerprint(note),
    createdAt: new Date().toISOString(),
    findings,
    errors: [],
  };
}
export function mergeSemantic(
  audit: TrustAudit,
  output: ProviderAudit,
  input: AuditInput,
  model: string,
  provider: string,
) {
  const allowed = new Set(eligibleClaims(input).map((s) => s.id));
  const seen = new Set<string>();
  for (const result of output.claims) {
    if (!allowed.has(result.statementId) || seen.has(result.statementId))
      throw new Error("Invalid or duplicate verifier claim ID");
    seen.add(result.statementId);
  }
  for (const c of output.concerns)
    if (
      c.sourceIds.some((id) => !input.sources.some((s) => s.id === id)) ||
      c.statementIds.some((id) => !allowed.has(id)) ||
      (!c.sourceIds.length && !c.statementIds.length)
    )
      throw new Error("Invalid verifier concern references");
  for (const f of audit.findings.filter(
    (f) => f.kind === "evidence" && allowed.has(f.target),
  )) {
    const result = output.claims.find((r) => r.statementId === f.target);
    f.model = model;
    f.provider = provider;
    if (!result) {
      audit.errors.push(
        `Verifier omitted claim ${f.target}; semantic support not checked.`,
      );
      f.explanations.push(
        "Verifier omitted this claim; semantic support not checked.",
      );
      continue;
    }
    f.explanations.push(result.reason);
    if (f.status !== "unsupported" && f.status !== "contradicted") {
      if (f.status === "unclear" && result.status === "supported") {
        f.message =
          "Local and semantic checks disagree. Review both explanations.";
      } else {
        f.status = result.status;
        f.message = result.reason;
      }
      f.required = f.status !== "supported";
    }
  }
  for (const c of output.concerns) {
    const refs = c.sourceIds.map((id) =>
      reference(input.sources.find((s) => s.id === id)!),
    );
    for (const id of c.statementIds)
      refs.push(
        ...audit.findings.find((f) => f.kind === "evidence" && f.target === id)!
          .sources,
      );
    const existing = audit.findings.find(
      (f) => f.kind === c.kind && f.target === c.target,
    );
    if (existing) {
      existing.explanations.push(c.reason);
      continue;
    }
    const f = makeFinding(
      c.kind,
      c.target,
      c.kind === "gaps" ? "not established" : "unclear",
      c.reason,
      refs,
      c.statementIds[0],
    );
    f.model = model;
    f.provider = provider;
    audit.findings.push(f);
  }
  audit.model = model;
  audit.provider = provider;
  return audit;
}
export function trustToFlags(audit: TrustAudit): Flag[] {
  return audit.findings.map((f) => ({
    id: f.id,
    category: {
      evidence: "EvidenceGuard",
      gaps: "Documentation gaps",
      consistency: "Consistency",
      safety: "Synthetic safety",
    }[f.kind],
    message: f.message,
    priority: f.priority,
    segmentId: f.sources[0]?.id,
    resolution: f.resolution,
    note: f.note,
    trust: f,
  }));
}
export function assertTrustApproval(audit: TrustAudit, input: AuditInput) {
  if (
    audit.checkerVersion !== CHECKER_VERSION ||
    audit.sourceFingerprint !== sourceFingerprint(input.sources) ||
    audit.noteFingerprint !== noteFingerprint(input.note)
  )
    throw new Error("Audit is stale. Run checks again.");
  if (
    input.note.statements.some(
      (s) =>
        !!s.rejectedEvidence?.length ||
        !s.evidence.length ||
        s.evidence.some(
          (e) =>
            !input.sources.some(
              (source) =>
                source.id === e.segmentId &&
                !!e.quote.trim() &&
                source.text.includes(e.quote),
            ),
        ),
    )
  )
    throw new Error(
      "Every statement or paragraph must retain a valid source reference before approval.",
    );
  if (
    audit.findings.some(
      (f) =>
        f.required && (f.resolution === "Open" || f.note.trim().length < 3),
    )
  )
    throw new Error(
      "Review every required finding with a rationale before approval.",
    );
}
