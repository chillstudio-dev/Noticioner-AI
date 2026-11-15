import { runTrustAudit } from "@/lib/trust-provider";
import { evaluateTrust } from "@/lib/trust-evaluation";
import {
  combinedFlags,
  personalSources,
  patientContextHash,
} from "@/lib/personal-trust";
import {
  personalPatientSummaries,
  PatientSummaryError,
} from "@/lib/personal-patient-summaries";
import { isSameRequestOrigin } from "@/lib/request-origin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  database,
  createSession,
  sessionUser,
  logout,
  patients,
  patient,
  consultations,
  consultation,
  createConsultation,
  audit,
  transaction,
  saveVersion,
  now,
  rateLimit,
} from "@/lib/db";
import {
  parseTranscript,
  baseline,
  noteSchema,
  validateEvidence,
  assertApproval,
} from "@/lib/clinical";
import { generateNote, providerStatus, transcribe } from "@/lib/provider";
import { languageSchema } from "@/lib/languages";
import { translateTranscript, translationInput } from "@/lib/translation";
import { evaluate } from "@/lib/evaluation";
export const runtime = "nodejs";
const patientBody = z.object({
  name: z.string().trim().min(2).max(100),
  dob: z.iso
    .date()
    .refine(
      (v) => v <= new Date().toISOString().slice(0, 10),
      "Date of birth cannot be in the future",
    ),
  history: z.string().max(3000),
  allergies: z.string().max(1000),
  medications: z.string().max(1000),
});
const response = (v: unknown, status = 200) =>
  NextResponse.json(v, { status, headers: { "Cache-Control": "no-store" } });
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// Call inside the same transaction as the write: request-body parsing and
// provider calls may have yielded since the route's initial ownership lookup.
function editableRecord(user: string, id: string, version: number) {
  const current = consultation(user, id);
  if (!current) throw new HttpError(404, "Consultation not found.");
  if (current.status === "Approved")
    throw new HttpError(
      409,
      "Approved records are read-only. Start a new consultation.",
    );
  if (current.version !== version)
    throw new HttpError(
      409,
      "This record changed. Reopen the latest version before saving or approving.",
    );
  return current;
}

