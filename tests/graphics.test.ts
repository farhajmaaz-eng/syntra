import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SceneGraph } from "@open-pencil/scene-graph";
import { encodeDesign } from "../src/design-studio/scene";
import { readDesign, saveDesign } from "../src/design-studio/store";
import { migrateLegacyDesign } from "../src/graphics/migration";
import { createServer } from "node:http";
import { runInNewContext } from "node:vm";
import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { runCreativeTool } from "../worker/creative-tools";
import { readPenpotScene } from "../src/graphics/penpot";
import { exportRobloxGui } from "../src/graphics/roblox";

const directory = mkdtempSync(join(tmpdir(), "syntra-graphics-"));
const fileId = "11111111-1111-1111-1111-111111111111";
const pageId = "22222222-2222-2222-2222-222222222222";
let sequence = 0;
type Shape = {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  characters: string;
  opacity: number;
  fontSize: string;
  borderRadius: number;
  readonly borderRadiusTopLeft: number;
  readonly borderRadiusTopRight: number;
  readonly borderRadiusBottomRight: number;
  readonly borderRadiusBottomLeft: number;
  fills: Array<{ fillColor: string; fillOpacity: number }>;
  parent: Shape | null;
  readonly parentX: number;
  readonly parentY: number;
  children: Shape[];
  appendChild(child: Shape): void;
  resize(width: number, height: number): void;
  remove(): void;
  getPluginData(key: string): string | undefined;
  setPluginData(key: string, value: string): void;
};
function shape(type: string, name = type): Shape {
  const data = new Map<string, string>();
  const corners = new Map<string, number>();
  return {
    id: String(++sequence),
    type,
    name,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    characters: "",
    opacity: 1,
    fontSize: "16",
    borderRadius: 0,
    get borderRadiusTopLeft() {
      return corners.get("TopLeft") ?? this.borderRadius;
    },
    set borderRadiusTopLeft(value: number) {
      corners.set("TopLeft", value);
    },
    get borderRadiusTopRight() {
      return corners.get("TopRight") ?? this.borderRadius;
    },
    set borderRadiusTopRight(value: number) {
      corners.set("TopRight", value);
    },
    get borderRadiusBottomRight() {
      return corners.get("BottomRight") ?? this.borderRadius;
    },
    set borderRadiusBottomRight(value: number) {
      corners.set("BottomRight", value);
    },
    get borderRadiusBottomLeft() {
      return corners.get("BottomLeft") ?? this.borderRadius;
    },
    set borderRadiusBottomLeft(value: number) {
      corners.set("BottomLeft", value);
    },
    fills: [{ fillColor: "#123456", fillOpacity: 0.75 }],
    parent: null as Shape | null,
    get parentX(): number {
      return this.x - (this.parent?.x ?? 0);
    },
    get parentY(): number {
      return this.y - (this.parent?.y ?? 0);
    },
    children: [] as Shape[],
    appendChild(child: Shape) {
      child.remove();
      child.parent = this;
      this.children.push(child);
    },
    resize(w: number, h: number) {
      this.width = w;
      this.height = h;
    },
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter(
          (child) => child !== this,
        );
    },
    getPluginData(key: string) {
      return data.get(key);
    },
    setPluginData(key: string, value: string) {
      data.set(key, value);
    },
  };
}
const root = shape("board", "Root");
function append(type: string, name?: string) {
  const child = shape(type, name);
  root.appendChild(child);
  return child;
}
const screen = append("board", "Store & inventory");
screen.x = 1700;
screen.y = 2000;
const label = append("text", "Title");
screen.appendChild(label);
label.x = 1720;
label.y = 2030;
label.characters = "<Pick a kit>";
const penpot = {
  currentFile: { id: fileId },
  currentPage: { id: pageId, name: "HUD", root },
  selection: [screen],
  createBoard: () => append("board"),
  createText: (text: string) =>
    Object.assign(append("text"), { characters: text }),
  createEllipse: () => append("circle"),
  createRectangle: () => append("rect"),
  history: { undoBlockBegin: vi.fn(() => Symbol()), undoBlockFinish: vi.fn() },
};

