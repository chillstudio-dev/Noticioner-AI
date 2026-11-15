import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import {
  withPracticeTransaction,
  query,
  requirePatientAccess,
  auditPractice,
  PracticeError,
  type PracticeActor,
} from "./practice-store";
import { prepareDocument, decryptDocument, fileStatus } from "./practice-files";
import { generateNote, providerStatus, transcribe } from "./provider";
import { languageSchema } from "./languages";
import { translateTranscript, translationInput } from "./translation";
import { practiceDemoMode } from "./practice-demo";
import { noteSchema, type Segment, type Note } from "./clinical";
import { runTrustAudit } from "./trust-provider";
import {
  assertTrustApproval,
  type TrustSource,
  type TrustFinding,
  type TrustAudit,
} from "./trust-engine";
import {
  practiceQuality,
  practicePatientSummaries,
  medicationSources,
  medicationSnapshotFresh,
} from "./practice-trust";
const uuid = z.uuid();
const patientInput = z.object({
  name: z.string().trim().min(2).max(100),
  dob: z.iso.date().refine((x) => x <= new Date().toISOString().slice(0, 10)),
  identifier: z.string().trim().min(1).max(100),
  reviewerId: uuid.optional(),
});
const medicationInput = z.object({
  name: z.string().trim().min(1).max(150),
  dose: z.string().trim().max(100),
  route: z.string().trim().max(100),
  frequency: z.string().trim().max(100),
  status: z.enum(["reported", "verified", "stopped"]),
  source: z.string().trim().min(1).max(1000),
});
const noteInput = z.object({
  text: z.string().trim().min(1).max(12000),
  amendsId: uuid.optional(),
});
const approvalInput = z.object({
  version: z.number().int().positive(),
  reviewed: z.literal(true),
});
const summaryInput = z
  .object({
    sourceNoteIds: z.array(uuid).max(8).default([]),
    sourceDocumentIds: z.array(uuid).max(8).default([]),
    consent: z.literal(true),
  })
  .refine((x) => x.sourceNoteIds.length + x.sourceDocumentIds.length > 0);
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function limitedBody(req: Request, max = 65536) {
  if (Number(req.headers.get("content-length")) > max)
    throw new PracticeError(413, "Request is too large.");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new PracticeError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function body(req: Request) {
  try {
    return JSON.parse(new TextDecoder().decode(await limitedBody(req)));
  } catch (e) {
    if (e instanceof PracticeError) throw e;
    throw new PracticeError(400, "Invalid JSON request.");
  }
}
async function active(client: PoolClient, actor: PracticeActor) {
  const { rows } = await client.query(
    "SELECT role FROM memberships WHERE organization_id=$1 AND practitioner_id=$2 AND active FOR SHARE",
    [actor.organizationId, actor.practitionerId],
  );
  if (!rows[0] || rows[0].role !== actor.role)
    throw new PracticeError(403, "Practice membership changed. Sign in again.");
}
async function tx<T>(
  actor: PracticeActor,
  operation: (client: PoolClient) => Promise<T>,
) {
  return withPracticeTransaction(async (client) => {
    await active(client, actor);
    return operation(client);
  });
}
function clinician(actor: PracticeActor) {
  if (actor.role === "admin")
    throw new PracticeError(
      403,
      "Clinical access requires a practitioner role and care assignment.",
    );
}
function reviewer(actor: PracticeActor) {
  if (actor.role !== "reviewer")
    throw new PracticeError(
      403,
      "An authorized reviewer must approve this record.",
    );
}
async function patient(
  client: PoolClient,
  actor: PracticeActor,
  id: string,
  write = false,
) {
  uuid.parse(id);
  return requirePatientAccess(client, actor, id, write);
}
export async function practiceRequest(
  req: Request,
  actor: PracticeActor,
  path: string[],
): Promise<Response> {
  try {
    const method = req.method;
    if (method !== "GET") {
      const { rows } = await query(
        `INSERT INTO practice_request_limits(key,count,reset_at) VALUES($1,1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN practice_request_limits.reset_at<now() THEN 1 ELSE practice_request_limits.count+1 END,reset_at=CASE WHEN practice_request_limits.reset_at<now() THEN now()+interval '1 minute' ELSE practice_request_limits.reset_at END RETURNING count`,
        [`${actor.organizationId}:${actor.practitionerId}`],
      );
      if (rows[0].count > 30)
        throw new PracticeError(
          429,
          "Too many changes. Please wait one minute.",
        );
    }
    if (path.join("/") === "bootstrap" && method === "GET")
      return json(
        await tx(actor, async (client) => {
          const patients =
            actor.role === "admin"
              ? []
              : (
                  await client.query(
                    `SELECT p.*,p.identifier AS external_identifier FROM practice_patients p JOIN care_relationships c ON c.organization_id=p.organization_id AND c.patient_id=p.id WHERE p.organization_id=$1 AND c.practitioner_id=$2 AND c.active AND ($3='' OR strpos(lower(p.name),lower($3))>0 OR strpos(lower(p.identifier),lower($3))>0) ORDER BY p.name,p.id LIMIT 251`,
                    [
                      actor.organizationId,
                      actor.practitionerId,
                      z
                        .string()
                        .max(100)
                        .parse(new URL(req.url).searchParams.get("q") || ""),
                    ],
                  )
                ).rows;
          const members = (
            await client.query(
              `SELECT m.practitioner_id,p.display_name,m.role FROM memberships m JOIN practitioners p ON p.id=m.practitioner_id WHERE m.organization_id=$1 AND m.active ORDER BY p.display_name`,
              [actor.organizationId],
            )
          ).rows;
          const organization = (
            await client.query(
              "SELECT id,name FROM organizations WHERE id=$1",
              [actor.organizationId],
            )
          ).rows[0];
          await auditPractice(client, actor, "patient_directory.read", null);
          return {
            actor,
            demo: practiceDemoMode(),
            organization,
            patients: patients.slice(0, 250),
            directoryLimited: patients.length > 250,
            members,
            provider: providerStatus(),
            files: fileStatus(),
          };
        }),
      );
    if (path.length === 1 && path[0] === "patients" && method === "POST") {
      clinician(actor);
      const b = patientInput.parse(await body(req)),
        id = randomUUID();
      return json(
        await tx(actor, async (client) => {
          if (actor.role === "clinician" && !b.reviewerId)
            throw new PracticeError(
              400,
              "Choose an assigned reviewer for this patient.",
            );
          if (
            b.reviewerId &&
            !(
              await client.query(
                "SELECT 1 FROM memberships WHERE organization_id=$1 AND practitioner_id=$2 AND active AND role='reviewer' FOR SHARE",
                [actor.organizationId, b.reviewerId],
              )
            ).rowCount
          )
            throw new PracticeError(
              400,
              "Choose an active reviewer in this practice.",
            );
          const { rows } = await client.query(
            "INSERT INTO practice_patients(id,organization_id,name,dob,identifier) VALUES($1,$2,$3,$4,$5) RETURNING *,identifier AS external_identifier",
            [id, actor.organizationId, b.name, b.dob, b.identifier],
          );
          await client.query(
            "INSERT INTO care_relationships(organization_id,patient_id,practitioner_id,access_level) VALUES($1,$2,$3,'edit')",
            [actor.organizationId, id, actor.practitionerId],
          );
          if (b.reviewerId && b.reviewerId !== actor.practitionerId) {
            await client.query(
              "INSERT INTO care_relationships(organization_id,patient_id,practitioner_id,access_level) VALUES($1,$2,$3,'edit')",
              [actor.organizationId, id, b.reviewerId],
            );
            await auditPractice(
              client,
              actor,
              `care.granted:${b.reviewerId}`,
              id,
            );
          }
          await auditPractice(client, actor, "patient.created", id);
          return rows[0];
        }),
        201,
      );
    }
    if (path.length === 1 && path[0] === "quality")
      return json(
        await practiceQuality(
          req,
          actor,
          method === "GET" ? undefined : await body(req),
        ),
      );
    if (path[0] !== "patients" || !path[1])
      throw new PracticeError(404, "Not found.");
    const id = uuid.parse(path[1]),
      resource = path[2],
      resourceId = path[3];
    if (resource === "patient-summaries" && path.length <= 5)
      return json(
        await practicePatientSummaries(
          req,
          actor,
          id,
          resourceId,
          path[4],
          method === "GET" ? undefined : await body(req),
        ),
        method === "POST" && !resourceId ? 201 : 200,
      );
    if (path.length === 2 && method === "GET")
      return json(
        await tx(actor, async (client) => {
          const p = await patient(client, actor, id);
          const values = [actor.organizationId, id];
          const notes = (
            await client.query(
              "SELECT * FROM practice_notes WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 200",
              values,
            )
          ).rows;
          const medications = (
            await client.query(
              "SELECT * FROM practice_medications WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 200",
              values,
            )
          ).rows;
          const documents = (
            await client.query(
              "SELECT id,filename,mime_type,byte_size,checksum,status,version,uploaded_by,created_at FROM practice_documents WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 200",
              values,
            )
          ).rows;
          const summaries = (
            await client.query(
              "SELECT * FROM practice_summaries WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 100",
              values,
            )
          ).rows;
          for (const summary of summaries) {
            summary.stale =
              !(await medicationSnapshotFresh(
                client,
                actor,
                id,
                summary.trust_sources,
              )) || (await sourcesStale(client, actor, id, summary.sources));
          }
          const patientSummaries = (
            await client.query(
              "SELECT * FROM practice_patient_summaries WHERE organization_id=$1 AND patient_id=$2 ORDER BY created_at DESC LIMIT 100",
              values,
            )
          ).rows;
          for (const summary of patientSummaries)
            summary.stale = await sourcesStale(client, actor, id, [
              {
                type: "note",
                id: summary.source_note_id,
                version: summary.source_version,
              },
            ]);
          const grants = (
            await client.query(
              "SELECT c.practitioner_id,p.display_name,c.active,c.access_level FROM care_relationships c JOIN practitioners p ON p.id=c.practitioner_id WHERE c.organization_id=$1 AND c.patient_id=$2",
              values,
            )
          ).rows;
          const audit = (
            await client.query(
              "SELECT id,action,outcome,created_at,practitioner_id FROM practice_audit WHERE organization_id=$1 AND resource_id=$2 ORDER BY created_at DESC LIMIT 50",
              values,
            )
          ).rows;
          await auditPractice(client, actor, "patient.read", id);
          return {
            patient: { ...p, external_identifier: p.identifier },
            permissions: {
              canWrite: p.access_level === "edit",
              canApprove:
                p.access_level === "edit" && actor.role === "reviewer",
              canManage: p.access_level === "edit" && actor.role === "reviewer",
            },
            notes,
            medications,
            documents,
            summaries,
            patientSummaries,
            grants,
            audit,
          };
        }),
      );
    if (
      resource === "grants" &&
      ((method === "POST" && path.length === 3) ||
        (method === "DELETE" && path.length === 4))
    ) {
      if (actor.role !== "reviewer" && actor.role !== "admin")
        throw new PracticeError(
          403,
          "A reviewer or administrator must manage care assignments.",
        );
      const grant =
        method === "POST"
          ? z
              .object({
                practitionerId: uuid,
                accessLevel: z.enum(["view", "edit"]).default("view"),
              })
              .parse(await body(req))
          : {
              practitionerId: uuid.parse(resourceId),
              accessLevel: "view" as const,
            };
      const { practitionerId, accessLevel } = grant;
      return json(
        await tx(actor, async (client) => {
          if (actor.role !== "admin") await patient(client, actor, id, true);
          else if (
            !(
              await client.query(
                "SELECT 1 FROM practice_patients WHERE organization_id=$1 AND id=$2",
                [actor.organizationId, id],
              )
            ).rowCount
          )
            throw new PracticeError(404, "Patient not found.");
          if (
            !(
              await client.query(
                "SELECT 1 FROM memberships WHERE organization_id=$1 AND practitioner_id=$2 AND active AND role IN ('clinician','reviewer') FOR SHARE",
                [actor.organizationId, practitionerId],
              )
            ).rowCount
          )
            throw new PracticeError(404, "Active practitioner not found.");
          if (method === "POST")
            await client.query(
              "INSERT INTO care_relationships(organization_id,patient_id,practitioner_id,active,access_level) VALUES($1,$2,$3,true,$4) ON CONFLICT(organization_id,patient_id,practitioner_id) DO UPDATE SET active=true,access_level=EXCLUDED.access_level",
              [actor.organizationId, id, practitionerId, accessLevel],
            );
          else
            await client.query(
              "UPDATE care_relationships SET active=false WHERE organization_id=$1 AND patient_id=$2 AND practitioner_id=$3",
              [actor.organizationId, id, practitionerId],
            );
          await auditPractice(
            client,
            actor,
            `care.${method === "POST" ? `granted:${accessLevel}` : "revoked"}:${practitionerId}`,
            id,
          );
          return { ok: true };
        }),
      );
    }
    clinician(actor);
    if (resource === "translate" && path.length === 3 && method === "POST") {
      const input = translationInput.parse(await body(req));
      await tx(actor, async (client) => {
        await patient(client, actor, id, true);
        await auditPractice(client, actor, "translation.sources_disclosed", id);
      });
      let draft;
      try {
        draft = await translateTranscript(input, req.signal);
      } catch (error) {
        throw new PracticeError(
          502,
          error instanceof Error ? error.message : "AI translation failed.",
        );
      }
      return json(
        await tx(actor, async (client) => {
          await patient(client, actor, id, true);
          await auditPractice(client, actor, "translation.generated", id);
          return draft;
        }),
      );
    }
    if (resource === "transcribe" && path.length === 3 && method === "POST") {
      await tx(actor, (client) => patient(client, actor, id, true));
      const bytes = await limitedBody(req, 20 * 1024 * 1024 + 32768);
      const form = await new Response(bytes, {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData();
      if (form.get("consent") !== "true")
        throw new PracticeError(
          400,
          "Synthetic recording consent is required.",
        );
      const audio = form.get("audio");
      const language = languageSchema.parse(form.get("language") ?? "en");
      if (
        !(audio instanceof File) ||
        !audio.size ||
        audio.size > 20 * 1024 * 1024
      )
        throw new PracticeError(400, "Audio must be between 1 byte and 20 MB.");
      if (
        ![
          "audio/webm",
          "video/webm",
          "audio/mp4",
          "audio/mpeg",
          "audio/wav",
          "audio/ogg",
        ].includes(audio.type.split(";")[0])
      )
        throw new PracticeError(400, "Unsupported audio type.");
      await tx(actor, async (client) => {
        await patient(client, actor, id, true);
        await auditPractice(client, actor, "transcription.started", id);
      });
      let text: string;
      try {
        text = await transcribe(audio, req.signal, language);
      } catch (error) {
        throw new PracticeError(
          502,
          error instanceof Error
            ? error.message
            : "Audio transcription failed. Retry or type a transcript.",
        );
      }
      return json(
        await tx(actor, async (client) => {
          await patient(client, actor, id, true);
          await auditPractice(client, actor, "transcription.completed", id);
          return { text };
        }),
      );
    }
    if (resource === "notes" && path.length === 3 && method === "POST") {
      const b = noteInput.parse(await body(req));
      return json(
        await tx(actor, async (client) => {
          await patient(client, actor, id, true);
          if (
            b.amendsId &&
            !(
              await client.query(
                "SELECT 1 FROM practice_notes WHERE organization_id=$1 AND patient_id=$2 AND id=$3 AND status='approved'",
                [actor.organizationId, id, b.amendsId],
              )
            ).rowCount
          )
            throw new PracticeError(
              409,
              "Amendments must reference an approved note for this patient.",
            );
          const noteId = randomUUID();
          const { rows } = await client.query(
            "INSERT INTO practice_notes(id,organization_id,patient_id,author_id,content,amends_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
            [
              noteId,
              actor.organizationId,
              id,
              actor.practitionerId,
              b.text,
              b.amendsId || null,
            ],
          );
          await client.query(
            "INSERT INTO practice_note_versions(id,organization_id,note_id,version,content,author_id) VALUES($1,$2,$3,1,$4,$5)",
            [
              randomUUID(),
              actor.organizationId,
              noteId,
              b.text,
              actor.practitionerId,
            ],
          );
          await auditPractice(client, actor, "note.created", id);
          return rows[0];
        }),
        201,
      );
    }
    if (resource === "medications" && path.length === 3 && method === "POST") {
      const b = medicationInput.parse(await body(req));
      if (b.status !== "reported") reviewer(actor);
      return json(
        await tx(actor, async (client) => {
          await patient(client, actor, id, true);
          const { rows } = await client.query(
            "INSERT INTO practice_medications(id,organization_id,patient_id,name,dose,route,frequency,status,source,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
            [
              randomUUID(),
              actor.organizationId,
              id,
              b.name,
              b.dose,
              b.route,
              b.frequency,
              b.status,
              b.source,
              actor.practitionerId,
            ],
          );
          await auditPractice(client, actor, "medication.recorded", id);
          return rows[0];
        }),
        201,
      );
    }
    if (resource === "documents" && path.length === 3 && method === "POST") {
      await tx(actor, (client) => patient(client, actor, id, true));
      const bytes = await limitedBody(req, 5 * 1024 * 1024 + 32768);
      const form = await new Response(bytes, {
        headers: { "Content-Type": req.headers.get("content-type") || "" },
      }).formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new PracticeError(400, "Select a file.");
      const b = await prepareDocument(file);
      return json(
        await tx(actor, async (client) => {
          await patient(client, actor, id, true);
          const { rows } = await client.query(
            "INSERT INTO practice_documents(id,organization_id,patient_id,uploaded_by,filename,mime_type,byte_size,checksum,original_bytes,extracted_text,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'available') RETURNING id,filename,mime_type,byte_size,status,version,created_at",
            [
              randomUUID(),
              actor.organizationId,
              id,
              actor.practitionerId,
              b.filename,
              b.mime,
              b.bytes,
              b.checksum,
              b.encrypted,
              b.extracted,
            ],
          );
          await auditPractice(client, actor, "document.uploaded", id);
          return rows[0];
        }),
        201,
      );
    }
    if (
      resource === "documents" &&
      path.length === 5 &&
      path[4] === "download" &&
      method === "GET"
    )
      return await tx(actor, async (client) => {
        await patient(client, actor, id);
        const { rows } = await client.query(
          "SELECT * FROM practice_documents WHERE organization_id=$1 AND patient_id=$2 AND id=$3 AND status='available'",
          [actor.organizationId, id, uuid.parse(resourceId)],
        );
        if (!rows[0]) throw new PracticeError(404, "Document not found.");
        const bytes = decryptDocument(rows[0].original_bytes);
        await auditPractice(client, actor, "document.downloaded", id);
        return new Response(bytes, {
          headers: {
            "Content-Type": rows[0].mime_type,
            "Content-Disposition": `attachment; filename="${rows[0].filename}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
          },
        });
      });
    if (resource === "summaries" && path.length === 3 && method === "POST") {
      const b = summaryInput.parse(await body(req));
      const snapshot = await tx(actor, async (client) => {
        await patient(client, actor, id, true);
        const sources = await loadSources(
          client,
          actor,
          id,
          b.sourceNoteIds,
          b.sourceDocumentIds,
        );
        const context = await medicationSources(client, actor, id);
        await auditPractice(client, actor, "summary.sources_disclosed", id);
        return { sources, context };
      });
      const { sources, context } = snapshot;
      const segments: Segment[] = sources.map((s) => ({
        id: s.segmentId,
        speaker: "Unknown",
        text: s.text,
      }));
      let note: Note;
      try {
        note = await generateNote(segments, req.signal);
      } catch {
        throw new PracticeError(
          502,
          "AI generation failed. No summary was saved. Retry explicitly.",
        );
      }
      const trustSources: TrustSource[] = [
        ...sources.map((s) => ({
          id: s.segmentId,
          recordId: s.id,
          type: s.type,
          text: s.text,
          version: s.version,
        })),
        ...context,
      ];
      await tx(actor, async (client) => {
        await patient(client, actor, id, true);
        if (
          (await sourcesStale(client, actor, id, sources)) ||
          !(await medicationSnapshotFresh(client, actor, id, trustSources))
        )
          throw new PracticeError(409, "Sources changed during generation.");
      });
      const trust = await runTrustAudit(
        { note, sources: trustSources, includeGaps: true },
        true,
        req.signal,
      );
      req.signal.throwIfAborted();
      return json(
        await tx(actor, async (client) => {
          await patient(client, actor, id, true);
          if (
            (await sourcesStale(client, actor, id, sources)) ||
            !(await medicationSnapshotFresh(client, actor, id, trustSources))
          )
            throw new PracticeError(
              409,
              "Source records changed. Generate again.",
            );
          req.signal.throwIfAborted();
          const { findings, ...metadata } = trust;
          const result = await client.query(
            "INSERT INTO practice_summaries(id,organization_id,patient_id,note,sources,model,created_by,trust_findings,trust_audit,trust_sources) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
            [
              randomUUID(),
              actor.organizationId,
              id,
              JSON.stringify(note),
              JSON.stringify(
                sources.map(({ type, id, version, segmentId }) => ({
                  type,
                  id,
                  version,
                  segmentId,
                })),
              ),
              providerStatus().model,
              actor.practitionerId,
              JSON.stringify(findings),
              JSON.stringify(metadata),
              JSON.stringify(trustSources),
            ],
          );
          await auditPractice(client, actor, "summary.generated", id);
          return result.rows[0];
        }),
        201,
      );
    }
    if (
      resource === "summaries" &&
      resourceId &&
      ((method === "PATCH" && path.length === 4) ||
        (path.length === 5 && ["findings", "audit"].includes(path[4])))
    ) {
      const b = z
        .object({ version: z.number().int() })
        .passthrough()
        .parse(await body(req));
      const snapshot = await tx(actor, async (client) => {
        await patient(client, actor, id, true);
        const r = (
          await client.query(
            "SELECT * FROM practice_summaries WHERE organization_id=$1 AND patient_id=$2 AND id=$3",
            [actor.organizationId, id, uuid.parse(resourceId)],
          )
        ).rows[0];
        if (!r) throw new PracticeError(404, "Summary not found.");
        if (r.status !== "draft" || r.version !== b.version)
          throw new PracticeError(
            409,
            "Summary changed or is approved. Reload.",
          );
        if (
          (await sourcesStale(client, actor, id, r.sources)) ||
          !(await medicationSnapshotFresh(client, actor, id, r.trust_sources))
        )
          throw new PracticeError(409, "Sources changed. Generate again.");
        return r;
      });
      let trust: TrustAudit | undefined, note: Note | undefined;
      if (path[4] !== "findings") {
        note =
          path[4] === "audit"
            ? noteSchema.parse(snapshot.note)
            : z.object({ note: noteSchema }).parse(b).note;
        if (path[4] === "audit")
          z.object({ consent: z.literal(true) }).parse(b);
        trust = await runTrustAudit(
          { note, sources: snapshot.trust_sources, includeGaps: true },
          path[4] === "audit",
          req.signal,
        );
      } else reviewer(actor);
      req.signal.throwIfAborted();
      return json(
        await tx(actor, async (client) => {
          await patient(client, actor, id, true);
          const r = (
            await client.query(
              "SELECT * FROM practice_summaries WHERE organization_id=$1 AND patient_id=$2 AND id=$3 FOR UPDATE",
              [actor.organizationId, id, resourceId],
            )
          ).rows[0];
          if (!r || r.status !== "draft" || r.version !== b.version)
            throw new PracticeError(409, "Summary changed. Reload.");
          if (
            (await sourcesStale(client, actor, id, r.sources)) ||
            !(await medicationSnapshotFresh(client, actor, id, r.trust_sources))
          )
            throw new PracticeError(409, "Sources changed. Generate again.");
          let result;
          if (trust && note) {
            const { findings, ...metadata } = trust;
            result = await client.query(
              "UPDATE practice_summaries SET note=$1,trust_findings=$2,trust_audit=$3,version=version+1 WHERE organization_id=$4 AND id=$5 RETURNING *",
              [
                JSON.stringify(note),
                JSON.stringify(findings),
                JSON.stringify(metadata),
                actor.organizationId,
                resourceId,
              ],
            );
          } else {
            const f = z
              .object({
                id: z.string(),
                resolution: z.enum(["Addressed", "Not applicable"]),
                note: z.string().trim().min(3).max(1000),
              })
              .parse(b);
            if (
              !(r.trust_findings as TrustFinding[]).some((x) => x.id === f.id)
            )
              throw new PracticeError(404, "Finding not found.");
            const findings = (r.trust_findings as TrustFinding[]).map((x) =>
              x.id === f.id
                ? { ...x, resolution: f.resolution, note: f.note }
                : x,
            );
            result = await client.query(
              "UPDATE practice_summaries SET trust_findings=$1,version=version+1 WHERE organization_id=$2 AND id=$3 RETURNING *",
              [JSON.stringify(findings), actor.organizationId, resourceId],
            );
          }
          req.signal.throwIfAborted();
          await auditPractice(
            client,
            actor,
            `summary.${path[4] || "edited"}`,
            id,
          );
          return result.rows[0];
        }),
      );
    }
    if (
      ["notes", "summaries"].includes(resource) &&
      path.length === 5 &&
      path[4] === "approve" &&
      method === "POST"
    ) {
      reviewer(actor);
      const b = approvalInput.parse(await body(req));
      return json(
        await tx(actor, async (client) => {
          await patient(client, actor, id, true);
          const table =
            resource === "notes" ? "practice_notes" : "practice_summaries";
          const { rows } = await client.query(
            `SELECT * FROM ${table} WHERE organization_id=$1 AND patient_id=$2 AND id=$3 FOR UPDATE`,
            [actor.organizationId, id, uuid.parse(resourceId)],
          );
          const record = rows[0];
          if (!record) throw new PracticeError(404, "Record not found.");
          if (record.status !== "draft" || record.version !== b.version)
            throw new PracticeError(
              409,
              "Record already approved or changed. Refresh before approving.",
            );
          if (resource === "summaries") {
            if (await sourcesStale(client, actor, id, record.sources))
              throw new PracticeError(
                409,
                "Sources changed. Generate a new summary.",
              );
            if (
              !(await medicationSnapshotFresh(
                client,
                actor,
                id,
                record.trust_sources,
              ))
            )
              throw new PracticeError(
                409,
                "Medication context changed. Generate again.",
              );
            try {
              assertTrustApproval(
                { ...record.trust_audit, findings: record.trust_findings },
                {
                  note: record.note,
                  sources: record.trust_sources,
                  includeGaps: true,
                },
              );
            } catch (error) {
              throw new PracticeError(
                409,
                error instanceof Error
                  ? error.message
                  : "Audit is stale. Run checks again.",
              );
            }
          }
          const updated = await client.query(
            `UPDATE ${table} SET status='approved',approved_by=$1,approved_at=now(),version=version+1 WHERE organization_id=$2 AND id=$3 RETURNING *`,
            [actor.practitionerId, actor.organizationId, resourceId],
          );
          await auditPractice(client, actor, `${resource}.approved`, id);
          return updated.rows[0];
        }),
      );
    }
    throw new PracticeError(405, "This operation is not supported.");
  } catch (error) {
    const status =
      error instanceof PracticeError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : (error as { code?: string })?.code === "23505"
            ? 409
            : 500;
    try {
      await query(
        "INSERT INTO practice_audit(id,organization_id,practitioner_id,action,resource_id,outcome) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          actor.organizationId,
          actor.practitionerId,
          "request.denied",
          uuid.safeParse(path[1]).success ? path[1] : null,
          `${status}`,
        ],
      );
    } catch {}
    return json(
      {
        error:
          error instanceof PracticeError
            ? error.message
            : status === 400
              ? "Invalid request fields."
              : status === 409
                ? "A record with this identifier already exists."
                : "The operation failed. Contact the practice administrator.",
      },
      status,
    );
  }
}
type Source = {
  type: "note" | "document";
  id: string;
  version: number;
  segmentId: string;
  text: string;
};
async function loadSources(
  client: PoolClient,
  actor: PracticeActor,
  patientId: string,
  noteIds: string[],
  documentIds: string[],
) {
  const sources: Source[] = [];
  for (const id of [...new Set(noteIds)]) {
    const { rows } = await client.query(
      "SELECT content,version FROM practice_notes WHERE organization_id=$1 AND patient_id=$2 AND id=$3 AND status='approved'",
      [actor.organizationId, patientId, id],
    );
    if (!rows[0])
      throw new PracticeError(
        400,
        "Select approved notes belonging to this patient.",
      );
    sources.push({
      type: "note",
      id,
      version: rows[0].version,
      segmentId: `source${sources.length + 1}`,
      text: rows[0].content,
    });
  }
  for (const id of [...new Set(documentIds)]) {
    const { rows } = await client.query(
      "SELECT extracted_text,version FROM practice_documents WHERE organization_id=$1 AND patient_id=$2 AND id=$3 AND status='available'",
      [actor.organizationId, patientId, id],
    );
    if (!rows[0]?.extracted_text)
      throw new PracticeError(
        400,
        "AI summaries currently accept text documents and approved notes. PDF extraction is not enabled.",
      );
    sources.push({
      type: "document",
      id,
      version: rows[0].version,
      segmentId: `source${sources.length + 1}`,
      text: rows[0].extracted_text,
    });
  }
  if (
    sources.some((s) => s.text.length > 12000) ||
    sources.reduce((n, s) => n + s.text.length, 0) > 24000
  )
    throw new PracticeError(
      400,
      "Select sources up to 12,000 characters each and 24,000 characters combined.",
    );
  return sources;
}
async function sourcesStale(
  client: PoolClient,
  actor: PracticeActor,
  patientId: string,
  sources: Pick<Source, "type" | "id" | "version">[],
) {
  for (const source of sources) {
    const table =
      source.type === "note" ? "practice_notes" : "practice_documents";
    const { rows } = await client.query(
      `SELECT version,status FROM ${table} WHERE organization_id=$1 AND patient_id=$2 AND id=$3 FOR SHARE`,
      [actor.organizationId, patientId, source.id],
    );
    if (
      !rows[0] ||
      rows[0].version !== source.version ||
      rows[0].status !== (source.type === "note" ? "approved" : "available")
    )
      return true;
    if (
      source.type === "note" &&
      (
        await client.query(
          "SELECT 1 FROM practice_notes WHERE organization_id=$1 AND patient_id=$2 AND amends_id=$3 AND status='approved'",
          [actor.organizationId, patientId, source.id],
        )
      ).rowCount
    )
      return true;
  }
  return false;
}
