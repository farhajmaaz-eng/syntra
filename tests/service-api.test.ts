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
});
