"use client";
import { readWorkspaceStorage } from "@/lib/workspace-storage";
import {
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
} from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useDesktopPreferences } from "@/lib/desktop";
import { Appearance, Shortcuts } from "./desktop-controls";
import {
  Activity,
  Cpu,
  Keyboard,
  Search,
  ArrowRight,
  Box,
  Gamepad2,
  Gauge,
  GitBranch,
  Link2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Radio,
  Send,
  Settings,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { roles, type Role } from "@/lib/roles";
import { Avatar } from "./agent-avatar";
import Overview from "./overview";
import WorkspaceReset from "./workspace-reset";
import TaskWorkspace, { NewTaskDialog } from "./task-workspace";
import AgentWorkspace, { LeadWorkspace } from "./agent-workspace";
import { ConfirmDialog, Skeleton } from "./ui/workspace-primitives";
import { CustomSelect } from "./ui/custom-select";
import { safeResponseJson } from "@/lib/utils";
import {
  loadStandaloneSnapshot,
  runStandaloneAction,
} from "@/lib/offline-workspace";
import CommandPalette from "./command-palette";
import WorkspaceShell, { navigation as nav } from "./workspace-shell";
const LibraryHub = dynamic(() => import("./library-hub"));
const CodexWorkspace = dynamic(() => import("./codex-workspace"));
const GameIntelligence = dynamic(() => import("./game-intelligence"));
const IntelligenceSettings = dynamic(() => import("./game-intelligence/settings"));
const GameOps = dynamic(() => import("./game-ops"));
const Market = dynamic(() => import("./market"));
const Pitches = dynamic(() => import("./pitches"));
const Reviews = dynamic(() => import("./reviews"));

const money = (n: number) => `$${(n || 0).toFixed(4)}`;
const date = (s: string) =>
  new Date(s.replace(" ", "T") + "Z").toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value.replaceAll(" ", "-")}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}
