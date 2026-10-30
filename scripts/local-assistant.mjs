import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const children = new Set();
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
function start(args, env = {}) {
  const child = spawn("npm", args, {
    cwd: root,
    stdio: "inherit",
    detached: true,
    env: { ...process.env, ...env },
  });
  children.add(child);
  child.on("exit", (code) => {
    children.delete(child);
    if (!stopping && code) stop(code);
  });
  child.on("error", () => stop(1));
  return child;
}
async function waitFor(url, expected) {
  const limit = Date.now() + 90000;
  while (Date.now() < limit && !stopping) {
    try {
      const response = await fetch(url);
      if (response.status === expected) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    "Local services did not become ready. Check whether emulator ports are already in use.",
  );
}
try {
  // Do not accidentally seed or connect the browser to a different running stack.
  for (const url of [
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5001",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:9099",
  ]) {
    let occupied = false;
    try {
      await fetch(url, { signal: AbortSignal.timeout(1500) });
      occupied = true;
    } catch {}
    if (occupied)
      throw new Error(
        "A local app or emulator is already running. Stop it before running demo:assistant.",
      );
  }
  start(["run", "emulators"], {
    JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS || "-Xmx512m",
  });
  await waitFor("http://127.0.0.1:5001/demo-ghostai/us-central1/api/me", 401);
  const seed = start(["run", "seed"]);
  await new Promise((resolve, reject) =>
    seed.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Demo seed failed.")),
    ),
  );
  if (!stopping) start(["run", "dev:emulator"]);
} catch (error) {
  console.error(error.message);
  stop(1);
}
