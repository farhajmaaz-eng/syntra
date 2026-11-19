# Design Studio and Illustrate

**Design Studio** is an editable OpenPencil document in the Syntra sidebar. The canvas runs in the page's DOM using OpenPencil Core and its Vue SDK. Syntra provides the surrounding controls, theme, typography, and local autosave. Select and draw frames, rectangles, ellipses and text. Use the layer list to inspect or edit the selected layer's position, size, name and text.

The local Design Studio document is stored in `design-studio.sqlite` under `SYNTRA_DATA_DIR`. Syntra loads the canvas and its local CanvasKit and font assets only when the editor opens. Browser and agent saves share revision checks. If someone edits the document while you have unsaved work, Syntra keeps the current canvas and asks before reloading the saved version.

## Use with Codex

Frame uses `design_inspect` followed by `design_edit` to create or revise editable layers, then reads back the result. Scenic is Syntra's modeller. It can search Roblox assets or create a local Illustrate model with `illustrate_create` and `illustrate_mesh`. New standalone Codex sessions also receive the local design and modeling tools automatically. Tester can inspect both workspaces and record a local verdict with `verify_creative`.

## Export a model into Roblox Studio

For a local file, download GLB from Illustrate and open it in Studio's Importer. For an agent-assisted import:

1. Connect Roblox Studio and pin the intended published place in Syntra's Games page.
2. In Roblox Studio's MCP settings, enable the asset read and write scopes and approve the `illustrate-exports` folder under `SYNTRA_DATA_DIR`. The modeller reports the exact path after staging a GLB.
3. Ask Lead to send the Illustrate model into that place. Scenic stages the inspected revision, uses Studio's advertised Open Cloud import tools, and requests Syntra approval before uploading.
4. After Roblox returns an asset ID and accepts the upload, Scenic inserts that ID into the pinned place and reads back the result. Studio permission, moderation and insertion errors are surfaced as failures.

Direct upload uses Roblox Studio's credentials and creates a permanent model asset. Syntra's standalone Codex sessions can stage local GLBs. Place changes use the pinned task workflow and its review controls.

[OpenPencil SDK](https://openpencil.dev/developers/sdk/getting-started) · [Studio Open Cloud model import](https://create.roblox.com/docs/studio/mcp-open-cloud)
