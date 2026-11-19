import { afterAll, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { SceneGraph } from "@open-pencil/scene-graph";
import { GET, PUT } from "../src/app/api/design-studio/route";
import { decodeDesign, encodeDesign } from "../src/design-studio/scene";
import { readDesign, saveDesign } from "../src/design-studio/store";
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
  const payload = JSON.parse(encodeDesign(graph));
  const textNode = payload.nodes.find((node: { id: string }) => node.id === text.id);
  textNode.sceneTestData = JSON.parse('{"__proto__":{"injected":true}}');
  const escapedKey = JSON.stringify(payload).replace('"__proto__"', '"__pro\\u0074o__"');
  const sanitized = JSON.parse(encodeDesign(decodeDesign(escapedKey)));
  expect(sanitized.nodes.find((node: { id: string }) => node.id === text.id).sceneTestData).toEqual({});
  textNode.sceneTestBytes = { syntraBytes: [10, 20] };
  const roundTrip = JSON.parse(encodeDesign(decodeDesign(JSON.stringify(payload))));
  expect(roundTrip.nodes.find((node: { id: string }) => node.id === text.id).sceneTestBytes)
    .toEqual({ syntraBytes: [10, 20] });
  const broken = JSON.parse(encodeDesign(graph));
  broken.nodes.push(broken.nodes.at(-1));
  expect(() => decodeDesign(JSON.stringify(broken))).toThrow();
  for (const invalid of [{ x: "12" }, { width: null }, { type: "UNKNOWN" }, { name: "x".repeat(201) }]) {
    const document = JSON.parse(encodeDesign(graph));
    Object.assign(document.nodes[0], invalid);
    expect(() => decodeDesign(JSON.stringify(document))).toThrow();
  }
});

it("retains revision-checked legacy design archives for migration", async () => {
  const visible = await GET().json();
  const poll = (revision: number) => GET(new Request(`http://localhost/api/design-studio?revision=${revision}`));
  const unchanged = poll(visible.revision);
  expect(unchanged.status).toBe(204);
  expect(await unchanged.text()).toBe("");
  const graph = decodeDesign(visible.scene);
  graph.createNode("TEXT", graph.getPages()[0].id, { name: "Inventory", text: "Inventory" });
  const result = saveDesign(encodeDesign(graph), visible.revision);
  expect(await poll(visible.revision).json()).toMatchObject({
    revision: result.revision, scene: expect.stringContaining("Inventory"),
  });
  expect(poll(result.revision).status).toBe(204);
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