let multiplePenpotTabs = false;
const server = createServer(async (req, res) => {
  const mcp = new McpServer({ name: "penpot-fixture", version: "1.0.0" });
  mcp.registerTool(
    "execute_code",
    { inputSchema: { code: z.string(), sessionId: z.string().optional() } },
    ({ code, sessionId }) => {
      if (!sessionId && multiplePenpotTabs)
        return {
          content: [{ type: "text", text: "Tool execution failed: Error: Multiple Penpot sessions are connected." }],
        };
      if (sessionId !== undefined && sessionId !== "fixture-session")
        return {
          isError: true,
          content: [{ type: "text", text: "Session mismatch" }],
        };
      try {
        const output = runInNewContext(
          "(function(){\n" + code + "\n})()",
          { penpot },
          { timeout: 1000 },
        );
        return { content: [{ type: "text", text: JSON.stringify(output) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
        };
      }
    },
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
  if (server.listening)
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("pins Frame to a Penpot page, applies an undoable styled edit, and exports editable Roblox UI", async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  vi.stubEnv("SYNTRA_PENPOT_MCP_URL", `http://127.0.0.1:${address.port}/mcp`);
  vi.stubEnv("SYNTRA_PENPOT_SESSION_ID", "fixture-session");
  vi.stubEnv(
    "SYNTRA_PENPOT_FILE_URL",
    `https://design.penpot.app/#/workspace?file-id=${fileId}&page-id=${pageId}`,
  );

  const inspected = await runCreativeTool("Frame", "design_inspect", {});
  await expect(runCreativeTool("Scenic", "design_edit", {})).rejects.toThrow(
    /cannot use/,
  );
  const edited = await runCreativeTool("Frame", "design_edit", {
    revision: inspected.revision,
    actions: [
      {
        action: "update",
        layerId: screen.id,
        cornerRadius: 12,
        fill: "#ffcc99",
      },
      {
        action: "create",
        type: "RECTANGLE",
        parentId: screen.id,
        name: "Button backdrop",
        x: 8,
        y: 16,
        width: 60,
        height: 30,
      },
    ],
  });
  expect(edited.changes).toHaveLength(2);
  expect(penpot.history.undoBlockFinish).toHaveBeenCalledOnce();
  await expect(
    runCreativeTool("Frame", "design_edit", {
      revision: inspected.revision,
      actions: [{ action: "delete", layerId: label.id }],
    }),
  ).rejects.toThrow(/revision changed/);

  const scene = await readPenpotScene();
  const result = exportRobloxGui(scene);
  expect(result.xml).toContain('class="ScreenGui"');
  expect(result.xml).toContain('class="TextLabel"');
  expect(result.xml).toContain('name="CornerRadius"><S>0</S><O>12</O>');
  expect(result.xml).toContain("Store &amp; inventory");
  expect(result.xml).toContain("&lt;Pick a kit&gt;");
  expect(result.xml).toContain("<XO>20</XO><YS>0</YS><YO>30</YO>");
  expect(result.xml).toContain("Button backdrop");
  expect(result.xml).not.toContain('class="Script"');
  vi.stubEnv("SYNTRA_DATA_DIR", directory);
  const { stageDesign, renderDesignInstall } = await import("../worker/design-handoff");
  const { revision } = await runCreativeTool("Frame", "design_inspect", {});
  const staged = await stageDesign({ revision, boardId: screen.id });
  expect(staged.model.instances[0].corners).toEqual([12, 12, 12, 12]);
  expect(staged.model.instances[0].children[0].text).toBe("<Pick a kit>");
  expect(renderDesignInstall(staged)).toContain('GetService("StarterGui")');

  const archive = new SceneGraph();
  archive.createNode("RECTANGLE", archive.getPages()[0].id, {
    name: "Saved legacy layer",
    width: 42,
    height: 32,
  });
  saveDesign(encodeDesign(archive), readDesign().revision);
  expect(await migrateLegacyDesign()).toMatchObject({ imported: 1 });
  expect(await migrateLegacyDesign()).toMatchObject({ imported: 0 });
  expect((await readPenpotScene()).layers).toContainEqual(
    expect.objectContaining({ name: "Saved legacy layer" }),
  );

  const { GET, PUT } = await import("../src/app/api/graphics/route");
  const path = "http://localhost:3000/api/graphics";
  const settings = {
    fileUrl: `https://design.penpot.app/#/workspace?file-id=${fileId}&page-id=${pageId}`,
    mcpUrl: `http://127.0.0.1:${address.port}/mcp?userToken=fixture-private-key`,
  };
  const initial = new Request(path, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  expect((await PUT(initial)).status).toBe(403);
  const connect = (candidate: typeof settings & { sessionId?: string }) =>
    PUT(new Request(path, {
      method: "PUT",
      body: JSON.stringify(candidate),
      headers: {
        Host: "localhost:3000",
        Origin: "http://localhost:3000",
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/json",
      },
    }));
  const saved = await connect(settings);
  expect(saved.status).toBe(200);
  const savedBody = await saved.text();
  expect(savedBody).not.toContain("fixture-private-key");
  expect(JSON.parse(savedBody).page).toBe(penpot.currentPage.name);

  multiplePenpotTabs = true;
  const ambiguous = await connect({ ...settings, mcpUrl: "" });
  expect(ambiguous.status).toBe(400);
  expect((await ambiguous.json()).error).toContain("MCP → Disconnect");

  multiplePenpotTabs = false;
  const reconnected = await connect({ ...settings, mcpUrl: "" });
  expect(reconnected.status).toBe(200);

  multiplePenpotTabs = true;

  const explicit = await connect({ ...settings, mcpUrl: "", sessionId: "fixture-session" });
  expect(explicit.status).toBe(200);
  const wrongSession = await connect({ ...settings, sessionId: "wrong-session" });
  expect(wrongSession.status).toBe(400);
  // Export below must still use the previously verified session.
  expect(await (await GET(new Request(path))).text()).not.toContain(
    "fixture-private-key",
  );
  const downloaded = await GET(new Request(path + "?op=export"));
  expect(downloaded.status).toBe(200);
  expect((await downloaded.json()).xml).toContain('class="ScreenGui"');

  penpot.currentPage.id = "different";
  await expect(readPenpotScene()).rejects.toThrow(
    /configured Penpot file and page/,
  );
});
