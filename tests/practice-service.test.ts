import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { practiceRequest } from "../src/lib/practice-service";
import {
  query,
  closePracticePool,
  type PracticeActor,
} from "../src/lib/practice-store";
import { migratePractice } from "../scripts/practice-migrate";

after(closePracticePool);
test(
  "shared practice workflow and authorization boundaries",
  { skip: !process.env.PRACTICE_DATABASE_URL },
  async () => {
    await migratePractice(); // Reapplying migrations must be safe.
    const org = randomUUID(),
      otherOrg = randomUUID();
    await query(
      "INSERT INTO organizations(id,name) VALUES($1,'Practice A'),($2,'Practice B')",
      [org, otherOrg],
    );
    async function actor(
      role: PracticeActor["role"],
      organizationId = org,
    ): Promise<PracticeActor> {
      const practitionerId = randomUUID();
      await query(
        "INSERT INTO practitioners(id,issuer,subject,display_name) VALUES($1::uuid,'https://identity.example',$1::text,'Synthetic practitioner')",
        [practitionerId],
      );
      await query(
        "INSERT INTO memberships(organization_id,practitioner_id,role) VALUES($1,$2,$3)",
        [organizationId, practitionerId, role],
      );
      return {
        practitionerId,
        organizationId,
        role,
        displayName: "Synthetic practitioner",
      };
    }
    const owner = await actor("reviewer"),
      colleague = await actor("clinician"),
      observer = await actor("reviewer"),
      outsider = await actor("reviewer", otherOrg),
      admin = await actor("admin");
    async function call(
      who: PracticeActor,
      path: string,
      payload?: unknown,
      method = payload === undefined ? "GET" : "POST",
    ) {
      return practiceRequest(
        new Request("http://localhost/api/practice/" + path, {
          method,
          body:
            payload === undefined
              ? undefined
              : payload instanceof FormData
                ? payload
                : JSON.stringify(payload),
          headers:
            payload instanceof FormData || payload === undefined
              ? undefined
              : { "content-type": "application/json" },
        }),
        who,
        path.split("/"),
      );
    }
    const clinicianPatient = {
      name: "New synthetic patient",
      dob: "1980-01-01",
      identifier: randomUUID(),
    };
    assert.equal(
      (await call(colleague, "patients", clinicianPatient)).status,
      400,
    );
    assert.equal(
      (
        await call(colleague, "patients", {
          ...clinicianPatient,
          reviewerId: outsider.practitionerId,
        })
      ).status,
      400,
    );
    const assigned = await call(colleague, "patients", {
      ...clinicianPatient,
      reviewerId: owner.practitionerId,
    });
    assert.equal(assigned.status, 201);
    const assignedPatient = await assigned.json();
    assert.equal(
      (await call(owner, `patients/${assignedPatient.id}`)).status,
      200,
    );
    const created = await call(owner, "patients", {
      name: "Synthetic Patient",
      dob: "1980-01-01",
      identifier: randomUUID(),
    });
    assert.equal(created.status, 201);
    const p = await created.json(),
      path = `patients/${p.id}`;
    assert.equal((await call(colleague, path)).status, 404);
    assert.equal((await call(outsider, path)).status, 404);
    assert.equal((await call(admin, path)).status, 404);
    assert.deepEqual(
      (await (await call(admin, "bootstrap")).json()).patients,
      [],
    );
    assert.equal(
      (
        await call(outsider, `${path}/grants`, {
          practitionerId: outsider.practitionerId,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call(owner, `${path}/grants`, {
          practitionerId: colleague.practitionerId,
          accessLevel: "edit",
        })
      ).status,
      200,
    );
    assert.equal((await call(colleague, path)).status, 200);
    assert.equal(
      (
        await call(colleague, `${path}/grants`, {
          practitionerId: owner.practitionerId,
        })
      ).status,
      403,
    );

    const noteResult = await call(colleague, `${path}/notes`, {
      text: "Patient reports a headache.",
    });
    assert.equal(noteResult.status, 201);
    const note = await noteResult.json();
    assert.equal(note.content, "Patient reports a headache.");
    assert.equal(
      (
        await call(colleague, `${path}/notes/${note.id}/approve`, {
          version: 1,
          reviewed: true,
        })
      ).status,
      403,
    );
    assert.equal(
      (await call(owner, `${path}/notes/${note.id}/approve`, { version: 1 }))
        .status,
      400,
    );
    assert.equal(
      (
        await call(owner, `${path}/notes/${note.id}/approve`, {
          version: 2,
          reviewed: true,
        })
      ).status,
      409,
    );
    const approvals = await Promise.all(
      [1, 2].map(() =>
        call(owner, `${path}/notes/${note.id}/approve`, {
          version: 1,
          reviewed: true,
        }),
      ),
    );
    assert.deepEqual(approvals.map((x) => x.status).sort(), [200, 409]);
    await assert.rejects(
      query(
        "UPDATE practice_notes SET content='tampered' WHERE organization_id=$1 AND id=$2",
        [org, note.id],
      ),
      /immutable/,
    );
    await assert.rejects(
      query(
        "DELETE FROM practice_note_versions WHERE organization_id=$1 AND note_id=$2",
        [org, note.id],
      ),
      /append only/,
    );
    const medication = {
      name: "Synthetic medication",
      dose: "reported dose",
      route: "oral",
      frequency: "daily",
      status: "reported",
      source: "Synthetic patient report",
    };
    assert.equal(
      (await call(colleague, `${path}/medications`, medication)).status,
      201,
    );
    assert.equal(
      (
        await call(colleague, `${path}/medications`, {
          ...medication,
          status: "verified",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await call(owner, `${path}/medications`, {
          ...medication,
          status: "verified",
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call(owner, `${path}/medications`, {
          ...medication,
          status: "active",
        })
      ).status,
      400,
    );

    process.env.PRACTICE_FILE_KEY = randomBytes(32).toString("base64");
    delete process.env.PRACTICE_SCANNER_BIN;
    const form = new FormData();
    const sourceText = "Synthetic patient reports headache.";
    form.set(
      "file",
      new File([sourceText], "notes.txt", { type: "text/plain" }),
    );
    const uploaded = await call(owner, `${path}/documents`, form);
    assert.equal(uploaded.status, 201);
    const doc = await uploaded.json(),
      download = `${path}/documents/${doc.id}/download`;
    const stored = await query(
      "SELECT original_bytes FROM practice_documents WHERE organization_id=$1 AND id=$2",
      [org, doc.id],
    );
    assert.ok(!stored.rows[0].original_bytes.includes(Buffer.from(sourceText)));
    assert.equal(await (await call(colleague, download)).text(), sourceText);
    assert.equal((await call(outsider, download)).status, 404);
    const pdf = new FormData();
    pdf.set(
      "file",
      new File(["%PDF-1.4\n"], "test.pdf", { type: "application/pdf" }),
    );
    assert.equal((await call(owner, `${path}/documents`, pdf)).status, 503);
    const binary = new FormData();
    binary.set(
      "file",
      new File(["\u0000bad"], "bad.txt", { type: "text/plain" }),
    );
    assert.equal((await call(owner, `${path}/documents`, binary)).status, 400);

    // Exercise provider validation without sending patient data to a real service.
    const originalFetch = globalThis.fetch;
    const oldKey = process.env.OPENAI_API_KEY,
      oldProvider = process.env.AI_PROVIDER,
      oldStt = process.env.STT_PROVIDER;
    process.env.STT_PROVIDER = "openai";
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "synthetic-test-key";
    globalThis.fetch = async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                statements: [
                  {
                    id: "statement1",
                    section: "Subjective",
                    text: "Patient reports a headache.",
                    category: "complaint",
                    certainty: "Supported",
                    evidence: [
                      {
                        segmentId: "source1",
                        quote: "Patient reports a headache.",
                      },
                    ],
                    speaker: "Patient",
                    speakerBasis: "Explicit",
                  },
                ],
              }),
            },
          },
        ],
      });
    let summaryId: string;
    try {
      const generated = await call(owner, `${path}/summaries`, {
        sourceNoteIds: [note.id],
        sourceDocumentIds: [],
        consent: true,
      });
      assert.equal(generated.status, 201, await generated.clone().text());
      const summary = await generated.json();
      summaryId = summary.id;
      assert.equal(summary.status, "draft");
      assert.equal(summary.sources[0].id, note.id);
      assert.equal(summary.sources[0].version, 2);
      assert.equal(
        (
          await call(owner, `${path}/summaries/${summary.id}/approve`, {
            version: 1,
            reviewed: true,
          })
        ).status,
        409,
      );
      let reviewedSummary = summary;
      await query("DELETE FROM practice_request_limits WHERE key=$1", [
        `${org}:${owner.practitionerId}`,
      ]);
      for (const finding of summary.trust_findings.filter(
        (f: { required: boolean }) => f.required,
      )) {
        const reviewed = await call(
          owner,
          `${path}/summaries/${summary.id}/findings`,
          {
            version: reviewedSummary.version,
            id: finding.id,
            resolution: "Addressed",
            note: "Checked against the synthetic source.",
          },
          "PATCH",
        );
        assert.equal(reviewed.status, 200, await reviewed.clone().text());
        reviewedSummary = await reviewed.json();
      }
      assert.equal(
        (
          await call(owner, `${path}/summaries/${summary.id}/approve`, {
            version: reviewedSummary.version,
            reviewed: true,
          })
        ).status,
        200,
      );
      await query("DELETE FROM practice_request_limits WHERE key=$1", [
        `${org}:${owner.practitionerId}`,
      ]);
      globalThis.fetch = async () =>
        Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  text: "The patient reports a headache.",
                }),
              },
            },
          ],
        });
      const translated = await call(owner, `${path}/translate`, {
        sourceText: "Le patient signale un mal de tête.",
        targetLanguage: "en",
        consent: true,
      });
      assert.equal(translated.status, 200);
      assert.equal(
        (await translated.json()).text,
        "The patient reports a headache.",
      );
      globalThis.fetch = async () => {
        assert.equal(
          (
            await call(admin, `${path}/grants`, {
              practitionerId: owner.practitionerId,
              accessLevel: "view",
            })
          ).status,
          200,
        );
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content:
                  '{"text":"Must not return translation after downgrade"}',
              },
            },
          ],
        });
      };
      const deniedTranslation = await call(owner, `${path}/translate`, {
        sourceText: "Le patient signale un mal de tête.",
        targetLanguage: "en",
        consent: true,
      });
      assert.equal(deniedTranslation.status, 403);
      assert.ok(!(await deniedTranslation.text()).includes("Must not return"));
      assert.equal(
        (
          await call(admin, `${path}/grants`, {
            practitionerId: owner.practitionerId,
            accessLevel: "edit",
          })
        ).status,
        200,
      );
      const audio = new FormData();
      audio.set(
        "audio",
        new File(["synthetic"], "sample.mp4", { type: "audio/mp4" }),
      );
      audio.set("consent", "true");
      audio.set("language", "fr");
      globalThis.fetch = async (_url, options) => {
        assert.equal((options!.body as FormData).get("language"), "fr");
        return Response.json({ text: "Bonjour. தமிழ் 日本語 한국어 中文" });
      };
      const transcribed = await call(owner, `${path}/transcribe`, audio);
      assert.equal(transcribed.status, 200);
      assert.equal(
        (await transcribed.json()).text,
        "Bonjour. தமிழ் 日本語 한국어 中文",
      );
      globalThis.fetch = async () => {
        assert.equal(
          (
            await call(admin, `${path}/grants`, {
              practitionerId: owner.practitionerId,
              accessLevel: "view",
            })
          ).status,
          200,
        );
        return Response.json({
          text: "Must not return this result after downgrade",
        });
      };
      const downgraded = await call(owner, `${path}/transcribe`, audio);
      assert.equal(downgraded.status, 403);
      assert.ok(!(await downgraded.text()).includes("Must not return"));
      assert.equal(
        (
          await call(admin, `${path}/grants`, {
            practitionerId: owner.practitionerId,
            accessLevel: "edit",
          })
        ).status,
        200,
      );
    } finally {
      globalThis.fetch = originalFetch;
      if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = oldKey;
      if (oldProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = oldProvider;
      if (oldStt === undefined) delete process.env.STT_PROVIDER;
      else process.env.STT_PROVIDER = oldStt;
    }
    const amendment = await (
      await call(owner, `${path}/notes`, {
        text: "Correction: headache resolved.",
        amendsId: note.id,
      })
    ).json();
    assert.equal(
      (
        await call(owner, `${path}/notes/${amendment.id}/approve`, {
          version: 1,
          reviewed: true,
        })
      ).status,
      200,
    );
    const detail = await (await call(owner, path)).json();
    assert.equal(
      detail.summaries.find((s: { id: string }) => s.id === summaryId).stale,
      true,
    );
    assert.ok(detail.audit.every((event: { id: string }) => event.id));
    // Default grants are view-only even for a practitioner with the reviewer role.
    assert.equal(
      (
        await call(owner, `${path}/grants`, {
          practitionerId: observer.practitionerId,
        })
      ).status,
      200,
    );
    const readOnly = await (await call(observer, path)).json();
    assert.deepEqual(readOnly.permissions, {
      canWrite: false,
      canApprove: false,
      canManage: false,
    });
    assert.equal(await (await call(observer, download)).text(), sourceText);
    const deniedWrites: [string, unknown][] = [
      [
        `${path}/translate`,
        { sourceText: "Original source", targetLanguage: "fr", consent: true },
      ],
      [`${path}/transcribe`, form],
      [`${path}/notes`, { text: "Unauthorized note" }],
      [`${path}/medications`, medication],
      [`${path}/documents`, form],
      [`${path}/summaries`, { sourceNoteIds: [note.id], consent: true }],
      [`${path}/notes/${note.id}/approve`, { version: 2, reviewed: true }],
      [
        `${path}/summaries/${summaryId}/approve`,
        { version: 2, reviewed: true },
      ],
      [
        `${path}/grants`,
        { practitionerId: observer.practitionerId, accessLevel: "edit" },
      ],
    ];
    for (const [endpoint, payload] of deniedWrites)
      assert.equal(
        (await call(observer, endpoint, payload)).status,
        403,
        endpoint,
      );
    assert.equal(
      (
        await call(
          observer,
          `${path}/grants/${colleague.practitionerId}`,
          {},
          "DELETE",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(owner, `${path}/grants`, {
          practitionerId: observer.practitionerId,
          accessLevel: "owner",
        })
      ).status,
      400,
    );
    // Upgrade and downgrade take effect on the next request without a new session.
    assert.equal(
      (
        await call(admin, `${path}/grants`, {
          practitionerId: observer.practitionerId,
          accessLevel: "edit",
        })
      ).status,
      200,
    );
    assert.equal(
      (await call(observer, `${path}/notes`, { text: "Authorized note" }))
        .status,
      201,
    );
    assert.equal(
      (
        await call(admin, `${path}/grants`, {
          practitionerId: observer.practitionerId,
          accessLevel: "view",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(observer, `${path}/notes`, {
          text: "Denied after downgrade",
        })
      ).status,
      403,
    );
    await assert.rejects(
      query(
        "UPDATE care_relationships SET access_level='owner' WHERE organization_id=$1 AND practitioner_id=$2",
        [org, observer.practitionerId],
      ),
      /check constraint/,
    );
    await assert.rejects(
      query(
        "UPDATE practice_audit SET outcome='tampered' WHERE organization_id=$1",
        [org],
      ),
      /append only/,
    );
    assert.equal(
      (
        await call(
          owner,
          `${path}/grants/${colleague.practitionerId}`,
          {},
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal((await call(colleague, path)).status, 404);
    assert.equal((await call(colleague, download)).status, 404);
    const denied = await query(
      "SELECT 1 FROM practice_audit WHERE organization_id=$1 AND practitioner_id=$2 AND action='request.denied' AND resource_id=$3",
      [org, colleague.practitionerId, p.id],
    );
    assert.ok(denied.rowCount);
    await query(
      `WITH added AS (INSERT INTO practice_patients(id,organization_id,name,dob,identifier) SELECT gen_random_uuid(),$1,'ZZ Synthetic ' || n,'1980-01-01'::date,'bulk-' || n FROM generate_series(1,251) n RETURNING id,organization_id) INSERT INTO care_relationships(organization_id,patient_id,practitioner_id) SELECT organization_id,id,$2 FROM added`,
      [org, owner.practitionerId],
    );
    const directory = await (await call(owner, "bootstrap")).json();
    assert.equal(directory.patients.length, 250);
    assert.equal(directory.directoryLimited, true);
    const searched = await practiceRequest(
      new Request("http://localhost/api/practice/bootstrap?q=bulk-251"),
      owner,
      ["bootstrap"],
    );
    const matches = await searched.json();
    assert.equal(matches.patients.length, 1);
    assert.equal(matches.patients[0].identifier, "bulk-251");
    await query(
      "UPDATE memberships SET active=false WHERE organization_id=$1 AND practitioner_id=$2",
      [org, owner.practitionerId],
    );
    assert.equal((await call(owner, path)).status, 403);
  },
);
