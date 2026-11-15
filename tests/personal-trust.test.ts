import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextRequest } from "next/server";
process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), "noticioner-audit-")),
  "test.sqlite",
);
const db = await import("../src/lib/db");
const { POST } = await import("../src/app/api/[...path]/route");
const { baseline, parseTranscript } = await import("../src/lib/clinical");
test("personal generation rejects stale note/context and cancellation, retains secondary failures only", async () => {
  const user = db.createSession(),
    patientId = db.uid();
  db.database()
    .prepare("INSERT INTO patients VALUES(?,?,?,?,?,?,?)")
    .run(
      patientId,
      user.id,
      "Fictional patient",
      "2000-01-01",
      "",
      "Unknown",
      "None",
    );
  const note = baseline(parseTranscript("Patient: Cough."));
  const original = globalThis.fetch,
    key = process.env.OPENAI_API_KEY,
    provider = process.env.AI_PROVIDER;
  process.env.OPENAI_API_KEY = "synthetic";
  process.env.AI_PROVIDER = "openai";
  const response = (value: unknown) =>
    Response.json({
      choices: [
        { finish_reason: "stop", message: { content: JSON.stringify(value) } },
      ],
    });
  const call = (
    id: string,
    action: string,
    payload: unknown,
    signal?: AbortSignal,
  ) =>
    POST(
      new NextRequest(`http://localhost/api/consultations/${id}/${action}`, {
        method: "POST",
        headers: {
          cookie: `cs_session=${user.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      }),
      { params: Promise.resolve({ path: ["consultations", id, action] }) },
    );
  try {
    for (const scenario of [
      "primary-failure",
      "secondary-failure",
      "context-change",
      "note-change",
      "cancelled",
    ]) {
      const c = db.createConsultation(
        user.id,
        patientId,
        "General consultation",
      );
      db.database()
        .prepare("UPDATE consultations SET transcript=? WHERE id=?")
        .run("Patient: Cough.", c.id);
      let calls = 0;
      const controller = new AbortController();
      globalThis.fetch = async () => {
        calls++;
        if (
          scenario === "primary-failure" ||
          (scenario === "secondary-failure" && calls === 2)
        )
          throw new Error("Synthetic provider outage");
        if (scenario === "cancelled") controller.abort();
        if (scenario === "note-change")
          db.database()
            .prepare("UPDATE consultations SET version=version+1 WHERE id=?")
            .run(c.id);
        if (scenario === "context-change" && calls === 2)
          db.database()
            .prepare("UPDATE patients SET allergies=? WHERE id=?")
            .run("Penicillin", patientId);
        return response(
          calls === 1
            ? note
            : {
                claims: note.statements.map((s) => ({
                  statementId: s.id,
                  status: "supported",
                  reason: "Exact source.",
                })),
                concerns: [],
              },
        );
      };
      const result = await call(
        c.id,
        "generate",
        { mode: "ai" },
        controller.signal,
      );
      if (scenario === "secondary-failure") {
        assert.equal(result.status, 200);
        const saved = db.consultation(user.id, c.id)!;
        assert.ok(saved.note);
        assert.ok(saved.flags.some((f) => f.trust?.status === "not checked"));
      } else {
        assert.notEqual(result.status, 200);
        assert.equal(db.consultation(user.id, c.id)!.note, null);
        if (scenario.endsWith("change")) assert.equal(result.status, 409);
      }
    }
    // Context changes after local generation invalidate approval even with dispositions.
    const c = db.createConsultation(user.id, patientId, "General consultation");
    db.database()
      .prepare("UPDATE consultations SET transcript=? WHERE id=?")
      .run("Patient: Cough.", c.id);
    const generated = await (
      await call(c.id, "generate", { mode: "baseline" })
    ).json();
    db.database()
      .prepare("UPDATE consultations SET flags=? WHERE id=?")
      .run(
        JSON.stringify(
          generated.flags.map((f: Record<string, unknown>) => ({
            ...f,
            resolution: "Addressed",
            note: "Checked fictional record",
          })),
        ),
        c.id,
      );
    db.database()
      .prepare("UPDATE patients SET allergies=? WHERE id=?")
      .run("Aspirin", patientId);
    const denied = await call(c.id, "approve", {
      version: generated.version,
      confirmed: true,
      reviewed: true,
    });
    assert.equal(denied.status, 409);
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = provider;
  }
});
