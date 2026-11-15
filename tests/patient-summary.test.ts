import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), "noticioner-summary-")),
  "db.sqlite",
);
const db = await import("../src/lib/db");
const { personalPatientSummaries } =
  await import("../src/lib/personal-patient-summaries");
const { baseline, parseTranscript } = await import("../src/lib/clinical");
test("patient summary lifecycle preserves approved note, isolates users, invalidates edits and cascades deletion", async () => {
  const user = db.createSession(),
    other = db.createSession();
  const patientId = db.uid();
  db.database()
    .prepare("INSERT INTO patients VALUES(?,?,?,?,?,?,?)")
    .run(patientId, user.id, "Fictional", "2000-01-01", "", "", "");
  const c = db.createConsultation(user.id, patientId, "General consultation");
  const note = baseline(parseTranscript("Patient: Cough."));
  db.saveVersion(user.id, c, note, [], "fixture");
  db.database()
    .prepare(
      "UPDATE consultations SET status='Approved',approved_at=?,approved_by=? WHERE id=?",
    )
    .run(db.now(), "Synthetic reviewer", c.id);
  const before = JSON.stringify(db.consultation(user.id, c.id));
  const sourceVersion = db.consultation(user.id, c.id)!.version;
  const original = globalThis.fetch,
    key = process.env.OPENAI_API_KEY,
    provider = process.env.AI_PROVIDER;
  process.env.AI_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "synthetic";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify(
              calls % 2
                ? {
                    paragraphs: [
                      {
                        id: "p1",
                        text: "You reported a cough.",
                        evidence: [{ segmentId: c.id, quote: "Cough." }],
                      },
                    ],
                  }
                : {
                    claims: [
                      {
                        statementId: "p1",
                        status: "supported",
                        reason: "Supported by the excerpt.",
                      },
                    ],
                    concerns: [],
                  },
            ),
          },
        },
      ],
    });
  };
  const call = (method: string, id?: string, action?: string, body?: unknown) =>
    personalPatientSummaries(
      user.id,
      c.id,
      method,
      id,
      action,
      body,
      new AbortController().signal,
    );
  try {
    await assert.rejects(() =>
      call("POST", undefined, undefined, { sourceVersion, consent: false }),
    );
    // API response objects are dynamic SQLite rows.
    let summary = (await call("POST", undefined, undefined, {
      sourceVersion,
      consent: true,
    })) as Record<string, unknown>;
    const id = String(summary.id);
    assert.equal(JSON.stringify(db.consultation(user.id, c.id)), before);
    await assert.rejects(
      () =>
        personalPatientSummaries(
          other.id,
          c.id,
          "GET",
          id,
          undefined,
          undefined,
          new AbortController().signal,
        ),
      /not found/,
    );
    summary = (await call("PATCH", id, undefined, {
      version: summary.version,
      content: {
        paragraphs: [
          { id: "p1", text: "An unsupported instruction.", evidence: [] },
        ],
      },
    })) as Record<string, unknown>;
    await assert.rejects(
      () =>
        call("POST", id, "approve", {
          version: summary.version,
          confirmed: true,
          reviewed: true,
        }),
      /Review|valid source/,
    );
    const trust = summary.trust as {
      findings: { id: string; required: boolean }[];
    };
    for (const f of trust.findings.filter((f) => f.required))
      summary = (await call("PATCH", id, "findings", {
        version: summary.version,
        id: f.id,
        resolution: "Addressed",
        note: "Removed unsupported instruction in the next edit.",
      })) as Record<string, unknown>;
    // A subsequent edit must reset the disposition, even after all findings were reviewed.
    summary = (await call("PATCH", id, undefined, {
      version: summary.version,
      content: {
        paragraphs: [
          {
            id: "p1",
            text: "You reported a cough.",
            evidence: [{ segmentId: c.id, quote: "Cough." }],
          },
        ],
      },
    })) as Record<string, unknown>;
    await assert.rejects(
      () =>
        call("POST", id, "approve", {
          version: summary.version,
          confirmed: true,
          reviewed: true,
        }),
      /Review|valid source/,
    );
    const findings = (
      summary.trust as { findings: { id: string; required: boolean }[] }
    ).findings;
    for (const f of findings.filter((f) => f.required))
      summary = (await call("PATCH", id, "findings", {
        version: summary.version,
        id: f.id,
        resolution: "Addressed",
        note: "Checked meaning against approved source.",
      })) as Record<string, unknown>;
    const approved = (await call("POST", id, "approve", {
      version: summary.version,
      confirmed: true,
      reviewed: true,
    })) as Record<string, unknown>;
    assert.equal(approved.status, "approved");
    await assert.rejects(
      () =>
        call("PATCH", id, undefined, {
          version: approved.version,
          content: approved.content,
        }),
      /approved/,
    );
    assert.equal(JSON.stringify(db.consultation(user.id, c.id)), before);
    db.database().prepare("DELETE FROM users WHERE id=?").run(user.id);
    assert.equal(
      db
        .database()
        .prepare("SELECT count(*) n FROM patient_summaries WHERE id=?")
        .get(id)?.n,
      0,
    );
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = provider;
  }
});
