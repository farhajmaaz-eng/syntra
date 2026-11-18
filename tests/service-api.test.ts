import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "forge-service-api-"));
process.env.FORGE_DATA_DIR = dir;

const { action, handleWorkerGet } = await import("../worker/service");
const { safeJsonArray, safeJsonValue } = await import(
  "../src/lib/feature-contracts"
);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("worker service and feature safety helpers", () => {
  it("handles snapshot, library, and unknown GET routes cleanly", () => {
    const snap = handleWorkerGet("snapshot", new URLSearchParams());
    expect(snap.kind).toBe("json");
    if (snap.kind === "json") {
      expect(snap.data).toHaveProperty("agents");
      expect(snap.data).toHaveProperty("settings");
    }

    const lib = handleWorkerGet("library", new URLSearchParams("q=security"));
    expect(lib.kind).toBe("json");

    const missing = handleWorkerGet("nonexistent/path", new URLSearchParams());
    expect(missing.kind).toBe("not_found");
  });

  it("validates actions and rejects unknown actions", async () => {
    await expect(action("unknown/action", {})).rejects.toThrow("Unknown action");
    const paused = await action("pause", { paused: true });
    expect(paused).toEqual({ ok: true });
    const resumed = await action("pause", { paused: false });
    expect(resumed).toEqual({ ok: true });
  });

  it("parses JSON payloads safely without throwing on malformed input", () => {
    expect(safeJsonArray('["task-1","task-2"]')).toEqual(["task-1", "task-2"]);
    expect(safeJsonArray("not-json")).toEqual([]);
    expect(safeJsonArray('{"a":1}')).toEqual([]);
    expect(safeJsonValue('{"ok":true}', {})).toEqual({ ok: true });
    expect(safeJsonValue("{broken", { fallback: true })).toEqual({
      fallback: true,
    });
  });

  it("guards fetch JSON responses against HTML pages and Unexpected token '<'", async () => {
    const { safeResponseJson } = await import("../src/lib/utils");
    const htmlRes = new Response("<!DOCTYPE html><html><body>404</body></html>", {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
    await expect(safeResponseJson(htmlRes)).rejects.toThrow(
      /HTML error \(404\)/,
    );
    const okJson = new Response('{"ok":true,"count":3}', { status: 200 });
    await expect(safeResponseJson(okJson)).resolves.toEqual({
      ok: true,
      count: 3,
    });
    const emptyRes = new Response(null, { status: 204 });
    await expect(safeResponseJson(emptyRes)).resolves.toEqual({});
  });

  it("supports adding/removing API keys and planning without a worker or Studio", async () => {
    const { createStandaloneSnapshot, runStandaloneAction } = await import(
      "../src/lib/offline-workspace"
    );
    const initial = createStandaloneSnapshot();
    expect(initial.games.length).toBeGreaterThan(0);
    expect(initial.keyConfigured).toBe(false);

    const saved = runStandaloneAction(initial, "provider/save", {
      provider: "openrouter",
      apiKey: "sk-or-test-key-1234",
      applyRecommended: true,
    });
    expect(saved.snapshot.keyConfigured).toBe(true);
    expect(saved.snapshot.provider.id).toBe("openrouter");
    expect(saved.snapshot.standaloneKeys.openrouter).toBe("sk-or-test-key-1234");

    const queued = runStandaloneAction(saved.snapshot, "chat", {
      content: "Plan an obby checkpoint module",
      gameId: initial.games[0].id,
    });
    expect(queued.snapshot.tasks).toHaveLength(1);
    expect(queued.snapshot.tasks[0].status).toBe("queued");

    const removed = runStandaloneAction(queued.snapshot, "provider/save", {
      provider: "openrouter",
      removeKey: true,
    });
    expect(removed.snapshot.keyConfigured).toBe(false);
    expect(removed.snapshot.standaloneKeys.openrouter).toBe("");

    const connected = runStandaloneAction(removed.snapshot, "connect", {});
    expect(connected.result.ok).toBe(true);

    const followUp = runStandaloneAction(connected.snapshot, "agents/message", {
      agent: "Architect",
      gameId: "",
      content: "Design a module interface for checkpoint persistence",
    });
    expect(followUp.snapshot.tasks.length).toBeGreaterThan(1);

    const resetPreview = runStandaloneAction(
      followUp.snapshot,
      "workspace/reset/preview",
      { scope: "connection" },
    );
    expect(resetPreview.result.counts).toHaveProperty("runs");
    expect(resetPreview.result.counts).toHaveProperty("assets");
    expect(resetPreview.result.token).toBeTruthy();
  });

  it("auto-creates a Syntra Sandbox project when chat or tasks/create is submitted without a game", async () => {
    const out: any = await action("chat", {
      content: "Build an obby checkpoint system",
      gameId: "",
    });
    expect(out.id).toBeTruthy();
    expect(out.taskId).toBeTruthy();
    const snap = handleWorkerGet("snapshot", new URLSearchParams());
    expect(snap.kind).toBe("json");
    if (snap.kind === "json") {
      const data = snap.data as any;
      expect(data.games.some((g: any) => g.name === "Syntra Sandbox")).toBe(
        true,
      );
      expect(data.tasks.some((t: any) => t.id === out.taskId)).toBe(true);
    }
  });
});
