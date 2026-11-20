# Syntra Graphics and Illustrate

**Syntra Graphics** opens the full Penpot editor for fills, strokes, corner radii, components, grid and flex layouts, design tokens, and prototyping. The Syntra workspace uses the dashboard theme. Penpot runs in its own tab with its own appearance settings.

## Connect Penpot

1. In Penpot, go to **Your account → Integrations → MCP Server**. Enable it, generate an MCP key if prompted, choose **Copy server URL**, and paste it into **Server URL** in Syntra Graphics.
2. Open the Penpot page you want to use. Choose **MCP → Connect** in the file toolbar, then paste the address from your browser into **Penpot file address**.
3. Choose **Connect** in Syntra. Syntra checks the page before saving. Keep the Penpot tab open while agents work.

Keep only the Penpot tab you want to use connected. If more than one tab is connected, choose **MCP → Disconnect** in the other tabs and try again. [Penpot MCP setup](https://help.penpot.dev/mcp/)

Syntra stores the connection in a private file in the workspace data directory. Treat the Server URL like a password because it can contain a key. For scripted deployments, set `SYNTRA_PENPOT_FILE_URL` and `SYNTRA_PENPOT_MCP_URL` as defaults, with `SYNTRA_PENPOT_SESSION_ID` when needed. Quote the Penpot file address in `.env` to preserve the full address.

For a local MCP server, connect a single tab through the Penpot plugin. Enter the local server address in **Server URL**.

The hosted editor can be used from a browser without running Penpot’s server on the Syntra machine. Self-hosting can run on a separate machine. Use an HTTPS endpoint for a remote Penpot instance. [Penpot configuration](https://help.penpot.dev/technical-guide/configuration/)

Frame and Codex can use `design_inspect` and `design_edit` on the configured file and page. Frame inspects the current revision before applying an edit, and Penpot groups the edit into one undo step. Tester can inspect the resulting design. Changing to a different Penpot page requires updating the configured URL.

## Export to Roblox Studio

For an agent-assisted import, pin your Studio in **Games** and ask Lead to import a named Penpot board. Frame stages the inspected revision. Builder receives that handoff through a task dependency, inspects StarterGui, and installs editable UI through the existing Studio review flow. Tester checks the result. Re-importing the same staged design is safe. A different object with the same name is left in place.

Select a board in Penpot, then choose **Download editable UI** in Syntra Graphics. In Roblox Studio, insert the downloaded `.rbxmx` model under **StarterGui**. The export maps supported boards and layers to a `ScreenGui` with editable frames, text labels, solid fills, transparency, strokes, and corners. Positions and sizes are exported in pixels. Review layout behavior on phone and desktop in Studio.

The export reports layers or styling that need manual adaptation. For complex vector paths, images, gradients, or effects, export PNG from Penpot and import the image into Roblox as an asset. Penpot retains the full editable source. [Penpot export formats](https://help.penpot.app/user-guide/export-import/exporting-layers/) · [Roblox labels](https://create.roblox.com/docs/ui/labels) · [Roblox corners](https://create.roblox.com/docs/reference/engine/classes/UICorner)

## Migrate a saved Design Studio scene

If a previous workspace has saved layers, choose **Copy saved design** to copy supported boards, groups, shapes, and text into the connected Penpot page. Review the migration differences in Syntra. The original `design-studio.sqlite` remains available in the workspace data directory and can be downloaded as an archive from Syntra Graphics.

## Export an Illustrate model

Download a GLB from Illustrate and open it in Roblox Studio’s 3D Importer. For agent-assisted import, connect and pin the intended Studio, grant the required Studio MCP asset scopes, and approve the workspace’s `illustrate-exports` folder. Scenic stages the GLB and requests approval for upload. [Studio Open Cloud model import](https://create.roblox.com/docs/studio/mcp-open-cloud)
