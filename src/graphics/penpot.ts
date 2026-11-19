import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { sceneSchema, type Edit, type Scene } from "./contracts";

import { penpotConnection } from "./connection";

const normalizeJson = function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    const entry = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(entry)
        .sort()
        .map((key) => [key, normalizeJson(entry[key])]),
    );
  }
  return value;
};

// Scripts are owned by Syntra. Inputs are validated data, serialized as JSON.
const snapshotScript = `
const canonical = ${normalizeJson.toString()};
const page = penpot.currentPage;
const file = penpot.currentFile;
if (!page || !file || file.id !== target.fileId || page.id !== target.pageId) {
  throw new Error("Open Syntra's configured Penpot file and page in the connected tab.");
}
const root = page.root;
const palette = value => /^#[0-9a-f]{6}$/i.test(value || "") ? value : null;
const nodes = new Map([[root.id, root]]);
function snapshot() {
  const layers = [];
  const stack = [...root.children].reverse().map(shape => ({shape, parentId: null}));
  while (stack.length) {
    const {shape, parentId} = stack.pop();
    if (layers.length >= 2000) throw new Error("Open a Penpot page with at most 2,000 layers.");
    nodes.set(shape.id, shape);
    const fills = shape.fills;
    const fill = Array.isArray(fills) ? fills[0] : null;
    const strokes = shape.strokes || [];
    const stroke = strokes[0];
    const strokeColor = palette(stroke?.strokeColor);
    const limitations = [];
    if (fill?.fillImage) limitations.push("image fill");
    if (fills === "mixed") limitations.push("mixed text styles");
    if (fill?.fillColorGradient || (Array.isArray(fills) && fills.length > 1)) limitations.push("gradient or layered fills");
    if (strokes.length > 1 || (stroke && (stroke.strokeStyle !== "solid" || !strokeColor))) limitations.push("complex stroke");
    if (shape.shadows?.length || shape.blur || shape.backgroundBlur) limitations.push("effects");
    if (shape.flipX || shape.flipY) limitations.push("flipped layer");
    if (shape.flex || shape.grid) limitations.push("responsive layout");
    if (shape.interactions?.length) limitations.push("prototype interactions");
    const text = shape.type === "text" ? shape.characters : undefined;
    const font = Number(shape.fontSize);
    if (typeof text === "string" && text.length > 4000) limitations.push("text over 4,000 characters");
    layers.push({
      id: shape.id, parentId, name: (shape.name || shape.type).slice(0,500), type: shape.type,
      x: parentId ? shape.parentX : shape.x, y: parentId ? shape.parentY : shape.y,
      pageX: shape.x, pageY: shape.y, width: shape.width, height: shape.height,
      rotation: shape.rotation || 0, hidden: shape.hidden === true, opacity: shape.opacity ?? 1,
      fill: palette(fill?.fillColor), fillOpacity: fill?.fillOpacity ?? 1,
      corners: [shape.borderRadiusTopLeft,shape.borderRadiusTopRight,shape.borderRadiusBottomRight,shape.borderRadiusBottomLeft].map(n => Number.isFinite(n) ? n : 0),
      clip: shape.type === "board" && shape.clipContent === true, text: typeof text === "string" ? text.slice(0,4000) : undefined,
      fontSize: font > 0 ? font : undefined, fontFamily: typeof shape.fontFamily === "string" ? shape.fontFamily : undefined,
      align: typeof shape.align === "string" ? shape.align : undefined,
      verticalAlign: typeof shape.verticalAlign === "string" ? shape.verticalAlign : undefined,
      stroke: strokeColor && stroke.strokeStyle === "solid" ? {color: strokeColor, opacity:stroke.strokeOpacity ?? 1,width:stroke.strokeWidth ?? 1} : null,
      limitations,
    });
    if (Array.isArray(shape.children)) for (let i=shape.children.length-1;i>=0;i--) stack.push({shape:shape.children[i],parentId:shape.id});
  }
  return {fileId:file.id,pageId:page.id,name:page.name,rootId:root.id,selection:penpot.selection.map(shape=>shape.id),layers};
}
`;

// Preserve the native undo history by batching an edit as one undo step.
const editScript = `
function styled(shape, row) {
  if (row.name !== undefined) shape.name = row.name;
  if (row.text !== undefined) shape.characters = row.text || " ";
  if (row.fontSize !== undefined) shape.fontSize = String(row.fontSize);
  if (row.fill !== undefined) shape.fills = [{ fillColor: row.fill, fillOpacity: row.fillOpacity ?? 1 }];
  if (row.opacity !== undefined) shape.opacity = row.opacity;
  if (row.corners) {
    [shape.borderRadiusTopLeft,shape.borderRadiusTopRight,shape.borderRadiusBottomRight,shape.borderRadiusBottomLeft] = row.corners;
  } else if (row.cornerRadius !== undefined) shape.borderRadius = row.cornerRadius;
  if (row.width !== undefined || row.height !== undefined) {
    if (shape.type === "text") shape.growType = "fixed";
    shape.resize(row.width ?? shape.width, row.height ?? shape.height);
  }
  if (row.x !== undefined) shape.x += row.x - (shape.parent?.id === root.id ? shape.x : shape.parentX);
  if (row.y !== undefined) shape.y += row.y - (shape.parent?.id === root.id ? shape.y : shape.parentY);
}
function create(row, parent) {
  const shape = row.type === "FRAME" ? penpot.createBoard() :
    row.type === "RECTANGLE" ? penpot.createRectangle() :
    row.type === "ELLIPSE" ? penpot.createEllipse() : penpot.createText(row.text || "Text");
  if (!shape) throw new Error("Penpot could not create a layer.");
  if (parent.id !== root.id) parent.appendChild(shape);
  styled(shape, row);
  return shape;
}
`;

