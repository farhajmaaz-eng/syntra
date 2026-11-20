import "dotenv/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, get, set, event, snapshot, task } from "./store";
import { studio } from "./mcp";
import { previewStudioSwitch, confirmStudioSwitch } from "./studio-selection";
import {
  previewWorkspaceReset,
  confirmWorkspaceReset,
} from "./workspace-reset";
import {
  active,
  recover,
  tick,
  interruptStopped,
  abortAll,
  backupCheckpoints,
  clearCheckpoints,
} from "./runtime";
import { redact, publicData } from "./errors";
import { roles } from "../src/lib/roles";
import {
  librarySearch,
  libraryRead,
  libraryAction,
  libraryBrief,
  libraryStats,
} from "./library";
import { codexAction, codexRead } from "./codex-actions";
import { codex, codexSessions, codexUsage } from "./codex";
import {
  featureAction,
  featureRead,
  assetFile,
  decideApproval,
  decideRun,
} from "./features";

export {
  active,
  recover,
  tick,
  interruptStopped,
  abortAll,
  redact,
  publicData,
  codex,
};

let connecting = false;
let maintaining = false;

export function isConnecting() {
  return connecting;
}

export function isMaintaining() {
  return maintaining;
}

export async function reconnect() {
  if (connecting) throw new Error("Connection already in progress");
  if (active.size)
    throw new Error("Pause and wait for active tasks before reconnecting");
  connecting = true;
  try {
    await studio.connect();
  } finally {
    connecting = false;
  }
}