async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  if (process.env.PRACTICE_ONLY === "true")
    return response({ error: "The standalone workspace is disabled." }, 404);
  try {
    const { path } = await context.params;
    const route = path.join("/"),
      method = req.method;
    const token = req.cookies.get("cs_session")?.value || "";
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (
        !isSameRequestOrigin(
          origin,
          req.headers.get("host"),
          req.nextUrl.protocol,
        )
      )
        throw new HttpError(403, "Cross-origin requests are not allowed.");
      if (req.headers.get("sec-fetch-site") === "cross-site")
        throw new HttpError(403, "Cross-site requests are not allowed.");
    }
    if (route === "session" && method === "POST") {
      if (!rateLimit("login", 100, 60000))
        throw new HttpError(
          429,
          "Too many workspace requests. Try again shortly.",
        );
      if (sessionUser(token)) return response({ ok: true });
      const session = createSession();
      const r = response({ ok: true });
      r.cookies.set("cs_session", session.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: req.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 7 * 86400,
      });
      return r;
    }
    const user = sessionUser(token);
    if (!user)
      throw new HttpError(401, "Refresh the page to open a workspace.");
    if (method !== "GET" && !rateLimit(user, 60))
      throw new HttpError(429, "Too many requests. Please wait one minute.");
    if (route === "session" && method === "DELETE") {
      logout(token);
      const r = response({ ok: true });
      r.cookies.delete("cs_session");
      return r;
    }
    if (route === "bootstrap" && method === "GET")
      return response({
        patients: patients(user),
        consultations: consultations(user),
        provider: providerStatus(),
        activity: database()
          .prepare(
            "SELECT * FROM audit_events WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
          )
          .all(user),
        evaluations: database()
          .prepare(
            "SELECT results FROM evaluation_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
          )
          .all(user)
          .map((r) => JSON.parse(String(r.results))),
      });
    if (route === "workspace" && method === "DELETE") {
      transaction(() =>
        database().prepare("DELETE FROM users WHERE id=?").run(user),
      );
      const r = response({ ok: true });
      r.cookies.delete("cs_session");
      return r;
    }
    if (path[0] === "patients") {
      if (method === "GET") return response(patients(user));
      const b = patientBody.parse(await req.json());
      const id = path[1] || randomUUID();
      if (method === "PATCH") {
        if (!patient(user, id)) throw new HttpError(404, "Patient not found.");
        database()
          .prepare(
            "UPDATE patients SET name=?,dob=?,history=?,allergies=?,medications=? WHERE id=? AND user_id=?",
          )
          .run(b.name, b.dob, b.history, b.allergies, b.medications, id, user);
      } else if (method === "POST" && !path[1])
        database()
          .prepare("INSERT INTO patients VALUES(?,?,?,?,?,?,?)")
          .run(id, user, b.name, b.dob, b.history, b.allergies, b.medications);
      else throw new HttpError(405, "Method not allowed");
      return response(patient(user, id));
    }
    if (route === "consultations" && method === "GET")
      return response(consultations(user));
    if (route === "consultations" && method === "POST") {
      const b = z
        .object({
          patientId: z.string(),
          type: z.enum([
            "General consultation",
            "Follow-up",
            "Medication review",
          ]),
        })
        .parse(await req.json());
      if (!patient(user, b.patientId))
        throw new HttpError(404, "Patient not found.");
      return response(createConsultation(user, b.patientId, b.type), 201);
    }
    if (route === "evaluation/run" && method === "POST") {
      const b = z
        .object({
          mode: z.enum(["baseline", "deterministic", "ai"]),
          suite: z.enum(["extraction", "trust"]).optional(),
          consent: z.boolean().optional(),
        })
        .parse(await req.json());
      if (!rateLimit(`eval:${user}`, 3, 60000))
        throw new HttpError(
          429,
          "Please wait before running another evaluation.",
        );
      if (b.suite === "trust" && b.mode === "ai" && !b.consent)
        throw new HttpError(
          400,
          "Consent is required for provider-backed synthetic evaluation.",
        );
      const result =
        b.suite === "trust"
          ? await evaluateTrust(
              b.mode === "ai" ? "ai" : "deterministic",
              req.signal,
            )
          : await evaluate(b.mode === "ai" ? "ai" : "baseline");
      database()
        .prepare("INSERT INTO evaluation_runs VALUES(?,?,?,?)")
        .run(randomUUID(), user, now(), JSON.stringify(result));
      return response(result);
    }
    if (route === "transcribe" && method === "POST") {
      const form = await req.formData();
      const id = z.string().parse(form.get("consultationId"));
      const c = consultation(user, id);
      if (!c) throw new HttpError(404, "Consultation not found.");
      if (c.status === "Approved")
        throw new HttpError(409, "Approved records are read-only.");
      if (form.get("consent") !== "true")
        throw new HttpError(400, "Synthetic recording consent is required.");
      const file = form.get("audio");
      if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024)
        throw new HttpError(400, "Audio must be between 1 byte and 20 MB.");
      if (
        ![
          "audio/webm",
          "video/webm",
          "audio/mp4",
          "audio/mpeg",
          "audio/wav",
          "audio/ogg",
        ].includes(file.type.split(";")[0])
      )
        throw new HttpError(400, "Unsupported audio type.");
      const language = languageSchema.parse(form.get("language") ?? "en");
      const text = await transcribe(file, req.signal, language);
      audit(user, id, "Transcript generated");
      return response({ text });
    }
    if (path[0] === "consultations" && path[1]) {
      const c = consultation(user, path[1]);
      if (!c) throw new HttpError(404, "Consultation not found.");
      const action = path[2];
      if (action === "patient-summaries") {
        const result = await personalPatientSummaries(
          user,
          c.id,
          method,
          path[3],
          path[4],
          method === "GET" ? undefined : await req.json(),
          req.signal,
        );
        return response(result);
      }
      if (method === "POST" && action === "translate" && path.length === 3) {
        const input = translationInput.parse(await req.json());
        audit(user, c.id, "Translation sources disclosed");
        const draft = await translateTranscript(input, req.signal);
        const latest = consultation(user, c.id);
        if (!latest || latest.version !== c.version)
          throw new HttpError(
            409,
            "The consultation changed during translation. Reopen and retry.",
          );
        audit(user, c.id, "Translation draft generated");
        return response(draft);
      }
      if (method === "GET" && action === "audit")
        return response(
          database()
            .prepare(
              "SELECT * FROM audit_events WHERE consultation_id=? AND user_id=? ORDER BY created_at DESC",
            )
            .all(c.id, user),
        );
      if (method === "GET" && action === "versions")
        return response(
          database()
            .prepare(
              "SELECT * FROM note_versions WHERE consultation_id=? ORDER BY version DESC",
            )
            .all(c.id),
        );
      if (method === "GET" && action === "pdf") {
        const { exportPDF } = await import("@/lib/pdf");
        const bytes = await exportPDF(c, patient(user, c.patient_id)!);
        audit(user, c.id, "Document exported", { version: c.version });
        return new NextResponse(Buffer.from(bytes), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="Noticioner-${c.id.slice(0, 8)}.pdf"`,
            "Cache-Control": "no-store",
          },
        });
      }
      if (method === "GET" && !action) return response(c);
      if (method === "DELETE" && !action) {
        transaction(() => {
          database()
            .prepare("DELETE FROM consultations WHERE id=? AND user_id=?")
            .run(c.id, user);
          audit(user, null, "Consultation deleted");
        });
        return response({ ok: true });
      }
      if (c.status === "Approved")
        throw new HttpError(
          409,
          "Approved records are read-only. Start a new consultation.",
        );
      if (method === "POST" && action === "event") {
        const b = z
          .object({
            action: z.enum([
              "Recording started",
              "Recording paused",
              "Recording resumed",
              "Recording stopped",
            ]),
          })
          .parse(await req.json());
        audit(user, c.id, b.action);
        return response({ ok: true });
      }
      if (method === "PATCH" && !action) {
        const b = z
          .object({
            transcript: z.string().max(50000),
            version: z.number().int(),
          })
          .parse(await req.json());
        transaction(() => {
          const current = editableRecord(user, c.id, b.version);
          database()
            .prepare(
              "UPDATE consultations SET transcript=?,note=NULL,flags='[]',trust_context_hash=NULL,status='Draft',version=version+1,updated_at=? WHERE id=?",
            )
            .run(b.transcript, now(), c.id);
          audit(user, c.id, "Transcript edited", {
            draftInvalidated: !!current.note,
          });
        });
        return response(consultation(user, c.id));
      }
      if (method === "POST" && action === "generate") {
        const b = z
          .object({ mode: z.enum(["baseline", "ai"]) })
          .parse(await req.json());
        const segments = parseTranscript(c.transcript);
        if (!segments.length)
          throw new HttpError(400, "Enter and save a transcript first.");
        const contextPatient = patient(user, c.patient_id)!;
        const contextHash = patientContextHash(contextPatient);
        const start = Date.now(),
          note =
            b.mode === "ai"
              ? await generateNote(segments, req.signal)
              : baseline(segments);
        const trust = await runTrustAudit(
          {
            note,
            sources: personalSources(segments, contextPatient, c.version),
            includeGaps: true,
          },
          b.mode === "ai",
          req.signal,
        );
        req.signal.throwIfAborted();
        transaction(() => {
          const current = consultation(user, c.id);
          if (
            !current ||
            current.version !== c.version ||
            current.status === "Approved" ||
            patientContextHash(patient(user, c.patient_id)!) !== contextHash
          )
            throw new HttpError(
              409,
              "The record changed during generation. Reopen and retry.",
            );
          saveVersion(
            user,
            c,
            note,
            combinedFlags(note, segments, trust),
            "Draft generated",
            b.mode === "ai"
              ? `AI / ${providerStatus().label} / ${providerStatus().model}`
              : "Offline / keyword baseline",
            Date.now() - start,
          );
          database()
            .prepare("UPDATE consultations SET trust_context_hash=? WHERE id=?")
            .run(contextHash, c.id);
        });
        return response(consultation(user, c.id));
      }
      if (method === "PATCH" && action === "note") {
        const b = z
          .object({ note: noteSchema, version: z.number().int() })
          .parse(await req.json());
        const current = editableRecord(user, c.id, b.version);
        if (!current.note)
          throw new HttpError(409, "Generate a draft before editing.");
        const contextPatient = patient(user, c.patient_id)!;
        const contextHash = patientContextHash(contextPatient);
        const segments = parseTranscript(current.transcript);
        const note = validateEvidence(b.note, segments);
        for (const statement of note.statements)
          if (
            current.note.statements.find((old) => old.id === statement.id)
              ?.text !== statement.text
          )
            statement.certainty = "Uncertain";
        const trust = await runTrustAudit(
          {
            note,
            sources: personalSources(segments, contextPatient, current.version),
            includeGaps: true,
          },
          false,
          req.signal,
        );
        req.signal.throwIfAborted();
        transaction(() => {
          const latest = editableRecord(user, c.id, b.version);
          if (patientContextHash(patient(user, c.patient_id)!) !== contextHash)
            throw new HttpError(
              409,
              "Patient context changed. Retry the audit.",
            );
          saveVersion(
            user,
            latest,
            note,
            combinedFlags(note, segments, trust),
            "Note edited",
          );
          database()
            .prepare("UPDATE consultations SET trust_context_hash=? WHERE id=?")
            .run(contextHash, c.id);
        });
        return response(consultation(user, c.id));
      }
      if (method === "POST" && action === "audit") {
        const b = z
          .object({ version: z.number().int(), consent: z.literal(true) })
          .parse(await req.json());
        const current = editableRecord(user, c.id, b.version);
        if (!current.note) throw new HttpError(409, "Generate a draft first.");
        const p = patient(user, current.patient_id)!;
        const hash = patientContextHash(p);
        const segments = parseTranscript(current.transcript);
        const trust = await runTrustAudit(
          {
            note: current.note,
            sources: personalSources(segments, p, current.version),
            includeGaps: true,
          },
          true,
          req.signal,
        );
        req.signal.throwIfAborted();
        transaction(() => {
          const latest = editableRecord(user, c.id, b.version);
          if (patientContextHash(patient(user, current.patient_id)!) !== hash)
            throw new HttpError(409, "Patient context changed. Retry.");
          saveVersion(
            user,
            latest,
            current.note!,
            combinedFlags(current.note!, segments, trust),
            "Trust audit retried",
          );
          database()
            .prepare("UPDATE consultations SET trust_context_hash=? WHERE id=?")
            .run(hash, c.id);
        });
        return response(consultation(user, c.id));
      }
      if (method === "PATCH" && action === "flags") {
        const b = z
          .object({
            id: z.string(),
            resolution: z.enum(["Addressed", "Not applicable"]),
            note: z.string().trim().min(3).max(1000),
            version: z.number().int(),
          })
          .parse(await req.json());
        transaction(() => {
          const current = editableRecord(user, c.id, b.version);
          if (!current.flags.some((f) => f.id === b.id))
            throw new HttpError(404, "Flag not found.");
          const flags = current.flags.map((f) =>
            f.id === b.id
              ? {
                  ...f,
                  resolution: b.resolution,
                  note: b.note,
                  ...(f.trust
                    ? {
                        trust: {
                          ...f.trust,
                          resolution: b.resolution,
                          note: b.note,
                        },
                      }
                    : {}),
                }
              : f,
          );
          database()
            .prepare(
              "UPDATE consultations SET flags=?,status=?,updated_at=?,version=version+1 WHERE id=?",
            )
            .run(
              JSON.stringify(flags),
              flags.some(
                (f) => f.trust?.required !== false && f.resolution === "Open",
              )
                ? "Needs Review"
                : "Reviewed",
              now(),
              c.id,
            );
          audit(user, c.id, "Warning reviewed", {
            flagId: b.id,
            resolution: b.resolution,
          });
        });
        return response(consultation(user, c.id));
      }
      if (method === "POST" && action === "approve") {
        const b = z
          .object({
            confirmed: z.boolean(),
            reviewed: z.boolean(),
            version: z.number().int(),
          })
          .parse(await req.json());
        transaction(() => {
          const current = editableRecord(user, c.id, b.version);
          const contextHash = database()
            .prepare("SELECT trust_context_hash FROM consultations WHERE id=?")
            .get(c.id)?.trust_context_hash;
          if (
            contextHash &&
            contextHash !== patientContextHash(patient(user, c.patient_id)!)
          )
            throw new HttpError(
              409,
              "Patient context changed. Edit and save the draft to rerun checks before approval.",
            );
          assertApproval(current.note, current.flags, b.confirmed, b.reviewed);
          database()
            .prepare(
              "UPDATE consultations SET status='Approved',approved_at=?,approved_by=?,updated_at=? WHERE id=?",
            )
            .run(now(), "Dr. Morgan (simulated)", now(), c.id);
          audit(user, c.id, "Document approved", {
            version: current.version,
            simulated: true,
          });
        });
        return response(consultation(user, c.id));
      }
    }
    throw new HttpError(404, "Endpoint not found.");
  } catch (e) {
    if (e instanceof SyntaxError)
      return response({ error: "Request body must be valid JSON." }, 400);
    if (e instanceof z.ZodError)
      return response(
        {
          error: "Invalid input.",
          details: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        400,
      );
    if (e instanceof PatientSummaryError)
      return response({ error: e.message }, e.status);
    if (e instanceof HttpError) return response({ error: e.message }, e.status);
    if (
      e instanceof Error &&
      /AI |provider|transcription|Transcription|draft|review|Review|confirm|Address|Duplicate/i.test(
        e.message,
      )
    )
      return response({ error: e.message }, 422);
    return response(
      {
        error:
          "The request could not be completed. Please retry. Your saved data is preserved.",
      },
      500,
    );
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
