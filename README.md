# Syntra Studio

Syntra Studio is a local-first workspace for building Roblox games with OpenAI Codex. Give the Lead a request, follow the tasks it assigns to seven specialist agents, and review proposed changes from one dashboard. You can work on local project files or connect Roblox Studio for live place edits and playtesting.

![Syntra workflow showing a request moving from Lead through specialist tasks and into review](docs/syntra-workflow.svg)

## Quick start

You’ll need **Node.js 22 or newer**, npm, and a ChatGPT account with Codex access or an OpenAI API key. For live place edits, install Roblox Studio on the Windows or macOS computer running the Syntra worker.

```sh
git clone https://github.com/farhajmaaz-eng/syntra.git
cd syntra
npm ci
cp .env.example .env
npm run local
```

On Windows PowerShell, use `Copy-Item .env.example .env` in place of `cp`. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

1. Open **Codex** and sign in. Set the project root to the directory that contains the files you want agents to work on.
2. Create or select a project in **Games**. For live Roblox Studio work, connect and pin a Studio instance using the steps below.
3. Submit a request in **Lead** or **Home**. Include the expected result and how it should be verified.
4. Track work in **Tasks**. Open **Review** to inspect proposed Studio operations and completed work. The **Codex** page also shows command and file-change approvals, session diffs, and token usage.

For a first request, try “Add a server-side checkpoint system to my obby. Keep the existing map and verify that players respawn at their latest checkpoint.”

## Connect Roblox Studio

