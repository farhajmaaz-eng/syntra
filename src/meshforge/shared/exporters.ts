import { Euler, Quaternion, Vector3 } from "three";
import { HalfEdgeTopology } from '../client/geometry/halfEdgeMesh';
import { MaterialSpec, SceneNodeData, SerializedSceneDocument } from './sceneSchema';
import { serializedToSoup } from './sceneOps';

export interface ExportOptions {
  scalePreset: 'studs_1_0' | 'meters_0_28' | 'centimeters_28_0';
  upAxis: 'Y' | 'Z';
  selectedNodeIds?: string[];
  triangulate?: boolean;
}

function getScaleFactor(preset: ExportOptions['scalePreset']): number {
  switch (preset) {
    case 'meters_0_28':
      return 0.28; // Official Roblox Studio scale: 1 Stud = 0.28 Meters
    case 'centimeters_28_0':
      return 28.0; // FBX / Unreal / Maya centimeters: 1 Stud = 28 cm
    case 'studs_1_0':
    default:
      return 1.0; // Direct 1 unit = 1 Stud
  }
}

export function meshExportName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]+/g, "_") || "Roblox_Asset";
}

function nodeOrientation(node: SceneNodeData) {
  return new Quaternion().setFromEuler(new Euler(
    node.rotation[0] * Math.PI / 180,
    node.rotation[1] * Math.PI / 180,
    node.rotation[2] * Math.PI / 180,
    "XYZ",
  ));
}

const zUpOrientation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

function pointInWorld(node: SceneNodeData, unitScale: number, upAxis: 'Y' | 'Z') {
  const orientation = nodeOrientation(node);
  const value = new Vector3();
  return (lx: number, ly: number, lz: number): [number, number, number] => {
    value.set(
      (lx - node.pivotOffset[0]) * node.scale[0],
      (ly - node.pivotOffset[1]) * node.scale[1],
      (lz - node.pivotOffset[2]) * node.scale[2],
    ).applyQuaternion(orientation);
    value.x = (value.x + node.position[0]) * unitScale;
    value.y = (value.y + node.position[1]) * unitScale;
    value.z = (value.z + node.position[2]) * unitScale;
    return upAxis === 'Z' ? [value.x, -value.z, value.y] : [value.x, value.y, value.z];
  };
}

function normalInWorld(node: SceneNodeData, upAxis: 'Y' | 'Z') {
  const orientation = nodeOrientation(node);
  const value = new Vector3();
  return (x: number, y: number, z: number): [number, number, number] => {
    value.set(x / (node.scale[0] || 1), y / (node.scale[1] || 1), z / (node.scale[2] || 1))
      .applyQuaternion(orientation).normalize();
    return upAxis === 'Z' ? [value.x, -value.z, value.y] : [value.x, value.y, value.z];
  };
}

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 6 ? clean : '9ca3af', 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

/**
 * 1. Wavefront OBJ + MTL Exporter with Roblox Scale & Axis metadata
 */
