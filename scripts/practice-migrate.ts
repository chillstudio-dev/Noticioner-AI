import { readFile, readdir } from "node:fs/promises";
import {
  practicePool,
  withPracticeTransaction,
} from "../src/lib/practice-store";
export async function migratePractice() {
  await withPracticeTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7259121)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS practice_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = new URL("../migrations/practice/", import.meta.url);
    const files = (await readdir(directory))
      .filter((name) => /^\d+_.+\.sql$/.test(name))
      .sort();
    for (const name of files) {
      const version = Number(name.split("_")[0]);
      const applied = await client.query(
        "SELECT 1 FROM practice_migrations WHERE version=$1",
        [version],
      );
      if (!applied.rowCount)
        await client.query(await readFile(new URL(name, directory), "utf8"));
    }
  });
}
if (process.argv[1]?.endsWith("practice-migrate.ts")) {
  try {
    await migratePractice();
    console.log("Practice migrations applied.");
  } finally {
    await practicePool().end();
  }
}