1. Open your place in Roblox Studio and [enable the official Studio MCP server](https://create.roblox.com/docs/studio/mcp).
2. Open **Settings → Roblox Studio connection** in Syntra. Enter the command and arguments supplied by Roblox Studio, save them, then choose **Connect / reconnect**.
3. In **Games**, use **Discover Studios**, then add or update your project with the returned Studio ID. If Studio restarts and the ID changes, use **Review Studio switch** to confirm the replacement.

See [Studio connection recovery](docs/STUDIO_CONNECTION_RECOVERY.md) if a connection changes during a run.

## What’s in the workspace

- **Lead and Team** coordinate the work. Architect plans, Builder writes Luau, Frame designs interfaces in Syntra Graphics, Scenic models in Illustrate, Balance tunes progression, Tester checks results, and Codex handles focused local-repository tasks.
- **Tasks and Review** show dependencies, status, approval requests, and evidence. Review interrupted operations against the actual project or place before retrying.
- **Library** includes searchable Roblox Creator Documentation and Syntra playbooks. Add project references or build a brief for an agent. See the [library guide](library/README.md).

## Research Roblox games

Open **Game Intelligence** from the sidebar to browse Trending, Top CCU, Rising, Most Visited, Most Favorited and Up-and-Coming. Search for an experience or tracked creator, filter by genre or concurrent players, and open an experience to inspect its source links and history. Ranked counts cover the tracked catalog. Rising uses a reported 24-hour CCU change or Syntra observations taken about a day apart.

Use **Settings → Roblox data sources** to turn providers on or off, set refresh intervals, and edit their catalog endpoints. Syntra reads keyless feeds from [Roblox](https://www.roblox.com/charts), [RoWatcher](https://rowatcher.com/developers), [RobloxGameStats](https://robloxgamestats.com/docs/api), [PlaySurge](https://playsurge.gg/docs), and [BloxHub](https://bloxhub.games/api). RobloxGameStats limits its free API to personal and non-commercial use. Syntra keeps cached results and local observations in `game-intelligence.sqlite` and shows provider status when a feed is interrupted. Lead can search, read rankings, compare games, and save sourced observations directly to a draft pitch.

Select up to five experiences in **Game Intelligence** to compare their metrics and observation times side by side. **Draft with Lead** saves the selected observations to **Market** and opens an editable research request. Lead can cite that saved snapshot in a versioned pitch and propose a prototype and playtest criteria. Review the pitch before converting it to project work.

## Monitor a published game

In **Games → Edit project**, enter the Roblox universe ID. Select the project in **LiveOps → Public activity** to see current public observations, timestamps, source links, and available player history. Each chart keeps its own observation window. **Investigate player activity** opens a Lead request with the selected series and its dates. Open **Fixes & Reports** for Studio test results and tracked failures.

For private metrics, open **LiveOps → Charts → Import CSV**. Export one chart from [Roblox Creator Dashboard](https://create.roblox.com/docs/production/analytics/analytics-dashboard#export-a-chart), choose its metric, and upload the timestamp/value CSV. Each import supports up to 2,000 observations. Date-only rows use UTC. Choose the decimal option for percentages written as fractions, and use **Import JSON** for exports with multiple series. The worker stores the imported analytics locally. Creator permissions are required to obtain private exports. FPS, ping, live server occupancy, live joins, and automatic drop-off telemetry are outside the public feed.

Agents can search completed work from human-accepted runs with `project_history`. Results are scoped to the current project and retain links through their task and run IDs.

## Design and model with Codex

Frame reads and edits the connected Penpot file in **Syntra Graphics**. The workspace exports editable Roblox UI models and can copy supported layers from the previous local archive. See [Syntra Graphics setup](docs/DESIGN_STUDIO.md). Scenic creates and validates Roblox assets in **Illustrate**, can reuse authorized Roblox assets, and can stage a GLB for a Studio import workflow. In Illustrate, **Studio Export** prepares a supported file for Studio's 3D importer.

Syntra's built-in Codex and Scenic agents can use Illustrate directly. For an external Codex CLI session, set the same `SYNTRA_ILLUSTRATE_MCP_KEY` in the Syntra server and CLI environments. Open the project in Illustrate, select **Connect Codex**, and copy the project-scoped command. Keep the key in your environment.

## Running and maintaining Syntra

`npm run local` launches the dashboard and a separate worker together. `npm run dev` uses an embedded worker. For a production build with the embedded worker, run `npm run build` followed by `npm run start`. If you run `npm run worker` independently, set `WORKER_EXTERNAL=1` for the dashboard and use the same data directory and worker port for both processes.

Workspace data and Codex credentials are stored locally in `.data/` by default. Set `SYNTRA_DATA_DIR` to move that directory. Upgrading installations can still read the previous directory setting and database filename. New workspaces use `syntra.sqlite`. Stop Syntra before backing it up, and keep it out of version control. Use the dashboard on a trusted machine. Codex billing is handled by OpenAI, and Syntra displays token usage.

## Windows desktop

Get the **Syntra-Desktop-Windows-x64** installer artifact from the latest successful [Windows desktop workflow](https://github.com/farhajmaaz-eng/syntra/actions/workflows/windows-desktop.yml). Extract the ZIP, run the setup EXE, and open **Syntra Desktop** from the Start menu. Setup installs Microsoft Edge WebView2 if it is missing. Syntra includes Node, SQLite, the Codex app-server, and the Illustrate WASM editor.

Desktop files live under `%LOCALAPPDATA%\dev.syntra.desktop`. **File → Open data folder** opens that directory. In **Codex → Local project & permissions**, **Browse folders** selects a Windows project folder. Sign in to Codex from Syntra. For Studio tools, enable MCP in the Windows Roblox Studio installation and connect it from **Games**. In **Settings → Runtime**, choose up to eight concurrent agents.

The Windows workflow builds the production Next.js frontend, stages the desktop runtime, tests it, and packages the Tauri 2 installer. To build it on a Windows x64 development machine with the Microsoft C++ build tools, Node 22, Rust, and WebView2 installed, run:

```sh
npm ci
npm run build -- --webpack
node desktop/make-resources.mjs
node desktop/smoke.mjs
npx --yes @tauri-apps/cli@2.12.6 build --bundles nsis --target x86_64-pc-windows-msvc
```

The staging script takes a fresh output directory. The installer is created in `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

## Development checks

```sh
npm run typecheck
npm test
npm run build
```

These checks run without a browser. Automated integration tests use local fixtures for Codex and Roblox Studio MCP. Live playtesting requires your own Roblox Studio instance and a signed-in Codex session.

For implementation details, see the [Codex integration guide](docs/CODEX_INTEGRATION.md).
