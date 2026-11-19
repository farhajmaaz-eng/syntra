import { SceneGraph, type SceneNode } from "@open-pencil/scene-graph";

const nodeTypes = [
  "CANVAS", "FRAME", "RECTANGLE", "ROUNDED_RECTANGLE", "ELLIPSE", "TEXT", "LINE", "STAR",
  "POLYGON", "VECTOR", "BOOLEAN_OPERATION", "GROUP", "SECTION", "COMPONENT",
  "COMPONENT_SET", "INSTANCE", "CONNECTOR", "SHAPE_WITH_TEXT",
] as const;
const validNodeTypes = new Set<string>(nodeTypes);

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function isSceneNode(value: unknown): value is SceneNode {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Partial<SceneNode>;
  return validId(node.id) && (node.parentId === null || validId(node.parentId)) &&
    Array.isArray(node.childIds) && node.childIds.length <= 2000 && node.childIds.every(validId) &&
    typeof node.type === "string" && validNodeTypes.has(node.type) &&
    typeof node.name === "string" && node.name.length <= 200 &&
    Number.isFinite(node.x) && Number.isFinite(node.y) &&
    Number.isFinite(node.width) && Number.isFinite(node.height);
}

export function encodeDesign(graph: SceneGraph) {
  return JSON.stringify({
    rootId: graph.rootId,
    nodes: Array.from(graph.getAllNodes()),
  }, (_key, value: unknown) =>
    value instanceof Uint8Array ? { syntraBytes: Array.from(value) } : value,
  );
}

function restoreDocumentValue(key: string, value: unknown) {
  if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
  if (value && typeof value === "object" && "syntraBytes" in value &&
      Array.isArray(value.syntraBytes) && Object.keys(value).length === 1) {
    return Uint8Array.from(value.syntraBytes);
  }
  return value;
}

export function decodeDesign(serialized: string) {
  // Plain scenes can use the native parser without a JS callback for every property.
  // Unicode escapes can spell a special key, so those documents also use the reviver.
  const needsReviver = /\\u|"(?:__proto__|constructor|prototype|syntraBytes)"\s*:/.test(serialized);
  const snapshot: { rootId?: unknown; nodes?: unknown } | null =
    JSON.parse(serialized, needsReviver ? restoreDocumentValue : undefined);
  if (!snapshot || !validId(snapshot.rootId) || !Array.isArray(snapshot.nodes) ||
      snapshot.nodes.length < 2 || snapshot.nodes.length > 2000 || !snapshot.nodes.every(isSceneNode)) {
    throw new Error("Invalid Design Studio document or layer fields.");
  }
  const graph = new SceneGraph();
  const indexed = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const root = indexed.get(snapshot.rootId);
  if (!root || root.type !== "FRAME" || root.parentId !== null || indexed.size !== snapshot.nodes.length) {
    throw new Error("Invalid Design Studio document root.");
  }

  graph.nodes.clear();
  graph.rootId = root.id;
  const seen = new Set<string>();
  const queue = [root];
  for (const node of queue) {
    if (seen.has(node.id)) throw new Error("Design contains a repeated layer.");
    seen.add(node.id);
    const { id, type, parentId, childIds, ...properties } = node;
    graph.createNodeWithId(id, type, parentId, properties as Partial<SceneNode>);
    for (const id of childIds) {
      const child = indexed.get(id);
      if (!child || child.parentId !== node.id) throw new Error("Invalid Design Studio layer hierarchy.");
      queue.push(child);
    }
  }
  if (seen.size !== indexed.size || !graph.getPages().length) {
    throw new Error("Design must contain a reachable page and valid layers.");
  }
  return graph;
}

export const layerTypes = ["FRAME", "RECTANGLE", "ELLIPSE", "TEXT"] as const;

export function designColor(hex: string): { r: number; g: number; b: number; a: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
    a: 1,
  };
}
