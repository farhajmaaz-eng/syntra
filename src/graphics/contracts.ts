import { z } from "zod";

const id = z.string().min(1).max(200);
const coordinate = z.number().min(-100_000).max(100_000);
const size = z.number().positive().max(10_000);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const proportion = z.number().min(0).max(1);
export const layerTypes = ["FRAME", "RECTANGLE", "ELLIPSE", "TEXT"] as const;

const fields = {
  name: id.optional(),
  text: z.string().max(4000).optional(),
  x: coordinate.optional(),
  y: coordinate.optional(),
  width: size.optional(),
  height: size.optional(),
  fill: hex.optional(),
  opacity: proportion.optional(),
  cornerRadius: z.number().min(0).max(10_000).optional(),
  fontSize: z.number().positive().max(500).optional(),
};
export const designInspectSchema = z.strictObject({ layerId: id.optional() });
export const designEditSchema = z.strictObject({
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  actions: z
    .array(
      z.discriminatedUnion("action", [
        z.strictObject({
          action: z.literal("create"),
          type: z.enum(layerTypes),
          parentId: id.optional(),
          ...fields,
        }),
        z.strictObject({ action: z.literal("update"), layerId: id, ...fields }),
        z.strictObject({ action: z.literal("delete"), layerId: id }),
      ]),
    )
    .min(1)
    .max(40),
});
export type Edit = z.infer<typeof designEditSchema>;

const layer = z.object({
  id,
  parentId: id.nullable(),
  name: z.string().max(500),
  type: z.string().max(64),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  pageX: z.number(),
  pageY: z.number(),
  rotation: z.number(),
  hidden: z.boolean(),
  opacity: proportion,
  fill: hex.nullable(),
  fillOpacity: proportion,
  corners: z.tuple([
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
  ]),
  stroke: z
    .object({
      color: hex,
      opacity: proportion,
      width: z.number().nonnegative(),
    })
    .nullable(),
  clip: z.boolean(),
  text: z.string().max(4000).optional(),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().max(200).optional(),
  align: z.string().max(40).optional(),
  verticalAlign: z.string().max(40).optional(),
  limitations: z.array(z.string().max(80)).max(20),
});
export const sceneSchema = z.object({
  fileId: id,
  pageId: id,
  name: z.string().max(500),
  rootId: id,
  selection: z.array(id).max(2000),
  layers: z.array(layer).max(2000),
});
export type Scene = z.infer<typeof sceneSchema>;
export type Layer = z.infer<typeof layer>;