export function exportSceneToOBJ(doc: SerializedSceneDocument, opts?: Partial<ExportOptions>): { obj: string; mtl: string } {
  const scalePreset = opts?.scalePreset ?? doc.exportUnitScale ?? 'meters_0_28';
  const upAxis = opts?.upAxis ?? doc.upAxis ?? 'Y';
  const unitScale = getScaleFactor(scalePreset);
  const triangulate = opts?.triangulate ?? true;
  const filterSet = opts?.selectedNodeIds?.length ? new Set(opts.selectedNodeIds) : null;

  const lines: string[] = [
    `# Roblox Studio Compatible 3D Mesh Export`,
    `# Scene: ${doc.name}`,
    `# Preset: ${doc.robloxPreset} | Scale: ${scalePreset} (factor=${unitScale}) | UpAxis: ${upAxis}`,
    `mtllib ${meshExportName(doc.name)}.mtl`,
    ``,
  ];

  const mtlLines: string[] = [`# Material Library for ${doc.name}`];
  for (const mat of doc.materials) {
    const [r, g, b] = hexToRgb01(mat.color);
    const [er, eg, eb] = hexToRgb01(mat.emissive || '#000000');
    mtlLines.push(
      `newmtl ${mat.id}`,
      `# RobloxSurfaceMaterial: ${mat.robloxMaterial}`,
      `Kd ${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)}`,
      `Ks ${(mat.metalness * 0.8).toFixed(4)} ${(mat.metalness * 0.8).toFixed(4)} ${(mat.metalness * 0.8).toFixed(4)}`,
      `Ke ${(er * mat.emissiveIntensity).toFixed(4)} ${(eg * mat.emissiveIntensity).toFixed(4)} ${(eb * mat.emissiveIntensity).toFixed(4)}`,
      `d ${mat.opacity.toFixed(4)}`,
      ``
    );
  }

  let vOffset = 1;
  let vtOffset = 1;
  let vnOffset = 1;

  for (const node of doc.nodes) {
    if (node.type !== 'mesh' || !node.soup || !node.visible) continue;
    if (filterSet && !filterSet.has(node.id)) continue;

    const topo = new HalfEdgeTopology(serializedToSoup(node.soup));
    const transformPoint = pointInWorld(node, unitScale, upAxis);
    const transformNormal = normalInWorld(node, upAxis);
    lines.push(`o ${node.name.replace(/\s+/g, '_')}`);
    lines.push(`usemtl ${node.materialId}`);

    for (let v = 0; v < topo.vertexCount; v++) {
      const [px, py, pz] = transformPoint(
        topo.positions[v * 3],
        topo.positions[v * 3 + 1],
        topo.positions[v * 3 + 2],
      );
      lines.push(`v ${px.toFixed(5)} ${py.toFixed(5)} ${pz.toFixed(5)}`);
    }

    for (const he of topo.halfEdges) {
      lines.push(`vt ${he.u.toFixed(5)} ${he.v.toFixed(5)}`);
    }

    for (let f = 0; f < topo.faceCount; f++) {
      const [nx, ny, nz] = topo.getFaceNormal(f);
      const [tnx, tny, tnz] = transformNormal(nx, ny, nz);
      lines.push(`vn ${tnx.toFixed(5)} ${tny.toFixed(5)} ${tnz.toFixed(5)}`);
    }

    for (let f = 0; f < topo.faceCount; f++) {
      const hes = topo.getFaceHalfEdges(f);
      if (hes.length < 3) continue;
      const nIdx = vnOffset + f;
      if (triangulate) {
        for (let i = 1; i < hes.length - 1; i++) {
          const c0 = hes[0], c1 = hes[i], c2 = hes[i + 1];
          lines.push(
            `f ${vOffset + c0.origin}/${vtOffset + c0.id}/${nIdx} ${vOffset + c1.origin}/${vtOffset + c1.id}/${nIdx} ${vOffset + c2.origin}/${vtOffset + c2.id}/${nIdx}`
          );
        }
      } else {
        const tokens = hes.map((he) => `${vOffset + he.origin}/${vtOffset + he.id}/${nIdx}`);
        lines.push(`f ${tokens.join(' ')}`);
      }
    }

    vOffset += topo.vertexCount;
    vtOffset += topo.halfEdges.length;
    vnOffset += topo.faceCount;
    lines.push(``);
  }

  return { obj: lines.join('\n'), mtl: mtlLines.join('\n') };
}

/**
 * 2. Binary glTF 2.0 (.glb) Exporter (Roblox Studio Unified 3D Importer native format)
 * Spec-compliant 12-byte header + JSON chunk + BIN chunk with PBR Metallic-Roughness materials.
 */
