import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
const dir = mkdtempSync(resolve(tmpdir(), "forge-runtime-audit-"));
process.env.FORGE_DATA_DIR = dir;
process.env.CODEX_APP_SERVER_COMMAND = process.execPath;
process.env.CODEX_APP_SERVER_ARGS = JSON.stringify([
  resolve("tests/codex-fixture.mjs"),
]);
const calls = (value: any[]) =>
  `FIXTURE_CALLS_B64:${Buffer.from(JSON.stringify(value)).toString("base64")}`;
const store = await import("../worker/store");
const runtime = await import("../worker/runtime");
const { codex } = await import("../worker/codex");
const { featureAction } = await import("../worker/features");
async function idle() {
  const start = Date.now();
  while (runtime.active.size && Date.now() - start < 5000)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(runtime.active.size).toBe(0);
}
async function started(n: number) {
  const start = Date.now();
  while (runtime.active.size < n && Date.now() - start < 5000)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(runtime.active.size).toBe(n);
}
function run(agent = "Architect", instructions = "FIXTURE_HOLD Inspect") {
  const id = randomUUID();
  store.db
    .prepare("INSERT INTO runs(id,request,studio_id) VALUES (?,?,?)")
    .run(id, "Audit planning", "test-studio");
  return store.addTask(id, agent, "Inspect", instructions);
}
beforeAll(async () => {
  store.set("codexProjectRoot", dir);
  store.set("codexAutoApprove", true);
  await codex.ensureStarted();
  await codex.loginApiKey("sk-fixture-codex-key-1234567890");
});
beforeEach(async () => {
  runtime.abortAll();
  await idle();
  for (const table of [
    "codex_events",
    "codex_turns",
    "codex_sessions",
    "approvals",
    "attention_requests",
    "agent_messages",
    "tool_calls",
    "memories",
    "tasks",
    "runs",
    "usage",
  ])
    store.db.prepare(`DELETE FROM ${table}`).run();
  store.set("paused", false);
  store.set("concurrency", 3);
  store.set("taskTimeoutMs", 10000);
  store.set("maxTasksPerRun", 50);
});
afterAll(async () => {
  runtime.abortAll();
  await idle();
  codex.shutdown();
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});

it("runs up to three independent agents and never two tasks for the same agent", async () => {
  const ids = [
    run("Architect"),
    run("Architect"),
    run("Builder"),
    run("Frame"),
    run("Balance"),
  ];
  await runtime.tick();
  await started(3);
  expect(runtime.active.size).toBe(3);
  expect(
    [...runtime.active].filter((id) => store.task(id).agent === "Architect"),
  ).toHaveLength(1);
  for (const id of [...runtime.active]) {
    featureAction("tasks/control", { id, action: "cancel" }, runtime.active);
    codex.interruptForTask(id);
  }
  runtime.interruptStopped();
  await idle();
  expect(store.task(ids[1]).status).toBe("queued");
  expect(store.task(ids[4]).status).toBe("queued");
});

it("enforces configurable lower concurrency", async () => {
  store.set("concurrency", 1);
  run("Architect");
  run("Builder");
  await runtime.tick();
  await started(1);
  expect(runtime.active.size).toBe(1);
  for (const id of [...runtime.active]) {
    featureAction("tasks/control", { id, action: "cancel" }, runtime.active);
    codex.interruptForTask(id);
  }
  runtime.interruptStopped();
  await idle();
});

it("aborts cancelled Codex turns, clears pending approvals and preserves done evidence", async () => {
  const id = run();
  store.db
    .prepare(
      "INSERT INTO tool_calls(id,task_id,tool,status,result) VALUES (?,?,'script_read','done','confirmed')",
    )
    .run("read", id);
  store.db
    .prepare(
      "INSERT INTO approvals(id,task_id,call_id,tool,args) VALUES (?,?,'c','multi_edit','{}')",
    )
    .run("approval", id);
  await runtime.tick();
  await started(1);
  featureAction("tasks/control", { id, action: "cancel" }, runtime.active);
  runtime.interruptStopped();
  await idle();
  expect(store.task(id).status).toBe("cancelled");
  expect(
    store.db.prepare("SELECT status FROM approvals WHERE id='approval'").get(),
  ).toEqual({ status: "cancelled" });
  expect(
    store.db.prepare("SELECT status FROM tool_calls WHERE id='read'").get(),
  ).toEqual({ status: "done" });
});

it("times out a stalled Codex turn and reports failure without a retry loop", async () => {
  store.set("taskTimeoutMs", 50);
  const id = run();
  await runtime.tick();
  await idle();
  expect(store.task(id)).toMatchObject({ status: "failed", attempts: 1 });
  expect(store.task(id).error).toMatch(/timed out|interrupted/i);
});

