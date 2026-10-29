import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resticFailureCodes } from "./diagnostics.mjs";

// No shell expansion, token arguments, raw diagnostics, inherited output, or
// repository passwords in child command lines. CLI output is private by default.
export async function command(executable, args, { env = process.env, input, output, timeoutMs = 900000, maxBytes = 4000000, postgresRestoreDiagnostics = false, resticDiagnostics = false } = {}) {
  const child = spawn(executable, args, { env, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  let bytes = 0, tooLarge = false;
  const chunks = [];
  let diagnostic = "";
  child.stderr.on("data", chunk => { if ((postgresRestoreDiagnostics || resticDiagnostics) && diagnostic.length < 65536) diagnostic = (diagnostic + chunk.toString()).slice(0, 65536); });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => { clearTimeout(timer); if (code === 0 && !tooLarge) resolve(); else reject(new Error("Private operation failed.")); });
  });
  // Attach rejection immediately, including when a producer stops early.
  completed.catch(() => {});
  const reading = (async () => {
    for await (const chunk of child.stdout) {
      bytes += chunk.length;
      if (!output) {
        if (bytes > maxBytes) { tooLarge = true; child.kill(); break; }
        chunks.push(chunk);
      } else await output(chunk);
    }
  })();
  reading.catch(() => {});
  child.stdin.on("error", () => {});
  try {
    const writing = pipeline(Readable.from(input?.[Symbol.asyncIterator] ? input : input === undefined ? [] : [input]), child.stdin);
    await Promise.all([completed, reading, writing]);
    return Buffer.concat(chunks);
  } catch {
    child.kill(); await completed.catch(() => {}); await reading.catch(() => {});
    const error = new Error("Private operation failed.");
    if (postgresRestoreDiagnostics) error.operationCodes = [
      [/schema .* already exists/i, "SCHEMA_EXISTS"], [/role .* does not exist/i, "ROLE_MISSING"], [/permission denied/i, "PERMISSION_DENIED"],
      [/extension .* is not available/i, "EXTENSION_UNAVAILABLE"], [/unsupported version/i, "ARCHIVE_VERSION"], [/does not appear to be a valid archive/i, "INVALID_ARCHIVE"],
      [/schema .* does not exist/i, "SCHEMA_MISSING"], [/relation .* does not exist/i, "RELATION_MISSING"], [/function .* does not exist/i, "FUNCTION_MISSING"],
    ].filter(([pattern]) => pattern.test(diagnostic)).map(([, code]) => code);
    if (postgresRestoreDiagnostics) for (const schema of ["public", "private", "auth", "storage", "extensions", "supabase_migrations"]) {
      if (new RegExp(`schema ["']?${schema}["']? (?:already exists|does not exist)`, "i").test(diagnostic)) error.operationCodes.push(`SCHEMA_${schema.toUpperCase()}`);
    }
    if (resticDiagnostics) error.operationCodes = [...(error.operationCodes ?? []), ...resticFailureCodes(diagnostic)];
    throw error;
  }
  finally { clearTimeout(timer); }
}

export function controlledEnvironment(env) {
  // Do not accept password-command/repository-file hooks or insecure TLS knobs
  // from a developer shell or inherited CI environment.
  for (const key of ["RESTIC_PASSWORD_COMMAND", "RESTIC_PASSWORD_FILE", "RESTIC_REPOSITORY_FILE", "RESTIC_INSECURE_TLS", "NODE_TLS_REJECT_UNAUTHORIZED", "PGSERVICE", "PGSERVICEFILE",
    "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) {
    assert.ok(!env[key], "Unreviewed credential/TLS override.");
  }
  const allowed = /^(?:PATH|Path|PATHEXT|SYSTEMROOT|SystemRoot|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SSL_CERT_FILE|SSL_CERT_DIR|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AWS_DEFAULT_REGION|AWS_REGION|RESTIC_REPOSITORY|RESTIC_PASSWORD|OPS_[A-Z0-9_]+)$/;
  return Object.fromEntries(Object.entries(env).filter(([name, value]) => allowed.test(name) && typeof value === "string"));
}
