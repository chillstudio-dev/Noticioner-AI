import { randomUUID } from "node:crypto";
import {
  practicePool,
  withPracticeTransaction,
} from "../src/lib/practice-store";
const [organizationName, issuer, subject, displayName, role = "clinician"] =
  process.argv.slice(2);
if (
  !organizationName ||
  !issuer ||
  !subject ||
  !displayName ||
  !["admin", "clinician", "reviewer"].includes(role) ||
  new URL(issuer).protocol !== "https:"
)
  throw new Error(
    'Usage: npm run practice:provision -- "Organization" "https://issuer" "verified-subject" "Name" clinician|reviewer|admin',
  );
try {
  await withPracticeTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7259122)");
    let org = (
      await client.query("SELECT id FROM organizations WHERE name=$1", [
        organizationName,
      ])
    ).rows[0];
    if (!org) {
      org = { id: randomUUID() };
      await client.query("INSERT INTO organizations(id,name) VALUES($1,$2)", [
        org.id,
        organizationName,
      ]);
    }
    const user = (
      await client.query(
        "INSERT INTO practitioners(id,issuer,subject,display_name) VALUES($1,$2,$3,$4) ON CONFLICT(issuer,subject) DO UPDATE SET display_name=excluded.display_name RETURNING id",
        [randomUUID(), issuer, subject, displayName],
      )
    ).rows[0];
    await client.query(
      "INSERT INTO memberships(organization_id,practitioner_id,role) VALUES($1,$2,$3) ON CONFLICT(organization_id,practitioner_id) DO UPDATE SET role=excluded.role,active=true",
      [org.id, user.id, role],
    );
    console.log("Provisioned practitioner", user.id, "in organization", org.id);
  });
} finally {
  await practicePool().end();
}