export function exportSceneToGLB(doc: SerializedSceneDocument, opts?: Partial<ExportOptions>): Uint8Array {
  const scalePreset = opts?.scalePreset ?? doc.exportUnitScale ?? 'meters_0_28';
  const upAxis = opts?.upAxis ?? doc.upAxis ?? 'Y';
  const unitScale = getScaleFactor(scalePreset);
  const filterSet = opts?.selectedNodeIds?.length ? new Set(opts.selectedNodeIds) : null;

  const matIndexMap = new Map<string, number>();
  const gltfMaterials = doc.materials.map((m, idx) => {
    matIndexMap.set(m.id, idx);
    const [r, g, b] = hexToRgb01(m.color);
    const [er, eg, eb] = hexToRgb01(m.emissive || '#000000');
    return {
      name: m.name,
      pbrMetallicRoughness: {
        baseColorFactor: [r, g, b, m.opacity],
        metallicFactor: m.metalness,
        roughnessFactor: m.roughness,
      },
      emissiveFactor: [er * m.emissiveIntensity, eg * m.emissiveIntensity, eb * m.emissiveIntensity],
      extras: {
        robloxSurfaceMaterial: m.robloxMaterial,
      },
    };
  });

  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const meshes: any[] = [];
  const nodes: any[] = [];
  const rootNodeIndices: number[] = [];
  const binChunks: Uint8Array[] = [];
  let byteOffset = 0;

  const pushTypedArray = (arr: Float32Array | Uint32Array, target: number): number => {
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    const bvIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
      target,
    });
    binChunks.push(bytes);
    if (pad > 0) binChunks.push(new Uint8Array(pad));
    byteOffset += bytes.byteLength + pad;
    return bvIdx;
  };

  for (const node of doc.nodes) {
    if (node.type !== 'mesh' || !node.soup || !node.visible) continue;
    if (filterSet && !filterSet.has(node.id)) continue;

    const topo = new HalfEdgeTopology(serializedToSoup(node.soup));
    const matObj = doc.materials.find((m) => m.id === node.materialId);
    const compiled = topo.buildRenderBuffersJS(matObj?.flatShading ?? false);

    if (!compiled.indices.length) continue;

    // Apply unit scale directly to mesh vertices and node translation so Roblox Studio imports exact Studs
    const pos = new Float32Array(compiled.positions.length);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < pos.length; i += 3) {
      let x = (compiled.positions[i] - node.pivotOffset[0]) * unitScale;
      let y = (compiled.positions[i + 1] - node.pivotOffset[1]) * unitScale;
      let z = (compiled.positions[i + 2] - node.pivotOffset[2]) * unitScale;
      if (upAxis === 'Z') {
        const tmp = y; y = -z; z = tmp;
      }
      pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
      x = pos[i]; y = pos[i + 1]; z = pos[i + 2];
      if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
      minX = minY = minZ = maxX = maxY = maxZ = 0;
    }

    const posBv = pushTypedArray(pos, 34962);
    const normals = compiled.normals.slice();
    if (upAxis === 'Z') {
      for (let i = 0; i < normals.length; i += 3) {
        const y = normals[i + 1];
        normals[i + 1] = -normals[i + 2];
        normals[i + 2] = y;
      }
    }
    const normBv = pushTypedArray(normals, 34962);
    const uvBv = pushTypedArray(compiled.uvs, 34962);
    const idxBv = pushTypedArray(compiled.indices, 34963);

    const posAcc = accessors.length;
    accessors.push({
      bufferView: posBv,
      componentType: 5126,
      count: (pos.length / 3) | 0,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });

    const normAcc = accessors.length;
    accessors.push({
      bufferView: normBv,
      componentType: 5126,
      count: (compiled.normals.length / 3) | 0,
      type: 'VEC3',
    });

    const uvAcc = accessors.length;
    accessors.push({
      bufferView: uvBv,
      componentType: 5126,
      count: (compiled.uvs.length / 2) | 0,
      type: 'VEC2',
    });

    const idxAcc = accessors.length;
    accessors.push({
      bufferView: idxBv,
      componentType: 5125,
      count: compiled.indices.length,
      type: 'SCALAR',
    });

    const meshIdx = meshes.length;
    meshes.push({
      name: node.name,
      primitives: [
        {
          attributes: { POSITION: posAcc, NORMAL: normAcc, TEXCOORD_0: uvAcc },
          indices: idxAcc,
          material: matIndexMap.get(node.materialId) ?? 0,
        },
      ],
    });

    const orientation = nodeOrientation(node);
    const [x, y, z] = node.position.map((position) => position * unitScale);
    const translation = upAxis === 'Z' ? [x, -z, y] : [x, y, z];
    if (upAxis === 'Z') {
      orientation.premultiply(zUpOrientation).multiply(zUpOrientation.clone().invert());
    }
    const nodeIdx = nodes.length;
    nodes.push({
      name: node.name,
      mesh: meshIdx,
      translation,
      rotation: orientation.toArray(),
      scale: upAxis === 'Z' ? [node.scale[0], node.scale[2], node.scale[1]] : node.scale,
      extras: {
        robloxAnchored: node.anchored,
        robloxCanCollide: node.canCollide,
        robloxCollisionFidelity: node.collisionFidelity,
      },
    });
    rootNodeIndices.push(nodeIdx);
  }

  const gltfJson = {
    asset: {
      version: '2.0',
      generator: 'MeshForge Roblox Studio 3D Modeler + MCP',
      extras: {
        robloxPreset: doc.robloxPreset,
        scalePreset,
        unitScale,
      },
    },
    scene: 0,
    scenes: [{ name: doc.name, nodes: rootNodeIndices }],
    nodes,
    meshes,
    materials: gltfMaterials,
    accessors,
    bufferViews,
    ...(byteOffset > 0 ? { buffers: [{ byteLength: byteOffset }] } : {}),
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltfJson));
  const jsonPad = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonChunkLen = jsonBytes.byteLength + jsonPad;

  const totalLength = 12 + 8 + jsonChunkLen + (byteOffset > 0 ? 8 + byteOffset : 0);
  const glb = new Uint8Array(totalLength);
  const view = new DataView(glb.buffer);

  // GLB Header: magic 'glTF' (0x46546C67), version 2, totalLength
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);

  // JSON Chunk (0x4E4F534A)
  view.setUint32(12, jsonChunkLen, true);
  view.setUint32(16, 0x4e4f534a, true);
  glb.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) glb[20 + jsonBytes.byteLength + i] = 0x20; // space pad

  // BIN Chunk (0x004E4942)
  if (byteOffset > 0) {
    const binHeaderPos = 20 + jsonChunkLen;
    view.setUint32(binHeaderPos, byteOffset, true);
    view.setUint32(binHeaderPos + 4, 0x004e4942, true);
    let writeCursor = binHeaderPos + 8;
    for (const chunk of binChunks) {
      glb.set(chunk, writeCursor);
      writeCursor += chunk.byteLength;
    }
  }

  return glb;
}

