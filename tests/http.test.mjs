import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
async function session(seed = true) {
  const r = await fetch(base + "/api/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(base).origin,
    },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 200, await r.text());
  const cookie = r.headers.get("set-cookie").split(";")[0];
  if (seed)
    for (const name of ["Alex Bennett", "Priya Shah", "James Wilson"]) {
      const created = await req(cookie, "patients", "POST", {
        name,
        dob: "1988-05-14",
        history: "Synthetic test profile",
        allergies: "Unknown",
        medications: "None",
      });
      assert.equal(created.status, 200);
    }
  return cookie;
}
async function req(cookie, path, method = "GET", body) {
  const r = await fetch(base + "/api/" + path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  return { status: r.status, data };
}
test("HTTP workflow persists, reviews, versions, approves and exports; security and error guards hold", async () => {
  const unauth = await fetch(base + "/api/consultations");
  assert.equal(unauth.status, 401);
  const cookie = await session(),
    other = await session();
  try {
    const bootstrap = await req(cookie, "bootstrap");
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.data.patients.length, 3);
    const p = bootstrap.data.patients[0];
    const invalid = await req(cookie, "patients", "POST", {
      name: "A",
      dob: "2099-01-01",
      history: "",
      allergies: "",
      medications: "",
    });
    assert.equal(invalid.status, 400);
    const create = await req(cookie, "consultations", "POST", {
      patientId: p.id,
      type: "General consultation",
    });
    assert.equal(create.status, 201);
    let c = create.data;
    assert.equal((await req(other, "consultations/" + c.id)).status, 404);
    assert.equal(
      (
        await req(other, "consultations", "POST", {
          patientId: p.id,
          type: "General consultation",
        })
      ).status,
      404,
    );
    const cross = await fetch(base + "/api/consultations", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ patientId: p.id, type: "General consultation" }),
    });
    assert.equal(cross.status, 403);
    assert.equal(
      (
        await req(cookie, `consultations/${c.id}/generate`, "POST", {
          mode: "baseline",
        })
      ).status,
      400,
    );
    assert.notEqual(
      (
        await req(cookie, `consultations/${c.id}/approve`, "POST", {
          confirmed: true,
          reviewed: true,
          version: c.version,
        })
      ).status,
      200,
    );
    const transcript =
      "Patient: I have a sore throat.\nPatient: It started three days ago.\nPatient: I have no known allergies.\nPatient: I take no regular medications.\nDoctor: On examination, temperature is 37.2 C.\nDoctor: My assessment is not established.\nDoctor: Follow-up: return in a week.";
    const saved = await req(cookie, `consultations/${c.id}`, "PATCH", {
      transcript,
      version: c.version,
    });
    assert.equal(saved.status, 200);
    c = saved.data;
    const generated = await req(
      cookie,
      `consultations/${c.id}/generate`,
      "POST",
      { mode: "baseline" },
    );
    assert.equal(generated.status, 200, JSON.stringify(generated.data));
    c = generated.data;
    assert.ok(c.note.statements.length);
    assert.equal(c.provider, "Offline / keyword baseline");
    assert.ok(
      c.note.statements.every((s) =>
        s.evidence.every((e) => transcript.includes(e.quote)),
      ),
    );
    const original = c.note.statements[0].text;
    c.note.statements[0].text = "Patient reports a sore throat.";
    const edited = await req(cookie, `consultations/${c.id}/note`, "PATCH", {
      note: c.note,
      version: c.version,
    });
    assert.equal(edited.status, 200);
    c = edited.data;
    assert.ok(c.flags.some((f) => f.resolution === "Open"));
    assert.notEqual(
      (
        await req(cookie, `consultations/${c.id}/approve`, "POST", {
          confirmed: true,
          reviewed: true,
          version: c.version,
        })
      ).status,
      200,
    );
    const versions = await req(cookie, `consultations/${c.id}/versions`);
    assert.equal(versions.data.length, 2);
    assert.equal(
      JSON.parse(versions.data[1].note).statements[0].text,
      original,
    );
    for (const flag of c.flags) {
      const review = await req(cookie, `consultations/${c.id}/flags`, "PATCH", {
        id: flag.id,
        resolution: "Addressed",
        note: "Reviewed synthetic source and acknowledged.",
        version: c.version,
      });
      assert.equal(review.status, 200);
      c = review.data;
    }
    const result = await req(cookie, `consultations/${c.id}/approve`, "POST", {
      confirmed: true,
      reviewed: true,
      version: c.version,
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    c = result.data;
    assert.equal(c.status, "Approved");
    assert.ok(c.approved_at);
    assert.equal(
      (
        await req(cookie, `consultations/${c.id}`, "PATCH", {
          transcript: "Changed",
          version: c.version,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req(cookie, `consultations/${c.id}/generate`, "POST", {
          mode: "baseline",
        })
      ).status,
      409,
    );
    const reopened = await req(cookie, `consultations/${c.id}`);
    assert.equal(
      reopened.data.note.statements[0].text,
      "Patient reports a sore throat.",
    );
    const pdf = await fetch(base + `/api/consultations/${c.id}/pdf`, {
      headers: { Cookie: cookie },
    });
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get("content-type"), /pdf/);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/approved-consultation.pdf", bytes);
    const events = await req(cookie, `consultations/${c.id}/audit`);
    assert.ok(events.data.some((e) => e.action === "Document approved"));
    assert.ok(events.data.some((e) => e.action === "Document exported"));
    const evalResult = await req(cookie, "evaluation/run", "POST", {
      mode: "baseline",
    });
    assert.equal(evalResult.status, 200);
    assert.equal(evalResult.data.sampleSize, 8);
    assert.ok(evalResult.data.fn > 0);
    const empty = await req(cookie, "consultations", "POST", {
      patientId: p.id,
      type: "Follow-up",
    });
    const id = empty.data.id;
    let fresh = (
      await req(cookie, `consultations/${id}`, "PATCH", {
        transcript,
        version: 0,
      })
    ).data;
    fresh = (
      await req(cookie, `consultations/${id}/generate`, "POST", {
        mode: "baseline",
      })
    ).data;
    const invalidated = await req(cookie, `consultations/${id}`, "PATCH", {
      transcript: transcript + "\nPatient: Correction.",
      version: fresh.version,
    });
    assert.equal(invalidated.data.note, null);
    assert.equal(invalidated.data.status, "Draft");
    assert.equal(
      (
        await req(cookie, `consultations/${id}`, "PATCH", {
          transcript,
          version: 0,
        })
      ).status,
      409,
    );
    if (!bootstrap.data.provider.configured) {
      const failed = await req(cookie, `consultations/${id}/generate`, "POST", {
        mode: "ai",
      });
      assert.equal(failed.status, 422);
      assert.match(failed.data.error, /not configured/);
    }
    assert.equal(
      (await req(cookie, `consultations/${id}`, "DELETE")).status,
      200,
    );
    assert.equal((await req(cookie, `consultations/${id}`)).status, 404);
  } finally {
    assert.equal((await req(cookie, "workspace", "DELETE")).status, 200);
    assert.equal((await req(other, "workspace", "DELETE")).status, 200);
  }
  assert.equal((await req(cookie, "bootstrap")).status, 401);
});

