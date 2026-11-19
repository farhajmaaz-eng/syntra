import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const dir = mkdtempSync(resolve(tmpdir(), "syntra-codex-runtime-"));
process.env.SYNTRA_DATA_DIR = dir;
process.env.CODEX_APP_SERVER_COMMAND = process.execPath;
process.env.CODEX_APP_SERVER_ARGS = JSON.stringify([
  resolve("tests/codex-fixture.mjs"),
]);

const store = await import("../worker/store");
const runtime = await import("../worker/runtime");
const { codex } = await import("../worker/codex");
const project = resolve(dir, "project");

async function settle() {
  while (runtime.active.size) await new Promise((resolve) => setTimeout(resolve, 10));
}
async function waitFor(fn: () => boolean, timeout = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await runtime.tick();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Timed out waiting for Codex workflow");
}

beforeAll(async () => {
  mkdirSync(project, { recursive: true });
  store.set("codexProjectRoot", project);
  store.set("codexAutoApprove", true);
  store.set("codexDefaultModel", "gpt-6.1-terra");
  store.set("paused", false);
  store.db.prepare("UPDATE agents SET model='gpt-6.1-terra' WHERE name='Codex'").run();
  await codex.ensureStarted();
  await codex.loginApiKey("sk-fixture-codex-key-1234567890");
});

afterAll(async () => {
  runtime.abortAll();
  await settle();
  codex.shutdown();
  store.db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("Codex as a first-class orchestrated agent", () => {
  it("runs a delegated Codex task and independently verifies the real diff", async () => {
    store.db
      .prepare("INSERT INTO runs(id,request,studio_id) VALUES ('codex-run','Fix local module','')")
      .run();
    const coding = store.addTask(
      "codex-run",
      "Codex",
      "Fix local module",
      "FIXTURE_APPROVAL Update src/example.ts and run the fixture checks.",
      [],
    );
    store.db.prepare("UPDATE tasks SET acceptance=? WHERE id=?").run(
      "A completed turn with a reviewable diff and checks",
      coding,
    );
    const testerId = store.addTask(
      "codex-run",
      "Tester",
      "Verify local code",
      `FIXTURE_CALLS: [{"tool":"codex_inspect","arguments":{"taskId":"${coding}"}},{"tool":"verify_codex","arguments":{"taskId":"${coding}","passed":true,"evidence":"Inspected the real Codex turn diff and confirmed the fixture patch; no Studio claim was made."}}]`,
      [coding],
    );

    await runtime.tick();
    await waitFor(() => store.task(coding).status === "completed", 15000);

    const completed = store.task(coding);
    expect(completed.result).toContain("command approved");
    expect(completed.attempts).toBe(0);
    const session: any = store.db
      .prepare("SELECT * FROM codex_sessions WHERE task_id=?")
      .get(coding);
    expect(session).toBeTruthy();
    const turn: any = store.db
      .prepare("SELECT * FROM codex_turns WHERE session_id=?")
      .get(session.id);
    expect(turn.status).toBe("completed");
    expect(turn.diff).toContain("src/example.ts");

    await waitFor(() => store.task(testerId).status === "completed", 15000);
    expect(store.task(testerId).result).toContain("VERIFIED:");
    await waitFor(
      () =>
        (store.db
          .prepare("SELECT status FROM runs WHERE id='codex-run'")
          .get() as any).status === "review",
    );
    expect(
      store.db
        .prepare("SELECT status FROM runs WHERE id='codex-run'")
        .get(),
    ).toEqual({ status: "review" });
    expect(
      store.db
        .prepare(
          "SELECT verdict FROM review_events WHERE target_kind='codex_turn' ORDER BY rowid DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ verdict: "verified" });
    expect(
      store.db
        .prepare("SELECT count(*) AS n FROM tool_calls WHERE tool='codex_inspect' AND status='done'")
        .get(),
    ).toEqual({ n: 1 });
  }, 30000);
});
