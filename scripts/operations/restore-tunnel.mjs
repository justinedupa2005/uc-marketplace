import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { assertDrillContainer } from "./drill-producer.mjs";
import { controlledEnvironment } from "./process.mjs";

// Docker does not publish ports for internal-only networks. Relay PostgreSQL
// bytes through the local Docker exec API instead; the database has no published
// port or outbound route. The pinned PostgreSQL image already includes Bash.
const relay = 'exec 3<>/dev/tcp/127.0.0.1/5432; cat <&3 & reader=$!; trap \'kill "$reader" 2>/dev/null || true\' EXIT; cat >&3';

export async function openRestoreTunnel(env) {
  await assertDrillContainer(env);
  const childEnv = Object.fromEntries(Object.entries(controlledEnvironment(env)).filter(([key]) => !/^(OPS_|AWS_|RESTIC_|POSTGRES_)/.test(key)));
  const sockets = new Set(), children = new Set();
  let closing = false;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
    void (async () => {
      // Recheck ownership before every relay, including startup retries.
      await assertDrillContainer(env);
      if (closing || socket.destroyed) { socket.destroy(); return; }
      const child = spawn("docker", ["exec", "--interactive", env.OPS_DRILL_CONTAINER, "bash", "--noprofile", "--norc", "-ec", relay], {
        env: childEnv, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
      children.add(child);
      child.stderr.resume(); // Never expose PostgreSQL/proxy diagnostics.
      child.once("error", () => socket.destroy());
      child.once("close", () => { children.delete(child); socket.destroy(); });
      child.stdin.on("error", () => socket.destroy());
      child.stdout.on("error", () => socket.destroy());
      socket.once("close", () => { child.stdin.destroy(); child.kill(); });
      socket.pipe(child.stdin);
      child.stdout.pipe(socket);
    })().catch(() => socket.destroy());
  });
  server.maxConnections = 4;
  const close = async () => {
    closing = true;
    for (const socket of sockets) socket.destroy();
    for (const child of children) { child.stdin.destroy(); child.kill(); }
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  };
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
    });
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    assert.ok(Number.isSafeInteger(address.port) && address.port > 0);
    return { host: "127.0.0.1", port: address.port, close };
  } catch {
    await close();
    throw Object.assign(new Error("Isolated restore relay could not start."), { operationCodes: ["RESTORE_TUNNEL_FAILED"] });
  }
}
