import { realpathSync, statSync } from "node:fs";
import path from "node:path";

const failureMessage = "Local Docker CLI not found.";

function windowsEnvironmentValue(environment, name) {
  if (!environment || typeof environment !== "object") return undefined;
  const key = Object.keys(environment).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  const value = key === undefined ? undefined : environment[key];
  return typeof value === "string" ? value : undefined;
}

function localAbsolutePath(value) {
  return typeof value === "string"
    && /^[A-Za-z]:[\\/]/.test(value)
    && !/[<>"|?*%]/.test(value)
    && ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    && !value.slice(2).includes(":");
}

function pathDirectory(value) {
  const trimmed = value.trim();
  const directory = trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1) : trimmed;
  return localAbsolutePath(directory) ? directory : null;
}

/** Resolve a local Docker CLI without changing PATH or accepting executable overrides. */
export function resolveQaDockerBinary(environment = process.env, {
  platform = process.platform,
  stat = statSync,
  realpath = realpathSync,
} = {}) {
  if (platform !== "win32") return "docker";

  const directories = [];
  const searchPath = windowsEnvironmentValue(environment, "PATH");
  for (const entry of searchPath?.split(";") ?? []) {
    const directory = pathDirectory(entry);
    if (directory) directories.push(directory);
  }
  for (const [variable, suffix] of [
    ["LOCALAPPDATA", ["Programs", "DockerDesktop", "resources", "bin"]],
    ["ProgramFiles", ["Docker", "Docker", "resources", "bin"]],
  ]) {
    const base = windowsEnvironmentValue(environment, variable);
    if (localAbsolutePath(base)) directories.push(path.win32.join(base, ...suffix));
  }

  for (const directory of directories) {
    const candidate = path.win32.join(directory, "docker.exe");
    try {
      const canonical = realpath(candidate);
      if (localAbsolutePath(canonical)
        && path.win32.basename(canonical).toLowerCase() === "docker.exe"
        && stat(canonical).isFile()) return canonical;
    } catch {
      // A missing/inaccessible candidate must not expose private paths or errors.
    }
  }
  throw new Error(failureMessage);
}
