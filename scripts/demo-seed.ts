import { randomUUID } from "node:crypto";
import { withPracticeTransaction } from "../src/lib/practice-store";
import { prepareDocument } from "../src/lib/practice-files";
import { demoAccounts } from "./demo-identity";

export const demoOrganizationId = "11111111-1111-4111-8111-111111111111";
export const demoPatientId = "33333333-3333-4333-8333-333333333331";
export async function seedDemo(issuer: string) {
  const document = await prepareDocument(
    new File(
      [
        "Synthetic patient Alex Tan reports a mild headache for one day. No real patient information is present.",
      ],
      "synthetic-referral.txt",
      { type: "text/plain" },
    ),
  );
  await withPracticeTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7259130)");
    if (
      (
        await client.query("SELECT 1 FROM organizations WHERE id=$1", [
          demoOrganizationId,
        ])
      ).rowCount
    )
      return;
    await client.query(
      "INSERT INTO organizations(id,name) VALUES($1,'Sample Hospital · Synthetic Demonstration')",
      [demoOrganizationId],
    );
    const practitioners: string[] = [];
    for (const account of demoAccounts) {
      const id = randomUUID();
      practitioners.push(id);
      await client.query(
        "INSERT INTO practitioners(id,issuer,subject,display_name) VALUES($1,$2,$3,$4)",
        [id, issuer, account.subject, account.name],
      );
      await client.query(
        "INSERT INTO memberships(organization_id,practitioner_id,role) VALUES($1,$2,$3)",
        [demoOrganizationId, id, account.role],
      );
    }
    await client.query(
      "INSERT INTO practice_patients(id,organization_id,name,dob,identifier) VALUES($1,$2,'Alex Tan (synthetic)','1988-05-14','SYN-1001')",
      [demoPatientId, demoOrganizationId],
    );
    const secondPatient = randomUUID();
    await client.query(
      "INSERT INTO practice_patients(id,organization_id,name,dob,identifier) VALUES($1,$2,'Priya Kumar (synthetic)','1992-03-09','SYN-1002')",
      [secondPatient, demoOrganizationId],
    );
    for (let index = 0; index < practitioners.length; index++)
      await client.query(
        "INSERT INTO care_relationships(organization_id,patient_id,practitioner_id,access_level) VALUES($1,$2,$3,$4)",
        [
          demoOrganizationId,
          demoPatientId,
          practitioners[index],
          demoAccounts[index].access,
        ],
      );
    await client.query(
      "INSERT INTO care_relationships(organization_id,patient_id,practitioner_id,access_level) VALUES($1,$2,$3,'edit')",
      [demoOrganizationId, secondPatient, practitioners[0]],
    );
    const noteId = randomUUID(),
      noteText =
        "Synthetic patient reports a mild headache for one day. This record is for software demonstration only.";
    await client.query(
      "INSERT INTO practice_notes(id,organization_id,patient_id,author_id,content,status,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,'approved',$4,now())",
      [noteId, demoOrganizationId, demoPatientId, practitioners[0], noteText],
    );
    await client.query(
      "INSERT INTO practice_note_versions(id,organization_id,note_id,version,content,author_id) VALUES($1,$2,$3,1,$4,$5)",
      [randomUUID(), demoOrganizationId, noteId, noteText, practitioners[0]],
    );
    const draftId = randomUUID(),
      draftText =
        "Synthetic follow-up draft: verify the reported symptoms and source wording before approval.";
    await client.query(
      "INSERT INTO practice_notes(id,organization_id,patient_id,author_id,content) VALUES($1,$2,$3,$4,$5)",
      [draftId, demoOrganizationId, demoPatientId, practitioners[1], draftText],
    );
    await client.query(
      "INSERT INTO practice_note_versions(id,organization_id,note_id,version,content,author_id) VALUES($1,$2,$3,1,$4,$5)",
      [randomUUID(), demoOrganizationId, draftId, draftText, practitioners[1]],
    );
    await client.query(
      "INSERT INTO practice_medications(id,organization_id,patient_id,name,dose,route,frequency,status,source,recorded_by) VALUES($1,$2,$3,'Example medication (synthetic)','Not specified','Not specified','Not specified','reported','Fictional patient report used to demonstrate provenance; not a prescription.',$4)",
      [randomUUID(), demoOrganizationId, demoPatientId, practitioners[1]],
    );
    await client.query(
      "INSERT INTO practice_documents(id,organization_id,patient_id,uploaded_by,filename,mime_type,byte_size,checksum,original_bytes,extracted_text,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'available')",
      [
        randomUUID(),
        demoOrganizationId,
        demoPatientId,
        practitioners[0],
        document.filename,
        document.mime,
        document.bytes,
        document.checksum,
        document.encrypted,
        document.extracted,
      ],
    );
    await client.query(
      "INSERT INTO practice_summaries(id,organization_id,patient_id,note,sources,model,created_by) VALUES($1,$2,$3,$4,$5,'Synthetic fixture · not generated by a live AI model',$6)",
      [
        randomUUID(),
        demoOrganizationId,
        demoPatientId,
        JSON.stringify({
          statements: [
            {
              id: "demo-statement",
              section: "Subjective",
              text: "The synthetic patient reports a mild headache for one day.",
              category: "complaint",
              certainty: "Supported",
              speaker: "Patient",
              speakerBasis: "Unknown",
              evidence: [
                {
                  segmentId: "source1",
                  quote:
                    "Synthetic patient reports a mild headache for one day.",
                },
              ],
            },
          ],
        }),
        JSON.stringify([
          { type: "note", id: noteId, version: 1, segmentId: "source1" },
        ]),
        practitioners[0],
      ],
    );
    await client.query(
      "INSERT INTO practice_audit(id,organization_id,practitioner_id,action,resource_id,outcome) VALUES($1,$2,$3,'demo.synthetic_records_created',$4,'success')",
      [randomUUID(), demoOrganizationId, practitioners[0], demoPatientId],
    );
  });
}
