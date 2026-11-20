# OpenAI Codex integration

Syntra Studio is Codex-only. There is no OpenRouter or NVIDIA inference path.
All eight agents — the Lead orchestrator and seven subagents — run through the
official `codex app-server` JSON-RPC process from the `@openai/codex` package.
There is no simulator or mock execution path in the application.

## Default topology

| Agent | Default model | Role |
| --- | --- | --- |
| Lead | `gpt-6.2-sol` | Main orchestrator. Its starting instructions tell it to set up and coordinate the seven subagents. |
| Architect | `gpt-6.1-terra` | Systems design and code-context analysis |
| Builder | `gpt-6.1-terra` | Luau implementation and server-side systems |
| Frame | `gpt-6.1-terra` | Interface implementation |
| Scenic | `gpt-6.1-terra` | World building, lighting and environments |
| Balance | `gpt-6.1-terra` | Economy and progression |
| Tester | `gpt-6.1-terra` | Independent evidence review and verdict |
| Codex | `gpt-6.1-terra` | Focused local-repository coding |

Lead answers questions and research requests directly. For implementation, it delegates to the specialists needed for the request. Tester verifies every implementation dependency before review.

Each delegated task gets its own Codex thread, prompt, private memory, dynamic
tool set and model. A worker task cannot run two turns at once, and one agent
never runs two tasks simultaneously.

## Protocol and lifecycle

- The worker spawns `codex app-server` lazily and speaks newline-delimited
  JSON-RPC over stdin/stdout. It calls `initialize`, sends `initialized`, then calls `account/read`,
  `model/list`, `thread/start` or `thread/resume`, and `turn/start`.
- `thread/start` receives `dynamicTools`: Syntra’s internal tools (`delegate`,
  `handoff`, `ask_human`, `remember`, `library_search`, `library_read`,
  `save_artifact`, `save_pitch`, `verify`, `verify_codex`, `codex_inspect`) and
  the role-approved Studio tools discovered from the official Roblox MCP
  server.
- When Codex calls a dynamic tool, the app-server sends
  `item/tool/call`. Syntra executes the real operation, returns the result, and
  records the durable tool-call ledger entry.
- Streaming notifications include `item/agentMessage/delta`,
  `item/completed`, `turn/diff/updated`, `turn/completed` and
  `thread/tokenUsage/updated`. Selected events are persisted in
  `codex_events`; partial answers and diffs are checkpointed in `codex_turns`.
- Team pause holds scheduling and leaves active turns running. Pausing or cancelling a specific run or task targets its turns. The worker sends one `turn/interrupt` per turn and checks `thread/read` if the terminal notification is missing.
- Unconfirmed operations stay visible for review. Confirmed transient failures receive bounded retries before any recorded tool action, file diff, or approval. Execution deadlines are deferred while a human decision is pending.
- `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
  `item/permissions/requestApproval` and `item/tool/requestUserInput` become
  durable approval rows. Approve or reject them in the Codex page or in
  Reviews. A question’s approval note becomes the answer sent back to Codex.
- Unknown app-server server requests are rejected with JSON-RPC `-32601`
  instead of being silently accepted.

Reference: the official [Codex app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
and [protocol JSON schemas](https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/json).

## Authentication

The Codex page supports the app-server’s documented flows:

1. **ChatGPT sign-in** (browser URL or device code).
2. **OpenAI API key**, sent once to the local app-server.

The app-server writes credentials to the isolated
`$SYNTRA_DATA_DIR/codex-home` directory. Syntra never stores a Codex token in its
SQLite database, snapshots, diagnostics, events or browser responses.
`CODEX_API_KEY` may be supplied in the worker environment instead.

ChatGPT sign-in availability and Codex usage limits are controlled by OpenAI
and your plan/workspace policy. API keys are billed by OpenAI. Syntra cannot
grant Codex entitlement, bypass workspace restrictions, or turn a ChatGPT-only
feature into an API feature. If the app-server rejects your authentication
method, use the other documented method or a plan that supports it.

## Local project access

- `codexProjectRoot` is the only allowed project tree. A session’s working
  directory must resolve inside that real path; `..` and symlink escapes are
  rejected.
- The default sandbox is `workspace-write`. `read-only` is available. Network
  access is off by default and must be explicitly enabled.
- The child process receives a deliberately small environment allowlist.
  Unrelated process secrets are not inherited. Only a Codex-specific
  `CODEX_API_KEY` is forwarded when configured.
- Codex is instructed to inspect before editing, follow the repository’s
  `AGENTS.md`, run relevant checks, and report changed paths. Every command and
  file change requires approval unless the user explicitly enables
  auto-approval.

## Studio tools and approvals

Roblox operations do not bypass Syntra. They are exposed as dynamic tools and
still use the official MCP schemas, role allowlists, pinned Studio IDs,
per-instance locks, read-before-write rules, approvals and the persistent
tool-call ledger. A Studio mutation creates an approval row; the Codex turn
waits for the decision, then either executes the call or returns a rejection to
Codex. Uncertain writes fail the task and require reconciliation in Reviews.

## Independent review

- The Tester sees the run dependencies and can inspect the actual local diff
  with `codex_inspect`.
- When a run contains local code changes but no Studio evidence, the Tester
  must call `codex_inspect` and then `verify_codex`.
- When a run contains Studio work, the Tester uses Studio inspection,
  playtest start/stop and console evidence with `verify`.
- User review remains the final gate. A Codex session turn can also be accepted
  or sent back from the Codex page, with the decision recorded in
  `review_events`.

## Known limitations

- Codex reports token usage, not dollar cost. OpenAI billing is authoritative.
- The official app-server has no universal rollback primitive. Review the
  stored diff and use Git or your own project recovery before retrying a failed
  or interrupted turn. Syntra does not invent rollback success.
- Approval requests remain pending for up to 24 hours. After a worker restart,
  unfinished turns and pending approvals are marked interrupted/cancelled
  rather than replayed.
- Interactive `requestUserInput` questions are represented as approvals; the
  approval note is used as the answer. Rich forms and MCP elicitation UI are not
  implemented.
- The integration is verified against `@openai/codex` 0.170.0. Protocol fields
  added by newer app-server releases may require a client update.
- Real paid Codex inference and a live Roblox Studio playtest were not run on
  this Linux build machine. The automated suite uses a real child-process
  JSON-RPC fixture, not a mocked in-process client.
- Chromium could not run reliably in the Termux/proot build environment, so
  browser smoke checks are not reported as passing here.

## Verification

```bash
npm test -- tests/codex.test.ts tests/codex-runtime.test.ts
npm run typecheck
npm run build
```

`tests/codex.test.ts` covers protocol startup, auth status, path confinement,
streaming, Codex command approvals and rejection, token usage, interruption and
failure reporting. `tests/codex-runtime.test.ts` covers Codex task execution,
auto-approval, the real diff, delegation, dynamic tools and the independent
`codex_inspect` → `verify_codex` verdict. `tests/workflow.test.ts` covers the
full Lead → Builder → approval → Studio write → readback → Tester flow through
dynamic tools.
