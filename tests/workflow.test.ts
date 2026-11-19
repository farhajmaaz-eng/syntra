import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const calls = (value: any[]) =>
  `FIXTURE_CALLS_B64:${Buffer.from(JSON.stringify(value)).toString("base64")}`;
const tmp = mkdtempSync(resolve(tmpdir(), "forge-test-"));
process.env.FORGE_DATA_DIR = tmp;
process.env.CODEX_APP_SERVER_COMMAND = process.execPath;
process.env.CODEX_APP_SERVER_ARGS = JSON.stringify([
  resolve("tests/codex-fixture.mjs"),
]);
process.env.FIXTURE_PLACE = resolve(tmp, "place.luau");
const store = await import("../worker/store");
const features = await import("../worker/features");
const { studio } = await import("../worker/mcp");
const runtime = await import("../worker/runtime");
const { codex } = await import("../worker/codex");
afterAll(async () => {
  await studio.close();
  codex.shutdown();
  store.db.close();
  rmSync(tmp, { recursive: true, force: true });
});
describe("Persistent Codex workflow", () => {
  beforeAll(async () => {
    store.set("codexProjectRoot", process.cwd());
    store.set("codexAutoApprove", false);
    store.set("mcpCommand", process.execPath);
    store.set("mcpArgs", [
      resolve("tests/studio-fixture.mjs"),
      process.env.FIXTURE_PLACE,
    ]);
    await studio.connect();
    await codex.ensureStarted();
    await codex.loginApiKey("sk-fixture-codex-key-1234567890");
    expect(studio.tools.length).toBe(5);
  }, 30000);

  it("plans, delegates, gates a real SDK write, verifies evidence and reaches review", async () => {
    store.db
      .prepare(
        "INSERT INTO runs(id,request,studio_id) VALUES ('run','Build a checkpoint','test-studio')",
      )
      .run();
    const lead = store.addTask(
      "run",
      "Lead",
      "Plan checkpoint",
      "Plan, delegate, test.",
    );
    const builderInstructions = `${calls([
      { tool: "script_read", arguments: {} },
      {
        tool: "multi_edit",
        arguments: { source: '-- Checkpoint\\nprint("Checkpoint ready")' },
      },
      { tool: "script_read", arguments: {} },
    ])} Create Checkpoint script`;
    store.db
      .prepare("UPDATE tasks SET instructions=? WHERE id=?")
      .run(
        `${calls([
          { tool: "library_search", arguments: { query: "security" } },
          {
            tool: "delegate",
            arguments: {
              agent: "Builder",
              title: "Build checkpoint",
              instructions: builderInstructions,
              dependencies: [],
              acceptance: "Checkpoint script exists in Studio",
            },
          },
        ])} Plan, delegate, test.`,
        lead,
      );
    let approvals = 0;
    for (let i = 0; i < 120; i++) {
      await runtime.tick();
      for (let wait = 0; wait < 60; wait++) {
        const pending = store.db
          .prepare("SELECT * FROM approvals WHERE status='pending'")
          .all() as any[];
        for (const ap of pending) {
          expect(ap.args).toContain("test-studio");
          if (ap.tool === "multi_edit")
            expect(() => readFileSync(process.env.FIXTURE_PLACE!)).toThrow();
          features.decideApproval({
            id: ap.id,
            approved: true,
            note: "Approved by workflow test",
          });
          approvals++;
        }
        if (!runtime.active.size) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      if (
        (
          store.db
            .prepare("SELECT status FROM runs WHERE id='run'")
            .get() as any
        ).status === "review"
      )
        break;
    }
    expect(
      (
        store.db
          .prepare(
            "SELECT count(*) AS n FROM tool_calls WHERE tool='library_search' AND status='done'",
          )
          .get() as any
      ).n,
    ).toBe(1);
    expect(approvals).toBe(3);
    expect(readFileSync(process.env.FIXTURE_PLACE!, "utf8")).toContain(
      "Checkpoint",
    );
    expect(
      (store.db.prepare("SELECT status FROM runs WHERE id='run'").get() as any)
        .status,
    ).toBe("review");
    expect(
      (
        store.db
          .prepare("SELECT result FROM tasks WHERE agent='Tester'")
          .get() as any
      ).result,
    ).toContain("VERIFIED:");
    expect(
      (
        store.db
          .prepare("SELECT count(DISTINCT agent) AS n FROM memories")
          .get() as any
      ).n,
    ).toBe(3);
    expect(
      (store.db.prepare("SELECT count(*) AS n FROM locks").get() as any).n,
    ).toBe(0);
  }, 30000);

  it("keeps full conversations out of live dashboard snapshots", () => {
    const snapshot = store.snapshot();
    expect(snapshot.settings).not.toHaveProperty("pricing");
    expect(snapshot.tasks.length).toBeGreaterThan(0);
    expect(snapshot.tasks[0]).not.toHaveProperty("messages");
    const persisted = store.task((snapshot.tasks[0] as any).id);
    expect(persisted.messages).toBeDefined();
  });

  it("rejects unauthorized MCP tools before running them", async () => {
    await expect(
      studio.call(
        "Lead",
        "multi_edit",
        { source: "bad" },
        "test-studio",
        "owner",
      ),
    ).rejects.toThrow("cannot use");
    expect(readFileSync(process.env.FIXTURE_PLACE!, "utf8")).not.toBe("bad");
  });

  it("restores queued work and flags interrupted writes after restart", () => {
    const id = store.addTask(
      "run",
      "Builder",
      "Interrupted",
      "Inspect outcome",
    );
    store.db.prepare("UPDATE tasks SET status='running' WHERE id=?").run(id);
    store.db
      .prepare(
        "INSERT INTO tool_calls(id,task_id,tool,args,status) VALUES ('interrupted',?,'multi_edit','{}','running')",
      )
      .run(id);
    runtime.recover();
    expect(store.task(id).status).toBe("failed");
    expect(
      (
        store.db
          .prepare("SELECT status FROM tool_calls WHERE id='interrupted'")
          .get() as any
      ).status,
    ).toBe("uncertain");
  });
});