function fingerprint(scene: Scene) {
  return JSON.stringify(normalizeJson(scene.layers));
}
export function revisionFor(scene: Scene) {
  return createHash("sha256")
    .update(scene.fileId)
    .update(scene.pageId)
    .update(fingerprint(scene))
    .digest("hex");
}

async function call<T>(body: string, sandbox: z.ZodType<T>): Promise<T> {
  const { file: target, mcp, sessionId } = penpotConnection();
  const transport = new StreamableHTTPClientTransport(mcp, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      }),
  });
  const client = new Client({ name: "syntra-graphics", version: "1.0.0" });
  try {
    try {
      await client.connect(transport);
    } catch {
      throw new Error(
        "Could not connect to Penpot MCP. Check the endpoint and connected tab.",
      );
    }
    const code =
      "const target=" +
      JSON.stringify({ fileId: target.fileId, pageId: target.pageId }) +
      ";\n" +
      snapshotScript +
      body;
    let result;
    try {
      result = await client.callTool(
        { name: "execute_code", arguments: { sessionId, code } },
        undefined,
        { timeout: 25_000 },
      );
    } catch {
      throw new Error(
        "Penpot did not confirm the request. Inspect the design before retrying an edit.",
      );
    }
    const content = Array.isArray(result.content) ? result.content : [];
    const text = content.find((item) => item.type === "text")?.text;
    if (typeof text !== "string" || result.isError) {
      // Do not reflect connection credentials or arbitrary upstream text in the UI.
      if (
        typeof text === "string" &&
        text.includes("configured Penpot file and page")
      ) {
        throw new Error(
          "Open the configured Penpot file and page in the connected tab.",
        );
      }
      if (typeof text === "string" && text.includes("Design changed"))
        throw new Error("Design changed. Inspect before editing again.");
      throw new Error(
        "Penpot rejected the operation. Check that the session is connected, then inspect the design before retrying.",
      );
    }
    return sandbox.parse(JSON.parse(text));
  } finally {
    await client.close().catch(() => {});
  }
}
export function readPenpotScene() {
  return call("return snapshot();", sceneSchema);
}
export async function inspectPenpot(layerId?: string) {
  const scene = await readPenpotScene();
  const revision = revisionFor(scene);
  if (layerId) {
    const layer = scene.layers.find((item) => item.id === layerId);
    if (!layer) throw new Error("Penpot layer not found on the pinned page.");
    return {
      revision,
      layer,
      children: scene.layers
        .filter((item) => item.parentId === layer.id)
        .slice(0, 20),
    };
  }
  return {
    revision,
    fileId: scene.fileId,
    pageId: scene.pageId,
    page: scene.name,
    selection: scene.selection,
    layers: scene.layers.slice(0, 30),
    totalLayers: scene.layers.length,
  };
}

function validateEdits(scene: Scene, actions: Edit["actions"]) {
  const layers = new Map(scene.layers.map((layer) => [layer.id, layer]));
  for (const action of actions) {
    const original =
      action.action === "create" ? null : layers.get(action.layerId);
    if (action.action !== "create" && !original)
      throw new Error("Layer is missing from the pinned page.");
    if (action.action === "delete") {
      const removed = new Set([action.layerId]);
      for (const [id, child] of layers)
        if (
          id === action.layerId ||
          (child.parentId && removed.has(child.parentId))
        ) {
          removed.add(id);
          layers.delete(id);
        }
    } else {
      if (
        action.action === "create" &&
        action.parentId &&
        action.parentId !== scene.rootId &&
        layers.get(action.parentId)?.type !== "board"
      ) {
        throw new Error("Create inside an existing Penpot board or the page.");
      }
      const type =
        action.action === "create" ? action.type : original?.type.toUpperCase();
      if (
        (action.text !== undefined || action.fontSize !== undefined) &&
        type !== "TEXT"
      )
        throw new Error("Text properties require a text layer.");
      if (
        action.cornerRadius !== undefined &&
        !["FRAME", "BOARD", "RECT", "RECTANGLE"].includes(type ?? "")
      ) {
        throw new Error("Corner rounding requires a board or rectangle.");
      }
    }
  }
}

export async function editPenpot(edit: Edit) {
  const scene = await readPenpotScene();
  if (revisionFor(scene) !== edit.revision)
    throw new Error("Design revision changed. Inspect before editing again.");
  validateEdits(scene, edit.actions);
  return call(
    editScript +
      `
if (JSON.stringify(canonical(snapshot().layers)) !== ${JSON.stringify(fingerprint(scene))}) throw new Error("Design changed");
const actions = ${JSON.stringify(edit.actions)};
const block = penpot.history.undoBlockBegin();
const changes = [];
try {
  for (const row of actions) {
    if (row.action === "create") {
      const shape = create(row,nodes.get(row.parentId || root.id));
      changes.push({ id: shape.id });
    } else if (row.action === "update") {
      styled(nodes.get(row.layerId),row);
      changes.push({ id: row.layerId });
    } else {
      nodes.get(row.layerId).remove();
      changes.push({ deleted: row.layerId });
    }
  }
} finally { penpot.history.undoBlockFinish(block); }
return {changes};
`,
    z.object({
      changes: z.array(
        z.object({ id: z.string().optional(), deleted: z.string().optional() }),
      ),
    }),
  );
}
export { call, editScript };
