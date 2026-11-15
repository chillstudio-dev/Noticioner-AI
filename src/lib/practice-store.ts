import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { randomUUID } from "node:crypto";
export type PracticeActor = {
  practitionerId: string;
  organizationId: string;
  role: "clinician" | "reviewer" | "admin";
  displayName: string;
};
export class PracticeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
let pool: Pool | undefined;
export function practicePool() {
  if (!process.env.PRACTICE_DATABASE_URL)
    throw new PracticeError(503, "Shared practice database is not configured.");
  return (pool ??= new Pool({
    connectionString: process.env.PRACTICE_DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  }));
}
export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values: unknown[] = [],
) {
  return practicePool().query<T>(sql, values);
}
export async function withPracticeTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await practicePool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function requirePatientAccess(
  client: Pick<PoolClient, "query">,
  actor: PracticeActor,
  patientId: string,
  write = false,
) {
  const { rows } = await client.query(
    "SELECT p.*,c.access_level FROM practice_patients p JOIN care_relationships c ON c.organization_id=p.organization_id AND c.patient_id=p.id JOIN memberships m ON m.organization_id=c.organization_id AND m.practitioner_id=c.practitioner_id WHERE p.organization_id=$1 AND p.id=$2 AND c.practitioner_id=$3 AND c.active AND m.active AND m.role IN ('clinician','reviewer') " + (write ? "FOR UPDATE OF p FOR SHARE OF c" : "FOR SHARE OF c,p"),
    [actor.organizationId, patientId, actor.practitionerId],
  );
  if (!rows.length || (write && actor.role === "admin"))
    throw new PracticeError(404, "Patient not found or access unavailable.");
  if (write && rows[0].access_level !== "edit")
    throw new PracticeError(403, "You have view-only access to this patient.");
  return rows[0];
}
export async function auditPractice(
  client: Pick<PoolClient, "query">,
  actor: PracticeActor,
  action: string,
  resourceId: string | null,
  outcome = "success",
) {
  await client.query(
    "INSERT INTO practice_audit(id,organization_id,practitioner_id,action,resource_id,outcome) VALUES($1,$2,$3,$4,$5,$6)",
    [
      randomUUID(),
      actor.organizationId,
      actor.practitionerId,
      action,
      resourceId,
      outcome,
    ],
  );
}
export async function closePracticePool() {
  await pool?.end();
  pool = undefined;
}
