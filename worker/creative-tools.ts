import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import type { SceneNode } from "@open-pencil/scene-graph";
import { decodeDesign, designColor, encodeDesign, layerTypes } from "../src/design-studio/scene";
import { readDesign, saveDesign } from "../src/design-studio/store";
import { workspaceDataDirectory } from "../src/lib/workspace-paths";
import type { Role } from "../src/lib/roles";
import { createRobloxMcpServer } from "../src/meshforge/mcp";
import { createMeshProject, listMeshProjects, readMeshProject, saveMeshProject } from "../src/meshforge/store";
import { exportSceneToGLB, meshExportName } from "../src/meshforge/shared/exporters";
import { createDefaultSceneDocument } from "../src/meshforge/shared/sceneOps";
import type { CodexDynamicTool } from "./codex";

const meshReadTools = ["inspect_scene", "validate_roblox_compatibility"] as const;
const meshWriteTools = ["create_mesh_primitive", "transform_node", "edit_mesh_topology", "assign_roblox_material", "delete_node"] as const;
const meshTools = [...meshReadTools, ...meshWriteTools] as const;
const id = z.string().trim().min(1).max(200);
const revision = z.number().int().positive();
const fields = {
  name: id.optional(),
  text: z.string().max(4000).optional(),
  x: z.number().min(-100000).max(100000).optional(),
  y: z.number().min(-100000).max(100000).optional(),
  width: z.number().positive().max(10000).optional(),
  height: z.number().positive().max(10000).optional(),
  fill: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  fontSize: z.number().positive().max(500).optional(),
};

const creativeTools = {
  design_inspect: {
    schema: z.object({ layerId: id.optional() }).strict(),
    description: "Inspect the saved Design Studio scene, layer IDs, text, and geometry. Read the revision before editing.",
    readers: ["Frame", "Codex", "Lead", "Tester", "Architect"],
  },
  design_edit: {
    schema: z.object({
      revision, actions: z.array(z.discriminatedUnion("action", [
        z.object({ action: z.literal("create"), type: z.enum(layerTypes), parentId: id.optional(), ...fields }).strict(),
        z.object({ action: z.literal("update"), layerId: id, ...fields }).strict(),
        z.object({ action: z.literal("delete"), layerId: id }).strict(),
      ])).min(1).max(40),
    }).strict(),
    description: "Apply a revision-checked batch to Design Studio's editable OpenPencil scene. Create frames, rectangles, ellipses, or text, or update and remove existing layers.",
    readers: ["Frame", "Codex"],
  },
  illustrate_projects: {
    schema: z.object({}).strict(),
    description: "List local Illustrate models and their project IDs and revisions.",
    readers: ["Scenic", "Codex", "Lead", "Tester", "Builder"],
  },
  illustrate_create: {
    schema: z.object({ name: id }).strict(),
    description: "Create an empty local Illustrate model. Use its project ID with illustrate_mesh.",
    readers: ["Scenic", "Codex"],
  },
  illustrate_mesh: {
    schema: z.object({
      projectId: id, tool: z.enum(meshTools),
      args: z.record(z.string(), z.json()).default({}),
    }).strict(),
    description: "Call the built-in Illustrate MCP engine. Use inspect_scene first. Primitive kinds: cube, plane, cylinder, sphere, wedge, torus, stairs, terrain, crate. Edits use target (node ID/name) and operation-specific arguments.",
    readers: ["Scenic", "Codex", "Lead", "Tester", "Builder"],
  },
  illustrate_export: {
    schema: z.object({ projectId: id, revision }).strict(),
    description: "Stage an inspected Illustrate project as a Roblox-ready Y-up GLB. Returns a file path in the dedicated Studio upload folder. This only writes a local file.",
    readers: ["Scenic", "Codex", "Builder"],
  },
} as const;

type Name = keyof typeof creativeTools;

export function isCreativeTool(name: string): name is Name {
  return Object.hasOwn(creativeTools, name);
}
export function creativeDefinitions(role: Role): CodexDynamicTool[] {
  return Object.entries(creativeTools)
    .filter(([, tool]) => (tool.readers as readonly string[]).includes(role))
    .map(([name, tool]) => ({
      name, description: tool.description, inputSchema: z.toJSONSchema(tool.schema, { io: "input" }),
    }));
}

export function illustrateExportDirectory() {
  return join(workspaceDataDirectory(), "illustrate-exports");
}

