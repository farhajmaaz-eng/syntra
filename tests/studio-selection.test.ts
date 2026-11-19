import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import Database from "better-sqlite3";
const dir = mkdtempSync(resolve(tmpdir(), "forge-selection-"));
process.env.FORGE_DATA_DIR = dir;
process.env.CODEX_APP_SERVER_COMMAND = process.execPath;
process.env.CODEX_APP_SERVER_ARGS = JSON.stringify([
  resolve("tests/codex-fixture.mjs"),
]);
const calls = (value: any[]) =>
  `FIXTURE_CALLS_B64:${Buffer.from(JSON.stringify(value)).toString("base64")}`;
const store = await import("../worker/store");
const { db, set, get, task } = store;
const { previewStudioSwitch, confirmStudioSwitch } =
  await import("../worker/studio-selection");
const { previewWorkspaceReset, confirmWorkspaceReset } =
  await import("../worker/workspace-reset");
const { studio, studioInstances, modelToolSchema } =
  await import("../worker/mcp");
const runtime = await import("../worker/runtime");
const { codex } = await import("../worker/codex");
const oldId = "f6a42404-67b3-4ade-b58b-c6b30f3e2753",
  newId = "6465ed97-8651-49fb-8de5-853936ddf645";
let available: any[];
const discover = async () => ({ instances: available });
const selection = { gameId: "game", oldStudioId: oldId, newStudioId: newId };
const nativeCall = (id: string, name: string, args: any) => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
async function idle() {
  await vi.waitFor(() => expect(runtime.active.size).toBe(0), {
    interval: 5,
    timeout: 2500,
  });
}
async function preview() {
  return previewStudioSwitch(selection, new Set(), discover);
}
async function confirm(p: any, extra: any = {}) {
  return confirmStudioSwitch(
    {
      token: p.token,
      confirmationName: "My Game",
      sameGameConfirmed: true,
      ...extra,
    },
    new Set(),
    discover,
  );
}
beforeEach(async () => {
  runtime.abortAll();
  await idle();
  studio.client = null;
  studio.tools = [];
  for (const table of [
    "codex_events",
    "codex_turns",
    "codex_sessions",
    "pitch_versions",
    "assets",
    "telemetry_snapshots",
    "pitches",
    "attention_requests",
    "agent_messages",
    "approvals",
    "tool_calls",
    "memories",
    "chat",
    "tasks",
    "runs",
    "games",
    "usage",
    "locks",
    "studio_inspections",
    "studio_revisions",
    "studio_pin_changes",
  ])
    db.exec(`DELETE FROM ${table}`);
  set("paused", true);
  set("maxTasksPerRun", 50);
  set("studioKnownInstances", {
    [oldId]: { id: oldId, name: "My Game", placeId: "123", universeId: "456" },
  });
  set("studioTools", []);
  db.prepare(
    "INSERT INTO games(id,name,studio_id,place_id,universe_id) VALUES ('game','My Game',?,'123','456')",
  ).run(oldId);
  db.prepare(
    "INSERT INTO runs(id,request,game_id,studio_id) VALUES ('run','Repair script','game',?)",
  ).run(oldId);
  const messages = [
    {
      role: "user",
      content: JSON.stringify({ request: "Repair script", studio_id: oldId }),
    },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        nativeCall("pending-write", "multi_edit", {
          studio_id: oldId,
          path: "Main",
          source: "never replay this",
        }),
      ],
    },
  ];
  db.prepare(
    "INSERT INTO tasks(id,run_id,agent,title,instructions,status,messages) VALUES ('task','run','Builder','Queued repair','Inspect the game and repair the script','approval',?)",
  ).run(JSON.stringify(messages));
  db.prepare(
    "INSERT INTO approvals(id,task_id,call_id,tool,args,status) VALUES ('approval','task','pending-write','multi_edit',?,'approved')",
  ).run(JSON.stringify({ studio_id: oldId, source: "never replay this" }));
  available = [
    { id: newId, name: "My reopened game", placeId: "123", universeId: "456" },
  ];
});
beforeAll(async () => {
  set("codexProjectRoot", dir);
  set("codexAutoApprove", true);
  await codex.ensureStarted();
  await codex.loginApiKey("sk-fixture-codex-key-1234567890");
});
afterAll(async () => {
  runtime.abortAll();
  await idle();
  codex.shutdown();
  studio.client = null;
  studio.tools = [];
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
it("normalizes structured/text discovery and removes model authority over studio_id", () => {
  expect(
    studioInstances({
      structuredContent: {
        studios: [{ id: newId, name: null, place_id: 123 }],
      },
    }),
  ).toEqual([
    { id: newId, name: "Unnamed Studio", placeId: "123", universeId: "" },
  ]);
  expect(
    studioInstances({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            connected_studios: [
              { studio_id: newId, name: "Game", placeId: 123 },
            ],
          }),
        },
      ],
    }),
  ).toHaveLength(1);
  expect(
    studioInstances({
      content: [{ type: "text", text: "not a valid discovery response" }],
    }),
  ).toBeNull();
  const schema = {
    type: "object",
    properties: { studio_id: { type: "string" }, path: { type: "string" } },
    required: ["studio_id", "path"],
  };
  expect(modelToolSchema(schema)).toEqual({
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  });
  expect(schema.required).toContain("studio_id");
});
it("previews without changing pins, requires confirmation and consumes the preview once", async () => {
  const p = await preview();
  expect(
    (db.prepare("SELECT studio_id FROM runs WHERE id='run'").get() as any)
      .studio_id,
  ).toBe(oldId);
  await expect(confirm(p, { sameGameConfirmed: false })).rejects.toThrow();
  await expect(
    confirm(p, { confirmationName: "Another game" }),
  ).rejects.toThrow("exact project name");
  await confirm(p);
  expect(
    db
      .prepare("SELECT studio_id,studio_pin_revision FROM runs WHERE id='run'")
      .get() as any,
  ).toEqual({ studio_id: newId, studio_pin_revision: 1 });
  await expect(confirm(p)).rejects.toThrow("expired");
  expect(get("paused")).toBe(true);
});
it("cancels old pending calls and approvals, updates queued context and preserves completed evidence", async () => {
  const done = JSON.stringify({ confirmed: true, studio_id: oldId });
  db.prepare(
    "INSERT INTO tool_calls(id,task_id,tool,args,status,result,studio_id) VALUES ('completed','task','multi_edit','{}','done',?,?)",
  ).run(done, oldId);
  db.prepare("INSERT INTO studio_inspections VALUES ('task',?,0)").run(oldId);
  const unstarted = store.addTask(
    "run",
    "Architect",
    "Unstarted analysis",
    "Inspect the hierarchy",
  );
  await confirm(await preview());
  const t = task("task"),
    messages = JSON.parse(t.messages);
  expect(t.status).toBe("queued");
  expect(JSON.parse(messages[0].content).studio_id).toBe(newId);
  expect(
    messages
      .filter(
        (m: any) => m.role === "tool" && m.tool_call_id === "pending-write",
      )
      .map((m: any) => JSON.parse(m.content)),
  ).toMatchObject([{ cancelled: true, executed: false }]);
  expect(
    JSON.parse(
      messages.find((m: any) => m.role === "assistant").tool_calls[0].function
        .arguments,
    ),
  ).not.toHaveProperty("studio_id");
  expect(
    db.prepare("SELECT status FROM approvals WHERE id='approval'").get(),
  ).toEqual({ status: "cancelled" });
  const { decideApproval } = await import("../worker/features");
  expect(() => decideApproval({ id: "approval", approved: true })).toThrow();
  expect(
    db.prepare("SELECT result FROM tool_calls WHERE id='completed'").get(),
  ).toEqual({ result: done });
  expect(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM studio_inspections WHERE task_id='task'",
      )
      .get(),
  ).toEqual({ n: 0 });
  expect(task(unstarted).messages).toBe("[]");
  expect(
    db.prepare("SELECT COUNT(*) AS n FROM studio_pin_changes").get(),
  ).toEqual({ n: 1 });
});
it("does not touch other games, terminal runs or completed tasks", async () => {
  db.prepare(
    "INSERT INTO games(id,name,studio_id) VALUES ('other','Other game',?)",
  ).run(oldId);
  db.prepare(
    "INSERT INTO runs(id,request,game_id,studio_id,status) VALUES ('other-run','Other','other',?,'active'),('accepted','Done','game',?,'accepted')",
  ).run(oldId, oldId);
  const done = store.addTask(
    "run",
    "Architect",
    "Completed architecture",
    "Done",
  );
  db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(done);
  await confirm(await preview());
  expect(
    db
      .prepare(
        "SELECT DISTINCT studio_id FROM runs WHERE id IN ('other-run','accepted')",
      )
      .all(),
  ).toEqual([{ studio_id: oldId }]);
  expect(task(done).status).toBe("completed");
});
it("rejects live old targets, wrong places, missing identity, missing targets and uncertain writes", async () => {
  available.push({
    id: oldId,
    name: "Still running",
    placeId: "123",
    universeId: "456",
  });
  await expect(preview()).rejects.toThrow("still available");
  available.pop();
  available[0].placeId = "999";
  await expect(preview()).rejects.toThrow("Place ID");
  available[0].placeId = "";
  await expect(preview()).rejects.toThrow("Place ID");
  available = [];
  await expect(preview()).rejects.toThrow("not available");
  available = [
    { id: newId, name: "My reopened game", placeId: "123", universeId: "456" },
  ];
  db.prepare(
    "INSERT INTO tool_calls(id,task_id,tool,status) VALUES ('uncertain','task','multi_edit','uncertain')",
  ).run();
  await expect(preview()).rejects.toThrow("uncertain");
});
it("allows local unsaved games only with explicit same-game confirmation", async () => {
  db.prepare(
    "UPDATE games SET place_id='',universe_id='' WHERE id='game'",
  ).run();
  set("studioKnownInstances", {});
  available[0].placeId = "";
  available[0].universeId = "";
  const p = await preview();
  expect(p.placeVerified).toBe(false);
  await confirm(p);
  expect(
    (db.prepare("SELECT studio_id FROM games WHERE id='game'").get() as any)
      .studio_id,
  ).toBe(newId);
});
it("rechecks state, session availability, idle state and metadata at confirmation time", async () => {
  let p = await preview();
  db.prepare(
    "UPDATE tasks SET instructions='Changed after preview' WHERE id='task'",
  ).run();
  await expect(confirm(p)).rejects.toThrow("changed after");
  p = await preview();
  available = [];
  await expect(confirm(p)).rejects.toThrow("not available");
  available = [
    { id: newId, name: "My reopened game", placeId: "123", universeId: "456" },
  ];
  p = await preview();
  set("paused", false);
  await expect(confirm(p)).rejects.toThrow("Pause the team");
  set("paused", true);
  await expect(
    previewStudioSwitch(selection, new Set(["active"]), discover),
  ).rejects.toThrow("Pause the team");
});
it("executes a queued task only against the confirmed new target and never replays the cancelled write", async () => {
  await confirm(await preview());
  const sent: any[] = [];
  studio.client = {
    callTool: async (input: any) => {
      if (input.name === "list_roblox_studios")
        return {
          structuredContent: {
            studios: available.map((x) => ({
              studio_id: x.id,
              name: x.name,
              place_id: x.placeId,
              universe_id: x.universeId,
            })),
          },
          content: [],
        };
      sent.push(input);
      return {
        content: [{ type: "text", text: '{"source":"actual read result"}' }],
      };
    },
  } as any;
  studio.tools = [
    {
      name: "list_roblox_studios",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "script_read",
      inputSchema: {
        type: "object",
        properties: { studio_id: { type: "string" }, path: { type: "string" } },
        required: ["studio_id", "path"],
      },
    },
  ];
  db.prepare("UPDATE tasks SET instructions=? WHERE id='task'").run(
    `${calls([
      {
        tool: "script_read",
        arguments: { path: "game.ServerScriptService.Main" },
        callId: "fresh-read",
      },
    ])} Inspect the new target without replaying prior changes.`,
  );
  set("paused", false);
  for (let i = 0; i < 8 && task("task").status !== "completed"; i++) {
    await runtime.tick();
    await idle();
  }
  expect(task("task").status).toBe("completed");
  expect(sent.length).toBeGreaterThan(0);
  expect(
    sent.every(
      (c) => c.name === "script_read" && c.arguments.studio_id === newId,
    ),
  ).toBe(true);
  expect(
    db
      .prepare(
        "SELECT studio_id,pin_revision FROM tool_calls WHERE id='task:fresh-read'",
      )
      .get(),
  ).toEqual({ studio_id: newId, pin_revision: 1 });
  studio.client = null;
  set("paused", true);
});
it("requires typed reset confirmation and backs up connection state before clearing pins", async () => {
  const p = previewWorkspaceReset({ scope: "connection" }, new Set());
  const hooks = {
    closeStudio: vi.fn(async () => {}),
    backupCheckpoints: runtime.backupCheckpoints,
    clearCheckpoints: runtime.clearCheckpoints,
  };
  await expect(
    confirmWorkspaceReset(
      { token: p.token, confirmation: "wrong" },
      new Set(),
      hooks,
    ),
  ).rejects.toThrow("confirmation phrase");
  const out = await confirmWorkspaceReset(
    { token: p.token, confirmation: "RESET STUDIO" },
    new Set(),
    hooks,
  );
  expect(
    (db.prepare("SELECT studio_id FROM runs WHERE id='run'").get() as any)
      .studio_id,
  ).toBe("");
  expect(get("mcpCommand")).toBe("");
  expect(get("paused")).toBe(true);
  expect(db.prepare("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 1 });
  const backup = new Database(resolve(dir, out.backup, "forge.sqlite"), {
    readonly: true,
  });
  try {
    expect(
      (backup.prepare("SELECT studio_id FROM runs WHERE id='run'").get() as any)
        .studio_id,
    ).toBe(oldId);
  } finally {
    backup.close();
  }
  // A blank pin after reset can be linked only via a newly verified confirmation.
  const next = await previewStudioSwitch(
    { ...selection, oldStudioId: "" },
    new Set(),
    discover,
  );
  await confirm(next);
  expect(
    (db.prepare("SELECT studio_id FROM runs WHERE id='run'").get() as any)
      .studio_id,
  ).toBe(newId);
});
it("fully resets local data and credentials with a private recoverable backup and no env fallback", async () => {
  mkdirSync(resolve(dir, "assets"), { recursive: true });
  writeFileSync(resolve(dir, "assets", "test.txt"), "private asset");
  const p = previewWorkspaceReset({ scope: "everything" }, new Set());
  const out = await confirmWorkspaceReset(
    { token: p.token, confirmation: "RESET FORGE" },
    new Set(),
    {
      closeStudio: async () => {},
      backupCheckpoints: runtime.backupCheckpoints,
      clearCheckpoints: runtime.clearCheckpoints,
    },
  );
  for (const table of [
    "games",
    "runs",
    "tasks",
    "tool_calls",
    "approvals",
    "usage",
    "studio_pin_changes",
  ])
    expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({
      n: 0,
    });
  expect(db.prepare("SELECT COUNT(*) AS n FROM agents").get()).toEqual({
    n: 8,
  });
  expect(get("paused")).toBe(true);
  expect(get("mcpCommand")).toBe("");
  expect(existsSync(resolve(dir, "assets", "test.txt"))).toBe(false);
  expect(
    readFileSync(resolve(dir, out.backup, "assets", "test.txt"), "utf8"),
  ).toBe("private asset");
  expect(statSync(resolve(dir, out.backup, "forge.sqlite")).mode & 0o777).toBe(
    0o600,
  );
});
it("rejects a reset preview after work or configuration changes", async () => {
  const p = previewWorkspaceReset({ scope: "everything" }, new Set());
  db.prepare("UPDATE tasks SET instructions='new work' WHERE id='task'").run();
  await expect(
    confirmWorkspaceReset(
      { token: p.token, confirmation: "RESET FORGE" },
      new Set(),
      {
        closeStudio: async () => {},
        backupCheckpoints: runtime.backupCheckpoints,
        clearCheckpoints: runtime.clearCheckpoints,
      },
    ),
  ).rejects.toThrow("changed since");
});

it("cannot reuse verification evidence from the previous pinned session", async () => {
  db.prepare(
    "UPDATE tasks SET agent='Tester',status='queued',instructions=? WHERE id='task'",
  ).run(
    `${calls([
      {
        tool: "verify",
        arguments: {
          passed: true,
          evidence:
            "Trying to reuse an earlier session without current evidence",
        },
      },
    ])} Try to verify.`,
  );
  for (const [id, tool] of [
    ["old-play", "start_stop_play"],
    ["old-console", "get_console_output"],
  ])
    db.prepare(
      "INSERT INTO tool_calls(id,task_id,tool,args,status,result,studio_id,pin_revision) VALUES (?,'task',?,'{}','done','{}',?,0)",
    ).run(id, tool, oldId);
  await confirm(await preview());
  set("paused", false);
  for (let i = 0; i < 3; i++) {
    db.prepare("UPDATE tasks SET next_at=0 WHERE id='task'").run();
    await runtime.tick();
    await idle();
  }
  expect(task("task").status).toBe("failed");
  expect(task("task").error).toMatch(/Verification requires|verify verdict/i);
  expect(task("task").result).not.toContain("VERIFIED:");
  set("paused", true);
});
