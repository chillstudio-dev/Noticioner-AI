import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const base = process.env.EVALUATION_BASE_URL ?? "http://127.0.0.1:3110";
const inputs = JSON.parse(await readFile("evaluation/transcript-inputs-12.json", "utf8"));
const origin = new URL(base).origin;
async function call(path, method = "GET", body, cookie) {
  const response = await fetch(`${base}/api/${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" ? { Origin: origin } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, `${method} /api/${path} returned ${response.status}: ${JSON.stringify(data)}`);
  return { status: response.status, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

const createdSession = await call("session", "POST", {});
assert.ok(createdSession.cookie, "session cookie was not issued");
const cookie = createdSession.cookie;
const patient = await call("patients", "POST", {
  name: "Synthetic evaluation subject",
  dob: "2000-01-01",
  history: "Fictional evaluation workspace only",
  allergies: "Not recorded",
  medications: "Not recorded",
}, cookie);
const examples = [];
for (const sample of inputs.cases) {
  const consultation = await call("consultations", "POST", {
    patientId: patient.data.id,
    type: "Follow-up",
  }, cookie);
  const transcript = sample.segments.map((s) => s.speaker === "Unknown" ? s.text : `${s.speaker}: ${s.text}`).join("\n");
  const saved = await call(`consultations/${consultation.data.id}`, "PATCH", {
    transcript,
    version: consultation.data.version,
  }, cookie);
  assert.equal(saved.data.transcript, transcript, `${sample.id}: transcript was not persisted verbatim`);
  const generated = await call(`consultations/${consultation.data.id}/generate`, "POST", { mode: "baseline" }, cookie);
  assert.ok(generated.data.note?.statements?.length, `${sample.id}: no draft statements returned`);
  assert.equal(generated.data.status, "Needs Review", `${sample.id}: generated draft should remain pending review`);
  examples.push({
    id: sample.id,
    transcript,
    segmentMap: sample.segments.map((s, index) => ({ sourceId: s.id, generatedId: `s${index + 1}` })),
    note: generated.data.note,
    flags: generated.data.flags,
    status: generated.data.status,
    version: generated.data.version,
  });
}
const result = {
  suite: inputs.suite,
  suiteVersion: inputs.suite_version,
  mode: "local-keyword-baseline-through-personal-workspace-api",
  createdAt: new Date().toISOString(),
  sampleSize: examples.length,
  examples,
};
await mkdir("evaluation-results", { recursive: true });
await writeFile("evaluation-results/noticioner-12-final-http.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({
  output: "evaluation-results/noticioner-12-final-http.json",
  sampleSize: examples.length,
  reviewRequired: examples.filter((e) => e.status === "Needs Review").length,
  sourceLinkedStatements: examples.reduce((n, e) => n + e.note.statements.filter((s) => s.evidence.length).length, 0),
}, null, 2));