function layerSummary(node: SceneNode) {
  const { id, parentId, type, name, x, y, width, height, text } = node;
  return { id, parentId, type, name, x, y, width, height, text: text?.slice(0, 4000) };
}

async function meshCall(projectId: string, name: string, args: Record<string, unknown>, role: Role) {
  const server = createRobloxMcpServer({
    async loadProject() {
      const { scene: doc, revision } = readMeshProject(projectId);
      return { doc, revision };
    },
    async saveProject(_id, doc, revision, toolName, argsJson, summary) {
      return saveMeshProject(projectId, revision, doc, { actor: role, toolName, argsJson, summary }).revision;
    },
  }, projectId);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "syntra-creative-tools", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name, arguments: { ...args, projectId } });
    const content = "content" in result && Array.isArray(result.content) ? result.content : [];
    const text = content[0]?.type === "text" ? content[0].text : "";
    if (result.isError) throw new Error(text || "Illustrate MCP tool failed.");
    try { return JSON.parse(text); } catch { return { text }; }
  } finally {
    await client.close();
    await server.close();
  }
}

export async function runCreativeTool(role: Role, name: Name, input: unknown) {
  if (!(creativeTools[name].readers as readonly string[]).includes(role)) {
    throw new Error(`${role} cannot use ${name}.`);
  }
  switch (name) {
    case "design_inspect": {
      const { layerId } = creativeTools[name].schema.parse(input);
      const { scene, revision } = readDesign();
      const graph = decodeDesign(scene);
      if (layerId) {
        const layer = graph.getNode(layerId);
        if (!layer) throw new Error("Design layer not found.");
        return { revision, layer: layerSummary(layer), children: graph.getChildren(layerId).slice(0, 100).map(layerSummary) };
      }
      const nodes = Array.from(graph.getAllNodes());
      return {
        revision, layers: nodes.slice(0, 100).map(layerSummary),
        pages: graph.getPages().map(({ id, name }) => ({ id, name })), totalLayers: nodes.length,
      };
    }
    case "design_edit": {
      const inputEdit = creativeTools[name].schema.parse(input);
      const { scene, revision } = readDesign();
      if (inputEdit.revision !== revision) throw new Error("Design revision changed. Inspect before editing again.");
      const graph = decodeDesign(scene);
      const changes = [];
      for (const action of inputEdit.actions) {
        if (action.action === "delete") {
          const layer = graph.getNode(action.layerId);
          if (!layer || layer.id === graph.rootId || layer.type === "CANVAS") throw new Error("Layer cannot be deleted.");
          graph.deleteNode(layer.id);
          changes.push({ deleted: layer.id });
          continue;
        }
        const { name, text, x, y, width, height, fill, fontSize } = action;
        const layer = action.action === "create" ? undefined : graph.getNode(action.layerId);
        const type = action.action === "create" ? action.type : layer?.type;
        if (!type || layer?.id === graph.rootId || type === "CANVAS") throw new Error("Editable layer not found.");
        if ((text !== undefined || fontSize !== undefined) && type !== "TEXT") throw new Error("Text properties require a TEXT layer.");
        const patch = Object.fromEntries(Object.entries({
          name, text, x, y, width, height, fontSize,
          fills: fill ? [{ type: "SOLID", color: designColor(fill), opacity: 1, visible: true }] : undefined,
        }).filter(([, value]) => value !== undefined)) as Partial<SceneNode>;
        if (action.action === "create") {
          const parentId = action.parentId ?? graph.getPages()[0].id;
          if (!graph.isContainer(parentId) || parentId === graph.rootId) throw new Error("Choose an existing page or container.");
          changes.push(layerSummary(graph.createNode(action.type, parentId, patch)));
        } else {
          graph.updateNode(action.layerId, patch);
          changes.push(layerSummary(graph.getNode(action.layerId)!));
        }
      }
      return { ...saveDesign(encodeDesign(graph), revision), changes };
    }
    case "illustrate_projects":
      creativeTools[name].schema.parse(input);
      return { projects: listMeshProjects().slice(0, 100) };
    case "illustrate_create": {
      const { name: title } = creativeTools[name].schema.parse(input);
      return createMeshProject({ ...createDefaultSceneDocument(title), nodes: [] });
    }
    case "illustrate_mesh": {
      const { projectId, tool, args } = creativeTools[name].schema.parse(input);
      if (!(meshReadTools as readonly string[]).includes(tool) && role !== "Scenic" && role !== "Codex") {
        throw new Error(`${role} can inspect models. Delegate mesh edits to Scenic.`);
      }
      return meshCall(projectId, tool, args, role);
    }
    case "illustrate_export": {
      const { projectId, revision } = creativeTools[name].schema.parse(input);
      const project = readMeshProject(projectId);
      if (project.revision !== revision) throw new Error("Illustrate revision changed. Reinspect before exporting.");
      if (!project.scene.nodes.some((node) => node.visible && node.soup?.faceIndices.length)) {
        throw new Error("The scene has no visible polygon meshes.");
      }
      const bytes = exportSceneToGLB(project.scene, { scalePreset: "meters_0_28", upAxis: "Y" });
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
      const folder = illustrateExportDirectory();
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const filepath = join(folder, `${meshExportName(project.name).slice(0, 80)}-${digest}.glb`);
      writeFileSync(filepath, bytes, { mode: 0o600 });
      return { projectId, revision, filepath, bytes: bytes.length, mediaType: "model/gltf-binary" };
    }
  }
}

