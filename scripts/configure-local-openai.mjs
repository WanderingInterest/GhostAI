import { readFile, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = process.argv[2];
if (!source)
  throw new Error(
    "Pass a local file containing only your OpenAI API key. The key will not be printed.",
  );
const key = (await readFile(source, "utf8")).trim();
if (!/^sk-[A-Za-z0-9_-]{20,1024}$/.test(key))
  throw new Error("The file must contain only an OpenAI API key.");
const target = fileURLToPath(
  new URL("../functions/.env.local", import.meta.url),
);
let existing = "";
try {
  existing = await readFile(target, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const lines = existing
  .split("\n")
  .filter((line) => !/^GHOSTAI_LOCAL_OPENAI_KEY=/.test(line));
await writeFile(
  target,
  `${lines.filter(Boolean).join("\n")}\nGHOSTAI_LOCAL_OPENAI_KEY=${key}\n`,
  { mode: 0o600 },
);
await chmod(target, 0o600);
console.log(
  "Local assistant key configured. It is restricted to the seeded emulator company and excluded from deployment.",
);