/**
 * 3. Autodesk FBX 7.4 ASCII Exporter calibrated for Roblox Studio 3D Importer
 * Uses GlobalSettings UnitScaleFactor = 28.0 (1 Stud = 28cm) or 1.0 depending on preset.
 */
export function exportSceneToFBX(doc: SerializedSceneDocument, opts?: Partial<ExportOptions>): string {
  const scalePreset = opts?.scalePreset ?? 'centimeters_28_0';
  const upAxis = opts?.upAxis ?? doc.upAxis ?? 'Y';
  const unitScale = getScaleFactor(scalePreset);
  const centimetersPerUnit = scalePreset === 'meters_0_28' ? 100 : scalePreset === 'studs_1_0' ? 28 : 1;
  const filterSet = opts?.selectedNodeIds?.length ? new Set(opts.selectedNodeIds) : null;

  const meshNodes = doc.nodes.filter(
    (n) => n.type === 'mesh' && n.soup && n.visible && (!filterSet || filterSet.has(n.id))
  );

  const lines: string[] = [
    `; FBX 7.4.0 project file`,
    `; Generated by MeshForge Roblox 3D Platform`,
    `; Roblox Preset: ${doc.robloxPreset} | ScalePreset: ${scalePreset} (factor=${unitScale})`,
    `FBXHeaderExtension:  {`,
    `    FBXHeaderVersion: 1003`,
    `    FBXVersion: 7400`,
    `    Creator: "MeshForge Roblox 3D Engine"`,
    `}`,
    `GlobalSettings:  {`,
    `    Version: 1000`,
    `    Properties70:  {`,
    `        P: "UpAxis", "int", "Integer", "",${upAxis === 'Y' ? 1 : 2}`,
    `        P: "UpAxisSign", "int", "Integer", "",1`,
    `        P: "FrontAxis", "int", "Integer", "",${upAxis === 'Y' ? 2 : 1}`,
    `        P: "FrontAxisSign", "int", "Integer", "",1`,
    `        P: "CoordAxis", "int", "Integer", "",0`,
    `        P: "CoordAxisSign", "int", "Integer", "",1`,
    `        P: "UnitScaleFactor", "double", "Number", "",${centimetersPerUnit}`,
    `        P: "OriginalUnitScaleFactor", "double", "Number", "",${centimetersPerUnit}`,
    `    }`,
    `}`,
    `Definitions:  {`,
    `    Version: 100`,
    `    Count: ${meshNodes.length * 3 + 1}`,
    `    ObjectType: "GlobalSettings" { Count: 1 }`,
    `    ObjectType: "Model" { Count: ${meshNodes.length} }`,
    `    ObjectType: "Geometry" { Count: ${meshNodes.length} }`,
    `    ObjectType: "Material" { Count: ${meshNodes.length} }`,
    `}`,
    `Objects:  {`,
  ];

  const connections: string[] = [];

  meshNodes.forEach((node, i) => {
    const geomId = 100000 + i * 10 + 1;
    const modelId = 100000 + i * 10 + 2;
    const matId = 100000 + i * 10 + 3;

    const topo = new HalfEdgeTopology(serializedToSoup(node.soup!));
    const zUp = upAxis === 'Z';
    const [px, py, pz] = node.position.map((value) => value * unitScale);
    const position = zUp ? [px, -pz, py] : [px, py, pz];
    const scale = zUp ? [node.scale[0], node.scale[2], node.scale[1]] : node.scale;
    const orientation = nodeOrientation(node);
    if (zUp) {
      orientation.premultiply(zUpOrientation).multiply(zUpOrientation.clone().invert());
    }
    const { x, y, z } = new Euler().setFromQuaternion(orientation, 'XYZ');
    const rotation = zUp ? [x, y, z].map((value) => value * 180 / Math.PI) : node.rotation;
    const verts: number[] = [];
    for (let v = 0; v < topo.vertexCount; v++) {
      const lx = (topo.positions[v * 3] - node.pivotOffset[0]) * unitScale;
      const ly = (topo.positions[v * 3 + 1] - node.pivotOffset[1]) * unitScale;
      const lz = (topo.positions[v * 3 + 2] - node.pivotOffset[2]) * unitScale;
      for (const value of zUp ? [lx, -lz, ly] : [lx, ly, lz]) verts.push(Number(value.toFixed(5)));
    }

    // FBX PolygonVertexIndex negates and subtracts 1 from the last index of each polygon: ~(lastIdx)
    const polyIndices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const uvIndex: number[] = [];

    for (let f = 0; f < topo.faceCount; f++) {
      const hes = topo.getFaceHalfEdges(f);
      if (hes.length < 3) continue;
      const [fnx, fny, fnz] = topo.getFaceNormal(f);
      for (let k = 0; k < hes.length; k++) {
        const he = hes[k];
        const isLast = k === hes.length - 1;
        polyIndices.push(isLast ? ~he.origin : he.origin);
        for (const value of zUp ? [fnx, -fnz, fny] : [fnx, fny, fnz]) normals.push(Number(value.toFixed(5)));
        uvIndex.push(uvs.length / 2);
        uvs.push(Number(he.u.toFixed(5)), Number(he.v.toFixed(5)));
      }
    }

    const mat = doc.materials.find((m) => m.id === node.materialId) || doc.materials[0];
    const [mr, mg, mb] = hexToRgb01(mat?.color || '#9ca3af');

    lines.push(
      `    Geometry: ${geomId}, "Geometry::${meshExportName(node.name)}", "Mesh" {`,
      `        Vertices: *${verts.length} {`,
      `            a: ${verts.join(',')}`,
      `        }`,
      `        PolygonVertexIndex: *${polyIndices.length} {`,
      `            a: ${polyIndices.join(',')}`,
      `        }`,
      `        GeometryVersion: 124`,
      `        LayerElementNormal: 0 {`,
      `            Version: 101`,
      `            Name: ""`,
      `            MappingInformationType: "ByPolygonVertex"`,
      `            ReferenceInformationType: "Direct"`,
      `            Normals: *${normals.length} {`,
      `                a: ${normals.join(',')}`,
      `            }`,
      `        }`,
      `        LayerElementUV: 0 {`,
      `            Version: 101`,
      `            Name: "UVMap"`,
      `            MappingInformationType: "ByPolygonVertex"`,
      `            ReferenceInformationType: "IndexToDirect"`,
      `            UV: *${uvs.length} {`,
      `                a: ${uvs.join(',')}`,
      `            }`,
      `            UVIndex: *${uvIndex.length} {`,
      `                a: ${uvIndex.join(',')}`,
      `            }`,
      `        }`,
      `        Layer: 0 {`,
      `            Version: 100`,
      `            LayerElement:  { Type: "LayerElementNormal", TypedIndex: 0 }`,
      `            LayerElement:  { Type: "LayerElementUV", TypedIndex: 0 }`,
      `        }`,
      `    }`,
      `    Model: ${modelId}, "Model::${meshExportName(node.name)}", "Mesh" {`,
      `        Version: 232`,
      `        Properties70:  {`,
      `            P: "Lcl Translation", "Lcl Translation", "", "A",${position.map((value) => value.toFixed(4)).join(',')}`,
      `            P: "Lcl Rotation", "Lcl Rotation", "", "A",${rotation.map((value) => value.toFixed(4)).join(',')}`,
      `            P: "Lcl Scaling", "Lcl Scaling", "", "A",${scale.map((value) => value.toFixed(4)).join(',')}`,
      `        }`,
      `        Shading: T`,
      `        Culling: "CullingOff"`,
      `    }`,
      `    Material: ${matId}, "Material::${meshExportName(mat?.name || 'SmoothPlastic')}", "" {`,
      `        Version: 102`,
      `        ShadingModel: "phong"`,
      `        Properties70:  {`,
      `            P: "DiffuseColor", "Color", "", "A",${mr.toFixed(4)},${mg.toFixed(4)},${mb.toFixed(4)}`,
      `        }`,
      `    }`
    );

    connections.push(
      `    C: "OO",${modelId},0`,
      `    C: "OO",${geomId},${modelId}`,
      `    C: "OO",${matId},${modelId}`
    );
  });

  lines.push(`}`, `Connections:  {`, ...connections, `}`, ``);
  return lines.join('\n');
}

