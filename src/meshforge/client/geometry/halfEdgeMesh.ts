export interface PolygonSoup {
  coords: Float32Array;     // [x0, y0, z0, x1, y1, z1, ...]
  faceCounts: Uint32Array;  // [4, 4, 3, ...]
  faceIndices: Uint32Array; // [v0, v1, v2, v3, ...]
  faceUvs?: Float32Array;   // [u0, v0, u1, v1, ...] per corner
}

export interface RobloxValidationReport {
  vertexCount: number;
  faceCount: number;
  triangleCount: number;
  boundaryEdges: number;
  zeroAreaFaces: number;
  ngonFaces: number;
  sizeStuds: [number, number, number];
  isManifold: boolean;
  fitsUgc4k: boolean;
  fitsMeshPart10k: boolean;
  fitsExtended20k: boolean;
  fitsMaxStuds: boolean;
}

export interface CompiledRenderBuffers {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  triToFace: Uint32Array;
  wireframePairs: Uint32Array;
  validation: RobloxValidationReport;
  usedWasm: boolean;
}

export interface HalfEdge {
  id: number;
  origin: number;
  target: number;
  twin: number; // -1 if boundary
  next: number;
  prev: number;
  face: number;
  u: number;
  v: number;
}

export interface EdgeRecord {
  id: number;
  v0: number;
  v1: number;
  he0: number;
  he1: number; // -1 if boundary
}

/**
 * TypeScript Half-Edge Mesh Topology Graph
 * Mirrors the Rust WASM kernel (`rblx_mesh_wasm`) for instant synchronous queries,
 * topological loop/ring selection, edge/vertex manipulation, and fallback execution.
 */
export class HalfEdgeTopology {
  positions: Float32Array;
  halfEdges: HalfEdge[] = [];
  faceEdge: Int32Array;
  vertEdge: Int32Array;
  edges: EdgeRecord[] = [];

  constructor(soup: PolygonSoup) {
    this.positions = new Float32Array(soup.coords);
    const vCount = (this.positions.length / 3) | 0;
    this.vertEdge = new Int32Array(vCount).fill(-1);
    const fCount = soup.faceCounts.length;
    const validFaceEdges: number[] = [];

    const directedMap = new Map<string, number>();
    const undirectedMap = new Map<string, number>();

    let cursor = 0;
    for (let f = 0; f < fCount; f++) {
      const cnt = soup.faceCounts[f];
      if (cnt < 3 || cursor + cnt > soup.faceIndices.length) {
        cursor += cnt;
        continue;
      }
      const baseHe = this.halfEdges.length;
      const realFace = validFaceEdges.length;
      validFaceEdges.push(baseHe);

      for (let i = 0; i < cnt; i++) {
        const origin = soup.faceIndices[cursor + i];
        const target = soup.faceIndices[cursor + ((i + 1) % cnt)];
        const heId = baseHe + i;
        const nextId = baseHe + ((i + 1) % cnt);
        const prevId = baseHe + ((i + cnt - 1) % cnt);

        let u = (this.positions[origin * 3] * 0.25) + 0.5;
        let v = (this.positions[origin * 3 + 2] * 0.25) + 0.5;
        if (soup.faceUvs && (cursor + i) * 2 + 1 < soup.faceUvs.length) {
          u = soup.faceUvs[(cursor + i) * 2];
          v = soup.faceUvs[(cursor + i) * 2 + 1];
        }

        this.halfEdges.push({
          id: heId,
          origin,
          target,
          twin: -1,
          next: nextId,
          prev: prevId,
          face: realFace,
          u,
          v,
        });

        if (origin < vCount && this.vertEdge[origin] === -1) {
          this.vertEdge[origin] = heId;
        }

        const revKey = `${target}_${origin}`;
        const twinId = directedMap.get(revKey);
        if (twinId !== undefined) {
          this.halfEdges[heId].twin = twinId;
          this.halfEdges[twinId].twin = heId;
        } else {
          directedMap.set(`${origin}_${target}`, heId);
        }

        const uKey = origin < target ? `${origin}_${target}` : `${target}_${origin}`;
        const existingEdge = undirectedMap.get(uKey);
        if (existingEdge === undefined) {
          undirectedMap.set(uKey, this.edges.length);
          this.edges.push({
            id: this.edges.length,
            v0: Math.min(origin, target),
            v1: Math.max(origin, target),
            he0: heId,
            he1: -1,
          });
        } else {
          this.edges[existingEdge].he1 = heId;
        }
      }
      cursor += cnt;
    }

    this.faceEdge = new Int32Array(validFaceEdges);
  }

