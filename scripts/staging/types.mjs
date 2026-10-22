import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { createManagementApi, root, verifyStagingProject } from "./lib.mjs";

export function validateGeneratedTypes(value) {
  if (typeof value !== "string" || value.length < 1000 || value.length > 500_000
      || !value.includes("export type Database =") || !value.includes("public: {")
      || ["profiles", "verifications", "meetups", "notifications", "student_reports"].some((name) => !value.includes(`${name}: {`))) throw new Error("Incomplete generated public types.");
  const parsed = ts.createSourceFile("database.generated.ts", value, ts.ScriptTarget.Latest, true);
  if (parsed.parseDiagnostics.length || parsed.statements.some((statement) => !ts.isTypeAliasDeclaration(statement)
      && !ts.isInterfaceDeclaration(statement) && !ts.isVariableStatement(statement))) throw new Error("Unexpected generated types format.");
  return value.replaceAll("\r\n", "\n").trimEnd() + "\n";
}
export async function generatedTypes(api) {
  await verifyStagingProject(api);
  return validateGeneratedTypes((await api("/types/typescript?included_schemas=public")).types);
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(root, "scripts/staging/types.mjs")) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--write") || process.argv.length > 3) throw new Error();
    const types = await generatedTypes(createManagementApi(process.env));
    const filename = path.join(root, "src/types/database.generated.ts");
    if (process.argv.includes("--write")) {
      // Mechanical generated artifact only; never writes dotenv or arbitrary paths.
      await writeFile(filename, types, "utf8");
      console.log(`Regenerated public database types from registered staging (SHA256 ${createHash("sha256").update(types).digest("hex")}).`);
    } else {
      if ((await readFile(filename, "utf8")).replaceAll("\r\n", "\n") !== types) throw new Error();
      console.log("Generated TypeScript definitions match the deployed staging schema.");
    }
  } catch { console.error("Staging type verification failed; no linked/production fallback was used. Review the schema before explicitly regenerating types."); process.exitCode = 1; }
}