/**
 * Wavefront OBJ Importer (converts imported .obj into Half-Edge PolygonSoup)
 */
export function parseOBJToNode(objText: string, name = 'Imported_Mesh'): SceneNodeData {
  const coords: number[] = [];
  const faceCounts: number[] = [];
  const faceIndices: number[] = [];
  const uvs: [number, number][] = [];
  const faceUvs: number[] = [];
  const index = (value: string, length: number) => {
    const number = Number(value);
    const offset = number < 0 ? length + number : number - 1;
    if (!value || !Number.isInteger(number) || offset < 0 || offset >= length) {
      throw new Error("OBJ face references a missing vertex or UV.");
    }
    return offset;
  };

  for (const raw of objText.split(/\r?\n/)) {
    const [kind, ...parts] = raw.split('#', 1)[0].trim().split(/\s+/);
    if (kind === 'v' || kind === 'vt') {
      const size = kind === 'v' ? 3 : 2;
      const values = parts.slice(0, size).map(Number);
      if (values.length !== size || !values.every(Number.isFinite)) {
        throw new Error("OBJ contains an invalid vertex or UV.");
      }
      if (kind === 'v') coords.push(...values);
      else uvs.push(values as [number, number]);
    } else if (kind === 'f') {
      if (parts.length < 3 || parts.length > 1024) throw new Error("OBJ face has an unsupported corner count.");
      faceCounts.push(parts.length);
      for (const part of parts) {
        const [position, uv] = part.split('/');
        faceIndices.push(index(position, coords.length / 3));
        faceUvs.push(...(uv ? uvs[index(uv, uvs.length)] : [0, 0]));
      }
    }
    if (coords.length > 300000 || faceIndices.length > 400000 || uvs.length > 400000) {
      throw new Error("OBJ exceeds MeshForge's geometry limits.");
    }
  }
  if (!faceCounts.length) throw new Error("OBJ contains no polygon faces.");

  return {
    id: `node_${Math.random().toString(36).slice(2, 9)}`,
    name,
    parentId: null,
    type: 'mesh',
    visible: true,
    locked: false,
    anchored: true,
    canCollide: true,
    castShadow: true,
    collisionFidelity: 'Default',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    pivotOffset: [0, 0, 0],
    materialId: 'mat_smooth_plastic',
    soup: { coords, faceCounts, faceIndices, faceUvs },
  };
}
