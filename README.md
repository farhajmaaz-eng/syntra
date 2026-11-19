# Syntra Studio

Syntra Studio is a local-first Roblox development workspace built around **OpenAI Codex**. A main Codex orchestrator receives your request, sets up seven Codex subagents, and coordinates their dependency-ordered work. The subagents use the same official Codex app-server with local project access and Syntra’s dynamic tools for Roblox Studio, approvals, library references, delegation and verification.

The dashboard is Next.js 16 + TypeScript + Tailwind + shadcn/ui-compatible Radix components, backed by a localhost worker, SQLite and the official Roblox Studio MCP server. See [design notes](docs/DESIGN.md) and the [Codex integration guide](docs/CODEX_INTEGRATION.md).

![Syntra workspace](artifacts/overview-desktop.png)

## Requirements

- Node.js 22+ and npm.
- An OpenAI Codex account or API key accepted by the installed Codex app-server. ChatGPT sign-in availability and plan restrictions are controlled by OpenAI.
- Roblox Studio on the same Windows/macOS machine as the worker for live place edits. The official Studio MCP server is supplied by Roblox; no third-party Roblox plugin is required.
- This Linux build machine can run the worker and tests, but it does not run Roblox Studio or real paid Codex inference.

## Start

```bash
cd /root/forge-studio
npm ci
cp .env.example .env
# Optional: set CODEX_PROJECT_ROOT to limit local file access.
npm run local
```

`npm run local` starts a real external worker plus Next and sets `WORKER_EXTERNAL=1` so the dashboard proxies to it. Open **http://127.0.0.1:3000**.

Other launch options:

- `npm run dev` starts Next with its **embedded worker**. This is convenient for UI work; closing the Next process stops the worker.
- `npm run worker` starts the worker alone. Use this under systemd, launchd, a Windows service, or a separate terminal, then run the dashboard with `WORKER_EXTERNAL=1 npm run dev` or `WORKER_EXTERNAL=1 npm run start`.
- `npm run build` then `npm run start` for production. Keep the worker running independently if you use `npm run worker`.

Runtime data lives in `FORGE_DATA_DIR` (default `.data`): `forge.sqlite`, `worker.secret`, assets and the isolated `codex-home/` credential directory. Never commit `.data`. Back it up with processes stopped. Do not copy Linux `node_modules` to Windows/macOS; SQLite uses native binaries.

## First run

1. Open **Codex** in the sidebar.
2. Sign in with ChatGPT (browser or device code) or paste an OpenAI API key. Syntra sends the key once to the local Codex app-server; it is not stored in Syntra’s database, snapshots or diagnostics. Credentials live under `.data/codex-home` with owner-only permissions.
3. Set the **project root**. Sessions may only open directories inside this real path. The default sandbox is `workspace-write`; network access is off unless explicitly enabled.
4. Review the **main starting instructions** and the eight-agent topology on the Codex page. Defaults are:
   - **Lead** — `gpt-6.2-sol`, the main orchestrator.
   - **Architect, Builder, Frame, Scenic, Balance, Tester, Codex** — `gpt-6.1-terra`, the seven subagents.
5. Create or select a project in **Games**, then send a request in **Lead** or **Home**. The Lead sets up the seven subagents through `delegate`; each subagent runs in its own Codex thread with the configured model.
6. Approve or reject Codex commands/file changes and Roblox Studio mutations in **Codex** or **Review**. Reviews also show completed runs and uncertain operations.
7. Use Roblox Studio’s official MCP command in **Settings → Roblox Studio connection** when you want live place edits. Discover Studios under **Games** and pin the returned Studio ID.

Suggested first request: “Add a server-side checkpoint system to my obby. Preserve the existing map. Use numbered checkpoint parts, validate touches server-side, and verify respawn behavior in a playtest.”

## Agent topology

- **Lead** (`gpt-6.2-sol`) is the only main orchestrator. Its starting instructions tell it to set up the seven subagents before implementing anything.
- **Architect** designs boundaries and APIs.
- **Builder** implements Luau and server-side systems.
- **Frame** builds interfaces.
- **Scenic** builds worlds, lighting and environments.
- **Balance** tunes economy and progression.
- **Tester** independently inspects real evidence. It uses `codex_inspect` + `verify_codex` for local-code changes, or Studio inspection/playtest/console evidence for place changes.
- **Codex** is the dedicated local-repository coder for focused code changes.

All eight agents run through the Codex app-server. They have isolated prompts, private memory, task histories, dynamic tools, role permissions and independent execution cycles. Every turn is a real app-server turn; there is no production simulator or seeded activity.

## Runtime architecture

