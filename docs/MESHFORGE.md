# Illustrate in Syntra

Open **Illustrate** from the Studio navigation or the workspace command palette. The editor uses the active Syntra theme and runs in a dedicated workspace with a WebGL2 viewport. It supports primitive and OBJ import workflows, half-edge mesh editing, materials, UVs, Roblox-oriented scene checks, and OBJ/MTL, GLB and ASCII FBX export.

## Projects and synchronization

Mesh scenes autosave into `meshforge.sqlite` in `SYNTRA_DATA_DIR` (default `.data`). There is no separate signup or cloud database. Include this database when backing up the workspace with Syntra stopped. The main Syntra workspace reset covers agent and Studio data. MeshForge scenes live in their own database.

Edited scenes are saved against the revision that was opened. If another tab or MCP tool saves first, open **Mesh projects** and either save a copy of your edits or reload the saved scene. Syntra keeps the edits in the current tab until you choose. The previous standalone Cloudflare project's accounts and data remain in that installation.

## MCP

The console inside MeshForge uses the local editor tool route. External MCP clients can connect to `/api/meshforge/mcp?projectId=<id>` using Streamable HTTP POST and `Authorization: Bearer <token>`. Set `SYNTRA_MESHFORGE_MCP_KEY` in `.env` before starting Syntra. The connection dialog shows the URL and a configuration template. A tool request is scoped to the project ID in the endpoint URL. Syntra's existing Roblox Studio MCP connection is independent.

## Geometry kernel

Syntra includes the compiled WebAssembly kernel and falls back to TypeScript if the browser cannot load it. The Rust sources are under `crates/rblx-mesh-wasm`. To rebuild it after changing the Rust code:

```sh
rustup target add wasm32-unknown-unknown
RUSTFLAGS="-C target-feature=+simd128" cargo build --manifest-path crates/rblx-mesh-wasm/Cargo.toml --target wasm32-unknown-unknown --release
cp crates/rblx-mesh-wasm/target/wasm32-unknown-unknown/release/rblx_mesh_wasm.wasm public/wasm/
```

Editor and kernel originated in [MeshForge Studio](https://github.com/farhajmaaz-eng/Meshforge-studio/tree/5f3e641).
