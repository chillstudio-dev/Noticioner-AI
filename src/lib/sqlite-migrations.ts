import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export function migrateSQLite(
  db: DatabaseSync,
  directory = resolve("migrations"),
) {
  const current = Number(
    db.prepare("PRAGMA user_version").get()?.user_version || 0,
  );
  const files = readdirSync(/* turbopackIgnore: true */ directory)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort((a, b) => Number(a.split("_")[0]) - Number(b.split("_")[0]));
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (version <= current) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        readFileSync(
          /* turbopackIgnore: true */ resolve(directory, file),
          "utf8",
        ),
      );
      db.exec(`PRAGMA user_version=${version}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
