import { cpSync, existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const source = resolve(".next/standalone");
const output = resolve(process.argv[2] || "src-tauri/runtime/app");
if (existsSync(output)) throw new Error("Use a fresh desktop resource directory.");
if (!existsSync(join(source, "server.js"))) throw new Error("Build the production Next.js app first.");

const copy = (from, to) => cpSync(from, to, { recursive: true, dereference: true });
mkdirSync(output, { recursive: true });
for (const entry of [".next", "node_modules", "package.json"]) {
  copy(join(source, entry), join(output, entry));
}
for (const [from, to] of [
  [".next/static", ".next/static"],
  ["public", "public"],
  ["library/official.json", "library/official.json"],
  ["library/playbooks.json", "library/playbooks.json"],
  ["desktop/server.cjs", "desktop-server.cjs"],
]) {
  mkdirSync(join(output, to, ".."), { recursive: true });
  copy(from, join(output, to));
}

// The CLI loads its platform binary and SQLite loads its addon at runtime.
for (const name of [
  "@openai/codex",
  `@openai/codex-${process.platform}-${process.arch}`,
  "better-sqlite3",
]) copy(join("node_modules", name), join(output, "node_modules", name));

await build({
  entryPoints: ["worker/instance-lock.ts"],
  outfile: join(output, "desktop-lock.cjs"),
  bundle: true,
  external: ["better-sqlite3"],
  platform: "node",
  format: "cjs",
  logLevel: "warning",
});

if (process.platform === "win32") {
  if (process.arch !== "x64") throw new Error("This installer is built for Windows x64.");
  const executable = realpathSync(process.execPath);
  if (!statSync(executable).isFile()) throw new Error("Node runtime is unavailable.");
  mkdirSync(join(output, ".."), { recursive: true });
  copy(executable, join(output, "..", "node.exe"));
}
