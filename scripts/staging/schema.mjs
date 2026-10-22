import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { DATABASE_BOOTSTRAP } from "../qa/lib/database-bootstrap.mjs";
import { loadMigrations, root } from "./lib.mjs";

export const contractSql = await readFile(path.join(root, "supabase/checks/schema_contract.sql"), "utf8");
export function canonical(value) {
  if (typeof value === "string") return value.replaceAll("\r\n", "\n");
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
export function compareSchema(expected, actual) {
  const map = (rows) => {
    const output = new Map();
    for (const row of rows) {
      if (!row || typeof row.kind !== "string" || typeof row.identity !== "string" || !Object.hasOwn(row, "definition")) throw new Error("Invalid schema inventory.");
      const key = `${row.kind}:${row.identity}`;
      if (output.has(key)) throw new Error("Duplicate schema inventory identity.");
      output.set(key, JSON.stringify(canonical(row.definition)));
    }
    return output;
  };
  const before = map(expected), after = map(actual);
  if (!before.size || !after.size) throw new Error("Empty schema inventories cannot pass.");
  return {
    missing: [...before.keys()].filter((key) => !after.has(key)),
    unexpected: [...after.keys()].filter((key) => !before.has(key)),
    changed: [...before.keys()].filter((key) => after.has(key) && before.get(key) !== after.get(key)),
  };
}
export async function expectedSchema(migrations) {
  const database = await PGlite.create({ extensions: { pgcrypto, pg_trgm } });
  try {
    await database.exec(DATABASE_BOOTSTRAP);
    for (const item of migrations ?? await loadMigrations()) await database.exec(item.query);
    return (await database.query(contractSql)).rows;
  } finally { await database.close(); }
}
