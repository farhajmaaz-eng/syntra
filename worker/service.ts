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
import { parseOptions, routingSchema, parametersSchema } from "./model-config";
import { redact, publicData } from "./errors";
import { refreshModels } from "./model";
import { roles } from "../src/lib/roles";
import { librarySearch, libraryRead, libraryAction } from "./library";
import { providerAction, providerOperationActive } from "./provider-actions";
import { providerStatus } from "./provider";
import { nvidiaFreeModelIds } from "../src/lib/model-presets";
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
  providerOperationActive,
  refreshModels,
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
    if (connecting || studio.isConnecting || providerOperationActive())
      throw new Error("Wait for connection/provider operations to finish");
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
  const providerResult = await providerAction(path, b, active);
  if (providerResult !== undefined) return providerResult;
  const featureResult = featureAction(path, b, active);
  if (featureResult !== undefined) {
    interruptStopped();
    return featureResult;
  }
  if (path === "settings") {
    const a = z
      .object({
        cap: z.number().min(0).max(1000),
        concurrency: z.number().int().min(1).max(3).optional(),
        taskTimeoutMs: z.number().int().min(1000).max(3600000).optional(),
        paused: z.boolean(),
        approvalRequired: z.boolean(),
        mcpCommand: z.string().max(2000),
        mcpArgs: z.array(z.string()).max(30),
        maxSteps: z.number().int().min(5).max(100),
      })
      .parse(b);
    if (active.size || providerOperationActive())
      throw new Error(
        "Pause the runtime and wait for active tasks before changing settings.",
      );
    for (const [k, v] of Object.entries(a)) set(k, v);
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
    const targetProvider = providerStatus().id;
    if (targetProvider === "nvidia" && !nvidiaFreeModelIds.includes(a.model))
      throw new Error("Choose a model from the NVIDIA free-endpoint allowlist");
    if ([...active].some((id) => task(id).agent === a.name))
      throw new Error("Agent is active; pause before editing.");
    const routing = parseOptions(a.provider_options, routingSchema),
      parameters = parseOptions(a.parameters, parametersSchema);
    if (a.max_tokens >= a.context_limit)
      throw new Error(
        "Output-token limit must be smaller than the configured context limit",
      );
    if (targetProvider === "openrouter") {
      let pricing = get<any>("pricing") || {};
      if (!pricing[a.model]) {
        await refreshModels();
        pricing = get<any>("pricing");
      }
      if (!pricing[a.model])
        throw new Error("Model ID is not in the OpenRouter catalog");
      if (!pricing[a.model].parameters?.includes("tools"))
        throw new Error("Choose a model that advertises tool calling");
      if (a.max_tokens > (pricing[a.model].maxOutput || Infinity))
        throw new Error("Output-token limit exceeds the model maximum");
    }
    if (
      providerStatus().id !== targetProvider ||
      [...active].some((id) => task(id)?.agent === a.name)
    )
      throw new Error(
        "Provider or agent activity changed while checking the model. Pause the team and save again.",
      );
    db.prepare(
      "UPDATE agents SET model=?,temperature=?,max_tokens=?,enabled=?,prompt=?,timeout_ms=?,context_limit=?,spending_limit=?,provider_options=?,parameters=? WHERE name=?",
    ).run(
      a.model,
      a.temperature,
      a.max_tokens,
      Number(a.enabled),
      a.prompt,
      a.timeout_ms,
      a.context_limit,
      a.spending_limit,
      JSON.stringify(routing),
      JSON.stringify(parameters),
      a.name,
    );
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
    return { ok: true, ...(await refreshModels()) };
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
    if (!t || !["failed", "blocked"].includes(t.status))
      throw new Error("Task cannot be retried");
    if (
      (
        db
          .prepare(
            "SELECT count(*) AS n FROM tool_calls WHERE task_id=? AND status='uncertain'",
          )
          .get(t.id) as any
      ).n
    )
      throw new Error("Resolve uncertain operations in Reviews first");
    db.prepare(
      "UPDATE tasks SET status='queued',attempts=0,next_at=0,steps=0,error=NULL WHERE id=?",
    ).run(t.id);
    db.prepare(
      "UPDATE tasks SET status='queued',error=NULL WHERE run_id=? AND status='blocked' AND error='A dependency failed; retry it first.'",
    ).run(t.run_id);
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
  if (path === "assets/file") {
    const file = assetFile(searchParams.get("id") || "");
    return { kind: "binary", ...file };
  }
  const result = featureRead(path, searchParams);
  if (result !== undefined) {
    return { kind: "json", data: publicData(result) };
  }
  if (path === "library") {
    return {
      kind: "json",
      data: searchParams.has("id")
        ? libraryRead(searchParams.get("id")!)
        : librarySearch(
            searchParams.get("q") || "",
            searchParams.get("category") || "",
            searchParams.get("starred") === "true",
          ),
    };
  }
  if (path === "snapshot") {
    return {
      kind: "json",
      data: {
        ...snapshot(),
        uncertain: db
          .prepare("SELECT * FROM tool_calls WHERE status='uncertain'")
          .all(),
      },
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
    __forgeEmbeddedWorker?: EmbeddedWorkerState;
  };
  if (!g.__forgeEmbeddedWorker) {
    g.__forgeEmbeddedWorker = { started: false, ticking: false };
  }
  const state = g.__forgeEmbeddedWorker;
  if (state.started) return;
  state.started = true;
  set("workerPort", Number(process.env.WORKER_PORT || 4318));
  recover();
  void studio.connect();
  void refreshModels().catch((e) => event(String(e), "System", "error"));
  state.timer = setInterval(() => {
    interruptStopped();
    if (!studio.client && !connecting && !maintaining) {
      void studio.maintain().catch((e) => event(redact(e), "System", "error"));
    }
    if (
      !state.ticking &&
      !connecting &&
      !maintaining &&
      !providerOperationActive()
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
