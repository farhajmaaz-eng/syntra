"use client";

import { nativeFolderPicker } from "@/lib/native-desktop";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  CircleCheck,
  CircleX,
  FileDiff,
  KeyRound,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  SquareTerminal,
  Terminal,
} from "lucide-react";
import { Button } from "./ui/button";
import { CustomSelect } from "./ui/custom-select";
import { ConfirmDialog } from "./ui/workspace-primitives";
import { StatusChip, type Act } from "./feature-ui";
import { leadStart } from "@/lib/roles";
import { safeResponseJson } from "@/lib/utils";

function date(value?: string) {
  if (!value) return "—";
  const parsed = new Date(
    /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z",
  );
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}
function num(value: unknown) {
  return Number(value || 0).toLocaleString();
}
function eventText(event: any) {
  const payload = event.payload || {};
  const item = payload.item;
  if (item) {
    if (item.type === "userMessage")
      return item.content?.map((x: any) => x.text).filter(Boolean).join("\n");
    if (item.type === "agentMessage") return item.text;
    if (item.type === "commandExecution")
      return `$ ${item.command || "command"}\n${item.aggregatedOutput || ""}`;
    if (item.type === "fileChange")
      return (item.changes || [])
        .map((change: any) => `${change.kind?.type || "update"} ${change.path}`)
        .join("\n");
    if (item.type === "reasoning")
      return [...(item.summary || []), ...(item.content || [])].join("\n");
  }
  if (event.type === "turn/started") return "Turn started";
  if (event.type === "turn/completed")
    return `Turn ${payload.turn?.status || "completed"}`;
  if (event.type === "thread/status/changed")
    return `Thread ${payload.status?.type || "changed"}`;
  if (event.type === "item/started" || event.type === "item/completed")
    return item?.type || "item";
  return "";
}