it("does not automatically replay a failed Codex turn", async () => {
  const id = run("Builder", "FIXTURE_FAIL Inspect");
  await runtime.tick();
  await idle();
  expect(store.task(id).status).toBe("failed");
  expect(store.task(id).attempts).toBe(1);
  await runtime.tick();
  await idle();
  expect(store.task(id).attempts).toBe(1);
});

it("deduplicates repeated delegation calls while recording both dynamic tool calls", async () => {
  const id = run(
    "Lead",
    `${calls([
      {
        tool: "delegate",
        arguments: {
          agent: "Architect",
          title: "Inspect architecture",
          instructions: "Inspect the project structure",
          dependencies: [],
          acceptance: "Relevant paths identified",
        },
      },
      {
        tool: "delegate",
        arguments: {
          agent: "Architect",
          title: "Inspect architecture",
          instructions: "Inspect the project structure",
          dependencies: [],
          acceptance: "Relevant paths identified",
        },
      },
    ])} Plan and delegate.`,
  );
  await runtime.tick();
  await idle();
  const t = store.task(id);
  expect(
    store.db
      .prepare(
        "SELECT count(*) AS n FROM tasks WHERE run_id=? AND agent='Architect'",
      )
      .get(t.run_id),
  ).toEqual({ n: 1 });
  expect(
    (
      store.db
        .prepare(
          "SELECT count(*) AS n FROM tool_calls WHERE task_id=? AND tool='delegate' AND status='done'",
        )
        .get(id) as any
    ).n,
  ).toBe(2);
  const child: any = store.db
    .prepare("SELECT * FROM tasks WHERE run_id=? AND agent='Architect'")
    .get(t.run_id);
  expect(child.parent_task_id).toBe(id);
  expect(child.acceptance).toBe("Relevant paths identified");
});

it("blocks orphan tasks, cross-run dependencies and unbounded delegation", () => {
  const id = run();
  const t = store.task(id);
  expect(() => store.addTask("missing", "Builder", "x", "x")).toThrow(
    "does not exist",
  );
  const other = run("Builder");
  expect(() => store.addTask(t.run_id, "Frame", "x", "x", [other])).toThrow(
    "same run",
  );
  store.set("maxTasksPerRun", 1);
  expect(() => store.addTask(t.run_id, "Frame", "x", "x")).toThrow(
    "task limit",
  );
});

it("marks interrupted Codex turns failed on restart and preserves cancellation", async () => {
  const id = run();
  store.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(id);
  store.db
    .prepare(
      "INSERT INTO tool_calls(id,task_id,tool,status) VALUES (?,?,'multi_edit','running')",
    )
    .run("write", id);
  const cancelled = run("Builder");
  store.db
    .prepare(
      "UPDATE tasks SET status='running',stop_requested='cancel' WHERE id=?",
    )
    .run(cancelled);
  runtime.recover();
  expect(store.task(id).status).toBe("failed");
  expect(store.task(id).error).toMatch(/Codex turn/i);
  expect(store.task(cancelled).status).toBe("cancelled");
  await runtime.tick();
  await idle();
  expect(runtime.active.size).toBe(0);
});

it("persists new configuration through repeatable migrations and an independent SQLite connection", async () => {
  const { migrateFeatures } = await import("../worker/migrations");
  store.db
    .prepare(
      "UPDATE agents SET parameters=?,provider_options=?,spending_limit=1.25 WHERE name='Architect'",
    )
    .run('{"top_p":0.8}', '{"allow_fallbacks":false}');
  migrateFeatures(store.db);
  migrateFeatures(store.db);
  const second = new Database(resolve(dir, "forge.sqlite"), { readonly: true });
  try {
    expect(
      second
        .prepare(
          "SELECT parameters,spending_limit FROM agents WHERE name='Architect'",
        )
        .get(),
    ).toEqual({ parameters: '{"top_p":0.8}', spending_limit: 1.25 });
  } finally {
    second.close();
  }
});

it("rejects a second worker before it can touch SQLite or recover another worker queue", async () => {
  const { existsSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const locked = mkdtempSync(resolve(tmpdir(), "forge-lock-audit-"));
  const previous = process.env.FORGE_DATA_DIR;
  let release: undefined | (() => void);
  try {
    process.env.FORGE_DATA_DIR = locked;
    release = (await import("../worker/instance-lock")).releaseWorkerLock;
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "worker/instance-lock.ts"],
      {
        env: { ...process.env, FORGE_DATA_DIR: locked },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain("Another Syntra worker");
    expect(existsSync(resolve(locked, "forge.sqlite"))).toBe(false);
  } finally {
    release?.();
    process.env.FORGE_DATA_DIR = previous;
    rmSync(locked, { recursive: true, force: true });
  }
});
