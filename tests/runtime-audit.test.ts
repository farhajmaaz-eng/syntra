import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
const dir = mkdtempSync(resolve(tmpdir(), "syntra-runtime-audit-"));
process.env.SYNTRA_DATA_DIR = dir;
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
  if (!codex.status().running) {
    await codex.ensureStarted();
    await codex.loginApiKey("sk-fixture-codex-key-1234567890");
  }
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
  const second = new Database(resolve(dir, "syntra.sqlite"), { readonly: true });
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
  const locked = mkdtempSync(resolve(tmpdir(), "syntra-lock-audit-"));
  const previous = process.env.SYNTRA_DATA_DIR;
  let release: undefined | (() => void);
  try {
    process.env.SYNTRA_DATA_DIR = locked;
    release = (await import("../worker/instance-lock")).releaseWorkerLock;
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "worker/instance-lock.ts"],
      {
        env: { ...process.env, SYNTRA_DATA_DIR: locked },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain("Another Syntra worker");
    expect(existsSync(resolve(locked, "syntra.sqlite"))).toBe(false);
  } finally {
    release?.();
    process.env.SYNTRA_DATA_DIR = previous;
    rmSync(locked, { recursive: true, force: true });
  }
});

it("completes a direct Lead answer and sends it to review without adding a Tester", async () => {
  const lead = run("Lead", "Explain a Roblox concept without implementation");
  const runId = store.task(lead).run_id;
  store.db.prepare("UPDATE runs SET plan_status='pending' WHERE id=?").run(runId);
  await runtime.tick();
  await idle();
  expect(store.task(lead).status).toBe("completed");
  await runtime.tick();
  expect(store.db.prepare("SELECT status,plan_status FROM runs WHERE id=?").get(runId))
    .toEqual({ status: "review", plan_status: "automatic" });
  expect(store.db.prepare("SELECT agent FROM tasks WHERE run_id=?").all(runId)).toEqual([{ agent: "Lead" }]);
});

it("holds new work during a team pause and keeps an unrelated Lead running during a task stop", async () => {
  const lead = run("Lead");
  const builder = run("Builder");
  await runtime.tick();
  await started(2);
  const frame = run("Frame");
  store.set("paused", true);
  featureAction("tasks/control", { id: builder, action: "pause" }, runtime.active);
  runtime.interruptStopped();
  await runtime.tick();
  for (let i = 0; i < 100 && runtime.active.has(builder); i++) await new Promise(resolve => setTimeout(resolve, 20));
  expect(store.task(builder)).toMatchObject({ status: "paused", attempts: 0 });
  expect(runtime.active.has(lead)).toBe(true);
  expect(store.task(frame).status).toBe("queued");
  store.set("paused", false);
  featureAction("tasks/control", { id: builder, action: "resume" }, runtime.active);
  await runtime.tick();
  await started(3);
  expect(runtime.active.has(builder)).toBe(true);
  expect(runtime.active.has(frame)).toBe(true);
});

it("honors rapid pause then resume without leaving a stopped task stranded", async () => {
  const id = run("Builder");
  await runtime.tick();
  await started(1);
  featureAction("tasks/control", { id, action: "pause" }, runtime.active);
  runtime.interruptStopped();
  featureAction("tasks/control", { id, action: "resume" }, runtime.active);
  await idle();
  expect(store.task(id)).toMatchObject({ status: "queued", attempts: 0, stop_requested: null });
});

it("resuming a run keeps individually paused tasks paused and does not spend attempts", async () => {
  const id = run("Builder");
  const runId = store.task(id).run_id;
  const manual = store.addTask(runId, "Frame", "Manually paused", "Leave paused");
  featureAction("tasks/control", { id: manual, action: "pause" }, runtime.active);
  await runtime.tick();
  await started(1);
  featureAction("runs/control", { id: runId, action: "pause" }, runtime.active);
  runtime.interruptStopped();
  await idle();
  expect(store.task(id)).toMatchObject({ status: "queued", attempts: 0 });
  featureAction("runs/control", { id: runId, action: "resume" }, runtime.active);
  expect(store.task(manual).status).toBe("paused");
  await runtime.tick();
  await started(1);
  expect(runtime.active.has(id)).toBe(true);
});

it("retries a confirmed transient failure before work and does not replay after recorded work", async () => {
  const clean = run("Architect", "FIXTURE_TRANSIENT");
  const prior = run("Builder", "FIXTURE_TRANSIENT");
  store.db.prepare("INSERT INTO tool_calls(id,task_id,tool,args,status) VALUES ('prior',?,'save_artifact','{}','done')").run(prior);
  await runtime.tick();
  await idle();
  expect(store.task(clean)).toMatchObject({ status: "queued", attempts: 1 });
  expect(store.task(prior)).toMatchObject({ status: "failed", attempts: 1 });
  store.db.prepare("UPDATE tasks SET next_at=0 WHERE id=?").run(clean);
  await runtime.tick();
  await idle();
  expect(store.task(clean).status).toBe("completed");
});

