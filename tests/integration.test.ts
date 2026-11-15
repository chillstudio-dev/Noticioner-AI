import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), "noticioner-")),
  "test.sqlite",
);
const db = await import("../src/lib/db");
const clinical = await import("../src/lib/clinical");
const { generateNote } = await import("../src/lib/provider");
test("session isolation, persistence, version history and cascading deletion", () => {
  const a = db.createSession(),
    b = db.createSession();
  db.database()
    .prepare("INSERT INTO patients VALUES(?,?,?,?,?,?,?)")
    .run(
      db.uid(),
      a.id,
      "Test Patient",
      "1988-05-14",
      "Synthetic",
      "Unknown",
      "None",
    );
  const p = db.patients(a.id)[0];
  const c = db.createConsultation(a.id, p.id, "General consultation");
  assert.equal(db.consultation(b.id, c.id), undefined);
  assert.throws(() =>
    db.createConsultation(b.id, p.id, "General consultation"),
  );
  db.database()
    .prepare("UPDATE consultations SET transcript=? WHERE id=?")
    .run("Patient: I have a cough.", c.id);
  const loaded = db.consultation(a.id, c.id)!;
  assert.equal(loaded.transcript, "Patient: I have a cough.");
  const segments = clinical.parseTranscript(loaded.transcript);
  db.transaction(() =>
    db.saveVersion(
      a.id,
      loaded,
      clinical.baseline(segments),
      [],
      "Draft generated",
    ),
  );
  assert.equal(db.consultation(a.id, c.id)?.version, 1);
  assert.equal(
    db
      .database()
      .prepare(
        "SELECT COUNT(*) as n FROM note_versions WHERE consultation_id=?",
      )
      .get(c.id)?.n,
    1,
  );
  assert.ok(
    db
      .database()
      .prepare("SELECT COUNT(*) as n FROM audit_events WHERE consultation_id=?")
      .get(c.id)?.n,
  );
  db.database().prepare("DELETE FROM consultations WHERE id=?").run(c.id);
  assert.equal(
    db
      .database()
      .prepare(
        "SELECT COUNT(*) as n FROM note_versions WHERE consultation_id=?",
      )
      .get(c.id)?.n,
    0,
  );
});
test("transaction rolls back failures", () => {
  const before = db
    .database()
    .prepare("SELECT COUNT(*) as n FROM users")
    .get()?.n;
  assert.throws(() =>
    db.transaction(() => {
      db.database()
        .prepare("INSERT INTO users VALUES(?,?,?)")
        .run("rollback", "Rollback", db.now());
      throw new Error("fail");
    }),
  );
  assert.equal(
    db.database().prepare("SELECT COUNT(*) as n FROM users").get()?.n,
    before,
  );
});
test("real provider parser rejects malformed JSON and preserves exact evidence", async () => {
  const original = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"statements":[]}' } }],
        }),
      );
    await assert.rejects(
      () => generateNote(clinical.parseTranscript("Patient: Cough.")),
      /schema/,
    );
    const note = clinical.baseline(clinical.parseTranscript("Patient: Cough."));
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(note) } }],
        }),
      );
    assert.equal(
      (await generateNote(clinical.parseTranscript("Patient: Cough.")))
        .statements[0].certainty,
      "Supported",
    );
  } finally {
    globalThis.fetch = original;
    if (key) process.env.OPENAI_API_KEY = key;
    else delete process.env.OPENAI_API_KEY;
  }
});

test("expired sessions and revoked tokens cannot access a workspace", () => {
  const s = db.createSession();
  assert.equal(db.sessionUser(s.token), s.id);
  db.database()
    .prepare("UPDATE sessions SET expires_at=0 WHERE user_id=?")
    .run(s.id);
  assert.equal(db.sessionUser(s.token), undefined);
  const next = db.createSession();
  db.logout(next.token);
  assert.equal(db.sessionUser(next.token), undefined);
});
test("rate limits reject excess calls", () => {
  const key = "test-" + Date.now();
  assert.equal(db.rateLimit(key, 2), true);
  assert.equal(db.rateLimit(key, 2), true);
  assert.equal(db.rateLimit(key, 2), false);
});
test("transcription adapter handles successful, empty and failed provider responses", async () => {
  const { transcribe } = await import("../src/lib/provider");
  const original = globalThis.fetch,
    key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const audio = new File(["synthetic fixture"], "fixture.webm", {
    type: "audio/webm",
  });
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ text: "Synthetic words." }));
    assert.equal(await transcribe(audio), "Synthetic words.");
    globalThis.fetch = async () => new Response(JSON.stringify({ text: "" }));
    await assert.rejects(() => transcribe(audio), /empty transcript/);
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    await assert.rejects(() => transcribe(audio), /503/);
  } finally {
    globalThis.fetch = original;
    if (key) process.env.OPENAI_API_KEY = key;
    else delete process.env.OPENAI_API_KEY;
  }
});
