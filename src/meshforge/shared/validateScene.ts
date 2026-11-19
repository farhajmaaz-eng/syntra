import { z } from "zod";
import type { SerializedSceneDocument } from "./sceneSchema";

const id = z.string().min(1).max(160);
const name = z.string().trim().min(1).max(160);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const color = z.string().regex(/^#[\da-f]{6}$/i);
const soup = z.object({
  coords: z.array(z.number()).max(300000),
  faceCounts: z.array(z.number().int().min(3).max(1024)).max(100000),
  faceIndices: z.array(z.number().int().nonnegative()).max(400000),
  faceUvs: z.array(z.number()).max(800000).optional(),
}).refine((mesh) =>
  mesh.coords.length % 3 === 0 &&
  mesh.faceCounts.reduce((total, count) => total + count, 0) === mesh.faceIndices.length &&
  mesh.faceIndices.every((index) => index < mesh.coords.length / 3) &&
  (!mesh.faceUvs || mesh.faceUvs.length === mesh.faceIndices.length * 2),
  "Invalid polygon topology or UV coordinates",
);

const sceneSchema = z.object({
  version: z.literal(1),
  name,
  robloxPreset: z.enum(["MeshPart_Standard", "EditableMesh_20k", "UGC_Accessory_4k", "Avatar_Cage_Outer"]),
  exportUnitScale: z.enum(["studs_1_0", "meters_0_28", "centimeters_28_0"]),
  upAxis: z.enum(["Y", "Z"]),
  gridSnapStuds: z.number().positive(),
  angleSnapDeg: z.number().positive(),
  nodes: z.array(z.object({
    id, name, parentId: id.nullable(), type: z.enum(["mesh", "folder"]),
    visible: z.boolean(), locked: z.boolean(), anchored: z.boolean(),
    canCollide: z.boolean(), castShadow: z.boolean(),
    collisionFidelity: z.enum(["Default", "Hull", "Box", "PreciseConvexDecomposition"]),
    position: vec3, rotation: vec3, scale: vec3, pivotOffset: vec3, materialId: z.string().max(160),
    soup: soup.optional(),
  })).max(500),
  materials: z.array(z.object({
    id, name, color, emissive: color,
    roughness: z.number().min(0).max(1), metalness: z.number().min(0).max(1),
    emissiveIntensity: z.number().nonnegative(), opacity: z.number().min(0).max(1),
    wireframe: z.boolean(), flatShading: z.boolean(),
    robloxMaterial: z.enum(["SmoothPlastic", "Neon", "Metal", "DiamondPlate", "CorrodedMetal", "Wood", "WoodPlanks", "Slate", "Concrete", "Brick", "Granite", "Glass", "ForceField"]),
    texture: z.object({
      pattern: z.enum(["none", "studs", "checker", "grid", "noise", "brushed_metal"]),
      scaleU: z.number().positive(), scaleV: z.number().positive(), secondaryColor: color,
    }),
  })).max(500),
}).refine((scene) => {
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  const materials = new Set(scene.materials.map((material) => material.id));
  if (nodes.size !== scene.nodes.length || materials.size !== scene.materials.length) return false;
  return scene.nodes.every((node) => {
    if (node.type === "mesh" && (!node.soup || !materials.has(node.materialId))) return false;
    const ancestors = new Set([node.id]);
    let parent = node.parentId;
    while (parent !== null) {
      const ancestor = nodes.get(parent);
      if (!ancestor || ancestors.has(parent)) return false;
      ancestors.add(parent);
      parent = ancestor.parentId;
    }
    return true;
  });
}, "Invalid material reference or scene hierarchy");

export function validateScene(input: unknown): SerializedSceneDocument {
  return sceneSchema.parse(input);
}
