# Reliability audit

Syntra Studio is Codex-only. The dashboard, authenticated localhost worker,
SQLite scheduler, Studio MCP integration, approvals, review workflow and
tool-call ledger are retained. OpenRouter and NVIDIA provider configuration has
been removed. No inference simulator is shipped.

## Execution path

1. The browser sends requests through the same-origin Next.js API proxy to the
   authenticated localhost worker.
2. Validated actions persist runs and tasks in SQLite. `tick()` reconciles
   dependencies and starts at most the configured number of distinct agents.
3. Each task gets a Codex thread through `worker/codex.ts`. The Lead is the main
   orchestrator (`gpt-6.2-sol`); the seven subagents use `gpt-6.1-terra` by
   default.
4. Syntra exposes internal operations and role-approved Studio tools as Codex
   dynamic tools. `item/tool/call` requests execute the real operation, wait for
   approvals where required, and persist ledger entries.
5. Studio calls use discovered schemas, pinned instance IDs, per-instance
   locks, role permissions, approval rows and a durable call ledger.
6. Readback, independent Tester evidence and user review precede acceptance.
7. Restart recovery marks unfinished Codex turns, running Studio calls and
   pending approvals as interrupted/uncertain. Completed calls are never
   replayed.

Relevant files: `worker/index.ts`, `worker/codex.ts`, `worker/runtime.ts`,
`worker/mcp.ts`, `worker/store.ts`, `worker/migrations.ts`,
`worker/features.ts` and `worker/tool-approvals.ts`.

## Safety controls

| Control | Implementation |
| --- | --- |
| Credential isolation | Codex runs with `CODEX_HOME=$FORGE_DATA_DIR/codex-home`; tokens are owned by the official app-server and never enter Syntra SQLite, snapshots or diagnostics. |
| Process environment | The Codex child receives a small allowlist. Provider and unrelated secrets are not inherited. |
| Project confinement | Session working directories must resolve inside the configured real project root; `..` and symlink escapes are rejected. |
| Sandboxing | `workspace-write` by default, optional `read-only`, network off unless explicitly enabled. |
| Codex approvals | Command, file-change, permission and user-input requests become durable approval rows. Stop/cancel/timeout interrupts the turn and cancels pending approvals. |
| Studio approvals | Mutations still require inspection, exact-argument approval, pinned Studio binding and ledger recording. |
| Readback | A Studio write without a later inspection read fails the task rather than claiming success. |
| Independent verification | Local-code runs require `codex_inspect` + `verify_codex`; Studio runs require inspection, playtest start/stop and console evidence. |
| Uncertain outcomes | Interrupted writes and ambiguous tools are marked uncertain and block replay until reconciled in Reviews. |
| Restart recovery | Running tasks fail with an inspection instruction; pending approvals are cancelled; completed evidence is preserved. |
| Concurrent agents | One task per agent; configurable concurrency from one to three; per-task timeouts and cancellation. |

## Regression coverage

- Codex JSON-RPC startup, auth status, catalog discovery, path confinement,
  streaming, command approvals and rejection, usage, interruption and failures.
- Dynamic-tool execution: delegation, handoffs, human questions, library,
  assets, pitches, Studio reads/mutations, play controls and verification.
- Full Lead → Builder → approval → SDK write → readback → Tester → review flow.
- Concurrency, cancellation, timeout, permanent failure without replay,
  duplicate delegation, bounded tasks, restart recovery and single-worker
  ownership.
- Repeatable additive migrations, workspace reset/backup behavior and Studio
  re-pinning.
- Feature storage, media validation, market/telemetry imports, pitches, assets
  and review history.

## Verification status

`npm run typecheck`, `npm test` and `npm run build` pass on this build machine.
The test suite uses real child-process JSON-RPC fixtures and the actual MCP SDK
protocol; it does not call paid Codex inference and is not a live Roblox
playtest. Chromium could not run reliably under Termux/proot, so browser smoke
checks are not claimed as passing here.

## Remaining limits

No live Codex credentials or Roblox Studio instance are configured on this
machine. Real paid inference, live place edits and playtests remain environment
dependent. Codex token usage is reported, but dollar cost is not; OpenAI billing
is authoritative. Syntra cannot roll back a local edit or Studio mutation.
Inspect the stored diff/evidence or use Git/Studio recovery before retrying.