test("concurrent reviews merge, competing edits reject stale versions, and approval cannot target a stale note", async () => {
  const cookie = await session();
  try {
    const data = (await req(cookie, "bootstrap")).data;
    let c = (
      await req(cookie, "consultations", "POST", {
        patientId: data.patients[0].id,
        type: "General consultation",
      })
    ).data;
    c = (
      await req(cookie, `consultations/${c.id}`, "PATCH", {
        version: 0,
        transcript: "Patient: I have a headache.",
      })
    ).data;
    c = (
      await req(cookie, `consultations/${c.id}/generate`, "POST", {
        mode: "baseline",
      })
    ).data;
    assert.ok(c.flags.length >= 2);
    const flags = c.flags.slice(0, 2);
    const results = await Promise.all(
      flags.map((f) =>
        req(cookie, `consultations/${c.id}/flags`, "PATCH", {
          id: f.id,
          resolution: "Addressed",
          note: "Concurrent synthetic review.",
          version: c.version,
        }),
      ),
    );
    assert.ok(results.every((r) => r.status === 200));
    const reviewed = (await req(cookie, `consultations/${c.id}`)).data;
    assert.ok(
      flags.every(
        (f) =>
          reviewed.flags.find((g) => g.id === f.id).resolution === "Addressed",
      ),
    );
    const edits = await Promise.all(
      [1, 2].map((i) =>
        req(cookie, `consultations/${c.id}/note`, "PATCH", {
          version: c.version,
          note: {
            statements: c.note.statements.map((s) => ({
              ...s,
              text: s.text + " Reviewer " + i + ".",
            })),
          },
        }),
      ),
    );
    assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
    const staleApproval = await req(
      cookie,
      `consultations/${c.id}/approve`,
      "POST",
      { version: c.version, confirmed: true, reviewed: true },
    );
    assert.equal(staleApproval.status, 409);
    assert.notEqual(
      (await req(cookie, `consultations/${c.id}`)).data.status,
      "Approved",
    );
  } finally {
    await req(cookie, "workspace", "DELETE");
  }
});

test("judge access needs no credentials and new workspaces contain no demonstration records", async () => {
  const cookie = await session(false);
  try {
    const result = await req(cookie, "bootstrap");
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.patients, []);
    assert.deepEqual(result.data.consultations, []);
    assert.equal((await req(cookie, "demo/prepare", "POST")).status, 404);
  } finally {
    await req(cookie, "workspace", "DELETE");
  }
});
