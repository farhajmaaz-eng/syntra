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
  const items = value?.result?.contentItems || [];
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
      { tool: "start_stop_play", arguments: { start: true } },
      { tool: "get_console_output", arguments: {} },
      { tool: "start_stop_play", arguments: { start: false } },
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
  } else if (method === "turn/start") {
    const turnId = randomUUID();
    const prompt = params.input?.map((item) => item.text).join(" ") || "";
    turns.set(turnId, { threadId: params.threadId, prompt });
    send({
      id,
      result: {
        turn: { id: turnId, status: "inProgress", items: [], error: null },
      },
    });
    note("turn/started", {
      threadId: params.threadId,
      turn: { id: turnId, status: "inProgress", items: [] },
    });
    void runTurn(params.threadId, turnId, prompt);
  } else if (method === "turn/interrupt") {
    const turn = turns.get(params.turnId);
    if (turn) finishTurn(params.turnId, "interrupted");
    send({ id, result: {} });
  } else if (method === "turn/steer") send({ id, result: {} });
  else send({ id, error: { code: -32601, message: `Unsupported ${method}` } });
}
