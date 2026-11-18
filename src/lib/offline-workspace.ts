"use client";

import { roles } from "./roles";
import {
  nvidiaAgentModels,
  openRouterAgentModels,
} from "./model-presets";

const STATE_KEY = "forge-standalone-workspace-v1";

function defaultAgents(providerId: "openrouter" | "nvidia" = "openrouter") {
  const presets =
    providerId === "nvidia" ? nvidiaAgentModels : openRouterAgentModels;
  return Object.keys(roles).map((name) => ({
    name,
    model:
      presets[name as keyof typeof presets]?.model ||
      openRouterAgentModels.Lead.model,
    temperature: 0.2,
    max_tokens: 4096,
    enabled: 1,
    prompt: roles[name as keyof typeof roles].brief,
    timeout_ms: 120000,
    context_limit: 128000,
    spending_limit: 2.5,
    parameters: "{}",
    provider_options: "{}",
  }));
}

export function createStandaloneSnapshot() {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  return {
    standaloneMode: true,
    agents: defaultAgents("openrouter"),
    tasks: [] as any[],
    runs: [] as any[],
    games: [
      {
        id: "local-sandbox",
        name: "Syntra Sandbox",
        description:
          "Local planning project — works without Roblox Studio or an active worker.",
        studio_id: "",
        stage: "prototype",
        universe_id: "",
        place_id: "",
        created: now,
      },
    ],
    chat: [] as any[],
    events: [
      {
        id: "evt-standalone",
        agent: "System",
        level: "info",
        message:
          "Standalone workspace ready. Add API keys, plan features, and navigate freely without Studio or a worker.",
        created: now,
      },
    ],
    approvals: [] as any[],
    usage: [] as any[],
    attention: [] as any[],
    assetReviews: 0,
    pitches: [] as any[],
    reviewEvents: [] as any[],
    agentUpdates: [] as any[],
    memories: [] as any[],
    spend: {
      cost: 0,
      reserved: 0,
      unpriced: 0,
      nimInputTokens: 0,
      nimOutputTokens: 0,
    },
    settings: {
      cap: 9,
      maxSteps: 30,
      concurrency: 3,
      taskTimeoutMs: 600000,
      paused: false,
      approvalRequired: true,
      mcpCommand: "",
      mcpArgs: [],
      workerPort: 4318,
      workerHeartbeat: 0,
      studioStatus: "disconnected",
      studioError: "",
      studioTools: [] as string[],
      resetRevision: "standalone",
      lastResetBackup: "",
    },
    standaloneKeys: {
      openrouter: "",
      nvidia: "",
    },
    keyConfigured: false,
    provider: {
      id: "openrouter" as "openrouter" | "nvidia",
      label: "OpenRouter",
      configured: false,
      keySource: "none",
      costTracking: "usd",
    },
  };
}

export function loadStandaloneSnapshot() {
  if (typeof window === "undefined") return createStandaloneSnapshot();
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return createStandaloneSnapshot();
    const parsed = JSON.parse(raw);
    const base = createStandaloneSnapshot();
    return {
      ...base,
      ...parsed,
      standaloneMode: true,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      spend: { ...base.spend, ...(parsed.spend || {}) },
      provider: { ...base.provider, ...(parsed.provider || {}) },
      standaloneKeys: {
        ...base.standaloneKeys,
        ...(parsed.standaloneKeys || {}),
      },
    };
  } catch {
    return createStandaloneSnapshot();
  }
}