export default function CodexWorkspace({
  data,
  act,
  busy,
}: {
  data: any;
  act: Act;
  busy: boolean;
}) {
  const status = data.codex || {};
  const sessions: any[] = data.codexSessions || [];
  const usage = data.codexUsage || status.usage || {};
  const [requested, setRequested] = useState(false);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<any>(null);
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [login, setLogin] = useState<any>(status.login || null);
  const [archive, setArchive] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [sandbox, setSandbox] = useState(
    status.sandbox || "workspace-write",
  );
  const [title, setTitle] = useState("");
  const [picker, setPicker] = useState<ReturnType<typeof nativeFolderPicker>>();
  const [pickerError, setPickerError] = useState("");
  useEffect(() => setPicker(() => nativeFolderPicker()), []);
  const [root, setRoot] = useState(status.projectRoot || "");
  const [cwd, setCwd] = useState(status.projectRoot || "");
  const [model, setModel] = useState(status.defaultModel || "");
  const active = sessions.find((value) => value.id === selected) || null;
  const running =
    active?.status === "running" ||
    detail?.turns?.some((turn: any) => turn.status === "running");

  useEffect(() => {
    if (!selected && sessions.length) setSelected(sessions[0].id);
  }, [sessions, selected]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/codex/session?id=${encodeURIComponent(selected)}`,
          { cache: "no-store" },
        );
        const value = await safeResponseJson(response);
        if (!response.ok) throw new Error(value.error || "Session unavailable");
        if (!disposed) {
          setDetail(value);
          setDetailError("");
        }
      } catch (value) {
        if (!disposed)
          setDetailError(
            value instanceof Error ? value.message : String(value),
          );
      }
    };
    void load();
    const timer = setInterval(load, running ? 1200 : 4000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [selected, running, data.tasks.length, data.codexSessions]);

  useEffect(() => {
    if (requested) return;
    setRequested(true);
    if (!status.running && !status.starting) void act("codex/status", {});
  }, [act, requested, status.running, status.starting]);

  useEffect(() => {
    if (status.sandbox) setSandbox(status.sandbox);
    if (status.projectRoot && !root) setRoot(status.projectRoot);
    if (status.projectRoot && !cwd) setCwd(status.projectRoot);
    if (status.defaultModel !== undefined && !model)
      setModel(status.defaultModel || "");
  }, [status.sandbox, status.projectRoot, status.defaultModel, root, cwd, model]);

  const models = useMemo(() => status.models || [], [status.models]);
  const currentAccount = status.account;
  const configured =
    !!data.keyConfigured ||
    currentAccount ||
    status.environmentKey ||
    (status.requiresOpenaiAuth === false && status.initialized);
  const projectRoot = root || status.projectRoot || "";

  async function run(path: string, body: any) {
    setNotice("");
    setError("");
    const result = await act(path, body);
    if (result) setNotice(result.message || "Updated");
    return result;
  }

  async function createSession() {
    const result = await run("codex/session/create", {
      title: title.trim() || "Codex session",
      cwd: cwd || projectRoot,
      model: model || undefined,
    });
    if (result?.session) {
      setSelected(result.session.id);
      setTitle("");
    }
  }

  async function sendPrompt() {
    if (!selected || !prompt.trim()) return;
    const result = await run("codex/session/turn", {
      id: selected,
      prompt: prompt.trim(),
    });
    if (result) setPrompt("");
  }

  async function approve(id: string, approved: boolean, note = "") {
    await run("approve", {
      id,
      approved,
      note,
      authorized: false,
    });
    setApprovalNotes((current) => ({ ...current, [id]: "" }));
  }

  const pending = (detail?.approvals || []).filter(
    (value: any) => value.status === "pending",
  );
  const turns = detail?.turns || [];
  const latest = turns[0];
  const transcript = useMemo(() => {
    const events = (detail?.events || []).filter((event: any) =>
      [
        "turn/started",
        "turn/completed",
        "item/started",
        "item/completed",
        "thread/status/changed",
        "error",
      ].includes(event.type),
    );
    const seen = new Set<string>();
    return events.filter((event: any) => {
      const text = eventText(event);
      if (!text) return false;
      const key = `${event.type}:${event.turn_id}:${text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [detail]);

  const team = data.agents || [];
  return (
    <>
      <section className="panel codex-topology">
        <div className="window-heading">
          <span>
            <SquareTerminal size={15} /> Main Codex orchestrator + seven subagents
          </span>
          <span className="pane-meta">
            {team.filter((agent: any) => agent.enabled).length} enabled
          </span>
        </div>
        <p>
          Lead answers directly or assigns specialists based on the request. Each
          assigned task runs in its own Codex thread with the configured model.
        </p>
        <div className="codex-team-grid">
          {team.map((agent: any) => (
            <div key={agent.name}>
              <strong>{agent.name}</strong>
              <code>{agent.model}</code>
              <small>{agent.enabled ? "enabled" : "disabled"}</small>
            </div>
          ))}
        </div>
        <details>
          <summary>Main starting instructions</summary>
          <pre>{leadStart}</pre>
        </details>
      </section>
      <div className="codex-status-grid">
        <section className="panel codex-auth">
          <h3>
            <KeyRound size={17} /> OpenAI Codex account
          </h3>
          <div className="codex-row">
            <StatusChip
              status={
                configured
                  ? currentAccount?.type === "apiKey"
                    ? "api key"
                    : currentAccount?.planType
                      ? `${currentAccount.planType} plan`
                      : "signed in"
                  : status.running
                    ? "signed out"
                    : "not running"
              }
            />
            {currentAccount?.email && <code>{currentAccount.email}</code>}
            {currentAccount?.workspaceName && (
              <small>{currentAccount.workspaceName}</small>
            )}
          </div>
          <small>
            Credentials are written only by the official Codex app-server into
            the isolated <code>.data/codex-home</code> directory. Syntra never
            receives, stores or returns a token. All eight agents require this
            sign-in.
          </small>
          {!configured ? (
            <>
              <form
                className="form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const result = await run("codex/login/api-key", { apiKey });
                  if (result) {
                    setApiKey("");
                    setLogin(null);
                  }
                }}
              >
                <label>
                  OpenAI API key
                  <input
                    aria-label="OpenAI API key"
                    type="password"
                    autoComplete="new-password"
                    spellCheck={false}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder="sk-…"
                    disabled={busy}
                  />
                </label>
                <small>
                  The key is sent once to the local app-server and is not
                  written to Syntra’s database or snapshots.
                </small>
                <div className="codex-row">
                  <Button disabled={busy || apiKey.trim().length < 16}>
                    Sign in with API key
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      const result = await run("codex/login/chatgpt", {
                        device: false,
                      });
                      if (result?.login?.authUrl) {
                        setLogin(result.login);
                        window.open(
                          result.login.authUrl,
                          "_blank",
                          "noopener,noreferrer",
                        );
                      }
                    }}
                  >
                    Sign in with ChatGPT
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      const result = await run("codex/login/chatgpt", {
                        device: true,
                      });
                      if (result?.login) setLogin(result.login);
                    }}
                  >
                    Use device code
                  </Button>
                </div>
              </form>
              {login && (
                <div className="codex-login" role="status">
                  {(login.authUrl || login.verificationUrl) && (
                    <a
                      className="text-link"
                      href={login.authUrl || login.verificationUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open sign-in page
                    </a>
                  )}
                  {login.userCode && (
                    <strong className="codex-device-code">
                      {login.userCode}
                    </strong>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => run("codex/login/cancel", {})}
                  >
                    Cancel sign-in
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="codex-row">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => run("codex/refresh", {})}
              >
                <RefreshCw size={13} /> Refresh account
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => run("codex/logout", {})}
              >
                Sign out
              </Button>
            </div>
          )}
          {status.error && (
            <>
              <p className="failure-text" role="alert">
                {status.error}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run("codex/status", {})}
              >
                <RefreshCw size={13} /> Retry Codex connection
              </Button>
            </>
          )}
        </section>

        <section className="panel form">
          <h3>
            <ShieldCheck size={17} /> Local project & permissions
          </h3>
          <form
            className="form"
            onSubmit={(event) => {
              event.preventDefault();
              void run("codex/settings", {
                projectRoot: root || projectRoot,
                sandbox,
                defaultModel: model || "",
                networkAccess: !!status.networkAccess,
                autoApprove: !!status.autoApprove,
              });
            }}
          >
            <label>
              Project root
              <input
                value={root}
                onChange={(event) => setRoot(event.target.value)}
                placeholder="/absolute/path/to/project"
                required
              />
            </label>
            {picker && (
              <Button type="button" variant="outline" size="sm" onClick={async () => {
                setPickerError("");
                try {
                  const folder = await picker();
                  if (folder) {
                    setRoot(folder);
                    setCwd(folder);
                  }
                } catch {
                  setPickerError("Could not open the Windows folder picker.");
                }
              }}>
                Browse folders
              </Button>
            )}
            {pickerError && <p role="alert" className="failure-text">{pickerError}</p>}
            <label>
              Sandbox
              <CustomSelect
                value={sandbox}
                onValueChange={setSandbox}
                aria-label="Codex sandbox"
              >
                <option value="workspace-write">Workspace write</option>
                <option value="read-only">Read only</option>
              </CustomSelect>
            </label>
            <label>
              Default model
              <CustomSelect
                value={model}
                onValueChange={setModel}
                aria-label="Default Codex model"
              >
                <option value="">App-server default</option>
                {models.map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.id}
                  </option>
                ))}
              </CustomSelect>
            </label>
            <small>
              Only directories inside this root can be opened. Every command
              and file change asks for approval unless you explicitly enable
              auto-approval below.
            </small>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!status.networkAccess}
                onChange={(event) =>
                  act("codex/settings", {
                    projectRoot: root || projectRoot,
                    sandbox,
                    defaultModel: model || "",
                    networkAccess: event.target.checked,
                    autoApprove: !!status.autoApprove,
                  })
                }
              />
              Allow network access inside the Codex sandbox
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!status.autoApprove}
                onChange={(event) =>
                  act("codex/settings", {
                    projectRoot: root || projectRoot,
                    sandbox,
                    defaultModel: model || "",
                    networkAccess: !!status.networkAccess,
                    autoApprove: event.target.checked,
                  })
                }
              />
              Auto-approve Codex commands and file changes
            </label>
            <Button disabled={busy}>Save Codex settings</Button>
          </form>
        </section>
      </div>

      {(notice || error) && (
        <p role={error ? "alert" : "status"} className={error ? "failure-text" : "muted-text"}>
          {error || notice}
        </p>
      )}

      <div className="codex-layout">
        <aside className="codex-sidebar">
          <section className="panel form">
            <h3>
              <Terminal size={17} /> New Codex session
            </h3>
            <label>
              Title
              <input
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Fix checkpoint tests"
              />
            </label>
            <label>
              Working directory
              <input
                value={cwd}
                onChange={(event) => setCwd(event.target.value)}
                placeholder={projectRoot || "/absolute/path"}
              />
            </label>
            <label>
              Model
              <CustomSelect
                value={model}
                onValueChange={setModel}
                aria-label="Session Codex model"
              >
                <option value="">App-server default</option>
                {models.map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </CustomSelect>
            </label>
            <Button
              disabled={busy || !configured || !(cwd || projectRoot)}
              onClick={createSession}
            >
              Create session
            </Button>
          </section>
          <section className="panel codex-session-list">
            <div className="toolbar">
              <h3>Sessions</h3>
              <small>{sessions.length}</small>
            </div>
            {sessions.length === 0 && (
              <p className="muted-text">
                Create a session after configuring a project root and signing
                in.
              </p>
            )}
            {sessions.map((session) => (
              <button
                key={session.id}
                className={`codex-session ${session.id === selected ? "active" : ""}`}
                onClick={() => setSelected(session.id)}
              >
                <span className={`dot ${session.status === "running" ? "green" : session.status === "error" ? "red" : "muted"}`} />
                <div>
                  <strong>{session.title}</strong>
                  <small>
                    {session.model || "default model"} · {date(session.updated)}
                  </small>
                </div>
                {session.pending_approvals > 0 && (
                  <span className="count attention-count">
                    {session.pending_approvals}
                  </span>
                )}
              </button>
            ))}
          </section>
          <section className="panel codex-usage">
            <h3>Codex usage</h3>
            <p>
              {num(usage.inputTokens)} input · {num(usage.outputTokens)} output
              tokens
            </p>
            <small>
              {usage.calls || 0} turns · token-only accounting. Codex billing is
              managed by your OpenAI account.
            </small>
          </section>
        </aside>

        <section className="panel codex-main">
          {!active ? (
            <div className="empty">
              <span className="empty-icon">
                <SquareTerminal size={26} />
              </span>
              <h3>No Codex session selected</h3>
              <p>
                Create a session to let Codex inspect and edit the configured
                local project. Every command and file change is reviewable.
              </p>
            </div>
          ) : (
            <>
              <div className="codex-main-heading">
                <div>
                  <h2>{active.title}</h2>
                  <small>
                    {active.cwd} · {active.model || "default model"} ·{" "}
                    {date(active.updated)}
                  </small>
                </div>
                <div className="codex-row">
                  {active.task_id && (
                    <Link
                      className="text-link"
                      href={`/tasks?task=${encodeURIComponent(active.task_id)}`}
                    >
                      Open linked task
                    </Link>
                  )}
                  {running ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => run("codex/session/interrupt", { id: active.id })}
                    >
                      <Square size={13} /> Interrupt
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setArchive(active)}
                  >
                    <Archive size={13} /> Archive
                  </Button>
                </div>
              </div>
              {detailError && (
                <p role="alert" className="failure-text">
                  {detailError}
                </p>
              )}
              {pending.length > 0 && (
                <div className="codex-approvals">
                  <h3>
                    <ShieldCheck size={16} /> Approval required
                  </h3>
                  {pending.map((approval: any) => {
                    const args = JSON.parse(approval.args || "{}");
                    return (
                      <article
                        key={approval.id}
                        className="codex-approval"
                        data-codex-approval={approval.id}
                      >
                        <div>
                          <StatusChip status={args.kind || "approval"} />
                          <strong>{approval.tool}</strong>
                          {args.reason && <small>{args.reason}</small>}
                        </div>
                        {args.command && <pre>{args.command}</pre>}
                        {args.cwd && <small>cwd: {args.cwd}</small>}
                        {args.questions && (
                          <ul>
                            {args.questions.map((question: any) => (
                              <li key={question.id}>
                                <strong>{question.header}</strong>
                                <p>{question.question}</p>
                                {(question.options || []).map((option: any) => (
                                  <small key={option.label}>
                                    {option.label}: {option.description}
                                  </small>
                                ))}
                              </li>
                            ))}
                          </ul>
                        )}
                        <label>
                          Note or answer
                          <textarea
                            rows={2}
                            value={approvalNotes[approval.id] || ""}
                            onChange={(event) =>
                              setApprovalNotes((current) => ({
                                ...current,
                                [approval.id]: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="codex-row">
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              approve(
                                approval.id,
                                true,
                                approvalNotes[approval.id] || "",
                              )
                            }
                          >
                            <CircleCheck size={14} /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              approve(
                                approval.id,
                                false,
                                approvalNotes[approval.id] || "",
                              )
                            }
                          >
                            <CircleX size={14} /> Reject
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              <div className="codex-transcript" aria-live="polite">
                {transcript.length === 0 && (
                  <p className="muted-text">
                    No events yet. Send an instruction to start the first turn.
                  </p>
                )}
                {transcript.map((event: any) => {
                  const text = eventText(event);
                  return (
                    <article key={event.id} className={`codex-event ${event.type.replaceAll("/", "-")}`}>
                      <header>
                        <span>{event.type}</span>
                        <small>{date(event.created)}</small>
                      </header>
                      {text && <pre>{text}</pre>}
                    </article>
                  );
                })}
                {latest?.result && (
                  <article className="codex-event turn-completed">
                    <header>
                      <span>Latest result</span>
                      <StatusChip status={latest.status} />
                    </header>
                    <pre>{latest.result}</pre>
                  </article>
                )}
              </div>
              {latest?.diff && (
                <details className="codex-diff" open>
                  <summary>
                    <FileDiff size={15} /> Latest diff
                  </summary>
                  <pre>{latest.diff}</pre>
                </details>
              )}
              {latest?.usage?.total && (
                <p className="muted-text">
                  Tokens: {num(latest.usage.total.inputTokens)} input ·{" "}
                  {num(latest.usage.total.outputTokens)} output ·{" "}
                  {num(latest.usage.total.totalTokens)} total
                </p>
              )}
              {latest?.status === "completed" &&
                latest.review_status === "unreviewed" && (
                  <div className="codex-review">
                    <h3>Review this Codex turn</h3>
                    <label>
                      Review note
                      <textarea
                        value={reviewNote}
                        onChange={(event) => setReviewNote(event.target.value)}
                        rows={2}
                        placeholder="What changed, and what should be revised?"
                      />
                    </label>
                    <div className="codex-row">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          const result = await run("codex/session/review", {
                            sessionId: active.id,
                            turnId: latest.id,
                            accepted: true,
                            note: reviewNote,
                          });
                          if (result) setReviewNote("");
                        }}
                      >
                        Accept changes
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || reviewNote.trim().length < 5}
                        onClick={async () => {
                          const result = await run("codex/session/review", {
                            sessionId: active.id,
                            turnId: latest.id,
                            accepted: false,
                            note: reviewNote,
                          });
                          if (result) setReviewNote("");
                        }}
                      >
                        Request changes in a follow-up
                      </Button>
                    </div>
                  </div>
                )}
              <form
                className="codex-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendPrompt();
                }}
              >
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Tell Codex what to inspect, implement or test in the local project…"
                  rows={4}
                  disabled={busy || !configured || !!active.task_id}
                  aria-label="Codex instruction"
                />
                <div className="codex-row">
                  <small>
                    {active.task_id
                      ? "This session is owned by a task. Use Tasks to retry or follow up."
                      : `Codex runs in ${active.cwd}. Commands and edits require approval.`}
                  </small>
                  <Button
                    disabled={
                      busy ||
                      !prompt.trim() ||
                      !configured ||
                      running ||
                      !!active.task_id
                    }
                  >
                    {running ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
                    Send to Codex
                  </Button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
      {archive && (
        <ConfirmDialog
          title="Archive this Codex session?"
          confirmLabel="Archive session"
          pending={busy}
          close={() => setArchive(null)}
          confirm={async () => {
            const result = await run("codex/session/archive", {
              id: archive.id,
              archived: true,
            });
            if (result) {
              setArchive(null);
              setSelected("");
            }
          }}
        >
          The session transcript and diff remain stored locally. Archived
          sessions are hidden from this list and cannot run new turns.
        </ConfirmDialog>
      )}
    </>
  );
}
