/**
 * Shared serializable Scene, Mesh, Material, and Roblox Export schemas
 * used identically by the React client, Web Worker, Hono D1 backend, and MCP Server.
 */

export type RobloxPresetId =
  | 'MeshPart_Standard'   // 10,000 tri budget, 2048 max studs, 1 stud = 0.28m
  | 'EditableMesh_20k'    // 20,000 tri budget, runtime EditableMesh compatible
  | 'UGC_Accessory_4k'    // 4,000 tri budget, strict manifold & UV bounds
  | 'Avatar_Cage_Outer';  // WrapTarget / WrapLayer watertight cage

export type RobloxCollisionFidelity =
  | 'Default'
  | 'Hull'
  | 'Box'
  | 'PreciseConvexDecomposition';

export type RobloxSurfaceMaterial =
  | 'SmoothPlastic'
  | 'Neon'
  | 'Metal'
  | 'DiamondPlate'
  | 'CorrodedMetal'
  | 'Wood'
  | 'WoodPlanks'
  | 'Slate'
  | 'Concrete'
  | 'Brick'
  | 'Granite'
  | 'Glass'
  | 'ForceField';

export interface ProceduralTextureSpec {
  pattern: 'none' | 'studs' | 'checker' | 'grid' | 'noise' | 'brushed_metal';
  scaleU: number;
  scaleV: number;
  secondaryColor: string;
}

export interface MaterialSpec {
  id: string;
  name: string;
  color: string; // Hex #rrggbb
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  opacity: number;
  wireframe: boolean;
  flatShading: boolean;
  robloxMaterial: RobloxSurfaceMaterial;
  texture: ProceduralTextureSpec;
}

export interface SerializedMeshSoup {
  coords: number[];      // flat [x,y,z,...] in Roblox Studs
  faceCounts: number[];  // polygon vertex counts [4,4,4,...]
  faceIndices: number[]; // corner vertex indices
  faceUvs?: number[];    // optional corner [u,v,...]
}

export interface SceneNodeData {
  id: string;
  name: string;
  parentId: string | null;
  type: 'mesh' | 'folder';
  visible: boolean;
  locked: boolean;
  anchored: boolean;
  canCollide: boolean;
  castShadow: boolean;
  collisionFidelity: RobloxCollisionFidelity;
  position: [number, number, number]; // in Studs
  rotation: [number, number, number]; // Euler degrees [rx, ry, rz]
  scale: [number, number, number];
  pivotOffset: [number, number, number];
  materialId: string;
  soup?: SerializedMeshSoup;
}

export interface SerializedSceneDocument {
  version: 1;
  name: string;
  robloxPreset: RobloxPresetId;
  exportUnitScale: 'studs_1_0' | 'meters_0_28' | 'centimeters_28_0';
  upAxis: 'Y' | 'Z';
  gridSnapStuds: number;
  angleSnapDeg: number;
  nodes: SceneNodeData[];
  materials: MaterialSpec[];
}

export interface AuthUser {
  id: string;
  email: string;
  username: string;
  mcpApiKey: string;
  createdAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  robloxPreset: RobloxPresetId;
  triangleCount: number;
  objectCount: number;
  isPublic: boolean;
  revision: number;
  updatedAt: string;
}

export interface McpSyncEvent {
  id: number;
  projectId: string;
  actor: string;
  toolName: string;
  argsJson: string;
  resultSummary: string;
  revision: number;
  createdAt: string;
}
