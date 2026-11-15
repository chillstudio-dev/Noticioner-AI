import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  query,
  closePracticePool,
  withPracticeTransaction,
  type PracticeActor,
} from "../src/lib/practice-store";
import { practiceRequest } from "../src/lib/practice-service";
import { practiceQuality } from "../src/lib/practice-trust";
import { runTrustAudit } from "../src/lib/trust-provider";
import { trustFixtures } from "../src/lib/trust-fixtures";
after(closePracticePool);
const enabled = !!process.env.PRACTICE_DATABASE_URL;
test(
  "PostgreSQL version-3 upgrade preserves populated tenant data",
  { skip: !enabled },
  async () => {
    const schema = "upgrade_" + randomUUID().replaceAll("-", "");
    await withPracticeTransaction(async (client) => {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      for (const file of [
        "001_shared_records",
        "002_integrity",
        "003_patient_access",
      ])
        await client.query(
          readFileSync(`migrations/practice/${file}.sql`, "utf8"),
        );
      const id = randomUUID();
      await client.query(
        "INSERT INTO organizations VALUES($1,'Preserved synthetic organization')",
        [id],
      );
      await client.query(
        readFileSync(
          "migrations/practice/004_trust_patient_summaries.sql",
          "utf8",
        ),
      );
      assert.equal(
        (await client.query("SELECT name FROM organizations WHERE id=$1", [id]))
          .rows[0].name,
        "Preserved synthetic organization",
      );
      assert.equal(
        (await client.query("SELECT max(version) v FROM practice_migrations"))
          .rows[0].v,
        4,
      );
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
    });
  },
);
test(
  "shared Trust review, patient summaries, quality, staleness and access revocation",
  { skip: !enabled },
  async () => {
    const org = randomUUID();
    await query("INSERT INTO organizations VALUES($1,'Trust test')", [org]);
    async function actor(role: PracticeActor["role"]) {
      const id = randomUUID();
      await query(
        "INSERT INTO practitioners VALUES($1::uuid,'https://test.example',$1::text,'Fictional reviewer')",
        [id],
      );
      await query(
        "INSERT INTO memberships(organization_id,practitioner_id,role) VALUES($1,$2,$3)",
        [org, id, role],
      );
      return {
        organizationId: org,
        practitionerId: id,
        role,
        displayName: "Fictional",
      } as PracticeActor;
    }
    const owner = await actor("reviewer"),
      writer = await actor("clinician");
    const call = (
      who: PracticeActor,
      path: string,
      body?: unknown,
      method = body === undefined ? "GET" : "POST",
    ) =>
      practiceRequest(
        new Request("http://localhost/api/practice/" + path, {
          method,
          body: body === undefined ? undefined : JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
        who,
        path.split("/"),
      );
    const p = await (
      await call(owner, "patients", {
        name: "Synthetic person",
        dob: "2000-01-01",
        identifier: randomUUID(),
      })
    ).json();
    const path = `patients/${p.id}`;
    await query(
      "INSERT INTO care_relationships(organization_id,patient_id,practitioner_id,access_level) VALUES($1,$2,$3,'edit')",
      [org, p.id, writer.practitionerId],
    );
    const n = await (
      await call(owner, path + "/notes", {
        text: "No fever. Recorded penicillin allergy.",
      })
    ).json();
    const approvedNote = await (
      await call(owner, `${path}/notes/${n.id}/approve`, {
        version: n.version,
        reviewed: true,
      })
    ).json();
    const original = globalThis.fetch,
      key = process.env.OPENAI_API_KEY,
      provider = process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "synthetic";
    process.env.AI_PROVIDER = "openai";
    const response = (content: unknown) =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify(content) },
          },
        ],
      });
    let phase = 0;
    const generate = () => {
      phase = 0;
      globalThis.fetch = async () => {
        phase++;
        return response(
          phase % 2
            ? {
                paragraphs: [
                  {
                    id: "p1",
                    text: "You did not report a fever.",
                    evidence: [{ segmentId: n.id, quote: "No fever." }],
                  },
                ],
              }
            : { claims: [], concerns: [] },
        );
      };
    };
    try {
      generate();
      const r = await call(owner, path + "/patient-summaries", {
        sourceNoteId: n.id,
        sourceVersion: approvedNote.version,
        consent: true,
      });
      assert.equal(r.status, 201, await r.clone().text());
      let summary = await r.json();
      const id = summary.id;
      assert.equal(
        (
          await call(owner, `${path}/patient-summaries/${id}/approve`, {
            version: summary.version,
            reviewed: true,
          })
        ).status,
        409,
      );
      const f = summary.trust.findings[0];
      assert.equal(
        (
          await call(
            writer,
            `${path}/patient-summaries/${id}/findings`,
            {
              version: summary.version,
              id: f.id,
              resolution: "Addressed",
              note: "Checked source",
            },
            "PATCH",
          )
        ).status,
        403,
      );
      const oldVersion = summary.version;
      summary = await (
        await call(
          owner,
          `${path}/patient-summaries/${id}/findings`,
          {
            version: summary.version,
            id: f.id,
            resolution: "Addressed",
            note: "Checked source negation",
          },
          "PATCH",
        )
      ).json();
      assert.equal(
        (
          await call(
            owner,
            `${path}/patient-summaries/${id}/findings`,
            {
              version: oldVersion,
              id: f.id,
              resolution: "Addressed",
              note: "Late review",
            },
            "PATCH",
          )
        ).status,
        409,
      );
      const approvals = await Promise.all([
        call(owner, `${path}/patient-summaries/${id}/approve`, {
          version: summary.version,
          reviewed: true,
        }),
        call(owner, `${path}/patient-summaries/${id}/approve`, {
          version: summary.version,
          reviewed: true,
        }),
      ]);
      assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);
      await assert.rejects(
        () =>
          query(
            "UPDATE practice_patient_summaries SET content='{}' WHERE organization_id=$1 AND id=$2",
            [org, id],
          ),
        /immutable/,
      );
      await assert.rejects(
        () =>
          query("DELETE FROM practice_audit WHERE organization_id=$1", [org]),
        /append only/,
      );
      // Revocation in either primary or secondary call must prevent persistence.
      for (const revokeAt of [1, 2]) {
        await query(
          "UPDATE care_relationships SET access_level='edit' WHERE organization_id=$1 AND practitioner_id=$2",
          [org, owner.practitionerId],
        );
        phase = 0;
        globalThis.fetch = async () => {
          phase++;
          if (phase === revokeAt)
            await query(
              "UPDATE care_relationships SET access_level='view' WHERE organization_id=$1 AND practitioner_id=$2",
              [org, owner.practitionerId],
            );
          return response(
            phase === 1
              ? {
                  paragraphs: [
                    {
                      id: "p1",
                      text: "No fever.",
                      evidence: [{ segmentId: n.id, quote: "No fever." }],
                    },
                  ],
                }
              : {
                  claims: [
                    {
                      statementId: "p1",
                      status: "supported",
                      reason: "Exact source",
                    },
                  ],
                  concerns: [],
                },
          );
        };
        assert.equal(
          (
            await call(owner, path + "/patient-summaries", {
              sourceNoteId: n.id,
              sourceVersion: approvedNote.version,
              consent: true,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await query(
              "SELECT count(*) n FROM practice_patient_summaries WHERE organization_id=$1",
              [org],
            )
          ).rows[0].n,
          "1",
        );
      }
      await query(
        "UPDATE care_relationships SET access_level='edit' WHERE organization_id=$1 AND practitioner_id=$2",
        [org, owner.practitionerId],
      );
      generate();
      summary = await (
        await call(owner, path + "/patient-summaries", {
          sourceNoteId: n.id,
          sourceVersion: approvedNote.version,
          consent: true,
        })
      ).json();
      const amendment = await (
        await call(owner, path + "/notes", {
          text: "Fictional amended content.",
          amendsId: n.id,
        })
      ).json();
      await call(owner, `${path}/notes/${amendment.id}/approve`, {
        version: amendment.version,
        reviewed: true,
      });
      assert.equal(
        (
          await call(owner, `${path}/patient-summaries/${summary.id}/approve`, {
            version: summary.version,
            reviewed: true,
          })
        ).status,
        409,
      );
      const listed = await (
        await call(owner, path + "/patient-summaries")
      ).json();
      assert.ok(listed.every((s: { stale: boolean }) => s.stale));
      // Quality works for a clinician without any care assignment and contains only fixtures.
      const unattached = await actor("clinician");
      const quality = await practiceQuality(
        new Request("http://localhost/quality", { method: "POST" }),
        unattached,
        { mode: "deterministic" },
      );
      assert.equal((quality as { sampleSize: number }).sampleSize, 24);
      const history = await practiceQuality(
        new Request("http://localhost/quality"),
        unattached,
        undefined,
      );
      assert.equal((history as unknown[]).length, 1);
      assert.ok(!JSON.stringify(history).includes(n.id));
      // The pure evaluator/provider code has no patient repository import or query.
      const evaluationCode = readFileSync(
        "src/lib/trust-evaluation.ts",
        "utf8",
      );
      assert.ok(
        !/practice-store|practice_patients|practice_notes|patient\(/.test(
          evaluationCode,
        ),
      );
      // Explicit source references are kept even if the provider fails.
      globalThis.fetch = async () => {
        throw new Error("offline");
      };
      const failed = await runTrustAudit(trustFixtures[0].input, true);
      assert.equal(failed.findings[0].status, "unsupported");
    } finally {
      globalThis.fetch = original;
      if (key === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = key;
      if (provider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = provider;
    }
  },
);