  get vertexCount(): number {
    return (this.positions.length / 3) | 0;
  }

  get faceCount(): number {
    return this.faceEdge.length;
  }

  getFaceVertices(fIdx: number): number[] {
    if (fIdx < 0 || fIdx >= this.faceEdge.length) return [];
    const start = this.faceEdge[fIdx];
    if (start < 0) return [];
    const out: number[] = [];
    let cur = start;
    let guard = 0;
    do {
      const he = this.halfEdges[cur];
      out.push(he.origin);
      cur = he.next;
      guard++;
    } while (cur !== start && cur >= 0 && guard < 256);
    return out;
  }

  getFaceHalfEdges(fIdx: number): HalfEdge[] {
    if (fIdx < 0 || fIdx >= this.faceEdge.length) return [];
    const start = this.faceEdge[fIdx];
    if (start < 0) return [];
    const out: HalfEdge[] = [];
    let cur = start;
    let guard = 0;
    do {
      const he = this.halfEdges[cur];
      out.push(he);
      cur = he.next;
      guard++;
    } while (cur !== start && cur >= 0 && guard < 256);
    return out;
  }

  getFaceNormal(fIdx: number): [number, number, number] {
    const verts = this.getFaceVertices(fIdx);
    if (verts.length < 3) return [0, 1, 0];
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < verts.length; i++) {
      const i0 = verts[i] * 3;
      const i1 = verts[(i + 1) % verts.length] * 3;
      const cx = this.positions[i0], cy = this.positions[i0 + 1], cz = this.positions[i0 + 2];
      const tx = this.positions[i1], ty = this.positions[i1 + 1], tz = this.positions[i1 + 2];
      nx += (cy - ty) * (cz + tz);
      ny += (cz - tz) * (cx + tx);
      nz += (cx - tx) * (cy + ty);
    }
    const len = Math.hypot(nx, ny, nz);
    return len > 1e-8 ? [nx / len, ny / len, nz / len] : [0, 1, 0];
  }

  getFaceCenter(fIdx: number): [number, number, number] {
    const verts = this.getFaceVertices(fIdx);
    if (verts.length === 0) return [0, 0, 0];
    let sx = 0, sy = 0, sz = 0;
    for (const v of verts) {
      sx += this.positions[v * 3];
      sy += this.positions[v * 3 + 1];
      sz += this.positions[v * 3 + 2];
    }
    const inv = 1 / verts.length;
    return [sx * inv, sy * inv, sz * inv];
  }

  /** Find quad edge loop starting from an undirected edge ID */
  getEdgeLoop(edgeId: number): number[] {
    if (edgeId < 0 || edgeId >= this.edges.length) return [];
    const result = new Set<number>([edgeId]);
    const heToEdge = new Map<number, number>();
    for (const e of this.edges) {
      heToEdge.set(e.he0, e.id);
      if (e.he1 >= 0) heToEdge.set(e.he1, e.id);
    }

    // Walk quad ring/parallel edges across faces
    const walkOpposite = (startHe: number) => {
      let curHe = startHe;
      let guard = 0;
      while (curHe >= 0 && guard++ < 512) {
        const he = this.halfEdges[curHe];
        const fHes = this.getFaceHalfEdges(he.face);
        if (fHes.length !== 4) break;
        const oppHe = this.halfEdges[this.halfEdges[he.next].next];
        const oppEdgeId = heToEdge.get(oppHe.id);
        if (oppEdgeId === undefined || result.has(oppEdgeId)) break;
        result.add(oppEdgeId);
        curHe = oppHe.twin;
      }
    };

    const startEdge = this.edges[edgeId];
    walkOpposite(startEdge.he0);
    if (startEdge.he1 >= 0) walkOpposite(startEdge.he1);
    return Array.from(result);
  }

  /** Split a loop of parallel quad edges at parameter t (0..1), Blender Ctrl+R style Loop Cut */
  loopCut(seedEdgeId: number, t = 0.5): PolygonSoup {
    const ringEdges = this.getEdgeLoop(seedEdgeId);
    if (ringEdges.length === 0) return this.toSoup();

    const coords = Array.from(this.positions);
    const edgeNewVert = new Map<number, number>();

    for (const eId of ringEdges) {
      const e = this.edges[eId];
      const ax = this.positions[e.v0 * 3], ay = this.positions[e.v0 * 3 + 1], az = this.positions[e.v0 * 3 + 2];
      const bx = this.positions[e.v1 * 3], by = this.positions[e.v1 * 3 + 1], bz = this.positions[e.v1 * 3 + 2];
      const nv = (coords.length / 3) | 0;
      coords.push(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
      edgeNewVert.set(eId, nv);
    }

    const heToEdge = new Map<number, number>();
    for (const e of this.edges) {
      heToEdge.set(e.he0, e.id);
      if (e.he1 >= 0) heToEdge.set(e.he1, e.id);
    }

    const newCounts: number[] = [];
    const newIndices: number[] = [];

    for (let f = 0; f < this.faceCount; f++) {
      const hes = this.getFaceHalfEdges(f);
      if (hes.length === 4) {
        const e0 = heToEdge.get(hes[0].id)!;
        const e1 = heToEdge.get(hes[1].id)!;
        const e2 = heToEdge.get(hes[2].id)!;
        const e3 = heToEdge.get(hes[3].id)!;

        if (edgeNewVert.has(e0) && edgeNewVert.has(e2)) {
          const m0 = edgeNewVert.get(e0)!;
          const m2 = edgeNewVert.get(e2)!;
          const v0 = hes[0].origin, v1 = hes[1].origin, v2 = hes[2].origin, v3 = hes[3].origin;
          newCounts.push(4, 4);
          newIndices.push(v0, m0, m2, v3);
          newIndices.push(m0, v1, v2, m2);
          continue;
        } else if (edgeNewVert.has(e1) && edgeNewVert.has(e3)) {
          const m1 = edgeNewVert.get(e1)!;
          const m3 = edgeNewVert.get(e3)!;
          const v0 = hes[0].origin, v1 = hes[1].origin, v2 = hes[2].origin, v3 = hes[3].origin;
          newCounts.push(4, 4);
          newIndices.push(v0, v1, m1, m3);
          newIndices.push(m3, m1, v2, v3);
          continue;
        }
      }

      // Non-quad or face with 1 split edge: insert split vertices inline along boundary
      const poly: number[] = [];
      for (const he of hes) {
        poly.push(he.origin);
        const eid = heToEdge.get(he.id);
        if (eid !== undefined && edgeNewVert.has(eid)) {
          poly.push(edgeNewVert.get(eid)!);
        }
      }
      newCounts.push(poly.length);
      newIndices.push(...poly);
    }

    return {
      coords: new Float32Array(coords),
      faceCounts: new Uint32Array(newCounts),
      faceIndices: new Uint32Array(newIndices),
    };
  }

  /** Delete selected faces */
  deleteFaces(selectedFaces: number[]): PolygonSoup {
    const del = new Set(selectedFaces);
    const counts: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    for (let f = 0; f < this.faceCount; f++) {
      if (del.has(f)) continue;
      const hes = this.getFaceHalfEdges(f);
      counts.push(hes.length);
      for (const he of hes) {
        indices.push(he.origin);
        uvs.push(he.u, he.v);
      }
    }

    return {
      coords: new Float32Array(this.positions),
      faceCounts: new Uint32Array(counts),
      faceIndices: new Uint32Array(indices),
      faceUvs: new Float32Array(uvs),
    };
  }

  /** Merge selected vertices to their centroid (Weld / Collapse) */
  weldVertices(selectedVerts: number[]): PolygonSoup {
    if (selectedVerts.length < 2) return this.toSoup();
    const sel = new Set(selectedVerts);
    let cx = 0, cy = 0, cz = 0;
    for (const v of selectedVerts) {
      cx += this.positions[v * 3];
      cy += this.positions[v * 3 + 1];
      cz += this.positions[v * 3 + 2];
    }
    cx /= selectedVerts.length;
    cy /= selectedVerts.length;
    cz /= selectedVerts.length;

    const targetV = selectedVerts[0];
    const coords = new Float32Array(this.positions);
    coords[targetV * 3] = cx;
    coords[targetV * 3 + 1] = cy;
    coords[targetV * 3 + 2] = cz;

    const counts: number[] = [];
    const indices: number[] = [];

    for (let f = 0; f < this.faceCount; f++) {
      const raw = this.getFaceVertices(f).map((v) => (sel.has(v) ? targetV : v));
      const dedup: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        const cur = raw[i];
        const prev = raw[(i + raw.length - 1) % raw.length];
        if (cur !== prev && !dedup.includes(cur)) dedup.push(cur);
      }
      if (dedup.length >= 3) {
        counts.push(dedup.length);
        indices.push(...dedup);
      }
    }

    return {
      coords,
      faceCounts: new Uint32Array(counts),
      faceIndices: new Uint32Array(indices),
    };
  }

  /** Generate Planar, Box, Cylindrical, or Spherical UV projection */
  projectUVs(mode: 'box' | 'planar' | 'cylindrical' | 'spherical', uvScale = 1): PolygonSoup {
    const counts: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    for (let f = 0; f < this.faceCount; f++) {
      const hes = this.getFaceHalfEdges(f);
      const [nx, ny, nz] = this.getFaceNormal(f);
      counts.push(hes.length);

      for (const he of hes) {
        const v = he.origin;
        const x = this.positions[v * 3];
        const y = this.positions[v * 3 + 1];
        const z = this.positions[v * 3 + 2];
        indices.push(v);

        let uCoord = 0.5;
        let vCoord = 0.5;
        if (mode === 'planar') {
          uCoord = x * 0.25 * uvScale + 0.5;
          vCoord = z * 0.25 * uvScale + 0.5;
        } else if (mode === 'box') {
          const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
          if (ay >= ax && ay >= az) {
            uCoord = x * 0.25 * uvScale + 0.5;
            vCoord = z * 0.25 * uvScale + 0.5;
          } else if (ax >= ay && ax >= az) {
            uCoord = z * 0.25 * uvScale + 0.5;
            vCoord = y * 0.25 * uvScale + 0.5;
          } else {
            uCoord = x * 0.25 * uvScale + 0.5;
            vCoord = y * 0.25 * uvScale + 0.5;
          }
        } else if (mode === 'cylindrical') {
          const angle = Math.atan2(z, x);
          uCoord = ((angle / (Math.PI * 2)) + 0.5) * uvScale;
          vCoord = y * 0.25 * uvScale + 0.5;
        } else if (mode === 'spherical') {
          const r = Math.max(Math.hypot(x, y, z), 1e-6);
          uCoord = (0.5 + Math.atan2(z, x) / (2 * Math.PI)) * uvScale;
          vCoord = (0.5 + Math.asin(Math.max(-1, Math.min(1, y / r))) / Math.PI) * uvScale;
        }

        uvs.push(uCoord, vCoord);
      }
    }

    return {
      coords: new Float32Array(this.positions),
      faceCounts: new Uint32Array(counts),
      faceIndices: new Uint32Array(indices),
      faceUvs: new Float32Array(uvs),
    };
  }

  toSoup(): PolygonSoup {
    const counts = new Uint32Array(this.faceCount);
    const indices: number[] = [];
    const uvs: number[] = [];
    for (let f = 0; f < this.faceCount; f++) {
      const hes = this.getFaceHalfEdges(f);
      counts[f] = hes.length;
      for (const he of hes) {
        indices.push(he.origin);
        uvs.push(he.u, he.v);
      }
    }
    return {
      coords: new Float32Array(this.positions),
      faceCounts: counts,
      faceIndices: new Uint32Array(indices),
      faceUvs: new Float32Array(uvs),
    };
  }

  /** Fallback TS compiler if WASM hasn't finished streaming yet */
  buildRenderBuffersJS(flatShading: boolean): CompiledRenderBuffers {
    const posOut: number[] = [];
    const normOut: number[] = [];
    const uvOut: number[] = [];
    const triIdx: number[] = [];
    const triToFace: number[] = [];
    const wirePairs: number[] = [];

    const vCount = this.vertexCount;
    const smoothNormals = new Float32Array(vCount * 3);
    if (!flatShading) {
      for (let f = 0; f < this.faceCount; f++) {
        const [nx, ny, nz] = this.getFaceNormal(f);
        for (const v of this.getFaceVertices(f)) {
          smoothNormals[v * 3] += nx;
          smoothNormals[v * 3 + 1] += ny;
          smoothNormals[v * 3 + 2] += nz;
        }
      }
      for (let v = 0; v < vCount; v++) {
        const len = Math.hypot(smoothNormals[v * 3], smoothNormals[v * 3 + 1], smoothNormals[v * 3 + 2]);
        if (len > 1e-8) {
          smoothNormals[v * 3] /= len;
          smoothNormals[v * 3 + 1] /= len;
          smoothNormals[v * 3 + 2] /= len;
        } else {
          smoothNormals[v * 3 + 1] = 1;
        }
      }
    }

    for (const e of this.edges) {
      wirePairs.push(e.v0, e.v1);
    }

    let boundaryEdges = 0;
    for (const he of this.halfEdges) {
      if (he.twin === -1) boundaryEdges++;
    }

    let zeroAreaFaces = 0;
    let ngonFaces = 0;

    for (let f = 0; f < this.faceCount; f++) {
      const hes = this.getFaceHalfEdges(f);
      if (hes.length < 3) continue;
      if (hes.length > 4) ngonFaces++;
      const [fnx, fny, fnz] = this.getFaceNormal(f);
      const baseV = (posOut.length / 3) | 0;

      for (const he of hes) {
        const v = he.origin;
        posOut.push(this.positions[v * 3], this.positions[v * 3 + 1], this.positions[v * 3 + 2]);
        if (flatShading) {
          normOut.push(fnx, fny, fnz);
        } else {
          normOut.push(smoothNormals[v * 3], smoothNormals[v * 3 + 1], smoothNormals[v * 3 + 2]);
        }
        uvOut.push(he.u, he.v);
      }

      for (let i = 1; i < hes.length - 1; i++) {
        triIdx.push(baseV, baseV + i, baseV + i + 1);
        triToFace.push(f);
      }
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    if (vCount === 0) {
      minX = minY = minZ = maxX = maxY = maxZ = 0;
    } else {
      for (let v = 0; v < vCount; v++) {
        const x = this.positions[v * 3], y = this.positions[v * 3 + 1], z = this.positions[v * 3 + 2];
        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
      }
    }
    const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
    const triCount = (triIdx.length / 3) | 0;

    return {
      positions: new Float32Array(posOut),
      normals: new Float32Array(normOut),
      uvs: new Float32Array(uvOut),
      indices: new Uint32Array(triIdx),
      triToFace: new Uint32Array(triToFace),
      wireframePairs: new Uint32Array(wirePairs),
      validation: {
        vertexCount: vCount,
        faceCount: this.faceCount,
        triangleCount: triCount,
        boundaryEdges,
        zeroAreaFaces,
        ngonFaces,
        sizeStuds: [sx, sy, sz],
        isManifold: boundaryEdges === 0,
        fitsUgc4k: triCount <= 4000,
        fitsMeshPart10k: triCount <= 10000,
        fitsExtended20k: triCount <= 20000,
        fitsMaxStuds: sx <= 2048 && sy <= 2048 && sz <= 2048,
      },
      usedWasm: false,
    };
  }
}