export function saveStandaloneSnapshot(snapshot: any) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(snapshot));
  } catch {}
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nowStamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function runStandaloneAction(
  current: any,
  path: string,
  body: Record<string, any> = {},
): { snapshot: any; result: any } {
  const next = structuredClone(current || loadStandaloneSnapshot());
  const now = nowStamp();

  if (path === "pause") {
    next.settings.paused = Boolean(body.paused);
    next.events.unshift({
      id: makeId("evt"),
      agent: "User",
      level: "info",
      message: next.settings.paused ? "Team paused" : "Team resumed",
      created: now,
    });
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "provider/save") {
    const providerId = body.provider === "nvidia" ? "nvidia" : "openrouter";
    const label = providerId === "nvidia" ? "NVIDIA NIM" : "OpenRouter";
    const keys = { ...(next.standaloneKeys || { openrouter: "", nvidia: "" }) };

    if (body.removeKey) {
      keys[providerId] = "";
    } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      keys[providerId] = body.apiKey.trim();
    }

    const configured = Boolean(keys[providerId]);
    next.standaloneKeys = keys;
    next.keyConfigured = configured;
    next.provider = {
      id: providerId,
      label,
      configured,
      keySource: configured ? "local" : "none",
      costTracking: providerId === "nvidia" ? "tokens" : "usd",
    };

    if (body.applyRecommended) {
      const presets =
        providerId === "nvidia" ? nvidiaAgentModels : openRouterAgentModels;
      next.agents = (next.agents || defaultAgents(providerId)).map((a: any) => ({
        ...a,
        model: presets[a.name as keyof typeof presets]?.model || a.model,
      }));
    }

    if (body.removeKey && !configured) {
      next.settings.paused = true;
    }

    next.events.unshift({
      id: makeId("evt"),
      agent: "User",
      level: "info",
      message: body.removeKey
        ? `${label} key removed cleanly from local storage`
        : `${label} provider saved locally`,
      created: now,
    });
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true, provider: next.provider } };
  }

  if (path === "provider/test") {
    const active = next.provider || { id: "openrouter" };
    const key = next.standaloneKeys?.[active.id];
    if (!key) {
      throw new Error(
        "No local API key configured. Enter an API key first to save or test.",
      );
    }
    const lead =
      next.agents.find((a: any) => a.name === "Lead") || next.agents[0];
    return {
      snapshot: next,
      result: {
        ok: true,
        model: `${lead?.model || "openrouter/auto"} (key format saved; live check runs when worker is online)`,
      },
    };
  }

  if (path === "models") {
    next.events.unshift({
      id: makeId("evt"),
      agent: "User",
      level: "info",
      message: "Loaded built-in model presets (standalone mode)",
      created: now,
    });
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "settings") {
    next.settings = {
      ...next.settings,
      cap: Number(body.cap ?? next.settings.cap),
      maxSteps: Number(body.maxSteps ?? next.settings.maxSteps),
      concurrency: Number(body.concurrency ?? next.settings.concurrency),
      taskTimeoutMs: Number(body.taskTimeoutMs ?? next.settings.taskTimeoutMs),
      approvalRequired:
        body.approvalRequired !== undefined
          ? Boolean(body.approvalRequired)
          : next.settings.approvalRequired,
      mcpCommand:
        body.mcpCommand !== undefined
          ? String(body.mcpCommand)
          : next.settings.mcpCommand,
      mcpArgs: Array.isArray(body.mcpArgs)
        ? body.mcpArgs
        : next.settings.mcpArgs,
    };
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "games") {
    if (body.removeId) {
      next.games = next.games.filter((g: any) => g.id !== body.removeId);
    } else if (body.id) {
      next.games = next.games.map((g: any) =>
        g.id === body.id ? { ...g, ...body } : g,
      );
    } else {
      const id = makeId("game");
      next.games.unshift({
        id,
        name: String(body.name || "Untitled Project"),
        description: String(body.description || ""),
        studio_id: String(body.studioId || ""),
        stage: String(body.stage || "prototype"),
        universe_id: String(body.universeId || ""),
        place_id: String(body.placeId || ""),
        created: now,
      });
    }
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "games/update") {
    next.games = next.games.map((g: any) =>
      g.id === body.id
        ? {
            ...g,
            name: String(body.name || g.name),
            studio_id: String(body.studioId ?? g.studio_id ?? ""),
            stage: String(body.stage || g.stage || "prototype"),
            universe_id: String(body.universeId ?? g.universe_id ?? ""),
            place_id: String(body.placeId ?? g.place_id ?? ""),
          }
        : g,
    );
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "connect") {
    next.events.unshift({
      id: makeId("evt"),
      agent: "System",
      level: "info",
      message:
        "Studio bridge is optional in standalone mode — planning and API keys work without Studio.",
      created: now,
    });
    saveStandaloneSnapshot(next);
    return {
      snapshot: next,
      result: {
        ok: true,
        status: "disconnected",
        message:
          "Studio bridge is optional in standalone mode — connect locally when running live place edits.",
      },
    };
  }

  if (path === "studios") {
    return {
      snapshot: next,
      result: {
        ok: true,
        content: [],
        instances: [],
        message:
          "No Studio instances discovered in standalone browser mode (Studio bridge is optional).",
      },
    };
  }

  if (path === "chat" || path === "tasks/create" || path === "agents/message") {
    const content = String(body.content || body.objective || "").trim();
    const title = content.slice(0, 72) || "Untitled task";
    const taskId = makeId("task");
    const runId = makeId("run");
    const agentName = String(body.agent || "Lead");
    let gameId =
      body.gameId && body.gameId !== "__auto__"
        ? String(body.gameId)
        : next.games[0]?.id || "";
    if (!gameId) {
      gameId = makeId("game");
      next.games.unshift({
        id: gameId,
        name: "Syntra Sandbox",
        description: "Auto-created local planning project.",
        studio_id: "",
        stage: "prototype",
        universe_id: "",
        place_id: "",
        created: now,
      });
    }
    next.runs.unshift({
      id: runId,
      game_id: gameId,
      request: content,
      status: "queued",
      plan_status: body.reviewPlan ? "pending" : "approved",
      created: now,
    });
    next.tasks.unshift({
      id: taskId,
      run_id: runId,
      agent: agentName,
      title,
      instructions: content,
      status: "queued",
      deps: JSON.stringify(
        Array.isArray(body.dependencies) ? body.dependencies : [],
      ),
      result: "",
      attempts: 0,
      steps: 0,
      error: "",
      created: now,
      updated: now,
      priority: Number(body.priority ?? 1),
      acceptance: String(body.acceptance || ""),
      requester: "User",
    });
    if (path === "chat") {
      next.chat.push({
        id: makeId("msg"),
        role: "user",
        content,
        run_id: runId,
        created: now,
      });
    }
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true, id: taskId, taskId } };
  }

  if (path === "tasks/update") {
    next.tasks = next.tasks.map((t: any) =>
      t.id === body.id ? { ...t, ...body, updated: now } : t,
    );
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "tasks/control" || path === "runs/control" || path === "retry") {
    const statusMap: Record<string, string> = {
      pause: "paused",
      resume: "queued",
      cancel: "cancelled",
      retry: "queued",
    };
    const actionKey = path === "retry" ? "retry" : String(body.action || "");
    const nextStatus = statusMap[actionKey];
    if (path === "runs/control") {
      next.runs = next.runs.map((r: any) =>
        r.id === body.id
          ? {
              ...r,
              status:
                actionKey === "cancel"
                  ? "cancelled"
                  : actionKey === "pause"
                    ? "paused"
                    : "active",
            }
          : r,
      );
      if (nextStatus) {
        next.tasks = next.tasks.map((t: any) =>
          t.run_id === body.id && !["completed", "cancelled"].includes(t.status)
            ? { ...t, status: nextStatus, updated: now }
            : t,
        );
      }
    } else if (nextStatus) {
      next.tasks = next.tasks.map((t: any) =>
        t.id === body.id ? { ...t, status: nextStatus, updated: now } : t,
      );
    }
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "plans/approve") {
    next.runs = next.runs.map((r: any) =>
      r.id === body.id ? { ...r, plan_status: "approved" } : r,
    );
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "attention/reply") {
    next.attention = (next.attention || []).map((q: any) =>
      q.id === body.id ? { ...q, status: "resolved", reply: body.reply } : q,
    );
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "approve" || path === "review" || path === "resolve") {
    if (path === "approve") {
      next.approvals = (next.approvals || []).map((a: any) =>
        a.id === body.id
          ? { ...a, status: body.approved ? "approved" : "rejected" }
          : a,
      );
    } else if (path === "review") {
      next.runs = (next.runs || []).map((r: any) =>
        r.id === body.id
          ? { ...r, status: body.accepted ? "accepted" : "active" }
          : r,
      );
    }
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "agents") {
    next.agents = next.agents.map((a: any) =>
      a.name === body.name ? { ...a, ...body } : a,
    );
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "pitches/save") {
    const id = String(body.id || makeId("pitch"));
    const existing = next.pitches.find((p: any) => p.id === id);
    if (existing) {
      next.pitches = next.pitches.map((p: any) =>
        p.id === id ? { ...p, ...body, version: (p.version || 1) + 1 } : p,
      );
    } else {
      next.pitches.unshift({
        id,
        title: String(body.title || "Untitled Pitch"),
        hook: String(body.hook || ""),
        genre: String(body.genre || ""),
        status: "draft",
        version: 1,
        game_id: "",
      });
    }
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true, id } };
  }

  if (path === "pitches/decision") {
    next.pitches = (next.pitches || []).map((p: any) =>
      p.id === body.id ? { ...p, status: body.verdict } : p,
    );
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  if (path === "pitches/convert") {
    const pitch = (next.pitches || []).find((p: any) => p.id === body.id);
    const gameId = pitch?.game_id || makeId("game");
    if (pitch && !pitch.game_id) {
      next.games.unshift({
        id: gameId,
        name: pitch.title || "Converted Project",
        description: pitch.hook || "",
        studio_id: String(body.studioId || ""),
        stage: "concept",
        universe_id: "",
        place_id: "",
        created: now,
      });
      next.pitches = next.pitches.map((p: any) =>
        p.id === body.id ? { ...p, game_id: gameId } : p,
      );
    }
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true, gameId } };
  }

  if (path === "workspace/reset/preview") {
    return {
      snapshot: next,
      result: {
        token: "standalone-reset",
        scope: body.scope || "connection",
        uncertainOperations: 0,
        counts: {
          games: next.games.length,
          runs: next.runs.length,
          tasks: next.tasks.length,
          pitches: next.pitches.length,
          assets: 0,
        },
        phrase: body.scope === "everything" ? "RESET EVERYTHING" : "RESET STUDIO",
      },
    };
  }

  if (path === "workspace/reset/confirm") {
    const fresh = createStandaloneSnapshot();
    if (body.scope !== "everything") {
      fresh.games = next.games;
      fresh.runs = next.runs;
      fresh.tasks = next.tasks;
      fresh.pitches = next.pitches;
      fresh.standaloneKeys = next.standaloneKeys;
      fresh.provider = next.provider;
      fresh.keyConfigured = next.keyConfigured;
    }
    saveStandaloneSnapshot(fresh);
    return {
      snapshot: fresh,
      result: { ok: true, scope: body.scope || "connection", backup: "local-browser" },
    };
  }

  if (path === "studio/switch/preview") {
    return {
      snapshot: next,
      result: {
        token: "standalone-switch",
        gameName:
          next.games.find((g: any) => g.id === body.gameId)?.name || "Project",
        oldStudioId: body.oldStudioId || "",
        newStudioId: body.newStudioId || "",
        target: { name: "Manual Studio ID", placeId: "" },
        runCount: 0,
        taskCount: 0,
      },
    };
  }

  if (path === "studio/switch/confirm") {
    saveStandaloneSnapshot(next);
    return { snapshot: next, result: { ok: true } };
  }

  return {
    snapshot: next,
    result: {
      ok: true,
      message: "Updated local standalone workspace state.",
    },
  };
}
