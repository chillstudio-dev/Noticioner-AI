import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  withPracticeTransaction,
  requirePatientAccess,
  auditPractice,
  PracticeError,
  type PracticeActor,
} from "./practice-store";
import {
  sourceFingerprint,
  patientSummarySchema,
  patientSummaryToNote,
  assertTrustApproval,
  type TrustSource,
  type TrustAudit,
} from "./trust-engine";
import { generatePatientSummary, runTrustAudit } from "./trust-provider";
import { providerStatus } from "./provider";
import { evaluateTrust } from "./trust-evaluation";

export async function trustTransaction<T>(
  actor: PracticeActor,
  fn: (client: PoolClient) => Promise<T>,
) {
  return withPracticeTransaction(async (client) => {
    const member = await client.query(
      "SELECT role FROM memberships WHERE organization_id=$1 AND practitioner_id=$2 AND active FOR SHARE",
      [actor.organizationId, actor.practitionerId],
    );
    if (member.rows[0]?.role !== actor.role || actor.role === "admin")
      throw new PracticeError(
        403,
        "Active clinician or reviewer membership required.",
      );
    return fn(client);
  });
}
export async function medicationSources(
  client: PoolClient,
  actor: PracticeActor,
  patientId: string,
): Promise<TrustSource[]> {
  const { rows } = await client.query(
    "SELECT * FROM practice_medications WHERE organization_id=$1 AND patient_id=$2 ORDER BY id",
    [actor.organizationId, patientId],
  );
  return rows.map((m) => ({
    id: `medication:${m.id}`,
    recordId: m.id,
    type: "medication",
    version: m.version,
    text: [m.name, m.dose, m.route, m.frequency, `Source: ${m.source}`].join(
      " ",
    ),
    verification: m.status,
  }));
}
export async function medicationSnapshotFresh(
  client: PoolClient,
  actor: PracticeActor,
  patientId: string,
  sources: TrustSource[],
) {
  return (
    sourceFingerprint(sources.filter((s) => s.type === "medication")) ===
    sourceFingerprint(await medicationSources(client, actor, patientId))
  );
}
export async function patientSummarySource(
  client: PoolClient,
  actor: PracticeActor,
  patientId: string,
  id: string,
  version?: number,
): Promise<TrustSource> {
  const { rows } = await client.query(
    "SELECT * FROM practice_notes WHERE organization_id=$1 AND patient_id=$2 AND id=$3 AND status='approved' FOR SHARE",
    [actor.organizationId, patientId, id],
  );
  const note = rows[0];
  const amendment = await client.query(
    "SELECT 1 FROM practice_notes WHERE organization_id=$1 AND patient_id=$2 AND amends_id=$3 AND status='approved'",
    [actor.organizationId, patientId, id],
  );
  if (
    !note ||
    (version !== undefined && note.version !== version) ||
    amendment.rowCount
  )
    throw new PracticeError(
      409,
      "An unchanged approved source note without an approved amendment is required.",
    );
  return {
    id: note.id,
    type: "note",
    version: note.version,
    text: note.content,
    label: "Approved clinical note",
  };
}
export async function practiceQuality(
  req: Request,
  actor: PracticeActor,
  body: unknown,
) {
  if (req.method === "GET")
    return trustTransaction(
      actor,
      async (client) =>
        (
          await client.query(
            "SELECT id,results,created_at FROM practice_quality_runs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20",
            [actor.organizationId],
          )
        ).rows,
    );
  if (req.method !== "POST")
    throw new PracticeError(405, "Method not allowed.");
  const b = z
    .object({
      mode: z.enum(["deterministic", "ai"]),
      consent: z.boolean().optional(),
    })
    .parse(body);
  if (b.mode === "ai" && !b.consent)
    throw new PracticeError(
      400,
      "Explicit consent to process synthetic fixtures is required.",
    );
  await trustTransaction(actor, async (client) => {
    const limit = await client.query(
      "INSERT INTO practice_request_limits(key,count,reset_at) VALUES($1,1,now()+interval '10 minutes') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN practice_request_limits.reset_at<now() THEN 1 ELSE practice_request_limits.count+1 END,reset_at=CASE WHEN practice_request_limits.reset_at<now() THEN now()+interval '10 minutes' ELSE practice_request_limits.reset_at END RETURNING count",
      [`quality:${actor.organizationId}:${actor.practitionerId}`],
    );
    if (limit.rows[0].count > 3)
      throw new PracticeError(
        429,
        "Please wait before running another quality evaluation.",
      );
  });
  // Deliberately patient-independent: the evaluator imports only synthetic fixtures.
  const result = await evaluateTrust(b.mode, req.signal);
  return trustTransaction(actor, async (client) => {
    await client.query(
      "INSERT INTO practice_quality_runs(id,organization_id,actor_id,suite_version,results) VALUES($1,$2,$3,$4,$5)",
      [
        randomUUID(),
        actor.organizationId,
        actor.practitionerId,
        result.suiteVersion,
        JSON.stringify(result),
      ],
    );
    await auditPractice(client, actor, "quality.synthetic_run", null);
    return result;
  });
}
export async function practicePatientSummaries(
  req: Request,
  actor: PracticeActor,
  patientId: string,
  id: string | undefined,
  action: string | undefined,
  body: unknown,
) {
  const method = req.method;
  if (method === "GET")
    return trustTransaction(actor, async (client) => {
      await requirePatientAccess(client, actor, patientId);
      const rows = (
        await client.query(
          "SELECT * FROM practice_patient_summaries WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 100",
          [actor.organizationId, patientId],
        )
      ).rows;
      for (const r of rows) {
        try {
          const s = await patientSummarySource(
            client,
            actor,
            patientId,
            r.source_note_id,
            r.source_version,
          );
          r.stale = sourceFingerprint([s]) !== r.source_fingerprint;
        } catch {
          r.stale = true;
        }
      }
      if (id) {
        const record = rows.find((r) => r.id === id);
        if (!record) throw new PracticeError(404, "Patient summary not found.");
        return record;
      }
      return rows;
    });
  if (method === "POST" && !id) {
    const b = z
      .object({
        sourceNoteId: z.uuid(),
        sourceVersion: z.number().int(),
        consent: z.literal(true),
      })
      .parse(body);
    const source = await trustTransaction(actor, async (client) => {
      await requirePatientAccess(client, actor, patientId, true);
      return patientSummarySource(
        client,
        actor,
        patientId,
        b.sourceNoteId,
        b.sourceVersion,
      );
    });
    const content = await generatePatientSummary(source, req.signal);
    await trustTransaction(actor, async (client) => {
      await requirePatientAccess(client, actor, patientId, true);
      await patientSummarySource(
        client,
        actor,
        patientId,
        b.sourceNoteId,
        b.sourceVersion,
      );
    });
    const trust = await runTrustAudit(
      {
        note: patientSummaryToNote(content),
        sources: [source],
        includeGaps: false,
      },
      true,
      req.signal,
    );
    req.signal.throwIfAborted();
    return trustTransaction(actor, async (client) => {
      await requirePatientAccess(client, actor, patientId, true);
      const current = await patientSummarySource(
        client,
        actor,
        patientId,
        b.sourceNoteId,
        b.sourceVersion,
      );
      if (sourceFingerprint([current]) !== sourceFingerprint([source]))
        throw new PracticeError(409, "Source changed during generation.");
      req.signal.throwIfAborted();
      const result = await client.query(
        "INSERT INTO practice_patient_summaries(id,organization_id,patient_id,source_note_id,source_version,source_fingerprint,content,trust,model,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          randomUUID(),
          actor.organizationId,
          patientId,
          b.sourceNoteId,
          b.sourceVersion,
          sourceFingerprint([source]),
          JSON.stringify(content),
          JSON.stringify(trust),
          providerStatus().model,
          actor.practitionerId,
        ],
      );
      await auditPractice(
        client,
        actor,
        "patient_summary.generated",
        patientId,
      );
      return result.rows[0];
    });
  }
  if (!id) throw new PracticeError(405, "Method not allowed.");
  z.uuid().parse(id);
  const b = z.object({ version: z.number().int() }).passthrough().parse(body);
  // Edits and retries audit outside the transaction, then recheck under a row lock.
  const snapshot = await trustTransaction(actor, async (client) => {
    await requirePatientAccess(client, actor, patientId, true);
    const r = (
      await client.query(
        "SELECT * FROM practice_patient_summaries WHERE organization_id=$1 AND patient_id=$2 AND id=$3",
        [actor.organizationId, patientId, id],
      )
    ).rows[0];
    if (!r) throw new PracticeError(404, "Patient summary not found.");
    if (r.status !== "draft" || r.version !== b.version)
      throw new PracticeError(409, "Summary changed or is approved. Reload.");
    const source = await patientSummarySource(
      client,
      actor,
      patientId,
      r.source_note_id,
      r.source_version,
    );
    if (sourceFingerprint([source]) !== r.source_fingerprint)
      throw new PracticeError(409, "Source changed.");
    return { r, source };
  });
  let updated:
    | { content: z.infer<typeof patientSummarySchema>; trust: TrustAudit }
    | undefined;
  if (
    (method === "PATCH" && !action) ||
    (method === "POST" && action === "audit")
  ) {
    const content =
      method === "PATCH"
        ? z.object({ content: patientSummarySchema }).parse(body).content
        : patientSummarySchema.parse(snapshot.r.content);
    const authorized = action === "audit";
    if (authorized) z.object({ consent: z.literal(true) }).parse(body);
    updated = {
      content,
      trust: await runTrustAudit(
        {
          note: patientSummaryToNote(content),
          sources: [snapshot.source],
          includeGaps: false,
        },
        authorized,
        req.signal,
      ),
    };
  }
  req.signal.throwIfAborted();
  return trustTransaction(actor, async (client) => {
    await requirePatientAccess(client, actor, patientId, true);
    const r = (
      await client.query(
        "SELECT * FROM practice_patient_summaries WHERE organization_id=$1 AND patient_id=$2 AND id=$3 FOR UPDATE",
        [actor.organizationId, patientId, id],
      )
    ).rows[0];
    if (!r || r.status !== "draft" || r.version !== b.version)
      throw new PracticeError(409, "Summary changed or is approved. Reload.");
    const source = await patientSummarySource(
      client,
      actor,
      patientId,
      r.source_note_id,
      r.source_version,
    );
    if (sourceFingerprint([source]) !== r.source_fingerprint)
      throw new PracticeError(409, "Source changed.");
    let result;
    if (updated)
      result = await client.query(
        "UPDATE practice_patient_summaries SET content=$1,trust=$2,version=version+1 WHERE organization_id=$3 AND id=$4 RETURNING *",
        [
          JSON.stringify(updated.content),
          JSON.stringify(updated.trust),
          actor.organizationId,
          id,
        ],
      );
    else if (method === "PATCH" && action === "findings") {
      if (actor.role !== "reviewer")
        throw new PracticeError(403, "Reviewer permission required.");
      const f = z
        .object({
          id: z.string(),
          resolution: z.enum(["Addressed", "Not applicable"]),
          note: z.string().trim().min(3).max(1000),
        })
        .parse(body);
      const trust = r.trust as TrustAudit;
      if (!trust.findings.some((x) => x.id === f.id))
        throw new PracticeError(404, "Finding not found.");
      trust.findings = trust.findings.map((x) =>
        x.id === f.id ? { ...x, resolution: f.resolution, note: f.note } : x,
      );
      result = await client.query(
        "UPDATE practice_patient_summaries SET trust=$1,version=version+1 WHERE organization_id=$2 AND id=$3 RETURNING *",
        [JSON.stringify(trust), actor.organizationId, id],
      );
    } else if (method === "POST" && action === "approve") {
      if (actor.role !== "reviewer")
        throw new PracticeError(403, "Reviewer permission required.");
      z.object({ reviewed: z.literal(true) }).parse(body);
      try {
        assertTrustApproval(r.trust, {
          note: patientSummaryToNote(r.content),
          sources: [source],
          includeGaps: false,
        });
      } catch (e) {
        throw new PracticeError(409, (e as Error).message);
      }
      result = await client.query(
        "UPDATE practice_patient_summaries SET status='approved',approved_by=$1,approved_at=now(),version=version+1 WHERE organization_id=$2 AND id=$3 RETURNING *",
        [actor.practitionerId, actor.organizationId, id],
      );
    } else throw new PracticeError(405, "Method not allowed.");
    req.signal.throwIfAborted();
    await auditPractice(
      client,
      actor,
      `patient_summary.${action || "edited"}`,
      patientId,
    );
    return result.rows[0];
  });
}
