import assert from "node:assert/strict";
import test from "node:test";
import { resolveQaDockerBinary } from "../scripts/qa/lib/docker.mjs";

const perUser = "C:\\Users\\Student\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe";
const system = "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe";
const environment = {
  LOCALAPPDATA: "C:\\Users\\Student\\AppData\\Local",
  ProgramFiles: "C:\\Program Files",
};

function filesystem(files, { directories = [], aliases = {} } = {}) {
  const visited = [];
  return {
    visited,
    platform: "win32",
    realpath(candidate) {
      visited.push(candidate);
      const canonical = aliases[candidate] ?? candidate;
      if (!files.includes(canonical) && !directories.includes(canonical)) throw new Error("private-path-and-error");
      return canonical;
    },
    stat(candidate) {
      return { isFile: () => files.includes(candidate) };
    },
  };
}

test("QA Docker resolution prefers the first existing PATH docker.exe over Desktop fallbacks", () => {
  const first = "C:\\CLI\\docker.exe";
  const second = "C:\\Other CLI\\docker.exe";
  const fs = filesystem([first, second, perUser, system]);
  assert.equal(resolveQaDockerBinary({ ...environment, Path: 'C:\\Missing;"C:\\CLI";C:\\Other CLI' }, fs), first);
  assert.deepEqual(fs.visited, ["C:\\Missing\\docker.exe", first]);
});

test("QA Docker resolution returns a canonical existing regular file", () => {
  const alias = "C:\\Alias\\docker.exe";
  const canonical = "C:\\Docker CLI\\docker.exe";
  assert.equal(resolveQaDockerBinary({ PATH: "C:\\Alias" }, filesystem([canonical], { aliases: { [alias]: canonical } })), canonical);
  assert.throws(() => resolveQaDockerBinary({ PATH: "C:\\Directory" }, filesystem([], {
    directories: ["C:\\Directory\\docker.exe"],
  })), { message: "Local Docker CLI not found." });
});

test("QA Docker resolution finds the per-user Desktop install without PATH", () => {
  const fs = filesystem([perUser, system]);
  const env = { ...environment };
  assert.equal(resolveQaDockerBinary(env, fs), perUser);
  assert.deepEqual(env, environment);
  assert.deepEqual(fs.visited, [perUser]);
});

test("QA Docker resolution falls back to the system Desktop install", () => {
  const fs = filesystem([system]);
  assert.equal(resolveQaDockerBinary(environment, fs), system);
  assert.deepEqual(fs.visited, [perUser, system]);
});

test("QA Docker resolution skips relative, remote, variable-expanded and malformed paths", () => {
  const malformed = [".", "relative", "C:relative", "\\root-relative", "\\\\server\\share", "%TOOLS%", "C:\\bad\npath", "C:\\bad|path", '"C:\\unbalanced', "C:\\other:stream"];
  const fs = filesystem([system]);
  assert.equal(resolveQaDockerBinary({ Path: malformed.join(";"), LOCALAPPDATA: "relative", ProgramFiles: "C:\\Program Files" }, fs), system);
  assert.deepEqual(fs.visited, [system]);
  for (const invalid of [undefined, null, 12, "", ...malformed]) {
    const missing = filesystem([]);
    assert.throws(() => resolveQaDockerBinary({ PATH: invalid, LOCALAPPDATA: invalid, ProgramFiles: invalid }, missing), { message: "Local Docker CLI not found." });
  }
});

test("QA Docker resolution ignores executable overrides and never returns unsupported or nonexistent files", () => {
  const arbitrary = "C:\\Custom\\tool.exe";
  const candidate = "C:\\Custom\\docker.exe";
  assert.throws(() => resolveQaDockerBinary({ DOCKER_EXE: arbitrary }, filesystem([arbitrary])), { message: "Local Docker CLI not found." });
  assert.throws(() => resolveQaDockerBinary({ PATH: "C:\\Custom" }, filesystem([arbitrary], { aliases: { [candidate]: arbitrary } })), { message: "Local Docker CLI not found." });
  const fs = filesystem([]);
  assert.throws(() => resolveQaDockerBinary(environment, fs), (error) => {
    assert.equal(error.message, "Local Docker CLI not found.");
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(error.stack, /private-path-and-error|Student|DockerDesktop/);
    return true;
  });
});

test("QA Docker resolution handles case-insensitive Windows environment names", () => {
  assert.equal(resolveQaDockerBinary({ localappdata: environment.LOCALAPPDATA }, filesystem([perUser])), perUser);
});

test("non-Windows QA keeps normal docker command resolution without filesystem access", () => {
  for (const platform of ["linux", "darwin"]) {
    assert.equal(resolveQaDockerBinary(environment, {
      platform,
      stat() { throw new Error("must not inspect files"); },
      realpath() { throw new Error("must not inspect files"); },
    }), "docker");
  }
});
