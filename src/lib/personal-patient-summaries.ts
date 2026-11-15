import { z } from "zod";
import { randomUUID } from "node:crypto";
import { database, consultation, transaction, audit, now } from "./db";
import {
  assertTrustApproval,
  patientSummarySchema,
  patientSummaryToNote,
  sourceFingerprint,
  type TrustSource,
  type TrustAudit,
} from "./trust-engine";
import { generatePatientSummary, runTrustAudit } from "./trust-provider";
import { providerStatus } from "./provider";
export class PatientSummaryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function approvedSource(
  user: string,
  id: string,
  version?: number,
): TrustSource {
  const c = consultation(user, id);
  if (!c) throw new PatientSummaryError(404, "Consultation not found.");
  if (
    c.status !== "Approved" ||
    !c.note ||
    (version !== undefined && c.version !== version)
  )
    throw new PatientSummaryError(
      409,
      "An unchanged approved clinical note is required.",
    );
  return {
    id: c.id,
    type: "note",
    version: c.version,
    text: c.note.statements.map((s) => s.text).join("\n"),
    label: "Approved clinical note",
  };
}
function row(user: string, consultationId: string, id: string) {
  const r = database()
    .prepare(
      "SELECT * FROM patient_summaries WHERE id=? AND user_id=? AND consultation_id=?",
    )
    .get(id, user, consultationId);
  if (!r) throw new PatientSummaryError(404, "Patient summary not found.");
  return r;
}
function parsed(r: Record<string, unknown>) {
  return {
    ...r,
    content: JSON.parse(String(r.content)),
    trust: JSON.parse(String(r.trust)),
  };
}
function fresh(
  user: string,
  consultationId: string,
  r: Record<string, unknown>,
) {
  const s = approvedSource(user, consultationId, Number(r.source_version));
  if (sourceFingerprint([s]) !== r.source_fingerprint)
    throw new PatientSummaryError(
      409,
      "The approved source changed. Generate a new summary.",
    );
  return s;
}
export async function personalPatientSummaries(
  user: string,
  consultationId: string,
  method: string,
  id: string | undefined,
  action: string | undefined,
  body: unknown,
  signal: AbortSignal,
) {
  if (method === "GET" && !id) {
    if (!consultation(user, consultationId))
      throw new PatientSummaryError(404, "Consultation not found.");
    return database()
      .prepare(
        "SELECT * FROM patient_summaries WHERE user_id=? AND consultation_id=? ORDER BY created_at DESC",
      )
      .all(user, consultationId)
      .map(parsed);
  }
  if (method === "POST" && !id) {
    const b = z
      .object({ sourceVersion: z.number().int(), consent: z.literal(true) })
      .parse(body);
    const source = approvedSource(user, consultationId, b.sourceVersion),
      fingerprint = sourceFingerprint([source]);
    const content = patientSummarySchema.parse(
      await generatePatientSummary(source, signal),
    );
    const trust = await runTrustAudit(
      {
        note: patientSummaryToNote(content),
        sources: [source],
        includeGaps: false,
      },
      true,
      signal,
    );
    signal.throwIfAborted();
    return transaction(() => {
      if (
        sourceFingerprint([
          approvedSource(user, consultationId, b.sourceVersion),
        ]) !== fingerprint
      )
        throw new PatientSummaryError(409, "Source changed during generation.");
      const newId = randomUUID();
      database()
        .prepare(
          "INSERT INTO patient_summaries(id,user_id,consultation_id,source_version,source_fingerprint,content,trust,model,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          newId,
          user,
          consultationId,
          b.sourceVersion,
          fingerprint,
          JSON.stringify(content),
          JSON.stringify(trust),
          providerStatus().model,
          now(),
        );
      audit(user, consultationId, "Patient summary generated", {
        summaryId: newId,
        sourceVersion: b.sourceVersion,
      });
      return parsed(row(user, consultationId, newId));
    });
  }
  if (!id) throw new PatientSummaryError(405, "Method not allowed.");
  const existing = row(user, consultationId, id);
  if (method === "GET" && !action) return parsed(existing);
  const b = z.object({ version: z.number().int() }).passthrough().parse(body);
  if (existing.status === "approved" || existing.version !== b.version)
    throw new PatientSummaryError(
      409,
      "Summary is approved or changed. Reload the record.",
    );
  const source = fresh(user, consultationId, existing);
  let updated:
    | { content: z.infer<typeof patientSummarySchema>; trust: TrustAudit }
    | undefined;
  if (
    (method === "PATCH" && !action) ||
    (method === "POST" && action === "audit")
  ) {
    const edit =
      action === "audit"
        ? {
            content: patientSummarySchema.parse(
              JSON.parse(String(existing.content)),
            ),
          }
        : z.object({ content: patientSummarySchema }).parse(body);
    if (action === "audit") z.object({ consent: z.literal(true) }).parse(body);
    const trust = await runTrustAudit(
      {
        note: patientSummaryToNote(edit.content),
        sources: [source],
        includeGaps: false,
      },
      action === "audit",
      signal,
    );
    updated = { content: edit.content, trust };
  }
  signal.throwIfAborted();
  return transaction(() => {
    const current = row(user, consultationId, id);
    fresh(user, consultationId, current);
    if (current.status === "approved" || current.version !== b.version)
      throw new PatientSummaryError(
        409,
        "Summary changed. Reload before continuing.",
      );
    const trust = JSON.parse(String(current.trust)) as TrustAudit;
    if (updated)
      database()
        .prepare(
          "UPDATE patient_summaries SET content=?,trust=?,version=version+1 WHERE id=?",
        )
        .run(
          JSON.stringify(updated.content),
          JSON.stringify(updated.trust),
          id,
        );
    else if (method === "PATCH" && action === "findings") {
      const f = z
        .object({
          id: z.string(),
          resolution: z.enum(["Addressed", "Not applicable"]),
          note: z.string().trim().min(3).max(1000),
        })
        .parse(body);
      if (!trust.findings.some((x) => x.id === f.id))
        throw new PatientSummaryError(404, "Finding not found.");
      trust.findings = trust.findings.map((x) =>
        x.id === f.id ? { ...x, resolution: f.resolution, note: f.note } : x,
      );
      database()
        .prepare(
          "UPDATE patient_summaries SET trust=?,version=version+1 WHERE id=?",
        )
        .run(JSON.stringify(trust), id);
    } else if (method === "POST" && action === "approve") {
      z.object({ confirmed: z.literal(true), reviewed: z.literal(true) }).parse(
        body,
      );
      try {
        assertTrustApproval(trust, {
          note: patientSummaryToNote(
            patientSummarySchema.parse(JSON.parse(String(current.content))),
          ),
          sources: [source],
          includeGaps: false,
        });
      } catch (e) {
        throw new PatientSummaryError(409, (e as Error).message);
      }
      database()
        .prepare(
          "UPDATE patient_summaries SET status='approved',version=version+1,approved_at=?,approved_by=? WHERE id=?",
        )
        .run(now(), "Workspace reviewer (simulated)", id);
    } else throw new PatientSummaryError(405, "Method not allowed.");
    audit(
      user,
      consultationId,
      action === "approve"
        ? "Patient summary approved"
        : action === "findings"
          ? "Patient summary finding reviewed"
          : "Patient summary edited",
      { summaryId: id, version: b.version + 1 },
    );
    return parsed(row(user, consultationId, id));
  });
}