export default function Studio({
  page,
  routeTaskId = "",
  routeAgent = "",
}: {
  page: string;
  routeTaskId?: string;
  routeAgent?: string;
}) {
  const router = useRouter();
  const [preferences, updatePreferences] = useDesktopPreferences();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [initialTask, setInitialTask] = useState("");
  const [pauseConfirm, setPauseConfirm] = useState(false);
  function openNewTask(initial = "") {
    setInitialTask(initial);
    setNewTaskOpen(true);
  }
  const [noticeError, setNoticeError] = useState(false);
  const [focusedTaskId, setFocusedTaskId] = useState("");
  const [taskFocusVersion, setTaskFocusVersion] = useState(0);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const editing =
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        !!document.querySelector("dialog[open]");
      if (editing) return;
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const target = nav[Number(e.key) - 1];
        router.push(target[0] === "home" ? "/" : "/" + target[0]);
      } else if (e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        updatePreferences({ focus: !preferences.focus });
      } else if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [preferences.focus, router, updatePreferences]);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedGame, setSelectedGame] = useState(""),
    [selectedAgent, setSelectedAgent] = useState("Lead"),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [connection, setConnection] = useState("polling"),
    [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.querySelector(".main")?.scrollTo({ top: 0 });
    document.addEventListener("keydown", key);
    setFocusedTaskId(
      routeTaskId || new URLSearchParams(location.search).get("task") || "",
    );
    const agent =
      routeAgent || new URLSearchParams(location.search).get("agent");
    if (agent && agent in roles) setSelectedAgent(agent);
    const game = readWorkspaceStorage("game");
    if (game) setSelectedGame(game);
    return () => document.removeEventListener("keydown", key);
  }, [page, routeTaskId, routeAgent]);
  function chooseGame(id: string) {
    setSelectedGame(id);
    localStorage.setItem("syntra-game", id);
  }
  const [workerOffline, setWorkerOffline] = useState(false);
  const snapshotRequest = useRef<AbortController | null>(null);
  const load = useCallback(async (force = false) => {
    if (snapshotRequest.current && !force) return;
    snapshotRequest.current?.abort();
    const request = new AbortController();
    snapshotRequest.current = request;
    try {
      const r = await fetch("/api/snapshot", {
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      });
      const d = await safeResponseJson(r);
      if (!r.ok) throw new Error(d.error || `Worker unavailable (${r.status})`);
      if (request.signal.aborted) return;
      setWorkerOffline(false);
      setData(d);
      setConnection((prev) => (prev === "live" ? "live" : "polling"));
      setUpdatedAt(Date.now());
      setError("");
    } catch {
      if (request.signal.aborted) return;
      setWorkerOffline(true);
      setConnection("standalone");
      setData((prev: any) =>
        prev?.standaloneMode ? prev : loadStandaloneSnapshot(),
      );
      setUpdatedAt(Date.now());
      setError("");
    } finally {
      if (snapshotRequest.current === request) snapshotRequest.current = null;
    }
  }, []);
  const workerPort = data?.settings.workerPort || 4318;
  useEffect(() => {
    void load();
    let ws: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout>;
    let disposed = false;
    const refreshVisible = () => {
      if (!document.hidden) void load();
    };
    const poll = setInterval(() => {
      if (ws?.readyState !== WebSocket.OPEN) refreshVisible();
    }, 4000);
    document.addEventListener("visibilitychange", refreshVisible);
    const canUseDirectWs =
      typeof window !== "undefined" &&
      location.protocol === "http:" &&
      /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    function connect() {
      if (!canUseDirectWs || disposed) return;
      try {
        ws = new WebSocket(`ws://${location.hostname}:${workerPort}`);
        ws.onopen = () => setConnection("live");
        ws.onmessage = refreshVisible;
        ws.onerror = () => setConnection("polling");
        ws.onclose = () => {
          if (disposed) return;
          setConnection("polling");
          retry = setTimeout(connect, 4000);
        };
      } catch {
        setConnection("polling");
      }
    }
    if (canUseDirectWs) {
      void fetch("/api/health", { cache: "no-store" })
        .then(safeResponseJson)
        .then((health) => {
          if (!disposed && health?.mode === "external") {
            connect();
          }
        })
        .catch(() => {});
    }
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", refreshVisible);
      snapshotRequest.current?.abort();
      snapshotRequest.current = null;
      clearInterval(poll);
      clearTimeout(retry);
      ws?.close();
    };
  }, [load, workerPort]);
  useEffect(() => {
    if (
      data?.games.length &&
      !data.games.some((g: any) => g.id === selectedGame)
    )
      chooseGame(data.games[0].id);
  }, [data, selectedGame]);
  useEffect(() => {
    if (page !== "tasks") return;
    const id =
      focusedTaskId || new URLSearchParams(location.search).get("task");
    if (!id) return;
    const element = document.getElementById(
      `task-${id}`,
    ) as HTMLDetailsElement | null;
    if (element && !element.open) {
      element.open = true;
      element.scrollIntoView({ block: "center" });
    }
  }, [page, data?.tasks?.length, focusedTaskId, taskFocusVersion]);
  async function act(path: string, body: any) {
    setBusy(true);
    setNotice("");
    setNoticeError(false);
    const notices: Record<string, string> = {
      chat: "Request queued",
      settings: "Settings saved",
      models: "Model catalog refreshed",
      games: "Project added",
      "games/update": "Project updated",
      "tasks/create": "Task created",
      "tasks/update": "Task updated",
      "codex/settings": "Codex settings saved",
      "codex/session/create": "Codex session created",
      "codex/session/turn": "Codex turn started",
      "codex/session/interrupt": "Codex turn interrupted",
      "codex/session/archive": "Codex session updated",
      "codex/session/review": "Codex review recorded",
      "codex/login/api-key": "Codex API key accepted",
      "codex/login/chatgpt": "Complete Codex sign-in in your browser",
      "codex/login/cancel": "Codex sign-in cancelled",
      "codex/logout": "Codex signed out",
      "codex/models": "Codex model catalog refreshed",
      "tasks/control": "Task updated",
      "runs/control": "Run updated",
      "plans/approve": "Execution plan approved",
      "agents/message": "Follow-up queued",
      "attention/reply": "Answer recorded",
      "pitches/save": "Pitch saved",
      "pitches/decision": "Pitch updated",
      "pitches/convert": "Pitch converted to project",
      "market/import": "Market snapshot imported",
      "telemetry/import": "Telemetry imported",
      "assets/save": "Asset saved",
      "assets/verdict": "Asset verdict recorded",
      "assets/archive": "Asset archived",
      "studio/switch/confirm":
        "Studio target updated; the team remains paused",
      "workspace/reset/confirm":
        "Reset complete. Configure Studio in Settings and Games",
      agents: "Agent settings saved",
      approve: "Approval recorded",
      review: "Review recorded",
      resolve: "Operation reconciled",
      retry: "Task queued",
    };

    const runLocal = () => {
      const { snapshot: next, result } = runStandaloneAction(data, path, body);
      setWorkerOffline(true);
      setConnection("standalone");
      setData(next);
      setUpdatedAt(Date.now());
      setNotice(
        result?.message ||
          notices[path] ||
          "Saved locally (standalone mode)",
      );
      return result;
    };

    try {
      if (workerOffline) {
        return runLocal();
      }
      const r = await fetch("/api/" + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(330000),
      });
      if (r.status === 503) {
        return runLocal();
      }
      const out = await safeResponseJson(r);
      if (!r.ok) throw new Error(out.error);
      await load(true);
      if (path === "connect") {
        setNotice(
          out?.status === "connected"
            ? "Connected to Roblox Studio bridge"
            : "Studio bridge is optional — no MCP executable configured or Studio isn't open",
        );
      } else {
        setNotice(out?.message || notices[path] || "");
      }
      return out;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (
        message.includes("Worker unavailable") ||
        message.includes("Failed to fetch") ||
        message.includes("HTML error")
      ) {
        try {
          return runLocal();
        } catch (localErr) {
          setNoticeError(true);
          setNotice(
            localErr instanceof Error ? localErr.message : String(localErr),
          );
          return null;
        }
      }
      setNoticeError(true);
      setNotice(message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const tasks: any[] = data?.tasks || [],
    approvals = (data?.approvals || []).filter(
      (a: any) => a.status === "pending",
    );
  const running = tasks.filter((t) => t.status === "running"),
    done = tasks.filter((t) => t.status === "completed");
  const title = nav.find((n) => n[0] === page)?.[1] || "Overview";
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const content = String(new FormData(form).get("content") || "");
    const result = await act("chat", {
      content,
      gameId: selectedGame || data?.games?.[0]?.id || "",
      reviewPlan: new FormData(form).get("reviewPlan") === "on",
    });
    if (result) form.reset();
    return !!result;
  }
  const composer = (
    <form className="composer" onSubmit={send}>
      <div className="composer-top">
        <MessageSquare size={17} />
        <span>Request to Lead</span>
        <CustomSelect
          variant="bar"
          align="right"
          aria-label="Active game"
          value={selectedGame}
          onValueChange={chooseGame}
          placeholder="Select a game"
        >
          <option value="">Select a game</option>
          {data?.games.map((g: any) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </CustomSelect>
      </div>
      <textarea
        name="content"
        aria-label="Request to Lead"
        required
        maxLength={20000}
        placeholder="Describe your game, a new feature, or something to fix…"
      />
      <label className="checkbox v2-plan-toggle">
        <input type="checkbox" name="reviewPlan" />
        Review Lead’s plan before specialists start
      </label>
      <div className="composer-bottom">
        <span>
          <span className="dot purple" /> Lead will plan and delegate to your
          team
        </span>
        <Button disabled={busy} type="submit">
          Send to Lead <ArrowRight size={15} />
        </Button>
      </div>
    </form>
  );
  return (
    <WorkspaceShell
      page={page}
      data={data}
      selectedGame={selectedGame}
      chooseGame={chooseGame}
      connection={connection}
      updatedAt={updatedAt}
      syncError={!!error}
      refresh={() => load(true)}
      preferences={preferences}
      updatePreferences={updatePreferences}
      openSearch={() => setPaletteOpen(true)}
      openShortcuts={() => setShortcutsOpen(true)}
      selectAgent={setSelectedAgent}
      newTask={() => openNewTask()}
    >
      {shortcutsOpen && <Shortcuts close={() => setShortcutsOpen(false)} />}
      {paletteOpen && (
        <CommandPalette
          tasks={tasks}
          close={() => setPaletteOpen(false)}
          choose={(href) => {
            const taskId = new URL(href, location.origin).searchParams.get(
              "task",
            );
            if (taskId) {
              setFilter("all");
              setQuery("");
              setFocusedTaskId(taskId);
              setTaskFocusVersion((v) => v + 1);
            }
            const name = new URL(href, location.origin).searchParams.get(
              "agent",
            );
            if (name && name in roles) setSelectedAgent(name);
          }}
        />
      )}
      {data && newTaskOpen && (
        <NewTaskDialog
          data={data}
          gameId={selectedGame}
          initial={initialTask}
          act={act}
          busy={busy}
          close={() => setNewTaskOpen(false)}
        />
      )}
      {pauseConfirm && (
        <ConfirmDialog
          title="Pause all agents?"
          confirmLabel="Pause all"
          tone="neutral"
          pending={busy}
          close={() => setPauseConfirm(false)}
          confirm={async () => {
            if (await act("pause", { paused: true })) setPauseConfirm(false);
          }}
        >
          Scheduling and future tool steps will pause. Operations already sent
          to Studio may finish; recorded changes are preserved.
        </ConfirmDialog>
      )}
      <main id="main-content">
        <div className="page-title">
          <div>
            <h1>{page === "home" ? "Your workspace" : title}</h1>
            <p>
              {
                (
                  {
                    home: "Requests, agents and Studio connections.",
                    chat: "Plan changes with Lead and review the results.",
                    team: "Configure agent models, tools and instructions.",
                    tasks: "Inspect work, dependencies and failures.",
                    codex:
                      "Run and review OpenAI Codex sessions in your local project.",
                    games: "Manage local Roblox Studio targets.",
                    "game-intelligence": "Explore public Roblox charts, metrics and history.",
                    reviews: "Approve tool calls and accept verified work.",
                    logs: "Inspect worker events and API usage.",
                    settings: "Codex, Studio connection, runtime limits and appearance.",
                    pitches:
                      "Develop versioned game concepts with source evidence.",
                    market:
                      "Research opportunities from attributed market observations.",
                    library:
                      "Search official documentation and personal references.",
                  } as Record<string, string>
                )[page]
              }
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!data || busy}
            onClick={() =>
              data?.settings.paused
                ? void act("pause", { paused: false })
                : setPauseConfirm(true)
            }
          >
            {data?.settings.paused ? <Play size={15} /> : <Pause size={15} />}{" "}
            {data?.settings.paused ? "Resume team" : "Pause team"}
          </Button>
        </div>
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        {notice && (
          <div
            role={noticeError ? "alert" : "status"}
            className={`alert ${noticeError ? "error" : "success"}`}
          >
            <span>{notice}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!data && !error && page !== "game-intelligence" && <Skeleton page={page} />}
        {data && page === "home" && (
          <Overview
            data={data}
            busy={busy}
            selectedGame={selectedGame}
            act={act}
            send={send}
          />
        )}
        {data && page === "chat" && (
          <LeadWorkspace
            data={data}
            selectedGame={selectedGame}
            composer={composer}
            act={act}
            busy={busy}
          />
        )}
        {data && page === "team" && (
          <AgentWorkspace
            data={data}
            selectedAgent={selectedAgent}
            selectAgent={setSelectedAgent}
            selectedGame={selectedGame}
            act={act}
            busy={busy}
          />
        )}
        {data && page === "codex" && (
          <CodexWorkspace data={data} act={act} busy={busy} />
        )}
        {data && page === "tasks" && (
          <TaskWorkspace
            data={data}
            act={act}
            busy={busy}
            newTask={() => openNewTask()}
            focusedTaskId={focusedTaskId}
            focusVersion={taskFocusVersion}
          />
        )}
        {page === "game-intelligence" && <GameIntelligence />}
        {data && page === "games" && (
          <>
            <Link href="/game-intelligence" className="button button-outline">
              <Gauge size={16} /> Browse Roblox Game Intelligence
            </Link>
            <GameOps
              data={data}
              selectedGame={selectedGame}
              chooseGame={chooseGame}
              act={act}
              busy={busy}
              newTask={openNewTask}
            />
          </>
        )}
        {data && page === "market" && (
          <Market data={data} act={act} newTask={openNewTask} />
        )}
        {data && page === "pitches" && (
          <Pitches data={data} act={act} busy={busy} chooseGame={chooseGame} />
        )}
        {data && page === "reviews" && (
          <Reviews
            data={data}
            busy={busy}
            act={act}
            newTask={openNewTask}
            selectedGame={selectedGame}
          />
        )}
        {data && page === "logs" && (
          <>
            <div className="toolbar">
              <h2>Live activity stream</h2>
              <span className="live">
                <span className="dot green" />
                {connection}
              </span>
            </div>
            <section className="panel">
              <Events events={data.events} />
            </section>
            <section className="panel spaced">
              <h3>API usage ledger</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {[
                        "Time",
                        "Agent",
                        "Model",
                        "Input",
                        "Output",
                        "Cost",
                        "Status",
                      ].map((x) => (
                        <th key={x}>{x}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.usage.map((u: any) => (
                      <tr key={u.id}>
                        <td>{date(u.created)}</td>
                        <td>{u.agent}</td>
                        <td>{u.model}</td>
                        <td>{u.input_tokens ?? "—"}</td>
                        <td>{u.output_tokens ?? "—"}</td>
                        <td>
                          {u.cost === null ? "Not reported" : money(u.cost)}
                          {u.reserved > 0 && (
                            <small> + {money(u.reserved)} reserved</small>
                          )}
                        </td>
                        <td>
                          <Badge value={u.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
        {page === "library" && (
          <LibraryHub
            data={data}
            selectedGame={selectedGame}
            act={act}
            busy={busy}
            newTask={openNewTask}
          />
        )}
        {data && page === "settings" && (
          <>
            <Appearance
              preferences={preferences}
              update={updatePreferences}
              data={data}
            />
            <SettingsForm
              key={data.settings.resetRevision || "initial"}
              data={data}
              busy={busy}
              act={act}
            />
          </>
        )}
        {page === "settings" && <IntelligenceSettings />}
        <footer className="footer">
          <span>
            <ShieldCheck size={12} /> Local workspace{" "}
            <span className="footer-separator">·</span> Your keys stay on your
            device
          </span>
          <button onClick={() => setShortcutsOpen(true)}>
            <Keyboard size={12} /> Keyboard shortcuts
          </button>
        </footer>
      </main>
    </WorkspaceShell>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function TaskRow({ t }: { t: any }) {
  return (
    <div className="task-row">
      <Avatar name={t.agent} size="mini" />
      <div>
        <strong>{t.title}</strong>
        <small>
          {t.agent} <span>·</span> {date(t.created)}
        </small>
      </div>
      <Badge value={t.status} />
    </div>
  );
}
function Events({ events }: { events: any[] }) {
  return (
    <div className="events">
      {events.length ? (
        events.map((e) => (
          <div className="event" key={e.id}>
            <span className={`event-dot ${e.level}`} />
            <div>
              <strong>{e.agent}</strong>
              <p>{e.message}</p>
            </div>
            <time>{date(e.created)}</time>
          </div>
        ))
      ) : (
        <p className="muted-text">Activity appears as your worker runs.</p>
      )}
    </div>
  );
}
function SettingsForm({
  data,
  busy,
  act,
}: {
  data: any;
  busy: boolean;
  act: (p: string, b: any) => Promise<any>;
}) {
  const s = data.settings;
  return (
    <div className="settings-layout">
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          let args;
          try {
            args = JSON.parse(String(f.get("args")));
          } catch {
            e.currentTarget
              .querySelector<HTMLTextAreaElement>("[name=args]")
              ?.setCustomValidity("Enter a JSON array of strings");
            return;
          }
          void act("settings", {
            maxSteps: Number(f.get("maxSteps")),
            concurrency: Number(f.get("concurrency")),
            taskTimeoutMs: Number(f.get("taskTimeoutMs")),
            paused: s.paused,
            approvalRequired: f.get("approvalRequired") === "on",
            mcpCommand: f.get("command"),
            mcpArgs: args,
          });
        }}
      >
        <h3>
          <Link2 size={18} /> Roblox Studio connection
        </h3>
        <p>
          Enable Studio as MCP server in Assistant → Manage MCP Servers. Use the
          official command for your operating system.
        </p>
        <label>
          MCP executable
          <input
            name="command"
            defaultValue={s.mcpCommand}
            placeholder="/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP"
          />
        </label>
        <label>
          Arguments (JSON array)
          <textarea
            name="args"
            defaultValue={JSON.stringify(s.mcpArgs)}
            onChange={(e) => e.target.setCustomValidity("")}
            rows={2}
          />
        </label>
        <label className="checkbox">
          <input
            name="approvalRequired"
            type="checkbox"
            defaultChecked={s.approvalRequired}
          />{" "}
          Require approval for every Studio modification
        </label>
        <hr />
        <h3>
          <Gauge size={18} /> Runtime
        </h3>
        <div className="form-grid">
          <label>
            Concurrent agents (1–3)
            <input
              name="concurrency"
              type="number"
              min="1"
              max="3"
              defaultValue={s.concurrency || 3}
            />
          </label>
          <label>
            Task timeout per execution (milliseconds)
            <input
              name="taskTimeoutMs"
              type="number"
              min="1000"
              max="3600000"
              defaultValue={s.taskTimeoutMs || 600000}
            />
          </label>
          <label>
            Maximum model steps per task
            <input
              name="maxSteps"
              type="number"
              min="5"
              max="100"
              defaultValue={s.maxSteps}
            />
          </label>
        </div>
        <Button disabled={busy}>Save configuration</Button>
      </form>
      <div>
        <section className="panel form spaced">
          <h3>
            <Cpu size={18} /> OpenAI Codex
          </h3>
          <p>
            All eight agents run through the official Codex app-server. Sign
            in, choose the project root, and review Codex sessions on the
            Codex page.
          </p>
          <p>
            <strong>{data.codex?.account ? "Signed in" : "Sign-in required"}</strong>
            {data.codex?.models?.length
              ? ` · ${data.codex.models.length} models available`
              : " · open the Codex page to connect"}
          </p>
          <Button asChild variant="outline">
            <Link href="/codex">Open Codex</Link>
          </Button>
        </section>
        <section className="panel form spaced">
          <h3>
            <Radio size={18} /> Studio bridge <small>(optional)</small>
          </h3>
          <Badge value={s.studioStatus} />
          {s.studioError && (
            <small className="muted-text">{s.studioError}</small>
          )}
          <p>
            {s.studioTools.length} official tools discovered. Connect Roblox
            Studio when executing live place edits; planning, API keys, and
            specifications work without Studio.
          </p>
          <Button disabled={busy} onClick={() => act("connect", {})}>
            Connect / reconnect
          </Button>
        </section>
        <WorkspaceReset data={data} act={act} busy={busy} />
        <section className="panel form spaced">
          <h3>Recovery & rollback</h3>
          <p>
            Syntra Studio records every call and preserves uncertain outcomes
            for inspection. The current official MCP API has no general rollback
            tool. Use Studio’s saved place versions or Undo when applicable;
            verify the restored game before retrying.
          </p>
        </section>
      </div>
    </div>
  );
}
