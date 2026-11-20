import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";

const app = resolve(process.argv[2] || "src-tauri/runtime/app");
const executable = process.platform === "win32" ? resolve(app, "../node.exe") : process.execPath;
const data = mkdtempSync(join(tmpdir(), "syntra-desktop-smoke-"));
const require = createRequire(join(app, "desktop-server.cjs"));
const key = "desktop-smoke-illustrate-key";
let running;

async function launch() {
  const child = spawn(executable, [join(app, "desktop-server.cjs")], {
    cwd: app,
    env: { ...process.env, SYNTRA_DATA_DIR: data, SYNTRA_ILLUSTRATE_MCP_KEY: key },
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  const exit = once(child, "exit");
  running = { child, exit };
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise((done) => lines.on("line", (line) => {
    const match = /^SYNTRA_READY (\d+) ([a-f0-9]{64})$/.exec(line);
    if (match) done(match);
    else console.log(line);
  }));
  child.stdin.write("start\n");
  const [, port, token] = await Promise.race([
    ready,
    exit.then(([code]) => { throw new Error(`Desktop server exited early with ${code}`); }),
    timeout(45_000, "Desktop server startup timed out"),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(origin + "/api/snapshot")).status, 403);
  const bootstrap = await fetch(origin + "/__syntra_desktop/" + token, { redirect: "manual" });
  assert.equal(bootstrap.status, 303);
  assert.equal(bootstrap.headers.get("location"), "/");
  const cookie = bootstrap.headers.get("set-cookie").split(";")[0];
  const request = (path, options = {}) => fetch(origin + path, {
    ...options,
    headers: { Cookie: cookie, ...options.headers },
    signal: AbortSignal.timeout(35_000),
  });
  return { request, port, origin };
}

function timeout(ms, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref();
  });
}

async function close() {
  if (!running) return;
  const { child, exit } = running;
  child.stdin.end();
  try {
    const [code] = await Promise.race([exit, timeout(20_000, "Graceful shutdown timed out")]);
    assert.equal(code, 0);
    assert.equal(existsSync(join(data, "worker.pid")), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    running = undefined;
  }
}

try {
  const { request, origin, port } = await launch();
  assert.equal((await request("/api/snapshot", { headers: { Origin: "https://other.example" } })).status, 403);
  const health = await request("/api/health").then(res => res.json());
  assert.equal(health.mode, "embedded");
  const home = await request("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Syntra/);
  assert.equal((await request("/illustrate")).status, 200);
  const wasmBytes = await request("/wasm/rblx_mesh_wasm.wasm").then(res => res.arrayBuffer());
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(wasmBytes));
  assert(exports.some(entry => entry.name === "wasm_build_render_buffers"));
  const library = await request("/api/library?stats=true");
  assert.equal(library.status, 200);
  const post = (path, body) => request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
  const codex = await post("/api/codex/status", {}).then(res => res.json());
  assert.equal(codex.ok, true, codex.error);
  assert.equal(codex.status.running, true);
  const settings = await post("/api/settings", { concurrency: 8 });
  assert.equal(settings.status, 200, await settings.text());
  const project = await post("/api/games", { name: "Desktop smoke project" });
  assert.equal(project.status, 200, await project.text());
  const Database = require("better-sqlite3");
  const db = new Database(join(data, "syntra.sqlite"), { readonly: true, fileMustExist: true });
  assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
  db.close();
  await close();

  const reopened = await launch();
  assert.equal(reopened.port, port);
  const saved = await reopened.request("/api/snapshot").then(res => res.json());
  assert.equal(saved.settings.concurrency, 8);
  assert(saved.games.some(game => game.name === "Desktop smoke project"));
  await close();
  console.log("Desktop runtime, backend permissions, production UI, WASM, Codex, and SQLite persistence passed.");
} finally {
  if (running) {
    running.child.stdin.end();
    await Promise.race([running.exit, timeout(20_000, "Desktop cleanup timed out")]).catch(() => running.child.kill());
  }
  rmSync(data, { recursive: true, force: true });
}