it("does not apply task execution timeouts to a pending human question", async () => {
  store.set("taskTimeoutMs", 1000);
  const id = run("Architect", calls([{ tool: "ask_human", arguments: { question: "Which branch should we keep?" } }]));
  await runtime.tick();
  let request: { id: string } | undefined;
  for (let i = 0; i < 75 && !request; i++) {
    request = store.db.prepare("SELECT id FROM attention_requests WHERE task_id=?").get(id) as { id: string } | undefined;
    if (!request) await new Promise(resolve => setTimeout(resolve, 20));
  }
  expect(request).toBeDefined();
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect(runtime.active.has(id)).toBe(true);
  expect(store.task(id).status).toBe("blocked");
  featureAction("attention/reply", { id: request!.id, reply: "Keep main" }, runtime.active);
  expect(store.task(id).status).toBe("running");
  await idle();
  expect(store.task(id).status).toBe("completed");
}, 10000);

it("recovers orphaned questions and honors a paused approval during a restart", () => {
  const orphan = run("Architect");
  const paused = run("Frame");
  store.db.prepare("UPDATE tasks SET status='blocked' WHERE id=?").run(orphan);
  store.db.prepare("UPDATE tasks SET status='approval',stop_requested='pause' WHERE id=?").run(paused);
  store.db.prepare("INSERT INTO attention_requests(id,task_id,call_id,question,priority) VALUES ('orphan',?,'ask','Waiting?',1)").run(orphan);
  runtime.recover();
  expect(store.task(orphan).status).toBe("failed");
  expect(store.task(paused)).toMatchObject({ status: "paused", stop_requested: null });
  expect(store.db.prepare("SELECT status FROM attention_requests WHERE id='orphan'").get()).toEqual({ status: "cancelled" });
});


it("preserves transcripts and dependency state on manual retry", async () => {
  const dependency = run("Architect");
  const runId = store.task(dependency).run_id;
  const dependant = store.addTask(runId, "Builder", "Wait for successful work", "Wait", [dependency]);
  store.db.prepare("UPDATE tasks SET status='failed',steps=4,attempts=2 WHERE id=?").run(dependency);
  store.db.prepare("UPDATE tasks SET status='blocked',error='A dependency failed; retry it first.' WHERE id=?").run(dependant);
  const { action } = await import("../worker/service");
  await action("retry", { id: dependency });
  expect(store.task(dependency)).toMatchObject({ status: "queued", steps: 4, attempts: 0 });
  expect(store.task(dependant).status).toBe("blocked");
});

it("keeps validation for a Lead turn with neither an answer nor delegated work", async () => {
  const id = run("Lead", "FIXTURE_EMPTY");
  await runtime.tick();
  await idle();
  expect(store.task(id)).toMatchObject({ status: "failed" });
  expect(store.task(id).error).toContain("without an answer or delegated work");
});

it("keeps Codex approval waits in sync with the task status", async () => {
  store.set("codexAutoApprove", false);
  const id = run("Architect", "FIXTURE_APPROVAL");
  try {
    await runtime.tick();
    let approval: { id: string } | undefined;
    for (let i = 0; i < 100 && !approval; i++) {
      approval = store.db.prepare("SELECT id FROM approvals WHERE task_id=? AND provider='codex' AND status='pending'").get(id) as
        { id: string } | undefined;
      if (!approval) await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(approval).toBeDefined();
    expect(store.task(id).status).toBe("approval");
    const { decideApproval } = await import("../worker/features");
    decideApproval({ id: approval!.id, approved: true, note: "Proceed" });
    await idle();
    expect(store.task(id).status).toBe("completed");
  } finally {
    store.set("codexAutoApprove", true);
  }
});

it("cannot complete a task while a tool outcome remains uncertain", async () => {
  const id = run("Builder", "Inspect finished work");
  store.db.prepare("INSERT INTO tool_calls(id,task_id,tool,args,status) VALUES ('unknown-outcome',?,'execute_luau','{}','uncertain')").run(id);
  await runtime.tick();
  await idle();
  expect(store.task(id).status).toBe("failed");
  expect(store.task(id).error).toContain("tool outcome is still unresolved");
});

it("upgrades shipped Lead instructions while preserving a custom prompt", () => {
  const original = "Own the request. Inspect the active game, clarify requirements in your deliverable, and delegate concrete, dependency-ordered tasks using delegate. Do not implement changes yourself. Delegate a final Tester task depending on every implementation task. Each task needs measurable acceptance criteria. Summarize the plan and risks.";
  store.db.prepare("UPDATE agents SET prompt=? WHERE name='Lead'").run(original);
  store.migrateLeadPrompt();
  const read = () => store.db.prepare("SELECT prompt FROM agents WHERE name='Lead'").get() as { prompt: string };
  const upgraded = read().prompt;
  expect(upgraded).toContain("Answer directly");
  store.db.prepare("UPDATE agents SET prompt='Custom project instructions' WHERE name='Lead'").run();
  store.migrateLeadPrompt();
  expect(read().prompt).toBe("Custom project instructions");
  store.db.prepare("UPDATE agents SET prompt=? WHERE name='Lead'").run(upgraded);
});
