import { isLibraryTool, libraryToolDefinitions, runLibraryTool } from "./library-tools";
import { creativeDefinitions, isCreativeTool, runCreativeTool } from "./creative-tools";
import { z } from "zod";
import { get, set, event, db } from "./store";
import { redact } from "./errors";
import {
  codex,
  codexSessionDetail,
  codexSessions,
  codexUsage,
  validateCodexCwd,
} from "./codex";

function pausedForCodex(active: Set<string>) {
  if (active.size || codex.busy())
    throw new Error(
      "Wait for active tasks and Codex turns before changing Codex settings or authentication.",
    );
}

export function codexRead(path: string, search: URLSearchParams) {
  if (path === "codex")
    return {
      status: codex.status(),
      sessions: codexSessions(search.get("archived") === "true"),
      usage: codexUsage(),
    };
  if (path === "codex/session") {
    const id = search.get("id");
    if (!id) throw new Error("Codex session ID is required");
    return codexSessionDetail(id);
  }
  return undefined;
}

export async function codexAction(
  path: string,
  body: any,
  active: Set<string>,
) {
  if (!path.startsWith("codex/")) return undefined;
  if (path === "codex/status") {
    try {
      await codex.ensureStarted();
    } catch (error) {
      return {
        ok: false,
        status: codex.status(),
        error: redact(error),
        sessions: codexSessions(),
        usage: codexUsage(),
      };
    }
    return {
      ok: true,
      status: codex.status(),
      sessions: codexSessions(),
      usage: codexUsage(),
    };
  }
  if (path === "codex/refresh") {
    await codex.ensureStarted();
    const account = await codex.refreshAccount();
    await codex.refreshModels().catch(() => undefined);
    return {
      ok: true,
      account,
      status: codex.status(),
      sessions: codexSessions(),
      usage: codexUsage(),
    };
  }
  if (path === "codex/models") {
    await codex.ensureStarted();
    const models = await codex.refreshModels();
    return { ok: true, models, status: codex.status() };
  }
  if (path === "codex/login/api-key") {
    pausedForCodex(active);
    const a = z
      .object({ apiKey: z.string().trim().min(16).max(4096) })
      .parse(body);
    const result = await codex.loginApiKey(a.apiKey);
    return { ok: true, ...result, status: codex.status() };
  }
  if (path === "codex/login/chatgpt") {
    pausedForCodex(active);
    const a = z.object({ device: z.boolean().default(false) }).parse(body);
    const result = await codex.loginChatgpt(a.device);
    return { ok: true, login: result, status: codex.status() };
  }
  if (path === "codex/login/cancel") {
    const a = z.object({ loginId: z.string().max(200).optional() }).parse(body);
    const result = await codex.cancelLogin(a.loginId);
    return { ok: true, result, status: codex.status() };
  }
  if (path === "codex/logout") {
    pausedForCodex(active);
    await codex.logout();
    return { ok: true, status: codex.status() };
  }
  if (path === "codex/settings") {
    pausedForCodex(active);
    const a = z
      .object({
        projectRoot: z.string().trim().min(1).max(2000),
        sandbox: z.enum(["workspace-write", "read-only"]),
        defaultModel: z.string().trim().max(200).default(""),
        networkAccess: z.boolean().default(false),
        autoApprove: z.boolean().default(false),
      })
      .parse(body);
    const previous = get<string>("codexProjectRoot");
    set("codexProjectRoot", a.projectRoot);
    try {
      validateCodexCwd(a.projectRoot);
    } catch (error) {
      set("codexProjectRoot", previous);
      throw error;
    }
    set("codexSandbox", a.sandbox);
    set("codexDefaultModel", a.defaultModel);
    set("codexNetworkAccess", a.networkAccess);
    set("codexAutoApprove", a.autoApprove);
    event("Codex settings saved", "User");
    return { ok: true, status: codex.status() };
  }
  if (path === "codex/session/create") {
    const a = z
      .object({
        title: z.string().trim().min(1).max(200).default("Codex session"),
        cwd: z.string().trim().max(2000).optional(),
        model: z.string().trim().max(200).optional(),
      })
      .parse(body);
    const row = await codex.createSession({
      ...a, dynamicTools: [...creativeDefinitions("Codex"), ...libraryToolDefinitions],
    });
    return { ok: true, session: row, sessions: codexSessions() };
  }
  if (path === "codex/session/turn") {
    const a = z
      .object({
        id: z.string().min(1).max(200),
        prompt: z.string().trim().min(1).max(120000),
      })
      .parse(body);
    const row = codexSessionDetail(a.id).session;
    if (row.task_id)
      throw new Error(
        "This session is owned by a worker task. Use Tasks to retry or follow up.",
      );
    void codex
      .runSessionTurn({
        sessionId: a.id,
        prompt: a.prompt,
        toolHandler: async (call) => {
          if (isLibraryTool(call.tool)) return runLibraryTool("Codex", call.tool, call.arguments ?? {});
          if (!isCreativeTool(call.tool)) throw new Error("Unknown Syntra tool.");
          return runCreativeTool("Codex", call.tool, call.arguments ?? {});
        },
      })
      .catch((error) => {
        db.prepare(
          "UPDATE codex_sessions SET status='error',updated=CURRENT_TIMESTAMP WHERE id=?",
        ).run(a.id);
        event(`Codex turn failed: ${redact(error)}`, "Codex", "error");
      });
    return { ok: true, sessionId: a.id };
  }
  if (path === "codex/session/interrupt") {
    const a = z.object({ id: z.string().min(1).max(200) }).parse(body);
    const interrupted = await codex.interruptSession(a.id);
    if (!interrupted)
      throw new Error("This Codex session has no active turn to interrupt");
    return { ok: true };
  }
  if (path === "codex/session/archive") {
    const a = z
      .object({ id: z.string().min(1).max(200), archived: z.boolean().default(true) })
      .parse(body);
    await codex.archiveSession(a.id, a.archived);
    return { ok: true, sessions: codexSessions() };
  }
  if (path === "codex/session/review") {
    const a = z
      .object({
        sessionId: z.string().min(1).max(200),
        turnId: z.string().min(1).max(200),
        accepted: z.boolean(),
        note: z.string().max(12000).default(""),
      })
      .parse(body);
    if (!a.accepted && a.note.trim().length < 5)
      throw new Error("Describe the changes you want before requesting them");
    codex.review(a.sessionId, a.turnId, a.accepted, a.note);
    return { ok: true };
  }
  if (path === "codex/session/detail") {
    const a = z.object({ id: z.string().min(1).max(200) }).parse(body);
    return codexSessionDetail(a.id);
  }
  throw new Error("Unknown Codex action");
}
