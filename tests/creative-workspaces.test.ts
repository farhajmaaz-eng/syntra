import { afterAll, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SceneGraph } from "@open-pencil/scene-graph";
import { GET, PUT } from "../src/app/api/design-studio/route";
import { decodeDesign, encodeDesign } from "../src/design-studio/scene";
import { readDesign } from "../src/design-studio/store";
import { creativeDefinitions, runCreativeTool, validateIllustrateUpload } from "../worker/creative-tools";

const directory = mkdtempSync(join(tmpdir(), "syntra-creative-"));
process.env.SYNTRA_DATA_DIR = directory;
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it("round-trips the real scene graph and rejects unreachable duplicate nodes", () => {
  const graph = new SceneGraph();
  const page = graph.getPages()[0];
  const frame = graph.createNode("FRAME", page.id, { name: "HUD", width: 400, height: 180 });
  const text = graph.createNode("TEXT", frame.id, { name: "Balance", text: "100 credits" });
  const restored = decodeDesign(encodeDesign(graph));
  expect(restored.getChildren(frame.id).map(({ id }) => id)).toEqual([text.id]);
  expect(restored.getNode(text.id)?.text).toBe("100 credits");
  const broken = JSON.parse(encodeDesign(graph));
  broken.nodes.push(broken.nodes.at(-1));
  expect(() => decodeDesign(JSON.stringify(broken))).toThrow();
});

it("shares revision-checked scene edits between Frame, Tester and the browser", async () => {
  const visible = await GET().json();
  const inspected = await runCreativeTool("Frame", "design_inspect", {});
  expect(inspected.revision).toBe(visible.revision);
  const result = await runCreativeTool("Frame", "design_edit", {
    revision: visible.revision,
    actions: [{ action: "create", type: "TEXT", text: "Inventory", width: 180, height: 40, fontSize: 18, fill: "#e3c99c" }],
  });
  const tester = await runCreativeTool("Tester", "design_inspect", {});
  expect(tester.revision).toBe(result.revision);
  expect(tester.layers).toContainEqual(expect.objectContaining({ type: "TEXT", text: "Inventory" }));
  await expect(runCreativeTool("Scenic", "design_edit", {})).rejects.toThrow(/cannot use/);
  await expect(runCreativeTool("Frame", "design_edit", {
    revision: visible.revision,
    actions: [{ action: "create", type: "FRAME" }],
  })).rejects.toThrow(/revision changed/);
  const stale = await PUT(new Request("http://localhost:3000/api/design-studio", {
    method: "PUT",
    headers: {
      Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(visible),
  }));
  expect(stale.status).toBe(409);
  expect(readDesign().revision).toBe(result.revision);
});

it("lets Scenic create via actual MCP, stages a GLB and constrains cloud uploads", async () => {
  expect(creativeDefinitions("Scenic").map(({ name }) => name)).toContain("illustrate_mesh");
  expect(creativeDefinitions("Frame").map(({ name }) => name)).toContain("design_edit");
  const created = await runCreativeTool("Scenic", "illustrate_create", { name: "Fixture sculpture" });
  await runCreativeTool("Scenic", "illustrate_mesh", {
    projectId: created.id, tool: "create_mesh_primitive", args: { kind: "cube", name: "Base" },
  });
  const inspected = await runCreativeTool("Tester", "illustrate_mesh", { projectId: created.id, tool: "inspect_scene" });
  expect(inspected.nodes).toContainEqual(expect.objectContaining({ name: "Base" }));
  await expect(runCreativeTool("Tester", "illustrate_mesh", {
    projectId: created.id, tool: "delete_node", args: { target: "Base" },
  })).rejects.toThrow(/can inspect models/);
  const artifact = await runCreativeTool("Scenic", "illustrate_export", { projectId: created.id, revision: inspected.revision });
  expect(readFileSync(artifact.filepath).subarray(0, 4).toString()).toBe("glTF");
  const upload = {
    method: "POST", endpoint: "/assets/v1/assets", scopes: ["asset:write"],
    files: { fileContent: artifact.filepath },
    body: JSON.stringify({ assetType: "Model", displayName: "Fixture sculpture" }),
  };
  expect(() => validateIllustrateUpload(upload)).not.toThrow();
  expect(() => validateIllustrateUpload({ ...upload, files: { ...upload.files, other: "private.txt" } })).toThrow();
  expect(() => validateIllustrateUpload({ ...upload, endpoint: "/cloud/v2/universes/123" })).toThrow();
  expect(() => validateIllustrateUpload({ ...upload, files: { fileContent: join(directory, basename(artifact.filepath)) } })).toThrow();
  writeFileSync(artifact.filepath, "glTFinvalid bytes here");
  expect(() => validateIllustrateUpload(upload)).toThrow();
});

it("streams the versioned CanvasKit module with an immutable cache policy", async () => {
  const { GET: asset } = await import("../src/app/api/design-assets/[asset]/route");
  const { canvasWasmUrl } = await import("../src/design-studio/assets");
  const response = await asset(new Request("http://localhost" + canvasWasmUrl), {
    params: Promise.resolve({ asset: "canvaskit.wasm" }),
  });
  expect(response.headers.get("content-type")).toBe("application/wasm");
  expect(response.headers.get("cache-control")).toContain("immutable");
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  expect(Array.from(value!.slice(0, 4))).toEqual([0, 97, 115, 109]);
  await reader.cancel();
});

it("connects an MCP SDK client to the authenticated Illustrate endpoint", async () => {
  const { POST } = await import("../src/app/api/illustrate/mcp/route");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const url = new URL("http://localhost/api/illustrate/mcp");
  const missing = await POST(new Request(url, { method: "POST" }));
  expect(missing.status).toBe(401);
  process.env.SYNTRA_ILLUSTRATE_MCP_KEY = "illustrate-test-key";
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: "Bearer illustrate-test-key" } },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      return request.method === "POST" ? POST(request) : new Response(null, { status: 405 });
    },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toContain("inspect_scene");
    const result = await client.callTool({ name: "inspect_scene", arguments: {} });
    expect(result.isError).not.toBe(true);
  } finally {
    await client.close();
    delete process.env.SYNTRA_ILLUSTRATE_MCP_KEY;
  }
});
