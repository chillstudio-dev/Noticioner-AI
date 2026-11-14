import nextEnv from "@next/env";
import { database } from "../src/lib/db";
nextEnv.loadEnvConfig(process.cwd());
database();
console.log(
  "SQLite migrations applied. New visitor workspaces start empty, without a login.",
);
