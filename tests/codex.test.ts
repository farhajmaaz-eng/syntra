import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const dir = mkdtempSync(resolve(tmpdir(), "syntra-codex-"));
process.env.SYNTRA_DATA_DIR = dir;
process.env.CODEX_APP_SERVER_COMMAND = process.execPath;
process.env.CODEX_APP_SERVER_ARGS = JSON.stringify([
  resolve("tests/codex-fixture.mjs"),
]);

const store = await import("../worker/store");
const features = await import("../worker/features");
const { codexAction } = await import("../worker/codex-actions");
const codexModule = await import("../worker/codex");
const { codex } = codexModule;
const { db } = store;
const project = resolve(dir, "project");

async function waitFor<T>(fn: () => T | null | undefined, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

beforeAll(async () => {
  mkdirSync(project, { recursive: true });
  store.set("codexProjectRoot", project);
  store.set("codexAutoApprove", false);
  store.set("codexDefaultModel", "gpt-6.1-terra");
  await codex.ensureStarted();
  await codex.loginApiKey("sk-fixture-codex-key-1234567890");
});

afterAll(async () => {
  codex.shutdown();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("OpenAI Codex app-server integration", () => {
  it("starts the official protocol, reports auth and uses the isolated model catalog", async () => {
    const status = codex.status();
    expect(status.running).toBe(true);
    expect(status.requiresOpenaiAuth).toBe(true);
    expect(status.models.map((model: any) => model.id)).toEqual(
      expect.arrayContaining(["gpt-6.2-sol", "gpt-6.1-terra"]),
    );
    const login = await codex.loginApiKey("sk-fixture-codex-key-1234567890");
    expect(login.account).toMatchObject({ type: "apiKey" });
    expect(codex.status().account).toMatchObject({ type: "apiKey" });
  });

  it("creates sessions only inside the configured project root", async () => {
    const session = await codex.createSession({
      title: "Fixture session",
      cwd: project,
      model: "gpt-6.1-terra",
    });
    expect(session.cwd).toBe(project);
    expect(session.thread_id).toBeTruthy();
    await expect(
      codex.createSession({ title: "Escape", cwd: resolve(dir, "..") }),
    ).rejects.toThrow("inside the configured project root");
  });

  it("streams a turn, records usage and resolves an approved command", async () => {
    const session = await codex.createSession({
      title: "Streaming",
      cwd: project,
      model: "gpt-6.1-terra",
    });
    let streamed = "";
    const running = codex.runSessionTurn({
      sessionId: session.id,
      prompt: "FIXTURE_APPROVAL Inspect the fixture and apply a patch",
      onText: (text) => {
        streamed = text;
      },
    });
    const approval = await waitFor(
      () =>
        db
          .prepare(
            "SELECT * FROM approvals WHERE session_id=? AND status='pending'",
          )
          .get(session.id) as any,
    );
    expect(JSON.parse(approval.args).command).toBe("npm test");
    features.decideApproval({
      id: approval.id,
      approved: true,
      authorized: true,
      note: "Approved by the integration test",
    });
    const result = await running;
    expect(result.text).toContain("command approved");
    expect(result.diff).toContain("src/example.ts");
    expect(streamed).toContain("Fixture completed");
    expect(
      db
        .prepare("SELECT status FROM approvals WHERE id=?")
        .get(approval.id),
    ).toEqual({ status: "approved" });
    const usage: any = db
      .prepare("SELECT * FROM usage WHERE provider='codex'")
      .get();
    expect(usage).toMatchObject({
      agent: "Codex",
      input_tokens: 12,
      output_tokens: 8,
      status: "unpriced",
    });
    const detail = codexModule.codexSessionDetail(session.id);
    expect(detail.events.length).toBeGreaterThan(2);
    expect(detail.turns[0]).toMatchObject({
      status: "completed",
      diff: expect.stringContaining("src/example.ts"),
    });
  });

  it("records a rejection and lets the turn continue", async () => {
    const session = await codex.createSession({
      title: "Rejected",
      cwd: project,
    });
    const running = codex.runSessionTurn({
      sessionId: session.id,
      prompt: "FIXTURE_APPROVAL Run a command I will reject",
    });
    const approval = await waitFor(
      () =>
        db
          .prepare(
            "SELECT * FROM approvals WHERE session_id=? AND status='pending'",
          )
          .get(session.id) as any,
    );
    features.decideApproval({
      id: approval.id,
      approved: false,
      note: "No command execution",
    });
    const result = await running;
    expect(result.text).toContain("command declined");
    expect(
      db
        .prepare("SELECT status FROM approvals WHERE id=?")
        .get(approval.id),
    ).toEqual({ status: "rejected" });
  });

  it("interrupts an in-flight turn without replaying local work", async () => {
    const session = await codex.createSession({
      title: "Interrupted",
      cwd: project,
    });
    const running = codex.runSessionTurn({
      sessionId: session.id,
      prompt: "FIXTURE_HOLD interrupt this turn",
    });
    await waitFor(
      () =>
        db
          .prepare(
            "SELECT id FROM codex_turns WHERE session_id=? AND status='running'",
          )
          .get(session.id),
    );
    const rejected = expect(running).rejects.toThrow(/interrupted/i);
    await codex.interruptSession(session.id);
    await rejected;
    expect(
      db
        .prepare("SELECT status FROM codex_turns WHERE session_id=?")
        .get(session.id),
    ).toEqual({ status: "interrupted" });
  });

  it("surfaces Codex failures and exposes them in session detail", async () => {
    const session = await codex.createSession({
      title: "Failure",
      cwd: project,
    });
    await expect(
      codex.runSessionTurn({
        sessionId: session.id,
        prompt: "FIXTURE_FAIL please fail this turn",
      }),
    ).rejects.toThrow(/Fixture failure/);
    const detail = codexModule.codexSessionDetail(session.id);
    expect(detail.turns[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Fixture failure"),
    });
  });
});

it("gives new standalone Codex sessions exact playbook retrieval", async () => {
  const active = new Set<string>();
  const created = await codexAction("codex/session/create", { title: "Playbook lookup", cwd: project }, active);
  const id = created?.session?.id;
  expect(id).toBeTruthy();
  await codexAction("codex/session/turn", {
    id,
    prompt: 'FIXTURE_CALLS: [{"tool":"library_grep","arguments":{"pattern":"ProcessReceipt","limit":1}}]',
  }, active);
  const turn = await waitFor(() => db.prepare(
    "SELECT status,result,error FROM codex_turns WHERE session_id=? AND status!='running'",
  ).get(id) as { status: string; result: string; error: string } | undefined);
  expect(turn.status, turn.error).toBe("completed");
  expect(turn.result).toContain("library_grep:");
  expect(turn.result).toContain("sectionId");
  expect(turn.result).toContain("ProcessReceipt");
});

it("persists an early terminal event and ignores stale events on the next turn", async () => {
  const session = await codex.createSession({ title: "Turn event ordering", cwd: project });
  const early = await codex.runSessionTurn({ sessionId: session.id, prompt: "FIXTURE_EARLY" });
  expect(early.text).toBe("Early completed answer");
  expect(db.prepare("SELECT status,result FROM codex_turns WHERE id=?").get(early.turnId))
    .toEqual({ status: "completed", result: "Early completed answer" });
  const following = await codex.runSessionTurn({ sessionId: session.id, prompt: "FIXTURE_STALE" });
  expect(following.turnId).not.toBe(early.turnId);
  expect(following.text).toContain("Fixture completed");
  expect(following.text).not.toContain("STALE TEXT");
  expect(following.text).not.toContain("UNTAGGED TEXT");
});

it("interrupts once during turn startup while rejecting a second turn on that session", async () => {
  const session = await codex.createSession({ title: "Scoped interruption", cwd: project });
  const running = codex.runSessionTurn({ sessionId: session.id, prompt: "FIXTURE_DELAY_START FIXTURE_HOLD" });
  const rejected = expect(running).rejects.toThrow(/interrupted/);
  await waitFor(() => codex.busy());
  await expect(codex.runSessionTurn({ sessionId: session.id, prompt: "Concurrent turn" })).rejects.toThrow(/active turn/);
  await Promise.all([codex.interruptSession(session.id), codex.interruptSession(session.id)]);
  await rejected;
  const events = db.prepare("SELECT type FROM codex_events WHERE session_id=? AND type LIKE 'fixture/%'").all(session.id);
  expect(events).toEqual([{ type: "fixture/interrupt" }]);
  expect(codexModule.codexSessionDetail(session.id).session.status).toBe("idle");
});

it("reconciles an acknowledged interrupt whose terminal notification was lost", async () => {
  const session = await codex.createSession({ title: "Read thread state", cwd: project });
  const running = codex.runSessionTurn({ sessionId: session.id, prompt: "FIXTURE_HOLD FIXTURE_SILENT_INTERRUPT" });
  const rejected = expect(running).rejects.toThrow(/interrupted/);
  await waitFor(() => db.prepare("SELECT id FROM codex_turns WHERE session_id=?").get(session.id));
  await codex.interruptSession(session.id);
  await rejected;
  expect(codexModule.codexSessionDetail(session.id).turns[0]).toMatchObject({ status: "interrupted" });
}, 10000);

it("settles the owning session when the App Server process exits and can restart", async () => {
  const session = await codex.createSession({ title: "Disconnected turn", cwd: project });
  await expect(codex.runSessionTurn({ sessionId: session.id, prompt: "FIXTURE_EXIT" })).rejects.toThrow(/app-server exited/);
  expect(codexModule.codexSessionDetail(session.id).turns[0]).toMatchObject({ status: "failed" });
  expect(codex.busy()).toBe(false);
  await codex.ensureStarted();
  await codex.loginApiKey("sk-fixture-codex-key-1234567890");
  expect((await codex.runSessionTurn({ sessionId: session.id, prompt: "FIXTURE_EARLY" })).text).toBe("Early completed answer");
}, 10000);


it("preserves separate completed message items without duplicating their streamed text", async () => {
  const session = await codex.createSession({ title: "Message retention", cwd: project });
  const result = await codex.runSessionTurn({ sessionId: session.id, prompt: "FIXTURE_MULTIPLE_MESSAGES" });
  expect(result.text).toBe("First completed item\n\nSecond completed item");
});

it("persists a terminal start reply even when there is no completion notification", async () => {
  const session = await codex.createSession({ title: "Terminal reply", cwd: project });
  const result = await codex.runSessionTurn({ sessionId: session.id, prompt: "FIXTURE_TERMINAL_REPLY" });
  expect(result.text).toBe("Terminal reply recovered.\n\nAdditional final message.");
  expect(result.diff).toContain("src/recovered.ts");
  expect(codexModule.codexSessionDetail(session.id).turns).toContainEqual(expect.objectContaining({ status: "completed" }));
});
