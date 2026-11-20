import readline from "node:readline";
import { randomUUID } from "node:crypto";

const rl = readline.createInterface({ input: process.stdin });
let account = null;
const threads = new Map();
const turns = new Map();
const pending = new Map();
let serial = 0;
let requestSerial = 1000;
let callSerial = 0;
function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
function note(method, params) {
  send({ method, params, emittedAtMs: Date.now() });
}
function finishTurn(turnId, status, error) {
  const entry = turns.get(turnId);
  entry.status = status;
  entry.error = error;
  if (entry.prompt.includes("FIXTURE_SILENT_INTERRUPT") && status === "interrupted") return;
  setTimeout(() => {
    note("turn/completed", {
      threadId: turns.get(turnId).threadId,
      turn: {
        id: turnId,
        status,
        items: [],
        error: error ? { message: error } : null,
      },
    });
  }, 20);
}
function clientRequest(method, params) {
  const id = ++requestSerial;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ id, method, params });
  });
}
function serverRequest(method, params) {
  const id = ++requestSerial;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    send({ id, method, params });
  });
}
function responseText(value) {
  const items = value?.contentItems || [];
  return items.map((item) => item.text || "").join("\n");
}
function extractCalls(prompt) {
  const encoded = prompt.match(/FIXTURE_CALLS_B64:\s*([A-Za-z0-9+/=]+)/);
  if (encoded) {
    try {
      const value = JSON.parse(
        Buffer.from(encoded[1], "base64").toString("utf8"),
      );
      if (Array.isArray(value)) return value;
    } catch {
      return [{ tool: "__invalid__", arguments: {} }];
    }
  }
  const marker = prompt.match(/FIXTURE_CALLS:\s*(\[[\s\S]*?\])/);
  if (marker) {
    try {
      const value = JSON.parse(marker[1]);
      if (Array.isArray(value)) return value;
    } catch {
      return [{ tool: "__invalid__", arguments: {} }];
    }
  }
  if (/You are Tester/.test(prompt))
    return [
      { tool: "script_read", arguments: {} },
      { tool: "start_stop_play", arguments: { is_start: true } },
      { tool: "get_console_output", arguments: {} },
      { tool: "start_stop_play", arguments: { is_start: false } },
      {
        tool: "verify",
        arguments: {
          passed: true,
          evidence:
            "Fixture read the script, started and stopped a playtest and observed PASS Checkpoint exists in console output.",
        },
      },
    ];
  return [];
}
async function runTurn(threadId, turnId, prompt) {
  if (/FIXTURE_HOLD/.test(prompt)) {
    turns.get(turnId).interruptible = true;
    return;
  }
  if (/FIXTURE_EMPTY/.test(prompt)) {
    finishTurn(turnId, "completed");
    return;
  }
  if (/FIXTURE_EXIT/.test(prompt)) {
    process.exit(17);
  }
  if (/FIXTURE_TRANSIENT/.test(prompt) && [...turns.values()].filter(turn => turn.threadId === threadId).length === 1) {
    finishTurn(turnId, "failed", "Provider temporarily overloaded");
    return;
  }
  if (/FIXTURE_FAIL/.test(prompt)) {
    note("error", {
      threadId,
      turnId,
      willRetry: false,
      error: { message: "Fixture failure", codexErrorInfo: "other" },
    });
    finishTurn(turnId, "failed", "Fixture failure");
    return;
  }
  const outputs = [];
  if (/FIXTURE_APPROVAL/.test(prompt)) {
    const decision = await serverRequest(
      "item/commandExecution/requestApproval",
      {
        threadId,
        turnId,
        itemId: "command-1",
        command: "npm test",
        cwd: "/tmp/project",
        reason: "Run the test suite",
        startedAtMs: Date.now(),
        kind: "command",
      },
    );
    outputs.push(
      decision?.decision === "accept"
        ? "command approved"
        : "command declined",
    );
  }
  const calls = extractCalls(prompt);
  for (const call of calls) {
    if (call.tool === "__invalid__") {
      outputs.push("Invalid FIXTURE_CALLS JSON");
      continue;
    }
    const callId = call.callId || `call-${++callSerial}`;
    const value = await clientRequest("item/tool/call", {
      threadId,
      turnId,
      callId,
      tool: call.tool,
      arguments: call.arguments || {},
    });
    outputs.push(`${call.tool}: ${responseText(value).slice(0, 2000)}`);
  }
  if (prompt.includes("FIXTURE_MULTIPLE_MESSAGES")) {
    for (const [id, text] of [["message-first", "First completed item"], ["message-second", "Second completed item"]]) {
      note("item/agentMessage/delta", { threadId, turnId, itemId: id, delta: text });
      note("item/completed", { threadId, turnId, item: { type: "agentMessage", id, text } });
    }
    finishTurn(turnId, "completed");
    return;
  }
  note("item/agentMessage/delta", {
    threadId,
    turnId,
    itemId: `item-${++serial}`,
    delta: outputs.length
      ? `Fixture completed ${calls.length} tool call(s).\n${outputs.join("\n")}`
      : "Fixture completed without tool calls.",
  });
  note("item/completed", {
    threadId,
    turnId,
    item: {
      id: "file-1",
      type: "fileChange",
      status: "completed",
      changes: [
        {
          path: "src/example.ts",
          kind: { type: "update" },
          diff: "@@ -1 +1 @@\n-old\n+new",
        },
      ],
    },
    completedAtMs: Date.now(),
  });
  note("thread/tokenUsage/updated", {
    threadId,
    turnId,
    tokenUsage: {
      last: {
        inputTokens: 12,
        cachedInputTokens: 0,
        outputTokens: 8,
        reasoningOutputTokens: 0,
        totalTokens: 20,
      },
      total: {
        inputTokens: 12,
        cachedInputTokens: 0,
        outputTokens: 8,
        reasoningOutputTokens: 0,
        totalTokens: 20,
      },
      modelContextWindow: 128000,
    },
  });
  note("turn/diff/updated", {
    threadId,
    turnId,
    diff: "@@ -1 +1 @@\n-old\n+new",
  });
  finishTurn(turnId, "completed");
}
for await (const line of rl) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    continue;
  }
  if (message.method === undefined) {
    const waiting = pending.get(message.id);
    if (waiting) {
      pending.delete(message.id);
      waiting(message.result ?? message.error);
    }
    continue;
  }
  const { id, method, params = {} } = message;
  if (method === "initialize")
    send({
      id,
      result: {
        userAgent: "codex-fixture",
        codexHome: process.env.CODEX_HOME,
        platformFamily: "unix",
        platformOs: "linux",
      },
    });
  else if (method === "initialized") continue;
  else if (method === "account/read")
    send({ id, result: { account, requiresOpenaiAuth: true } });
  else if (method === "account/login/start") {
    account =
      params.type === "apiKey"
        ? { type: "apiKey" }
        : {
            type: "chatgpt",
            email: "codex@example.test",
            planType: "plus",
            workspaceName: null,
          };
    send({ id, result: { type: params.type } });
    setTimeout(
      () => note("account/login/completed", { success: true, loginId: "login" }),
      10,
    );
  } else if (method === "account/login/cancel")
    send({ id, result: { status: "canceled" } });
  else if (method === "account/logout") {
    account = null;
    send({ id, result: {} });
  } else if (method === "model/list")
    send({
      id,
      result: {
        data: [
          {
            id: "gpt-6.2-sol",
            model: "gpt-6.2-sol",
            displayName: "GPT-6.2 Sol",
            description: "Fixture Lead model",
            isDefault: true,
            hidden: false,
            supportedReasoningEfforts: [],
          },
          {
            id: "gpt-6.1-terra",
            model: "gpt-6.1-terra",
            displayName: "GPT-6.1 Terra",
            description: "Fixture subagent model",
            isDefault: false,
            hidden: false,
            supportedReasoningEfforts: [],
          },
        ],
      },
    });
  else if (method === "thread/start") {
    const threadId = randomUUID();
    const thread = {
      id: threadId,
      cwd: params.cwd || process.cwd(),
      model: params.model || "gpt-6.2-sol",
      modelProvider: "openai",
      status: { type: "idle" },
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      cliVersion: "fixture",
      ephemeral: false,
      preview: "",
      sessionId: threadId,
      turns: [],
    };
    threads.set(threadId, thread);
    send({
      id,
      result: {
        thread,
        model: thread.model,
        modelProvider: "openai",
        cwd: thread.cwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: { type: "workspaceWrite" },
        disabledPluginIds: [],
      },
    });
    note("thread/started", { thread });
  } else if (method === "thread/resume") {
    const thread = threads.get(params.threadId) || {
      id: params.threadId,
      cwd: params.cwd,
      model: params.model || "gpt-6.1-terra",
      status: { type: "idle" },
      turns: [],
    };
    threads.set(thread.id, thread);
    send({
      id,
      result: {
        thread,
        model: thread.model,
        modelProvider: "openai",
        cwd: thread.cwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: { type: "workspaceWrite" },
        disabledPluginIds: [],
      },
    });
  } else if (method === "thread/read") {
    const members = [...turns.entries()].filter(([, turn]) => turn.threadId === params.threadId);
    send({ id, result: { thread: { id: params.threadId,
      status: { type: members.some(([, turn]) => turn.status === "inProgress") ? "active" : "idle" },
      turns: members.map(([id, turn]) => ({ id, status: turn.status, error: turn.error ? { message: turn.error } : null })),
    } } });
  } else if (method === "turn/start") {
    const turnId = randomUUID();
    const prompt = params.input?.map((item) => item.text).join(" ") || "";
    const prior = [...turns.entries()].findLast(([, turn]) => turn.threadId === params.threadId);
    turns.set(turnId, { threadId: params.threadId, prompt, status: "inProgress", interrupts: 0 });
    const response = { id, result: { turn: { id: turnId, status: "inProgress", items: [], error: null } } };
    if (prompt.includes("FIXTURE_TERMINAL_REPLY")) {
      turns.get(turnId).status = "completed";
      note("item/agentMessage/delta", { threadId: params.threadId, turnId, itemId: "terminal", delta: "Incomplete draft" });
      send({ id, result: { turn: { id: turnId, status: "completed", items: [
        { id: "terminal", type: "agentMessage", text: "Terminal reply recovered." },
        { id: "notes", type: "agentMessage", text: "Additional final message." },
        { id: "patch", type: "fileChange", changes: [{ path: "src/recovered.ts", diff: "@@ -1 +1 @@\n-old\n+new" }] },
      ] } } });
      continue;
    }
    if (prompt.includes("FIXTURE_EARLY")) {
      note("item/agentMessage/delta", { threadId: params.threadId, turnId, delta: "Early completed answer" });
      turns.get(turnId).status = "completed";
      note("turn/completed", { threadId: params.threadId, turn: { id: turnId, status: "completed", items: [] } });
      send(response);
      continue;
    }
    if (prior && prompt.includes("FIXTURE_STALE")) {
      note("item/agentMessage/delta", { threadId: params.threadId, delta: "UNTAGGED TEXT" });
      note("item/agentMessage/delta", { threadId: params.threadId, turnId: prior[0], delta: "STALE TEXT" });
      note("turn/completed", { threadId: params.threadId, turn: { id: prior[0], status: "interrupted", items: [] } });
    }
    if (prompt.includes("FIXTURE_DELAY_START")) await new Promise(resolve => setTimeout(resolve, 75));
    send(response);
    note("turn/started", {
      threadId: params.threadId,
      turn: { id: turnId, status: "inProgress", items: [] },
    });
    void runTurn(params.threadId, turnId, prompt);
  } else if (method === "turn/interrupt") {
    const turn = turns.get(params.turnId);
    if (turn && ++turn.interrupts === 1) {
      note("fixture/interrupt", { threadId: turn.threadId, turnId: params.turnId });
      finishTurn(params.turnId, "interrupted");
      send({ id, result: {} });
    } else if (turn) {
      note("fixture/duplicateInterrupt", { threadId: turn.threadId, turnId: params.turnId });
      send({ id, error: { message: "Duplicate interrupt" } });
    } else send({ id, error: { message: "Unknown turn" } });
  } else if (method === "turn/steer") send({ id, result: {} });
  else send({ id, error: { code: -32601, message: `Unsupported ${method}` } });
}
