import { PolygonSoup, HalfEdgeTopology, RobloxValidationReport } from '../client/geometry/halfEdgeMesh';
import {
  createCubeSoup,
  createPlaneSoup,
  createCylinderSoup,
  createSphereSoup,
  createWedgeSoup,
  createTorusSoup,
  createProceduralStairsSoup,
  createProceduralTerrainChunkSoup,
  createProceduralCrateRigSoup,
} from '../client/geometry/primitives';
import { wasmKernel } from '../client/geometry/wasmKernel';
import {
  MaterialSpec,
  RobloxCollisionFidelity,
  RobloxSurfaceMaterial,
  SceneNodeData,
  SerializedMeshSoup,
  SerializedSceneDocument,
} from '../shared/sceneSchema';

export function soupToSerialized(soup: PolygonSoup): SerializedMeshSoup {
  return {
    coords: Array.from(soup.coords).map((v) => Number(v.toFixed(5))),
    faceCounts: Array.from(soup.faceCounts),
    faceIndices: Array.from(soup.faceIndices),
    faceUvs: soup.faceUvs ? Array.from(soup.faceUvs).map((v) => Number(v.toFixed(5))) : undefined,
  };
}

export function serializedToSoup(s: SerializedMeshSoup): PolygonSoup {
  return {
    coords: new Float32Array(s.coords),
    faceCounts: new Uint32Array(s.faceCounts),
    faceIndices: new Uint32Array(s.faceIndices),
    faceUvs: s.faceUvs ? new Float32Array(s.faceUvs) : undefined,
  };
}

