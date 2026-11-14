import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import type { Note, Flag } from "./clinical";
export type Patient = {
  id: string;
  name: string;
  dob: string;
  history: string;
  allergies: string;
  medications: string;
};
export type Consultation = {
  id: string;
  patient_id: string;
  patient_name: string;
  created_at: string;
  updated_at: string;
  type: string;
  status: string;
  transcript: string;
  note: Note | null;
  flags: Flag[];
  provider: string | null;
  latency_ms: number | null;
  version: number;
  approved_at: string | null;
  approved_by: string | null;
};
let db: DatabaseSync;
export function database() {
  if (!db) {
    const path = resolve(
      /* turbopackIgnore: true */ process.env.DATABASE_PATH ||
        "data/cliniscribe.sqlite",
    );
    mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    db.exec(readFileSync(resolve("migrations/001_initial.sql"), "utf8"));
  }
  return db;
}
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export function transaction<T>(fn: () => T): T {
  const d = database();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
export function audit(
  user: string,
  id: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  database()
    .prepare("INSERT INTO audit_events VALUES(?,?,?,?,?,?,?)")
    .run(
      uid(),
      user,
      id,
      action,
      now(),
      "Workspace reviewer",
      JSON.stringify(metadata),
    );
}
export function createSession() {
  return transaction(() => {
    const d = database(),
      id = uid(),
      token = randomBytes(32).toString("hex");
    d.prepare("INSERT INTO users VALUES(?,?,?)").run(
      id,
      "Workspace reviewer",
      now(),
    );
    d.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(token),
      id,
      Date.now() + 7 * 86400000,
    );
    audit(id, null, "Workspace created");
    return { token, id };
  });
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function sessionUser(token: string) {
  return database()
    .prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?")
    .get(hash(token), Date.now())?.user_id as string | undefined;
}
export function logout(token: string) {
  database()
    .prepare("DELETE FROM sessions WHERE token_hash=?")
    .run(hash(token));
}
export function patients(user: string) {
  return database()
    .prepare(
      "SELECT id,name,dob,history,allergies,medications FROM patients WHERE user_id=? ORDER BY name",
    )
    .all(user) as Patient[];
}
export function patient(user: string, id: string) {
  return patients(user).find((p) => p.id === id);
}
export function consultations(user: string): Consultation[] {
  const rows = database()
    .prepare(
      "SELECT c.*,p.name AS patient_name FROM consultations c JOIN patients p ON p.id=c.patient_id WHERE c.user_id=? ORDER BY c.created_at DESC",
    )
    .all(user);
  return rows.map((r) => ({
    ...r,
    note: r.note ? JSON.parse(String(r.note)) : null,
    flags: JSON.parse(String(r.flags)),
  })) as Consultation[];
}
export function consultation(user: string, id: string) {
  return consultations(user).find((c) => c.id === id);
}
export function createConsultation(
  user: string,
  patientId: string,
  type: string,
  transcript = "",
) {
  if (!patient(user, patientId)) throw new Error("Patient not found");
  return transaction(() => {
    const id = uid(),
      time = now();
    database()
      .prepare(
        "INSERT INTO consultations(id,user_id,patient_id,created_at,updated_at,type,transcript) VALUES(?,?,?,?,?,?,?)",
      )
      .run(id, user, patientId, time, time, type, transcript);
    audit(user, id, "Consultation created");
    if (transcript) audit(user, id, "Transcript loaded");
    return consultation(user, id)!;
  });
}
export function saveVersion(
  user: string,
  c: Consultation,
  note: Note,
  flags: Flag[],
  kind: string,
  provider?: string,
  latency?: number,
) {
  const version = c.version + 1;
  database()
    .prepare("INSERT INTO note_versions VALUES(?,?,?,?,?,?)")
    .run(uid(), c.id, version, JSON.stringify(note), kind, now());
  database()
    .prepare(
      "UPDATE consultations SET note=?,flags=?,version=?,status='Needs Review',provider=COALESCE(?,provider),latency_ms=COALESCE(?,latency_ms),updated_at=? WHERE id=? AND user_id=?",
    )
    .run(
      JSON.stringify(note),
      JSON.stringify(flags),
      version,
      provider ?? null,
      latency ?? null,
      now(),
      c.id,
      user,
    );
  audit(user, c.id, kind, { version });
}
export function rateLimit(key: string, limit = 20, window = 60000) {
  const d = database(),
    time = Date.now();
  const r = d.prepare("SELECT * FROM rate_limits WHERE key=?").get(key);
  if (!r || Number(r.reset_at) < time) {
    d.prepare("INSERT OR REPLACE INTO rate_limits VALUES(?,?,?)").run(
      key,
      1,
      time + window,
    );
    return true;
  }
  if (Number(r.count) >= limit) return false;
  d.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").run(key);
  return true;
}