- **Next.js** serves the responsive dashboard and a same-origin API proxy. All privileged operations go through the localhost worker. No browser-bundled credentials.
- **Worker** (`worker/index.ts`) binds to `127.0.0.1:4318` with a random 0600 token. WebSocket broadcasts are refresh-only notifications; HTTP polling is the fallback. `WORKER_PORT` is configurable; restart both processes when changing it.
- **Codex manager** (`worker/codex.ts`) speaks the official newline-delimited JSON-RPC protocol over stdio. It discovers the model catalog, starts/resumes threads, streams deltas and diffs, handles auth, tracks token usage, interrupts turns, and maps Codex approval requests to durable rows. Codex child processes receive a deliberately small environment allowlist; unrelated secrets are not inherited.
- **Dynamic tools** expose Syntra’s internal operations (`delegate`, `handoff`, `ask_human`, `verify`, library, assets, pitches, memory) and role-approved Roblox Studio tools to each Codex turn. Studio calls still use discovered schemas, pinned Studio IDs, per-instance locks, approvals and the tool-call ledger.
- **Scheduler** runs one to three agents concurrently (Settings), one task per agent. Dependencies, retries with backoff, handoffs, blocked-task recovery, step limits and user review are durable in SQLite. Codex turn failures are not replayed automatically.
- **Recovery** marks unfinished Codex turns and running Studio calls as interrupted/uncertain on restart. Inspect the real diff or Studio state before retrying. Completed tool calls are cached by durable IDs and are never re-executed.
- **Approvals** bind to persisted call IDs and exact payloads. Codex command/file/permission requests and Roblox mutations are reviewable. A task waiting for approval keeps its Codex turn alive; stopping, cancelling or timing out the task interrupts the turn and cancels pending approvals.
- **SQLite** uses WAL and transactions for tasks, agents, memories, chat, games, runs, approvals, events, usage, locks, tool calls and Codex sessions/turns/events.

## Spending and usage

There is no OpenRouter, NVIDIA or model-routing configuration. Codex usage is reported as **tokens** (input, output, total) from `thread/tokenUsage/updated`; OpenAI billing is authoritative and happens on your OpenAI account. The workspace shows Codex token usage and turn counts, not a USD cap. Codex-specific limits and plan restrictions are controlled by OpenAI.

## Local project access and safety

- Only directories inside `codexProjectRoot` are allowed. The worker resolves real paths and rejects `..` and symlink escapes.
- Codex runs with `workspace-write` by default. `read-only` is available. Network access is off by default.
- Every Codex command and file change requires approval unless you explicitly enable auto-approval for Codex operations.
- The app-server is a local process for a trusted, personal machine. Do not expose the dashboard or worker to untrusted users. Settings can launch the configured MCP executable.
- The official app-server does not provide a universal rollback primitive. Use Git, Studio Undo or saved place versions where applicable, verify the resulting state, and reconcile uncertain operations. Syntra never fabricates rollback success.

## Reviews and control

- **Codex** shows auth, project settings, the eight-agent topology, ad-hoc and task-owned sessions, streamed items, diffs, token usage, approvals and turn-level review.
- **Review** groups pending Studio, asset and Codex approvals, exposes exact arguments, supports individual or batch decisions, and lists accepted work and review history.
- **Tasks** shows dependencies, attempts, errors, pause/cancel controls and task-owned Codex sessions. A task-owned session cannot be driven from the Codex page.
- **Settings** controls the Studio MCP command, approval policy, concurrency, task timeout, model step limit, themes and density.

Shortcuts: **Ctrl/Cmd+K** opens the launcher, **Alt+1…9** switches the first nine views, **Alt+F** toggles focus mode, **?** shows shortcuts. Search and navigation state persist locally. **Download diagnostics** exports connection status, task counts, Codex session/token flags and agent models without credentials, prompts or tool arguments.

## Library

Open **Library** to browse **94 attributed official Roblox Creator Documentation guides** plus **22 Syntra agent playbooks and task recipes**. The pack covers security, data, Luau, networking, UI, world building, performance, economy, testing and release workflows, with offline source text, pinned revisions, practical do/avoid notes and checklists. Search spans section-level FTS: results show the matching heading and snippet, and a **Brief** button builds a cited, context-bounded task brief for a selected agent. Add your own guides, source links, Markdown files and images with **Add reference**; all eight Codex agents can consult the library through dynamic tools. Personal references stay in `.data/forge.sqlite`.

The retrieval model is deliberately close to the useful part of RoAutomation’s Library—heading-aware chunks and relevance ranking—while adding an official bundled pack, section citations, agent/kind filters, checklists and a first-class `library_brief` tool. See [library/README.md](library/README.md).

For source attribution, licensing and optional Python refresh instructions, see [library/README.md](library/README.md). The bundled pack works without Python; Python is needed only to scrape a newer source pack.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

The suite includes real child-process Codex JSON-RPC fixtures, dynamic-tool delegation, streaming, Codex approvals/rejection, interruption, token usage, Studio approvals, SDK writes, independent Tester verification, restart recovery, concurrency, cancellation, path confinement and repeatable migrations. It does not call paid Codex inference and is not a real Roblox playtest.

Optional browser checks (when Chromium and a display environment work):

```bash
npx playwright install chromium
node scripts/smoke.mjs
node scripts/ui-smoke.mjs
node scripts/desktop-smoke.mjs
node scripts/library-smoke.mjs
node scripts/redesign-smoke.mjs
FORGE_DATA_DIR=/tmp/forge-audit-check node scripts/reliability-smoke.mjs
```

The Linux Termux/proot build machine used for this delivery cannot run Chromium reliably, so browser checks were not reported as passing here. See the verification notes in [the Codex integration guide](docs/CODEX_INTEGRATION.md).

## Official references

- OpenAI Codex app-server: https://github.com/openai/codex/tree/main/codex-rs/app-server
- Codex app-server protocol schemas: https://github.com/openai/codex/tree/main/codex-rs/app-server-protocol/schema/json
- Roblox Studio MCP setup and tool catalog: https://create.roblox.com/docs/studio/mcp
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk

## Documentation

- [Codex integration and limitations](docs/CODEX_INTEGRATION.md)
- [Design system](docs/DESIGN.md)
- [Studio connection recovery](docs/STUDIO_CONNECTION_RECOVERY.md)
- [Reliability audit](docs/RELIABILITY_AUDIT.md)
- [V2 feature audit](docs/FEATURE_AUDIT_V2.md)