export function createDefaultSceneDocument(name = 'Untitled Roblox Place'): SerializedSceneDocument {
  const matPlastic: MaterialSpec = {
    id: 'mat_smooth_plastic',
    name: 'Roblox SmoothPlastic',
    color: '#6b7280',
    roughness: 0.38,
    metalness: 0.05,
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    wireframe: false,
    flatShading: false,
    robloxMaterial: 'SmoothPlastic',
    texture: { pattern: 'studs', scaleU: 4, scaleV: 4, secondaryColor: '#525866' },
  };

  const matAccent: MaterialSpec = {
    id: 'mat_metal_trim',
    name: 'Industrial DiamondPlate',
    color: '#3b82f6',
    roughness: 0.28,
    metalness: 0.72,
    emissive: '#000000',
    emissiveIntensity: 0,
    opacity: 1,
    wireframe: false,
    flatShading: false,
    robloxMaterial: 'DiamondPlate',
    texture: { pattern: 'grid', scaleU: 4, scaleV: 4, secondaryColor: '#1d4ed8' },
  };

  const matNeon: MaterialSpec = {
    id: 'mat_neon_core',
    name: 'Cyber Neon',
    color: '#10b981',
    roughness: 0.15,
    metalness: 0.0,
    emissive: '#10b981',
    emissiveIntensity: 0.65,
    opacity: 1,
    wireframe: false,
    flatShading: false,
    robloxMaterial: 'Neon',
    texture: { pattern: 'none', scaleU: 1, scaleV: 1, secondaryColor: '#059669' },
  };

  const crateSoup = createProceduralCrateRigSoup(4, 0.2, -0.22);

  return {
    version: 1,
    name,
    robloxPreset: 'MeshPart_Standard',
    exportUnitScale: 'meters_0_28',
    upAxis: 'Y',
    gridSnapStuds: 0.5,
    angleSnapDeg: 15,
    materials: [matPlastic, matAccent, matNeon],
    nodes: [
      {
        id: 'node_crate_01',
        name: 'SciFi_SupplyCrate',
        parentId: null,
        type: 'mesh',
        visible: true,
        locked: false,
        anchored: true,
        canCollide: true,
        castShadow: true,
        collisionFidelity: 'PreciseConvexDecomposition',
        position: [0, 2, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        pivotOffset: [0, 0, 0],
        materialId: 'mat_smooth_plastic',
        soup: soupToSerialized(crateSoup),
      },
    ],
  };
}

export function countSceneStats(doc: SerializedSceneDocument): { triangleCount: number; objectCount: number } {
  let tris = 0;
  let objs = 0;
  for (const n of doc.nodes) {
    if (n.type === 'mesh' && n.soup) {
      objs++;
      for (const cnt of n.soup.faceCounts) {
        if (cnt >= 3) tris += cnt - 2;
      }
    }
  }
  return { triangleCount: tris, objectCount: objs };
}

export type PrimitiveKind =
  | 'cube'
  | 'plane'
  | 'cylinder'
  | 'sphere'
  | 'wedge'
  | 'torus'
  | 'stairs'
  | 'terrain'
  | 'crate';

export function buildPrimitiveSoup(kind: PrimitiveKind, params: Record<string, number> = {}): PolygonSoup {
  switch (kind) {
    case 'cube':
      return createCubeSoup(params.sizeX ?? 4, params.sizeY ?? 4, params.sizeZ ?? 4);
    case 'plane':
      return createPlaneSoup(params.width ?? 8, params.depth ?? 8, params.segX ?? 4, params.segZ ?? 4);
    case 'cylinder':
      return createCylinderSoup(
        params.radiusTop ?? 2,
        params.radiusBottom ?? 2,
        params.height ?? 4,
        params.radialSegs ?? 16
      );
    case 'sphere':
      return createSphereSoup(params.radius ?? 2, params.rings ?? 10, params.segments ?? 16);
    case 'wedge':
      return createWedgeSoup(params.sizeX ?? 4, params.sizeY ?? 4, params.sizeZ ?? 4);
    case 'torus':
      return createTorusSoup(
        params.majorRadius ?? 2.5,
        params.minorRadius ?? 0.8,
        params.radialSegs ?? 12,
        params.tubularSegs ?? 20
      );
    case 'stairs':
      return createProceduralStairsSoup(
        params.steps ?? 8,
        params.width ?? 6,
        params.height ?? 6,
        params.depth ?? 8
      );
    case 'terrain':
      return createProceduralTerrainChunkSoup(
        params.size ?? 16,
        params.resolution ?? 16,
        params.amplitude ?? 2.4,
        params.frequency ?? 0.35,
        params.seed ?? 42
      );
    case 'crate':
      return createProceduralCrateRigSoup(
        params.size ?? 4,
        params.frameInset ?? 0.2,
        params.recessDepth ?? -0.22
      );
  }
}

export function validateSceneForRoblox(doc: SerializedSceneDocument): {
  preset: string;
  totalTriangles: number;
  totalVertices: number;
  meshObjects: number;
  allCompatible: boolean;
  perNode: Array<{
    id: string;
    name: string;
    report: RobloxValidationReport;
    issues: string[];
  }>;
} {
  let totalTriangles = 0;
  let totalVertices = 0;
  let meshObjects = 0;
  let allCompatible = true;

  const budgetLimit =
    doc.robloxPreset === 'UGC_Accessory_4k'
      ? 4000
      : doc.robloxPreset === 'EditableMesh_20k'
      ? 20000
      : 10000;

  const perNode: Array<{ id: string; name: string; report: RobloxValidationReport; issues: string[] }> = [];

  for (const node of doc.nodes) {
    if (node.type !== 'mesh' || !node.soup) continue;
    meshObjects++;
    const soup = serializedToSoup(node.soup);
    const compiled = new HalfEdgeTopology(soup).buildRenderBuffersJS(false);
    const r = compiled.validation;
    // Account for node scale in Studs
    r.sizeStuds = [
      Number((r.sizeStuds[0] * Math.abs(node.scale[0])).toFixed(3)),
      Number((r.sizeStuds[1] * Math.abs(node.scale[1])).toFixed(3)),
      Number((r.sizeStuds[2] * Math.abs(node.scale[2])).toFixed(3)),
    ];
    r.fitsMaxStuds = r.sizeStuds[0] <= 2048 && r.sizeStuds[1] <= 2048 && r.sizeStuds[2] <= 2048;

    totalTriangles += r.triangleCount;
    totalVertices += r.vertexCount;

    const issues: string[] = [];
    if (r.triangleCount > budgetLimit) {
      issues.push(`Exceeds ${doc.robloxPreset} triangle budget (${r.triangleCount} > ${budgetLimit})`);
    }
    if (!r.fitsMaxStuds) {
      issues.push(`Dimensions [${r.sizeStuds.join(' x ')}] exceed Roblox 2048-stud MeshPart limit`);
    }
    if (!r.isManifold && (doc.robloxPreset === 'Avatar_Cage_Outer' || node.collisionFidelity === 'PreciseConvexDecomposition')) {
      issues.push(`${r.boundaryEdges} open boundary half-edges detected (watertight manifold recommended for Cage/Collision)`);
    }
    if (r.zeroAreaFaces > 0) {
      issues.push(`${r.zeroAreaFaces} degenerate zero-area faces will be stripped by Roblox Studio importer`);
    }
    if (issues.length > 0) allCompatible = false;
    perNode.push({ id: node.id, name: node.name, report: r, issues });
  }

  return {
    preset: doc.robloxPreset,
    totalTriangles,
    totalVertices,
    meshObjects,
    allCompatible,
    perNode,
  };
}

/**
 * Apply a high-level modeling operation on a scene document (used identically by MCP Server & AI Console)
 */
export function applyMeshOperationToDoc(
  doc: SerializedSceneDocument,
  nodeIdOrName: string,
  op: 'extrude' | 'inset' | 'bevel' | 'subdivide' | 'loop_cut' | 'project_uvs',
  params: {
    faces?: number[];
    distance?: number;
    scale?: number;
    inset?: number;
    depth?: number;
    width?: number;
    smooth?: boolean;
    edgeId?: number;
    t?: number;
    uvMode?: 'box' | 'planar' | 'cylindrical' | 'spherical';
    uvScale?: number;
  }
): { updatedNode: SceneNodeData; summary: string } {
  const node = doc.nodes.find((n) => n.id === nodeIdOrName || n.name.toLowerCase() === nodeIdOrName.toLowerCase());
  if (!node || node.type !== 'mesh' || !node.soup) {
    throw new Error(`Mesh node '${nodeIdOrName}' not found in scene.`);
  }
  const soup = serializedToSoup(node.soup);
  const topo = new HalfEdgeTopology(soup);
  const defaultFaces = Array.from({ length: topo.faceCount }, (_, i) => i);

  let nextSoup: PolygonSoup = soup;
  let summary = '';

  switch (op) {
    case 'extrude': {
      const faces = params.faces && params.faces.length > 0 ? params.faces : [0];
      const dist = params.distance ?? 1.0;
      const sc = params.scale ?? 1.0;
      nextSoup = wasmKernel.extrudeFaces(soup, faces, dist, sc);
      summary = `Extruded ${faces.length} face(s) on '${node.name}' by ${dist} studs (scale ${sc})`;
      break;
    }
    case 'inset': {
      const faces = params.faces && params.faces.length > 0 ? params.faces : defaultFaces;
      const ins = params.inset ?? 0.2;
      const dep = params.depth ?? 0.0;
      nextSoup = wasmKernel.insetFaces(soup, faces, ins, dep);
      summary = `Inset ${faces.length} face(s) on '${node.name}' (inset=${ins}, depth=${dep})`;
      break;
    }
    case 'bevel': {
      const faces = params.faces && params.faces.length > 0 ? params.faces : defaultFaces;
      const w = params.width ?? 0.18;
      nextSoup = wasmKernel.bevelFaces(soup, faces, w);
      summary = `Beveled ${faces.length} face(s) on '${node.name}' (width=${w})`;
      break;
    }
    case 'subdivide': {
      const sm = params.smooth ?? false;
      nextSoup = wasmKernel.subdivide(soup, sm);
      summary = `Subdivided '${node.name}' (${sm ? 'Catmull-Clark smooth' : 'Linear quad split'})`;
      break;
    }
    case 'loop_cut': {
      const edgeId = params.edgeId ?? 0;
      const t = params.t ?? 0.5;
      nextSoup = topo.loopCut(edgeId, t);
      summary = `Inserted edge loop cut on '${node.name}' starting at edge #${edgeId} (t=${t})`;
      break;
    }
    case 'project_uvs': {
      const mode = params.uvMode ?? 'box';
      const sc = params.uvScale ?? 1.0;
      nextSoup = topo.projectUVs(mode, sc);
      summary = `Projected ${mode} UVs on '${node.name}' (scale=${sc})`;
      break;
    }
  }

  node.soup = soupToSerialized(nextSoup);
  return { updatedNode: node, summary };
}

export function applyMaterialPreset(
  doc: SerializedSceneDocument,
  nodeIdOrName: string,
  opts: {
    color?: string;
    robloxMaterial?: RobloxSurfaceMaterial;
    roughness?: number;
    metalness?: number;
    collisionFidelity?: RobloxCollisionFidelity;
    pattern?: 'none' | 'studs' | 'checker' | 'grid' | 'noise' | 'brushed_metal';
  }
): string {
  const node = doc.nodes.find((n) => n.id === nodeIdOrName || n.name.toLowerCase() === nodeIdOrName.toLowerCase());
  if (!node) throw new Error(`Node '${nodeIdOrName}' not found.`);

  if (opts.collisionFidelity) node.collisionFidelity = opts.collisionFidelity;

  const newMatId = `mat_${Math.random().toString(36).slice(2, 8)}`;
  const mat: MaterialSpec = {
    id: newMatId,
    name: `${node.name}_${opts.robloxMaterial || 'Material'}`,
    color: opts.color || '#9ca3af',
    roughness: opts.roughness ?? 0.35,
    metalness: opts.metalness ?? 0.1,
    emissive: opts.robloxMaterial === 'Neon' ? (opts.color || '#10b981') : '#000000',
    emissiveIntensity: opts.robloxMaterial === 'Neon' ? 0.8 : 0,
    opacity: opts.robloxMaterial === 'Glass' || opts.robloxMaterial === 'ForceField' ? 0.55 : 1,
    wireframe: false,
    flatShading: false,
    robloxMaterial: opts.robloxMaterial || 'SmoothPlastic',
    texture: {
      pattern: opts.pattern ?? 'none',
      scaleU: 4,
      scaleV: 4,
      secondaryColor: '#374151',
    },
  };
  doc.materials.push(mat);
  node.materialId = newMatId;
  return `Assigned Roblox material '${mat.robloxMaterial}' (${mat.color}) to '${node.name}'`;
}
