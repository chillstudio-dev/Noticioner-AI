import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateSQLite } from "../src/lib/sqlite-migrations";
test("fresh schema, populated version-1 upgrade and rerun preserve records", () => {
  for (const upgrade of [false, true]) {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    if (upgrade) {
      db.exec(readFileSync("migrations/001_initial.sql", "utf8"));
      db.prepare("INSERT INTO users VALUES(?,?,?)").run(
        "old",
        "Existing workspace",
        "2026-11-15",
      );
    }
    migrateSQLite(db);
    migrateSQLite(db);
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 2);
    if (upgrade)
      assert.equal(
        db.prepare("SELECT name FROM users WHERE id=?").get("old")?.name,
        "Existing workspace",
      );
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='patient_summaries'",
        )
        .get(),
    );
    db.close();
  }
});
test("failed migration rolls back schema and user_version", () => {
  const directory = mkdtempSync(join(tmpdir(), "noticioner-migrations-"));
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA user_version=1");
    writeFileSync(
      join(directory, "002_failure.sql"),
      "CREATE TABLE rollback_probe(id TEXT); PRAGMA user_version=2; INVALID SQL;",
    );
    assert.throws(() => migrateSQLite(db, directory));
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 1);
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='rollback_probe'")
        .get(),
      undefined,
    );
  } finally {
    db.close();
    rmSync(directory, { recursive: true });
  }
});