export async function action(path: string, b: any) {
  if (maintaining)
    throw new Error(
      "Workspace maintenance is in progress. Wait for it to finish.",
    );
  if (
    path.startsWith("studio/switch/") ||
    path.startsWith("workspace/reset/")
  ) {
    if (connecting || studio.isConnecting || codex.busy())
      throw new Error("Wait for Codex or Studio operations to finish");
    maintaining = true;
    try {
      if (path === "studio/switch/preview")
        return await previewStudioSwitch(b, active, () => studio.discover());
      if (path === "studio/switch/confirm")
        return await confirmStudioSwitch(b, active, () => studio.discover());
      if (path === "workspace/reset/preview")
        return previewWorkspaceReset(b, active);
      if (path === "workspace/reset/confirm")
        return await confirmWorkspaceReset(b, active, {
          closeStudio: () => studio.close(),
          backupCheckpoints,
          clearCheckpoints,
        });
      throw new Error("Unknown maintenance action");
    } finally {
      maintaining = false;
    }
  }
  if (path.startsWith("library/")) return libraryAction(path.slice(8), b);
  const codexResult = await codexAction(path, b, active);
  if (codexResult !== undefined) return codexResult;
  const featureResult = featureAction(path, b, active);
  if (featureResult !== undefined) {
    interruptStopped();
    return featureResult;
  }
  if (path === "settings") {
    const a = z
      .object({
        cap: z.number().min(0).max(1000).optional(),
        concurrency: z.number().int().min(1).max(Object.keys(roles).length).optional(),
        taskTimeoutMs: z.number().int().min(1000).max(3600000).optional(),
        paused: z.boolean(),
        approvalRequired: z.boolean(),
        mcpCommand: z.string().max(2000),
        mcpArgs: z.array(z.string()).max(30),
        maxSteps: z.number().int().min(5).max(100),
      })
      .parse(b);
    if (active.size || codex.busy())
      throw new Error(
        "Pause the runtime and wait for active tasks before changing settings.",
      );
    for (const [k, v] of Object.entries(a))
      if (v !== undefined) set(k, v);
    event("Settings saved");
    return { ok: true };
  }
  if (path === "pause") {
    set("paused", z.boolean().parse(b.paused));
    interruptStopped();
    return { ok: true };
  }
  if (path === "agents") {
    const a = z
      .object({
        name: z.enum(Object.keys(roles) as [string, ...string[]]),
        model: z.string().min(1).max(200),
        temperature: z.number().min(0).max(2),
        max_tokens: z.number().int().min(128).max(1000000),
        timeout_ms: z.number().int().min(1000).max(300000).default(180000),
        context_limit: z.number().int().min(1024).max(2000000).default(64000),
        spending_limit: z.number().min(0).max(1000).default(0),
        provider_options: z.unknown().optional(),
        parameters: z.unknown().optional(),
        enabled: z.boolean(),
        prompt: z.string().min(10).max(20000),
      })
      .parse(b);
    if (a.name === "Codex" && a.model.length > 200)
      throw new Error("Codex model ID is too long");
    const codexModels = codex
      .status()
      .models?.map((model: any) => model.id)
      .filter(Boolean) as string[];
    if (codexModels?.length && !codexModels.includes(a.model))
      throw new Error(
        "Choose a model from the current Codex app-server catalog, or refresh models on the Codex page.",
      );
    if (a.max_tokens >= a.context_limit)
      throw new Error(
        "Output-token limit must be smaller than the configured context limit",
      );
    if (
      [...active].some((id) => task(id)?.agent === a.name) ||
      codex.busy()
    )
      throw new Error(
        "Agent activity changed while checking the model. Pause the team and save again.",
      );
    db.prepare(
      "UPDATE agents SET model=?,enabled=?,prompt=? WHERE name=?",
    ).run(a.model, Number(a.enabled), a.prompt, a.name);
    return { ok: true };
  }
  if (path === "connect") {
    await reconnect();
    return { status: get("studioStatus") };
  }
  if (path === "studios") {
    return await studio.discover();
  }
  if (path === "models") {
    await codex.ensureStarted();
    const models = await codex.refreshModels();
    return { ok: true, count: models.length, models };
  }
  if (path === "games") {
    const a = z
      .object({
        name: z.string().min(1).max(200),
        studioId: z.string().trim().max(200).default(""),
        universeId: z.string().regex(/^\d*$/).max(30).default(""),
        placeId: z.string().regex(/^\d*$/).max(30).default(""),
      })
      .parse(b);
    db.prepare(
      "INSERT INTO games(id,name,studio_id,stage,universe_id,place_id) VALUES (?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      a.name,
      a.studioId,
      a.studioId ? "prototype" : "concept",
      a.universeId,
      a.placeId,
    );
    return { ok: true };
  }
  if (path === "approve") return decideApproval(b);
  if (path === "resolve") {
    const a = z
      .object({
        id: z.string(),
        executed: z.boolean(),
        evidence: z.string().min(10),
      })
      .parse(b);
    const c: any = db
      .prepare("SELECT * FROM tool_calls WHERE id=? AND status='uncertain'")
      .get(a.id);
    if (!c) throw new Error("Uncertain call not found");
    db.prepare("UPDATE tool_calls SET status=?,result=? WHERE id=?").run(
      a.executed ? "done" : "retry",
      JSON.stringify({ userResolved: true, evidence: a.evidence }),
      c.id,
    );
    db.prepare("DELETE FROM locks WHERE owner=?").run(c.id);
    event(`User reconciled ${c.tool}: ${a.evidence}`, "User");
    return { ok: true };
  }
  if (path === "retry") {
    const a = z.object({ id: z.string() }).parse(b);
    const t = task(a.id);
    const run: any = t
      ? db.prepare("SELECT status FROM runs WHERE id=?").get(t.run_id)
      : null;
    if (run?.status === "cancelled")
      throw new Error("Create new work for a cancelled run");
    if (
      db
        .prepare(
          "SELECT id FROM attention_requests WHERE task_id=? AND status='pending' LIMIT 1",
        )
        .get(a.id)
    )
      throw new Error("Answer the pending question on Home before retrying");
    if (!t || active.has(t.id) || !["active", "paused"].includes(run?.status) || !["failed", "blocked"].includes(t.status))
      throw new Error("Task cannot be retried");
    if (
      (
        db
          .prepare(
            "SELECT count(*) AS n FROM tool_calls WHERE task_id=? AND status IN ('running','uncertain')",
          )
          .get(t.id) as any
      ).n
    )
      throw new Error("Resolve uncertain operations in Reviews first");
    db.prepare(
      "UPDATE tasks SET status='queued',attempts=0,next_at=0,stop_requested=NULL,error=NULL,updated=CURRENT_TIMESTAMP WHERE id=?",
    ).run(t.id);
    return { ok: true };
  }
  if (path === "review") return decideRun(b);
  throw new Error("Unknown action");
}

export type WorkerGetResult =
  | {
      kind: "binary";
      bytes: Buffer;
      mime: string;
      filename: string;
      inline: boolean;
    }
  | { kind: "json"; data: unknown }
  | { kind: "not_found" };