// The raw Studio tool is exposed only for the documented asset upload workflow.
// Its concrete request shape still comes from the connected MCP server.
export function validateIllustrateUpload(input: unknown) {
  const args = z.looseObject({
    method: z.enum(["GET", "POST"]),
    endpoint: z.string().max(300),
    scopes: z.array(z.enum(["asset:read", "asset:write"])).max(2).optional(),
    files: z.unknown().optional(),
    body: z.unknown().optional(),
  }).parse(input);
  if (args.method === "GET") {
    if (!/^\/assets\/v1\/(?:operations\/[\w-]+|assets\/\d+)$/.test(args.endpoint) ||
        args.files !== undefined || args.body !== undefined) {
      throw new Error("Only Roblox asset and operation status reads are available.");
    }
    return;
  }
  if (args.endpoint !== "/assets/v1/assets") throw new Error("Only model uploads are available.");
  const body = typeof args.body === "string" ? JSON.parse(args.body) : args.body;
  const model = z.looseObject({ assetType: z.literal("Model") });
  if (!model.safeParse(body).success &&
      !z.object({ request: z.union([model, z.string().transform((value) => JSON.parse(value)).pipe(model)]) }).safeParse(body).success) {
    throw new Error("Open Cloud uploads must declare the Model asset type.");
  }
  let file = args.files;
  if (Array.isArray(file)) {
    if (file.length !== 1) throw new Error("Upload exactly one staged GLB.");
    [file] = file;
  } else if (file && typeof file === "object" && Object.hasOwn(file, "fileContent")) {
    if (Object.keys(file).length !== 1) throw new Error("Upload exactly one staged GLB.");
    file = (file as { fileContent: unknown }).fileContent;
  }
  if (typeof file !== "string") {
    const { path, filePath, fieldName, field, name } = z.object({
      path: z.string().optional(), filePath: z.string().optional(),
      fieldName: z.literal("fileContent").optional(), field: z.literal("fileContent").optional(),
      name: z.literal("fileContent").optional(),
      contentType: z.literal("model/gltf-binary").optional(),
      mimeType: z.literal("model/gltf-binary").optional(),
    }).strict().parse(file);
    if (path && filePath) throw new Error("Upload exactly one staged GLB.");
    if (Array.isArray(args.files) && !(fieldName || field || name)) {
      throw new Error("The GLB multipart field must be fileContent.");
    }
    file = path ?? filePath;
  }
  if (typeof file !== "string" || !isStagedGlb(file)) {
    throw new Error("Upload exactly one existing GLB returned by illustrate_export.");
  }
}

function isStagedGlb(filename: string) {
  const base = basename(filename);
  if (!/^[\w-]+-[a-f0-9]{16}\.glb$/.test(base) || filename !== join(illustrateExportDirectory(), base)) return false;
  try {
    const stat = lstatSync(filename);
    if (!stat.isFile() || stat.size < 12 || stat.size > 24 * 1024 * 1024) return false;
    const bytes = readFileSync(filename);
    return bytes.subarray(0, 4).toString() === "glTF" &&
      base.endsWith("-" + createHash("sha256").update(bytes).digest("hex").slice(0, 16) + ".glb");
  } catch {
    return false;
  }
}
