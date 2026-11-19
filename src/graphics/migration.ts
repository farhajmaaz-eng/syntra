import { z } from "zod";
import { decodeDesign } from "../design-studio/scene";
import { readDesign } from "../design-studio/store";
import { call, editScript } from "./penpot";

export function legacyDesign() {
  const { scene, revision } = readDesign();
  const graph = decodeDesign(scene);
  const warnings = new Set<string>();
  const supported = {
    FRAME: "FRAME",
    GROUP: "FRAME",
    RECTANGLE: "RECTANGLE",
    ROUNDED_RECTANGLE: "RECTANGLE",
    ELLIPSE: "ELLIPSE",
    TEXT: "TEXT",
  } as const;
  const included = new Set(graph.getPages().map((page) => page.id));
  const layers: Array<{
    key: string;
    parentKey: string;
    type: (typeof supported)[keyof typeof supported];
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fill?: string;
    fillOpacity?: number;
    opacity: number;
    corners?: number[];
    text?: string;
    fontSize?: number;
  }> = [];
  for (const page of graph.getPages()) {
    const pending = [...graph.getChildren(page.id)].reverse();
    while (pending.length) {
      const node = pending.pop()!;
      const type = supported[node.type as keyof typeof supported];
      if (!type || !node.parentId || !included.has(node.parentId)) {
        warnings.add(
          `${node.name}: unsupported layer or parent. Retained in the archive.`,
        );
        continue;
      }
      included.add(node.id);
      const fill = node.fills.find(
        (paint) => paint.type === "SOLID" && paint.visible !== false,
      );
      if (
        node.fills.length > 1 ||
        node.fills.some((paint) => paint.type !== "SOLID") ||
        node.effects.length ||
        node.strokes.length ||
        node.rotation ||
        node.styleRuns.length ||
        node.layoutMode !== "NONE"
      ) {
        warnings.add(
          `${node.name}: review advanced styling or layout against the archive.`,
        );
      }
      const color =
        fill?.type === "SOLID"
          ? "#" +
            [fill.color.r, fill.color.g, fill.color.b]
              .map((channel) =>
                Math.round(Math.min(1, Math.max(0, channel)) * 255)
                  .toString(16)
                  .padStart(2, "0"),
              )
              .join("")
          : undefined;
      layers.push({
        key: node.id,
        parentKey: node.parentId,
        type,
        name: node.name,
        x: node.x,
        y: node.y,
        width: Math.max(1, node.width),
        height: Math.max(1, node.height),
        fill: color,
        fillOpacity:
          fill?.type === "SOLID"
            ? fill.opacity * (fill.color.a ?? 1)
            : undefined,
        opacity: node.opacity,
        corners:
          type === "FRAME" || type === "RECTANGLE"
            ? [
                node.topLeftRadius,
                node.topRightRadius,
                node.bottomRightRadius,
                node.bottomLeftRadius,
              ].map((radius) => radius || node.cornerRadius || 0)
            : undefined,
        ...(type === "TEXT"
          ? { text: node.text, fontSize: node.fontSize }
          : {}),
      });
      pending.push(...graph.getChildren(node.id).reverse());
    }
  }
  const pages = graph
    .getPages()
    .filter((page) => layers.some((layer) => layer.parentKey === page.id))
    .map((page) => ({ key: page.id, name: page.name }));
  return { revision, pages, layers, warnings: [...warnings] };
}

export async function migrateLegacyDesign() {
  const legacy = legacyDesign();
  if (!legacy.layers.length)
    throw new Error("There are no supported saved layers to migrate.");
  const key = `syntra-legacy-${legacy.revision}`;
  const payload = { pages: legacy.pages, layers: legacy.layers, key };
  const result = await call(
    editScript +
      `
const data = ${JSON.stringify(payload)};
if (root.children.some(shape => shape.getPluginData("syntraLegacyRevision") === data.key)) return { imported: 0 };
const block = penpot.history.undoBlockBegin();
let container;
try {
  container = create({type:"FRAME",name:"Syntra design archive",width:1440,height:900},root);
  const imported = new Map();
  data.pages.forEach((row,index) => imported.set(row.key,create({ type:"FRAME",name:row.name,width:1440,height:900,x:index*1480,y:0 },container)));
  for (const row of data.layers) imported.set(row.key, create(row,imported.get(row.parentKey)));
  container.setPluginData("syntraLegacyRevision", data.key);
  return { imported: data.layers.length };
} catch (error) {
  container?.remove();
  throw error;
} finally { penpot.history.undoBlockFinish(block); }
`,
    z.object({ imported: z.number().int().nonnegative() }),
  );
  return { ...result, warnings: legacy.warnings };
}