export function handleWorkerGet(
  path: string,
  searchParams: URLSearchParams,
): WorkerGetResult {
  if (path === "health") {
    return {
      kind: "json",
      data: {
        ok: true,
        mode: "external",
        uptimeSec: Math.round(process.uptime()),
      },
    };
  }
  if (path === "assets/file") {
    const file = assetFile(searchParams.get("id") || "");
    return { kind: "binary", ...file };
  }
  const codexResult = codexRead(path, searchParams);
  if (codexResult !== undefined) {
    return { kind: "json", data: publicData(codexResult) };
  }
  const result = featureRead(path, searchParams);
  if (result !== undefined) {
    return { kind: "json", data: publicData(result) };
  }
  if (path === "library") {
    const id = searchParams.get("id");
    const sectionId = searchParams.get("section") || undefined;
    if (searchParams.get("stats") === "true") {
      return { kind: "json", data: libraryStats() };
    }
    if (searchParams.has("brief")) {
      return {
        kind: "json",
        data: libraryBrief(
          searchParams.get("brief") || "",
          searchParams.get("agent") || "",
          Number(searchParams.get("limit")) || 6,
        ),
      };
    }
    return {
      kind: "json",
      data: id
        ? libraryRead(id, { sectionId })
        : librarySearch(
            searchParams.get("q") || "",
            searchParams.get("category") || "",
            searchParams.get("starred") === "true",
            {
              agent: searchParams.get("agent") || undefined,
              kind: searchParams.get("kind") || undefined,
              limit: Number(searchParams.get("limit")) || undefined,
            },
          ),
    };
  }
  if (path === "snapshot") {
    return {
      kind: "json",
      data: (() => {
        const codexStatus = codex.status();
        const codexReady =
          !!codexStatus.account || !!codexStatus.environmentKey;
        return {
          ...snapshot(),
          codex: codexStatus,
          keyConfigured: codexReady,
          provider: {
            id: "codex",
            label: "OpenAI Codex app-server",
            configured: codexReady,
            keySource: codexReady ? "codex" : "none",
            costTracking: "token-only",
          },
          codexSessions: codexSessions(),
          codexUsage: codexUsage(),
          uncertain: db
            .prepare("SELECT * FROM tool_calls WHERE status='uncertain'")
            .all(),
        };
      })(),
    };
  }
  return { kind: "not_found" };
}

type EmbeddedWorkerState = {
  started: boolean;
  ticking: boolean;
  timer?: ReturnType<typeof setInterval>;
};

export function ensureEmbeddedWorkerStarted() {
  const g = globalThis as typeof globalThis & {
    __syntraEmbeddedWorker?: EmbeddedWorkerState;
    __syntraDesktopShutdown?: () => Promise<void>;
  };
  if (!g.__syntraEmbeddedWorker) {
    g.__syntraEmbeddedWorker = { started: false, ticking: false };
  }
  const state = g.__syntraEmbeddedWorker;
  if (state.started) return;
  state.started = true;
  set("workerPort", Number(process.env.WORKER_PORT || 4318));
  recover();
  void studio.connect();
  let desktopNotifications: (() => void) | undefined;
  if (process.env.SYNTRA_DESKTOP === "1") {
    const notices = [
      { kind: "attention", pending: db.prepare(
        "SELECT id FROM approvals WHERE status='pending' UNION SELECT id FROM attention_requests WHERE status='pending'",
      ) },
      { kind: "review", pending: db.prepare("SELECT id FROM runs WHERE status='review'") },
    ].map(({ kind, pending }) => {
      const ids = () => new Set((pending.all() as { id: string }[]).map((row) => row.id));
      return { kind, ids, known: ids() };
    });
    desktopNotifications = () => {
      for (const notice of notices) {
        const current = notice.ids();
        if ([...current].some((id) => !notice.known.has(id)))
          process.stdout.write(`SYNTRA_NOTICE ${notice.kind}\n`);
        notice.known = current;
      }
    };
    g.__syntraDesktopShutdown = async () => {
      clearInterval(state.timer);
      abortAll();
      const deadline = Date.now() + 12_000;
      while ((active.size || state.ticking) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      codex.shutdown();
      await studio.close();
      db.close();
    };
  }
  state.timer = setInterval(() => {
    interruptStopped();
    desktopNotifications?.();
    if (!studio.client && !connecting && !maintaining) {
      void studio.maintain().catch((e) => event(redact(e), "System", "error"));
    }
    if (
      !state.ticking &&
      !connecting &&
      !maintaining
    ) {
      state.ticking = true;
      void tick()
        .catch((e) => event(String(e), "System", "error"))
        .finally(() => {
          state.ticking = false;
        });
    }
  }, 1200);
  state.timer.unref?.();
}
