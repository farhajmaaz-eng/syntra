import { SceneGraph, type SceneNode } from "@open-pencil/scene-graph";
import { z } from "zod";

const nodeTypes = [
  "CANVAS", "FRAME", "RECTANGLE", "ROUNDED_RECTANGLE", "ELLIPSE", "TEXT", "LINE", "STAR",
  "POLYGON", "VECTOR", "BOOLEAN_OPERATION", "GROUP", "SECTION", "COMPONENT",
  "COMPONENT_SET", "INSTANCE", "CONNECTOR", "SHAPE_WITH_TEXT",
] as const;
const nodeShape = z.looseObject({
  id: z.string().min(1).max(200),
  parentId: z.string().max(200).nullable(),
  childIds: z.array(z.string().max(200)).max(2000),
  type: z.enum(nodeTypes),
  name: z.string().max(200),
  x: z.number(), y: z.number(), width: z.number(), height: z.number(),
});
const snapshotShape = z.object({
  rootId: z.string().min(1).max(200),
  nodes: z.array(nodeShape).min(2).max(2000),
});

export function encodeDesign(graph: SceneGraph) {
  return JSON.stringify({
    rootId: graph.rootId,
    nodes: Array.from(graph.getAllNodes()),
  }, (_key, value: unknown) =>
    value instanceof Uint8Array ? { syntraBytes: Array.from(value) } : value,
  );
}

export function decodeDesign(serialized: string) {
  const snapshot = snapshotShape.parse(JSON.parse(serialized, (key, value: unknown) => {
    if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
    if (value && typeof value === "object" && "syntraBytes" in value &&
        Array.isArray(value.syntraBytes) && Object.keys(value).length === 1) {
      return Uint8Array.from(value.syntraBytes);
    }
    return value;
  }));
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
