import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import { db, dataDir, get, set, event, task } from "./store";
import { OperationError, redact } from "./errors";
import { codexAgentModel } from "../src/lib/model-presets";

const require = createRequire(import.meta.url);
const SESSION_STATUS = ["idle", "running", "error"] as const;
const APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export type CodexDynamicTool = {
  name: string;
  description: string;
  inputSchema: any;
};

export type CodexToolCall = {
  tool: string;
  arguments: any;
  callId: string;
  threadId: string;
  turnId: string;
  signal?: AbortSignal;
};

type RpcResponse = { id: number; result?: any; error?: any };
type ActiveTurn = {
  sessionId: string;
  threadId: string;
  turnId: string;
  taskId?: string;
  text: string;
  diff: string;
  usage: any;
  error: string;
  status: string;
  resolve: (value: any) => void;
  reject: (error: unknown) => void;
  settled: boolean;
  lastPersisted: number;
  onText?: (text: string) => void;
  abort?: () => void;
  toolHandler?: (call: CodexToolCall) => Promise<any>;
};

type PendingApproval = {
  approvalId: string;
  rpcId: string | number;
  sessionId: string;
  threadId: string;
  turnId: string;
  kind: string;
  questions?: any[];
  resolve: (value: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

function codexHome() {
  const path = resolve(dataDir, "codex-home");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows does not implement POSIX modes; the directory remains user-local.
  }
  return path;
}

function projectRoot() {
  const configured = get<string>("codexProjectRoot") || process.cwd();
  return realpathSync(resolve(configured));
}

export function validateCodexCwd(value?: string) {
  const root = projectRoot();
  let cwd: string;
  try {
    cwd = realpathSync(resolve(value || root));
  } catch {
    throw new OperationError("Codex project directory does not exist");
  }
  if (!statSync(cwd).isDirectory())
    throw new OperationError("Codex project path must be a directory");
  const rel = relative(root, cwd);
  if (rel.startsWith("..") || isAbsolute(rel))
    throw new OperationError(
      "Codex sessions must stay inside the configured project root",
    );
  return cwd;
}

function sandboxMode() {
  const value = get<string>("codexSandbox");
  return value === "read-only" ? "read-only" : "workspace-write";
}

function sandboxPolicy(cwd: string) {
  return sandboxMode() === "read-only"
    ? { type: "readOnly", networkAccess: Boolean(get("codexNetworkAccess")) }
    : {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: Boolean(get("codexNetworkAccess")),
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
}

function modelFor(sessionModel?: string) {
  return (
    sessionModel ||
    get<string>("codexDefaultModel") ||
    process.env.CODEX_MODEL ||
    codexAgentModel
  );
}

function childEnv() {
  const keep = [
    "PATH",
    "HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROGRAMFILES(X86)",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "SHELL",
    "NO_COLOR",
  ];
  const env: Record<string, string> = {};
  for (const key of keep) if (process.env[key]) env[key] = process.env[key]!;
  env.CODEX_HOME = codexHome();
  // Only a Codex-specific environment credential is forwarded. OpenRouter,
  // NVIDIA and unrelated process secrets are deliberately excluded.
  if (process.env.CODEX_API_KEY)
    env.CODEX_API_KEY = process.env.CODEX_API_KEY;
  return env;
}

function binary() {
  const configured = process.env.CODEX_APP_SERVER_COMMAND;
  if (configured) {
    let args: string[] = [];
    try {
      const parsed = JSON.parse(process.env.CODEX_APP_SERVER_ARGS || "[]");
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string"))
        args = parsed;
    } catch {
      throw new OperationError("CODEX_APP_SERVER_ARGS must be a JSON array");
    }
    return { command: configured, args };
  }
  const local = resolve(
    process.cwd(),
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js",
  );
  try {
    const pkg = require.resolve("@openai/codex/package.json");
    const cli = resolve(dirname(pkg), "bin", "codex.js");
    if (existsSync(cli)) return { command: process.execPath, args: [cli, "app-server"] };
  } catch {
    // Bundled server code can hide the package resolver; use the project copy.
  }
  if (existsSync(local))
    return { command: process.execPath, args: [local, "app-server"] };
  return { command: process.env.CODEX_COMMAND || "codex", args: ["app-server"] };
}

function clip(value: unknown, limit = 24000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit)}\n…truncated` : text;
}

function recordEvent(
  sessionId: string,
  turnId: string | null,
  type: string,
  payload: unknown,
) {
  db.prepare(
    "INSERT INTO codex_events(session_id,turn_id,type,payload) VALUES (?,?,?,?)",
  ).run(sessionId, turnId, type, clip(payload));
  // Bound per-session history without touching the latest 400 events.
  db.prepare(
    "DELETE FROM codex_events WHERE session_id=? AND id NOT IN (SELECT id FROM codex_events WHERE session_id=? ORDER BY id DESC LIMIT 400)",
  ).run(sessionId, sessionId);
}

function session(id: string) {
  const row: any = db
    .prepare("SELECT * FROM codex_sessions WHERE id=?")
    .get(id);
  if (!row) throw new OperationError("Codex session not found");
  return row;
}

function turn(id: string) {
  const row: any = db.prepare("SELECT * FROM codex_turns WHERE id=?").get(id);
  if (!row) throw new OperationError("Codex turn not found");
  return row;
}

export function codexTaskSession(taskId: string) {
  return db
    .prepare(
      "SELECT * FROM codex_sessions WHERE task_id=? ORDER BY rowid DESC LIMIT 1",
    )
    .get(taskId) as any;
}

export function codexSessions(includeArchived = false) {
  return db
    .prepare(
      `SELECT s.*,
        (SELECT id FROM codex_turns t WHERE t.session_id=s.id ORDER BY t.rowid DESC LIMIT 1) AS last_turn_id,
        (SELECT status FROM codex_turns t WHERE t.session_id=s.id ORDER BY t.rowid DESC LIMIT 1) AS last_turn_status,
        (SELECT substr(result,1,500) FROM codex_turns t WHERE t.session_id=s.id ORDER BY t.rowid DESC LIMIT 1) AS last_result,
        (SELECT count(*) FROM approvals a WHERE a.session_id=s.id AND a.status='pending') AS pending_approvals
       FROM codex_sessions s
       ${includeArchived ? "" : "WHERE s.archived=0"}
       ORDER BY s.updated DESC, s.rowid DESC LIMIT 100`,
    )
    .all();
}

export function codexSessionDetail(id: string) {
  const s = session(id);
  return {
    session: s,
    turns: db
      .prepare(
        "SELECT id,session_id,task_id,prompt,status,result,diff,error,usage,review_status,review_note,reviewed_at,created,updated FROM codex_turns WHERE session_id=? ORDER BY rowid DESC LIMIT 50",
      )
      .all(id),
    events: db
      .prepare(
        "SELECT id,session_id,turn_id,type,payload,created FROM codex_events WHERE session_id=? ORDER BY id DESC LIMIT 250",
      )
      .all(id)
      .reverse(),
    approvals: db
      .prepare(
        "SELECT * FROM approvals WHERE session_id=? ORDER BY created DESC LIMIT 100",
      )
      .all(id),
  };
}

export function codexUsage() {
  return db
    .prepare(
      "SELECT COALESCE(SUM(input_tokens),0) AS inputTokens,COALESCE(SUM(output_tokens),0) AS outputTokens,count(*) AS calls,SUM(CASE WHEN status='unpriced' THEN 1 ELSE 0 END) AS unpriced FROM usage WHERE provider='codex'",
    )
    .get();
}

class CodexManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private activeByThread = new Map<string, ActiveTurn>();
  private activeByTurn = new Map<string, ActiveTurn>();
  private loaded = new Set<string>();
  private approvals = new Map<string, PendingApproval>();
  private buffer = "";
  private stderr = "";
  private error = "";
  private account: any = get("codexAccount") || null;
  private requiresAuth = true;
  private models: any[] = [];
  private login: any = null;
  private shuttingDown = false;

  busy() {
    return this.activeByTurn.size > 0;
  }

  status() {
    return {
      available: this.available(),
      running: !!this.child && !this.child.killed,
      initialized: !!this.child && !this.starting && !this.error,
      starting: !!this.starting,
      account: this.account,
      requiresOpenaiAuth: this.requiresAuth,
      models: this.models,
      login: this.login,
      error: this.error,
      projectRoot: (() => {
        try {
          return projectRoot();
        } catch {
          return get("codexProjectRoot") || "";
        }
      })(),
      sandbox: sandboxMode(),
      defaultModel: get<string>("codexDefaultModel") || modelFor(),
      networkAccess: Boolean(get("codexNetworkAccess")),
      autoApprove: Boolean(get("codexAutoApprove")),
      usage: codexUsage(),
      homeConfigured: !!process.env.CODEX_HOME,
      environmentKey: !!process.env.CODEX_API_KEY,
    };
  }

  private available() {
    try {
      const b = binary();
      if (process.env.CODEX_APP_SERVER_COMMAND) return true;
      if (b.command === process.execPath)
        return existsSync(b.args[0]);
      return true;
    } catch {
      return false;
    }
  }

  async ensureStarted() {
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    if (!this.available())
      throw new OperationError(
        "OpenAI Codex is not installed. Run npm ci, then reload the worker. The @openai/codex package supplies the app-server binary.",
      );
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async start() {
    const b = binary();
    this.error = "";
    this.stderr = "";
    this.buffer = "";
    this.loaded.clear();
    const child = spawn(b.command, b.args, {
      cwd: validateCodexCwd(get<string>("codexProjectRoot")),
      env: childEnv() as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8000);
      for (const line of chunk.split("\n")) {
        const text = line.trim();
        if (!text || /^\s*$/.test(text)) continue;
        if (/error|refus|failed|unauthorized/i.test(text))
          event(`Codex app-server: ${redact(text).slice(0, 500)}`, "Codex", "error");
      }
    });
    child.on("error", (error) => {
      this.error = `Codex app-server failed to start: ${redact(error)}`;
      this.failAll(new OperationError(this.error));
    });
    child.on("exit", (code, signal) => {
      const expected = this.shuttingDown;
      this.child = null;
      this.loaded.clear();
      if (!expected) {
        this.error = `Codex app-server exited (${code ?? signal ?? "unknown"}). ${
          this.stderr ? redact(this.stderr).slice(-1200) : ""
        }`.trim();
        event(this.error, "Codex", "error");
        this.failAll(new OperationError(this.error));
      }
    });
    try {
      await this.request(
        "initialize",
        {
          clientInfo: { name: "syntra_studio", version: "1.0.0" },
          capabilities: { experimentalApi: true },
        },
        25000,
      );
      await this.readAccount();
      await this.refreshModels().catch((error) => {
        event(`Codex model catalog unavailable: ${redact(error)}`, "Codex", "warning");
      });
      event("OpenAI Codex app-server connected", "Codex");
    } catch (error) {
      this.error = redact(error);
      try {
        child.kill();
      } catch {}
      throw new OperationError(this.error);
    }
  }

  private failAll(error: unknown) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    for (const active of this.activeByTurn.values())
      this.settleTurn(active, "failed", redact(error));
    for (const [rpcId, approval] of this.approvals) {
      clearTimeout(approval.timer);
      db.prepare(
        "UPDATE approvals SET status='cancelled',note=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
      ).run("Codex app-server disconnected before a decision", approval.approvalId);
      this.approvals.delete(rpcId);
    }
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > 20 * 1024 * 1024) {
      this.buffer = "";
      event("Codex app-server emitted an oversized protocol frame", "Codex", "error");
      return;
    }
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: any;
      try {
        message = JSON.parse(line);
      } catch {
        event(`Codex protocol warning: ${redact(line).slice(0, 300)}`, "Codex", "warning");
        continue;
      }
      this.handle(message);
    }
  }

  private handle(message: any) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(Number(message.id));
      if (message.error)
        pending.reject(
          new OperationError(
            `Codex ${message.error.message || "request failed"}${
              message.error.data ? `: ${clip(message.error.data, 800)}` : ""
            }`,
          ),
        );
      else pending.resolve(message.result);
      return;
    }
    if (message.method && message.id !== undefined) {
      void this.serverRequest(message).catch((error) => {
        this.send({
          id: message.id,
          error: { code: -32603, message: redact(error) },
        });
      });
      return;
    }
    if (message.method) this.notification(message.method, message.params || {});
  }

  private send(value: unknown) {
    if (!this.child || this.child.killed) return false;
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
    return true;
  }

  private request(method: string, params: any, timeout = 30000) {
    const id = this.nextId++;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OperationError(`Codex ${method} timed out`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.send({ id, method, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new OperationError("Codex app-server is not running"));
      }
    });
  }

  private async serverRequest(message: any) {
    const method = message.method;
    const params = message.params || {};
    if (method === "item/tool/call") {
      const active = this.activeByThread.get(params.threadId || "");
      if (!active?.toolHandler) {
        this.send({
          id: message.id,
          result: {
            contentItems: [
              {
                type: "inputText",
                text: "This Syntra Codex session has no dynamic tool handler.",
              },
            ],
            success: false,
          },
        });
        return;
      }
      try {
        const output = await active.toolHandler({
          tool: params.tool,
          arguments: params.arguments,
          callId: params.callId,
          threadId: params.threadId,
          turnId: params.turnId || active.turnId,
        });
        this.send({
          id: message.id,
          result: {
            contentItems: [
              {
                type: "inputText",
                text:
                  typeof output === "string"
                    ? output
                    : JSON.stringify(output ?? {}),
              },
            ],
            success: true,
          },
        });
      } catch (error) {
        this.send({
          id: message.id,
          result: {
            contentItems: [
              { type: "inputText", text: `Tool failed: ${redact(error)}` },
            ],
            success: false,
          },
        });
      }
      return;
    }
    if (
      ![
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/permissions/requestApproval",
        "item/tool/requestUserInput",
      ].includes(method)
    ) {
      this.send({
        id: message.id,
        error: {
          code: -32601,
          message: `Syntra does not implement Codex server request ${method}`,
        },
      });
      event(`Codex unsupported interaction: ${method}`, "Codex", "warning");
      return;
    }
    const threadId = params.threadId || "";
    const active = this.activeByThread.get(threadId);
    const turnId = params.turnId || active?.turnId || "";
    const sessionRow =
      (active && this.session(active.sessionId)) ||
      (db
        .prepare("SELECT * FROM codex_sessions WHERE thread_id=?")
        .get(threadId) as any);
    if (!sessionRow) {
      this.send({
        id: message.id,
        error: { code: -32602, message: "Unknown Codex thread" },
      });
      return;
    }
    const kind =
      method === "item/commandExecution/requestApproval"
        ? "command"
        : method === "item/fileChange/requestApproval"
          ? "fileChange"
          : method === "item/permissions/requestApproval"
            ? "permissions"
            : "question";
    const approvalId = randomUUID();
    const taskId = active?.taskId || sessionRow.task_id || `codex-session:${sessionRow.id}`;
    const args = {
      kind,
      method,
      itemId: params.itemId,
      command: params.command || null,
      cwd: params.cwd || null,
      reason: params.reason || null,
      questions: params.questions || null,
      requested: params.permissions || null,
      turnId,
      sessionId: sessionRow.id,
      startedAtMs: params.startedAtMs || Date.now(),
    };
    db.prepare(
      "INSERT INTO approvals(id,task_id,call_id,tool,args,status,provider,session_id,rpc_request_id) VALUES (?,?,?,?,?,'pending','codex',?,?)",
    ).run(
      approvalId,
      taskId,
      String(message.id),
      `codex/${kind}`,
      JSON.stringify(args),
      sessionRow.id,
      String(message.id),
    );
    recordEvent(sessionRow.id, turnId || null, method, params);
    event(
      `Codex ${kind === "question" ? "question" : "approval"} required`,
      "Codex",
    );
    const response = new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        this.approvals.delete(String(message.id));
        db.prepare(
          "UPDATE approvals SET status='cancelled',note=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
        ).run("No decision was recorded before the approval expired", approvalId);
        this.send({
          id: message.id,
          error: { code: -32000, message: "Approval expired without a decision" },
        });
        resolve(null);
      }, APPROVAL_TIMEOUT_MS);
      this.approvals.set(String(message.id), {
        approvalId,
        rpcId: message.id,
        sessionId: sessionRow.id,
        threadId,
        turnId,
        kind,
        questions: params.questions,
        resolve,
        timer,
      });
    });
    if (get("codexAutoApprove") && kind !== "question")
      this.resolveApproval(
        approvalId,
        true,
        "Auto-approved by workspace policy",
      );
    response.then((decision) => {
      if (decision) this.send({ id: message.id, result: decision });
    });
  }

  resolveApproval(approvalId: string, approved: boolean, note = "") {
    const row: any = db
      .prepare("SELECT * FROM approvals WHERE id=? AND provider='codex'")
      .get(approvalId);
    if (!row || row.status !== "pending") return false;
    const pending = this.approvals.get(String(row.rpc_request_id));
    let decision: any;
    if (pending?.kind === "question") {
      const answers: Record<string, any> = {};
      for (const question of pending.questions || [])
        answers[question.id] = {
          answers: [
            approved
              ? note.trim() || "Proceed using your best judgment."
              : "The user declined to answer; use your best judgment or stop.",
          ],
        };
      decision = { answers };
    } else if (pending?.kind === "permissions") {
      const requested = JSON.parse(row.args).requested;
      decision = {
        permissions: approved ? requested || {} : {},
        scope: "turn",
      };
    } else {
      decision = { decision: approved ? "accept" : "decline" };
    }
    db.prepare(
      "UPDATE approvals SET status=?,note=?,reviewer='User',decided_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(approved ? "approved" : "rejected", note, approvalId);
    if (pending) {
      clearTimeout(pending.timer);
      this.approvals.delete(String(pending.rpcId));
      pending.resolve(decision);
    }
    db.prepare(
      "INSERT INTO review_events(id,target_kind,target_id,verdict,note,reviewer) VALUES (?,?,?,?,?, 'User')",
    ).run(
      randomUUID(),
      "codex_approval",
      approvalId,
      approved ? "approved" : "rejected",
      note,
    );
    event(
      approved ? "Codex operation approved" : "Codex operation rejected",
      "User",
    );
    return true;
  }

  private session(id: string) {
    return session(id);
  }

  private notification(method: string, params: any) {
    if (method === "account/login/completed") {
      this.login = null;
      if (params.success) {
        void this.readAccount().catch((error) =>
          event(redact(error), "Codex", "error"),
        );
      } else {
        this.error = params.error || "Codex sign-in failed";
        event(this.error, "Codex", "error");
      }
      set("codexLogin", params);
      return;
    }
    if (method === "thread/name/updated") {
      if (params.threadId && params.name)
        db.prepare(
          "UPDATE codex_sessions SET title=?,updated=CURRENT_TIMESTAMP WHERE thread_id=?",
        ).run(String(params.name).slice(0, 200), params.threadId);
      return;
    }
    if (method === "configWarning") {
      const warningSession = this.sessionForThread(params.threadId);
      if (warningSession)
        recordEvent(warningSession.id, params.threadId || null, method, params);
      event(`Codex configuration warning: ${clip(params.summary, 500)}`, "Codex", "warning");
      return;
    }
    const active =
      (params.turnId && this.activeByTurn.get(params.turnId)) ||
      (params.threadId && this.activeByThread.get(params.threadId)) ||
      null;
    if (!active && !params.threadId) return;
    const sessionId =
      active?.sessionId || this.sessionForThread(params.threadId)?.id;
    if (!sessionId) return;
    const turnId = params.turnId || active?.turnId || null;
    const streaming = [
      "item/agentMessage/delta",
      "item/plan/delta",
      "item/reasoning/textDelta",
      "item/reasoning/summaryTextDelta",
      "turn/diff/updated",
    ];
    if (!streaming.includes(method))
      recordEvent(sessionId, turnId, method, params);

    if (method === "thread/status/changed") {
      const value = params.status?.type;
      if (active) return;
      db.prepare(
        "UPDATE codex_sessions SET status=?,updated=CURRENT_TIMESTAMP WHERE id=?",
      ).run(value === "active" ? "running" : value === "systemError" ? "error" : "idle", sessionId);
      return;
    }
    if (method === "item/agentMessage/delta" && active) {
      active.text += params.delta || "";
      this.persistStreaming(active);
      active.onText?.(active.text);
      return;
    }
    if (method === "turn/diff/updated" && active) {
      const value = String(params.diff || "");
      // Prefer the path-labelled fileChange diff; turn-level diffs often omit
      // filenames and should not erase reviewable evidence.
      if (value && !active.diff.includes("--- ")) active.diff = value;
      this.persistStreaming(active);
      return;
    }
    if (method === "item/completed" && active) {
      const item = params.item || {};
      if (item.type === "agentMessage" && item.text)
        active.text = String(item.text);
      if (item.type === "fileChange" && Array.isArray(item.changes)) {
        const diff = item.changes
          .map((change: any) => {
            const path = change.path || "unknown path";
            return `--- ${path}\n${change.diff || ""}`;
          })
          .join("\n");
        if (diff) active.diff = diff;
      }
      this.persistStreaming(active, true);
      return;
    }
    if (method === "thread/tokenUsage/updated" && active) {
      active.usage = params.tokenUsage || null;
      this.persistStreaming(active, true);
      return;
    }
    if (method === "error" && active) {
      active.error = params.error?.message || "Codex turn error";
      if (!params.willRetry) active.status = "failed";
      return;
    }
    if (method === "turn/completed" && active) {
      const value = params.turn || {};
      this.settleTurn(
        active,
        value.status || "completed",
        value.error?.message || active.error,
        value,
      );
      return;
    }
    if (method === "thread/closed" && active) {
      this.settleTurn(active, "interrupted", "Codex thread closed");
    }
  }

  private sessionForThread(threadId: string) {
    if (!threadId) return null;
    return db
      .prepare("SELECT * FROM codex_sessions WHERE thread_id=?")
      .get(threadId) as any;
  }

  private persistStreaming(active: ActiveTurn, force = false) {
    const now = Date.now();
    if (!force && now - active.lastPersisted < 300) return;
    active.lastPersisted = now;
    db.prepare(
      "UPDATE codex_turns SET result=?,diff=?,usage=?,updated=CURRENT_TIMESTAMP WHERE id=?",
    ).run(
      active.text.slice(0, 120000),
      active.diff.slice(0, 240000),
      JSON.stringify(active.usage || {}),
      active.turnId,
    );
  }

  private settleTurn(
    active: ActiveTurn,
    status: string,
    error = "",
    raw: any = null,
  ) {
    if (active.settled) return;
    active.settled = true;
    if (raw && Array.isArray(raw.items) && !active.text) {
      const messages = raw.items
        .filter((item: any) => item.type === "agentMessage" && item.text)
        .map((item: any) => item.text);
      if (messages.length) active.text = messages.join("\n\n");
    }
    const normalized =
      status === "completed"
        ? "completed"
        : status === "interrupted"
          ? "interrupted"
          : "failed";
    db.prepare(
      "UPDATE codex_turns SET status=?,result=?,diff=?,usage=?,error=?,updated=CURRENT_TIMESTAMP WHERE id=?",
    ).run(
      normalized,
      active.text.slice(0, 120000),
      active.diff.slice(0, 240000),
      JSON.stringify(active.usage || {}),
      error ? redact(error) : null,
      active.turnId,
    );
    const total = active.usage?.total;
    if (total)
      db.prepare(
        "INSERT OR REPLACE INTO usage(id,task_id,agent,model,input_tokens,output_tokens,cost,reserved,status,provider) VALUES (?,?,?,?,?,?,NULL,0,'unpriced','codex')",
      ).run(
        `codex:${active.turnId}`,
        active.taskId || null,
        "Codex",
        modelFor(),
        Number(total.inputTokens) || 0,
        Number(total.outputTokens) || 0,
      );
    db.prepare(
      "UPDATE codex_sessions SET status=?,updated=CURRENT_TIMESTAMP WHERE id=?",
    ).run(normalized === "completed" ? "idle" : "error", active.sessionId);
    this.activeByThread.delete(active.threadId);
    this.activeByTurn.delete(active.turnId);
    if (active.abort)
      active.abort();
    if (normalized === "completed") {
      active.resolve({
        turnId: active.turnId,
        text: active.text,
        diff: active.diff,
        usage: active.usage,
      });
    } else {
      const message =
        error ||
        `Codex turn ${normalized}`;
      const nonRetry = /unauthor|usage limit|rate limit|context|not found|bad request|policy/i.test(
        message,
      );
      active.reject(
        new OperationError(
          `Codex ${normalized}: ${redact(message)}`,
          !nonRetry && /overload|temporar|reconnect|timeout/i.test(message),
          normalized === "interrupted",
        ),
      );
    }
  }

  private async readAccount() {
    const result = await this.request("account/read", {}, 20000);
    this.account = result?.account || null;
    this.requiresAuth = Boolean(result?.requiresOpenaiAuth);
    set("codexAccount", this.account);
    return result;
  }

  async refreshAccount() {
    await this.ensureStarted();
    return this.readAccount();
  }

  async refreshModels() {
    await this.ensureStarted();
    const result = await this.request("model/list", { limit: 100 }, 25000);
    this.models = Array.isArray(result?.data)
      ? result.data.map((model: any) => ({
          id: model.id || model.model,
          name: model.displayName || model.id || model.model,
          description: model.description || "",
          default: !!model.isDefault,
          hidden: !!model.hidden,
          efforts: model.supportedReasoningEfforts || [],
        }))
      : [];
    return this.models;
  }

  private async threadParams(
    cwd: string,
    model?: string,
    dynamicTools?: CodexDynamicTool[],
  ) {
    return {
      cwd,
      model: model || undefined,
      ...(dynamicTools?.length ? { dynamicTools } : {}),
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: sandboxMode(),
      developerInstructions:
        "You are Codex operating inside Syntra Studio. Work only in the selected local project, follow AGENTS.md, inspect before editing, run relevant checks, and report exact changed paths and test evidence. All file and command operations are reviewed by a human.",
      sessionStartSource: "startup",
      threadSource: "user",
    };
  }

  async createSession(input: {
    title?: string;
    cwd?: string;
    model?: string;
    taskId?: string;
    dynamicTools?: CodexDynamicTool[];
  }) {
    await this.ensureStarted();
    const cwd = validateCodexCwd(input.cwd || get<string>("codexProjectRoot"));
    const result = await this.request(
      "thread/start",
      await this.threadParams(cwd, input.model, input.dynamicTools),
      30000,
    );
    const thread = result?.thread || {};
    const id = randomUUID();
    db.prepare(
      "INSERT INTO codex_sessions(id,thread_id,title,cwd,model,status,task_id) VALUES (?,?,?,?,?, 'idle',?)",
    ).run(
      id,
      thread.id,
      String(input.title || "Codex session").slice(0, 200),
      cwd,
      String(result?.model || modelFor() || "").slice(0, 200),
      input.taskId || null,
    );
    this.loaded.add(thread.id);
    event(`Codex session created: ${input.title || "Codex session"}`, "Codex");
    return session(id);
  }

  private async resume(sessionRow: any) {
    if (this.loaded.has(sessionRow.thread_id)) return;
    try {
      const result = await this.request(
        "thread/resume",
        {
          threadId: sessionRow.thread_id,
          cwd: sessionRow.cwd,
          model: sessionRow.model || undefined,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: sandboxMode(),
          excludeTurns: true,
        },
        30000,
      );
      this.loaded.add(result?.thread?.id || sessionRow.thread_id);
    } catch (error) {
      if (/already|loaded|active/i.test(redact(error))) {
        this.loaded.add(sessionRow.thread_id);
        return;
      }
      throw error;
    }
  }

  async runSessionTurn(input: {
    sessionId: string;
    prompt: string;
    taskId?: string;
    signal?: AbortSignal;
    onText?: (text: string) => void;
    dynamicTools?: CodexDynamicTool[];
    toolHandler?: (call: CodexToolCall) => Promise<any>;
  }) {
    await this.ensureStarted();
    if (this.account === null && this.requiresAuth && !process.env.CODEX_API_KEY)
      throw new OperationError(
        "Sign in to Codex in the Codex page or set CODEX_API_KEY before running a turn.",
      );
    const sessionRow = session(input.sessionId);
    if (sessionRow.archived) throw new OperationError("Codex session is archived");
    const busy = [...this.activeByThread.values()].find(
      (active) => active.sessionId === sessionRow.id,
    );
    if (busy)
      throw new OperationError(
        "This Codex session already has an active turn. Interrupt it or wait for completion.",
      );
    await this.resume(sessionRow);
    const cwd = validateCodexCwd(sessionRow.cwd);
    const active: ActiveTurn = {
      sessionId: sessionRow.id,
      threadId: sessionRow.thread_id,
      turnId: "",
      taskId: input.taskId || sessionRow.task_id || undefined,
      text: "",
      diff: "",
      usage: null,
      error: "",
      status: "inProgress",
      resolve: () => {},
      reject: () => {},
      settled: false,
      lastPersisted: 0,
      onText: input.onText,
      toolHandler: input.toolHandler,
    };
    const done = new Promise<any>((resolve, reject) => {
      active.resolve = resolve;
      active.reject = reject;
    });
    this.activeByThread.set(active.threadId, active);
    db.prepare(
      "UPDATE codex_sessions SET status='running',updated=CURRENT_TIMESTAMP WHERE id=?",
    ).run(active.sessionId);
    try {
      const result = await this.request(
        "turn/start",
        {
          threadId: active.threadId,
          input: [{ type: "text", text: input.prompt.slice(0, 120000) }],
          cwd,
          model: sessionRow.model || modelFor() || undefined,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandboxPolicy: sandboxPolicy(cwd),
        },
        30000,
      );
      const turnId = result?.turn?.id;
      if (!turnId) throw new OperationError("Codex did not return a turn ID");
      active.turnId = turnId;
      this.activeByTurn.set(turnId, active);
      db.prepare(
        "INSERT INTO codex_turns(id,session_id,task_id,prompt) VALUES (?,?,?,?)",
      ).run(
        turnId,
        active.sessionId,
        active.taskId || null,
        input.prompt.slice(0, 120000),
      );
      recordEvent(active.sessionId, turnId, "turn/started", result.turn);
    } catch (error) {
      if (!active.settled) {
        active.settled = true;
        this.activeByThread.delete(active.threadId);
        db.prepare(
          "UPDATE codex_sessions SET status='idle',updated=CURRENT_TIMESTAMP WHERE id=?",
        ).run(active.sessionId);
        active.reject(error);
      }
      throw error;
    }
    if (input.signal) {
      const abort = () =>
        void this.interrupt(active.threadId, active.turnId).catch((error) =>
          event(`Codex interrupt failed: ${redact(error)}`, "Codex", "error"),
        );
      if (input.signal.aborted) abort();
      else {
        input.signal.addEventListener("abort", abort, { once: true });
        active.abort = () => input.signal!.removeEventListener("abort", abort);
      }
    }
    return done;
  }

  async interruptSession(sessionId: string) {
    const active = [...this.activeByTurn.values()].find(
      (value) => value.sessionId === sessionId,
    );
    if (!active) return false;
    await this.interrupt(active.threadId, active.turnId);
    return true;
  }

  async interrupt(threadId: string, turnId?: string) {
    if (!this.child) return;
    const active = this.activeByThread.get(threadId);
    const target = turnId || active?.turnId;
    if (!target) return;
    this.cancelApprovals(threadId, "Turn interrupted before a decision");
    await this.request("turn/interrupt", { threadId, turnId: target }, 15000);
    if (active && !active.settled) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 15000);
        const check = setInterval(() => {
          if (active.settled) {
            clearInterval(check);
            clearTimeout(timer);
            resolve();
          }
        }, 100);
      });
      if (!active.settled)
        this.settleTurn(active, "interrupted", "Interrupt was not acknowledged");
    }
  }

  interruptForTask(taskId: string) {
    const active = [...this.activeByTurn.values()].find(
      (value) => value.taskId === taskId,
    );
    if (!active) return;
    void this.interrupt(active.threadId, active.turnId).catch((error) =>
      event(`Codex interrupt failed: ${redact(error)}`, "Codex", "error"),
    );
  }

  private cancelApprovals(threadId: string, note: string) {
    for (const [rpcId, approval] of this.approvals)
      if (approval.threadId === threadId) {
        clearTimeout(approval.timer);
        this.approvals.delete(rpcId);
        db.prepare(
          "UPDATE approvals SET status='cancelled',note=?,decided_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
        ).run(note, approval.approvalId);
        this.send({
          id: approval.rpcId,
          error: { code: -32000, message: note },
        });
      }
  }

  async loginApiKey(apiKey: string) {
    const value = z.string().trim().min(16).max(4096).parse(apiKey);
    await this.ensureStarted();
    await this.request(
      "account/login/start",
      { type: "apiKey", apiKey: value },
      30000,
    );
    const result = await this.readAccount();
    if (!this.account) throw new OperationError("Codex did not accept the API key");
    event("Codex signed in with an API key", "User");
    return { account: this.account, requiresOpenaiAuth: this.requiresAuth, result };
  }

  async loginChatgpt(device = false) {
    await this.ensureStarted();
    const result = await this.request(
      "account/login/start",
      device
        ? { type: "chatgptDeviceCode" }
        : { type: "chatgpt", codexStreamlinedLogin: true },
      30000,
    );
    this.login = result;
    set("codexLogin", result);
    return result;
  }

  async cancelLogin(loginId?: string) {
    await this.ensureStarted();
    const result = await this.request(
      "account/login/cancel",
      { loginId: loginId || this.login?.loginId },
      15000,
    );
    this.login = null;
    return result;
  }

  async logout() {
    await this.ensureStarted();
    await this.request("account/logout", null, 20000);
    this.account = null;
    set("codexAccount", null);
    event("Codex signed out", "User");
    return { ok: true };
  }

  async archiveSession(id: string, archived = true) {
    session(id);
    if (
      [...this.activeByThread.values()].some(
        (active) => active.sessionId === id,
      )
    )
      throw new OperationError("Interrupt the active Codex turn before archiving");
    db.prepare(
      "UPDATE codex_sessions SET archived=?,updated=CURRENT_TIMESTAMP WHERE id=?",
    ).run(archived ? 1 : 0, id);
    return { ok: true };
  }

  review(sessionId: string, turnId: string, accepted: boolean, note = "") {
    session(sessionId);
    const reviewed = turn(turnId);
    if (reviewed.session_id !== sessionId)
      throw new OperationError("Turn does not belong to this session");
    if (!["completed", "interrupted", "failed"].includes(reviewed.status))
      throw new OperationError("Wait for the Codex turn to finish before reviewing");
    db.prepare(
      "UPDATE codex_turns SET review_status=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND session_id=?",
    ).run(accepted ? "accepted" : "changes_requested", note, turnId, sessionId);
    db.prepare(
      "INSERT INTO review_events(id,target_kind,target_id,verdict,note,reviewer) VALUES (?,?,?,?,?,'User')",
    ).run(
      randomUUID(),
      "codex_turn",
      turnId,
      accepted ? "accepted" : "changes_requested",
      note,
    );
    return { ok: true };
  }

  inspectTask(taskId: string) {
    const row = codexTaskSession(taskId);
    if (!row)
      throw new OperationError("No Codex session is linked to this task");
    const turns = db
      .prepare(
        "SELECT id,status,result,diff,error,usage,review_status,review_note,created,updated FROM codex_turns WHERE session_id=? ORDER BY rowid DESC LIMIT 10",
      )
      .all(row.id) as any[];
    return {
      session: {
        id: row.id,
        title: row.title,
        cwd: row.cwd,
        model: row.model,
        status: row.status,
      },
      turns: turns.map((value) => ({
        ...value,
        result: value.result?.slice(0, 24000) || "",
        diff: value.diff?.slice(0, 60000) || "",
      })),
    };
  }

  recover() {
    db.prepare(
      "UPDATE codex_turns SET status='interrupted',error=COALESCE(error,'Worker restarted during this Codex turn'),updated=CURRENT_TIMESTAMP WHERE status='running'",
    ).run();
    db.prepare(
      "UPDATE codex_sessions SET status='idle',updated=CURRENT_TIMESTAMP WHERE status='running'",
    ).run();
    db.prepare(
      "UPDATE approvals SET status='cancelled',note='Worker restarted before a decision',decided_at=CURRENT_TIMESTAMP WHERE provider='codex' AND status='pending'",
    ).run();
    this.failAll(new OperationError("Codex app-server is not running"));
    this.child = null;
    this.loaded.clear();
  }

  shutdown() {
    this.shuttingDown = true;
    try {
      if (this.child) this.child.kill("SIGTERM");
    } catch {}
    this.child = null;
  }
}

export const codex = new CodexManager();
