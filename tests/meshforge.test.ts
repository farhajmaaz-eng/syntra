import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Euler, Quaternion, Vector3 } from "three";
import { GET, POST, PUT } from "../src/app/api/meshforge/[...action]/route";
import { closeMeshStorage } from "../src/meshforge/store";
import { wasmKernel } from "../src/meshforge/client/geometry/wasmKernel";
import { exportSceneToFBX, exportSceneToGLB, exportSceneToOBJ, parseOBJToNode } from "../src/meshforge/shared/exporters";
import { buildPrimitiveSoup, createDefaultSceneDocument } from "../src/meshforge/shared/sceneOps";

const dataDir = mkdtempSync(join(tmpdir(), "syntra-meshforge-test-"));
const mcpKey = "meshforge-test-local-key";
process.env.SYNTRA_DATA_DIR = dataDir;
process.env.SYNTRA_MESHFORGE_MCP_KEY = mcpKey;
afterAll(() => {
  closeMeshStorage();
  rmSync(dataDir, { recursive: true, force: true });
});

const origin = "http://localhost:3000";
const editor = { Origin: origin, "Sec-Fetch-Site": "same-origin" };
const external = { Authorization: `Bearer ${mcpKey}` };
async function request(method: "GET" | "POST" | "PUT", path: string, body?: unknown, headers?: Record<string, string>) {
  const url = new URL("/api/meshforge/" + path, origin);
  const handler = { GET, POST, PUT }[method];
  return handler(new Request(url, {
    method,
    headers: {
      Host: url.host, "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve({ action: url.pathname.split("/").slice(3) }) });
}
const rpc = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0", id: 1, method: "tools/call",
  params: { name, arguments: args },
});

it("persists the scene and rejects stale, malformed, and cross-origin writes", async () => {
  const scene = createDefaultSceneDocument("MeshForge test");
  expect((await request("POST", "projects", { scene })).status).toBe(403);
  const create = await request("POST", "projects", { scene }, editor);
  expect(create.status).toBe(201);
  const { id } = await create.json();
  const [winner, loser] = await Promise.all([
    request("PUT", `projects/${id}`, { revision: 1, scene: { ...scene, name: "First" } }, editor),
    request("PUT", `projects/${id}`, { revision: 1, scene: { ...scene, name: "Second" } }, editor),
  ]);
  expect([winner.status, loser.status].sort()).toEqual([200, 409]);
  const result = await (await request("GET", `projects/${id}`)).json();
  expect(result.revision).toBe(2);
  expect(result.scene.name).toBe(winner.ok ? "First" : "Second");

  const invalid = structuredClone(scene);
  invalid.nodes.find((node) => node.soup)!.soup!.faceIndices[0] = 999999;
  expect((await request("PUT", `projects/${id}`, { revision: 2, scene: invalid }, editor)).status).toBe(400);
  expect((await (await request("GET", `projects/${id}`)).json()).revision).toBe(2);
});

it("scopes the MCP SDK route and syncs only committed tool changes", async () => {
  const create = await request("POST", "projects", { scene: createDefaultSceneDocument("MCP test") }, editor);
  expect(create.status).toBe(201);
  const { id } = await create.json();
  const path = `mcp?projectId=${id}`;
  const unsupportedStream = await request("GET", path, undefined, external);
  expect(unsupportedStream.status).toBe(405);
  expect(unsupportedStream.headers.get("Allow")).toBe("POST");
  expect((await request("POST", path, rpc("inspect_scene", {}), editor)).status).toBe(401);
  const wrongProject = await request("POST", path, rpc("inspect_scene", { projectId: "proj_default_workspace" }), external);
  expect((await wrongProject.json()).result.isError).toBe(true);

  const result = await request("POST", path, rpc("create_mesh_primitive", { kind: "cube", name: "Fixture Cube" }), external);
  expect(result.status).toBe(200);
  const response = await result.json();
  expect(JSON.parse(response.result.content[0].text).revision).toBe(2);
  const sync = await (await request("GET", `projects/${id}/sync?sinceRevision=1&sinceEventId=0`)).json();
  expect(sync.scene.nodes.some(({ name }: { name: string }) => name === "Fixture Cube")).toBe(true);
  expect(sync.events).toMatchObject([{ toolName: "create_mesh_primitive", revision: 2, actor: "mcp" }]);
  const settled = await (await request("GET", `projects/${id}/sync?sinceRevision=2&sinceEventId=${sync.events[0].id}`)).json();
  expect(settled).toEqual({ revision: 2, events: [] });

  const inspect = await request("POST", `tools?projectId=${id}`, rpc("inspect_scene", {}), editor);
  expect(JSON.parse((await inspect.json()).result.content[0].text).projectId).toBe(id);
});

it("preserves OBJ corner UVs and rejects invalid geometry", () => {
  const node = parseOBJToNode("v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf -3/1 -2/2 -1/3 # UV triangle");
  expect(node.soup?.faceIndices).toEqual([0, 1, 2]);
  expect(node.soup?.faceUvs).toEqual([0, 0, 1, 0, 0, 1]);
  expect(() => parseOBJToNode("v 0 0 0\nf 1 2 3")).toThrow(/missing vertex/);
  expect(() => parseOBJToNode("v Infinity 0 0")).toThrow(/invalid vertex/);
  expect(() => parseOBJToNode("v 0 0 0")).toThrow(/no polygon/);
});

it("exports consistent transforms, axis conversion, and material filenames", () => {
  const scene = createDefaultSceneDocument("Example (v2)");
  const node = scene.nodes.find((entry) => entry.soup)!;
  scene.nodes = [node];
  node.visible = true;
  node.position = [1, 2, 3];
  node.rotation = [30, 45, 20];
  node.scale = [2, 3, 4];
  const options = { scalePreset: "studs_1_0", upAxis: "Z" } as const;
  const obj = exportSceneToOBJ(scene, options);
  expect(obj.obj).toContain("mtllib Example_v2_.mtl");
  const vertex = obj.obj.split("\n").find((line) => line.startsWith("v "))!.slice(2).split(" ").map(Number);
  const euler = new Euler(...node.rotation.map((value) => value * Math.PI / 180) as [number, number, number], "XYZ");
  const expected = new Vector3().fromArray(node.soup!.coords)
    .sub(new Vector3(...node.pivotOffset)).multiply(new Vector3(...node.scale))
    .applyEuler(euler).add(new Vector3(...node.position));
  expect(vertex[0]).toBeCloseTo(expected.x, 4);
  expect(vertex[1]).toBeCloseTo(-expected.z, 4);
  expect(vertex[2]).toBeCloseTo(expected.y, 4);

  const bytes = exportSceneToGLB(scene, options);
  const glb = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(glb.getUint32(0, true)).toBe(0x46546c67);
  expect(glb.getUint32(8, true)).toBe(bytes.byteLength);
  const model = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + glb.getUint32(12, true))));
  expect(model.nodes[0].translation).toEqual([1, -3, 2]);
  expect(model.nodes[0].scale).toEqual([2, 4, 3]);
  expect(new Quaternion().fromArray(model.nodes[0].rotation).length()).toBeCloseTo(1, 5);
  const fbx = exportSceneToFBX(scene, options);
  expect(fbx).toContain("FBXVersion: 7400");
  expect(fbx).toContain('"FrontAxis", "int", "Integer", "",1');
  expect(fbx).toContain('"Lcl Translation", "", "A",1.0000,-3.0000,2.0000');
  expect(fbx).toContain('"Lcl Scaling", "", "A",2.0000,4.0000,3.0000');
});

it("loads the bundled WASM and matches the TypeScript cube topology", async () => {
  const wasm = readFileSync("public/wasm/rblx_mesh_wasm.wasm");
  const cube = buildPrimitiveSoup("cube");
  const baseline = wasmKernel.buildRenderBuffers(cube, true);
  vi.stubGlobal("fetch", async () => new Response(new Uint8Array(wasm)));
  try {
    expect(await wasmKernel.init()).toBe(true);
    const result = wasmKernel.buildRenderBuffers(cube, true);
    expect(result.validation.triangleCount).toBe(baseline.validation.triangleCount);
    expect(result.indices.length).toBe(baseline.indices.length);
    expect(result.positions.every(Number.isFinite)).toBe(true);
    expect(wasmKernel.extrudeFaces(cube, [0], 1, 1).faceCounts.length).toBeGreaterThan(cube.faceCounts.length);
  } finally {
    vi.unstubAllGlobals();
  }
});
