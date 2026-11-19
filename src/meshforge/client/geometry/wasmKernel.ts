import { CompiledRenderBuffers, HalfEdgeTopology, PolygonSoup } from './halfEdgeMesh';

interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_alloc_f32(len: number): number;
  wasm_free_f32(ptr: number, len: number): void;
  wasm_alloc_u32(len: number): number;
  wasm_free_u32(ptr: number, len: number): void;
  wasm_extrude_faces(
    cPtr: number, cLen: number,
    cntPtr: number, cntLen: number,
    idxPtr: number, idxLen: number,
    selPtr: number, selLen: number,
    distance: number, scale: number
  ): number;
  wasm_inset_faces(
    cPtr: number, cLen: number,
    cntPtr: number, cntLen: number,
    idxPtr: number, idxLen: number,
    selPtr: number, selLen: number,
    inset: number, depth: number
  ): number;
  wasm_bevel_faces(
    cPtr: number, cLen: number,
    cntPtr: number, cntLen: number,
    idxPtr: number, idxLen: number,
    selPtr: number, selLen: number,
    width: number
  ): number;
  wasm_subdivide(
    cPtr: number, cLen: number,
    cntPtr: number, cntLen: number,
    idxPtr: number, idxLen: number,
    smooth: number
  ): number;
  wasm_build_render_buffers(
    cPtr: number, cLen: number,
    cntPtr: number, cntLen: number,
    idxPtr: number, idxLen: number,
    flatShading: number
  ): number;

  wasm_out_coords_ptr(): number;
  wasm_out_coords_len(): number;
  wasm_out_counts_ptr(): number;
  wasm_out_counts_len(): number;
  wasm_out_indices_ptr(): number;
  wasm_out_indices_len(): number;
  wasm_out_uvs_ptr(): number;
  wasm_out_uvs_len(): number;

  wasm_render_pos_ptr(): number;
  wasm_render_pos_len(): number;
  wasm_render_norm_ptr(): number;
  wasm_render_norm_len(): number;
  wasm_render_uv_ptr(): number;
  wasm_render_uv_len(): number;
  wasm_render_idx_ptr(): number;
  wasm_render_idx_len(): number;
  wasm_render_triface_ptr(): number;
  wasm_render_triface_len(): number;
  wasm_render_wire_ptr(): number;
  wasm_render_wire_len(): number;
  wasm_validation_ptr(): number;
}

class WasmKernelBridge {
  private exports: WasmExports | null = null;
  private loadingPromise: Promise<boolean> | null = null;

  get isReady(): boolean {
    return this.exports !== null;
  }

  async init(wasmUrl = '/wasm/rblx_mesh_wasm.wasm'): Promise<boolean> {
    if (this.exports) return true;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      try {
        const resp = await fetch(wasmUrl);
        if (!resp.ok) throw new Error(`Failed to load WASM (${resp.status})`);
        const bytes = await resp.arrayBuffer();
        const { instance } = await WebAssembly.instantiate(bytes, {});
        this.exports = instance.exports as unknown as WasmExports;
        return true;
      } catch (err) {
        console.warn('[WasmKernelBridge] Falling back to TypeScript HalfEdge kernel:', err);
        return false;
      }
    })();

    return this.loadingPromise;
  }

  private copyF32ToWasm(arr: Float32Array): number {
    const ex = this.exports!;
    const ptr = ex.wasm_alloc_f32(arr.length);
    new Float32Array(ex.memory.buffer, ptr, arr.length).set(arr);
    return ptr;
  }

  private copyU32ToWasm(arr: Uint32Array): number {
    const ex = this.exports!;
    const ptr = ex.wasm_alloc_u32(arr.length);
    new Uint32Array(ex.memory.buffer, ptr, arr.length).set(arr);
    return ptr;
  }

  private readTopologyOut(): PolygonSoup {
    const ex = this.exports!;
    const buf = ex.memory.buffer;
    const coords = new Float32Array(buf, ex.wasm_out_coords_ptr(), ex.wasm_out_coords_len()).slice();
    const faceCounts = new Uint32Array(buf, ex.wasm_out_counts_ptr(), ex.wasm_out_counts_len()).slice();
    const faceIndices = new Uint32Array(buf, ex.wasm_out_indices_ptr(), ex.wasm_out_indices_len()).slice();
    const faceUvs = new Float32Array(buf, ex.wasm_out_uvs_ptr(), ex.wasm_out_uvs_len()).slice();
    return { coords, faceCounts, faceIndices, faceUvs };
  }

  extrudeFaces(soup: PolygonSoup, selectedFaces: number[], distance: number, scale = 1.0): PolygonSoup {
    if (!this.exports || selectedFaces.length === 0) {
      return jsExtrudeFaces(soup, selectedFaces, distance, scale);
    }
    const ex = this.exports;
    const selArr = new Uint32Array(selectedFaces);
    const cPtr = this.copyF32ToWasm(soup.coords);
    const cntPtr = this.copyU32ToWasm(soup.faceCounts);
    const idxPtr = this.copyU32ToWasm(soup.faceIndices);
    const selPtr = this.copyU32ToWasm(selArr);
    try {
      ex.wasm_extrude_faces(
        cPtr, soup.coords.length,
        cntPtr, soup.faceCounts.length,
        idxPtr, soup.faceIndices.length,
        selPtr, selArr.length,
        distance, scale
      );
      return this.readTopologyOut();
    } finally {
      ex.wasm_free_f32(cPtr, soup.coords.length);
      ex.wasm_free_u32(cntPtr, soup.faceCounts.length);
      ex.wasm_free_u32(idxPtr, soup.faceIndices.length);
      ex.wasm_free_u32(selPtr, selArr.length);
    }
  }

  insetFaces(soup: PolygonSoup, selectedFaces: number[], inset: number, depth = 0): PolygonSoup {
    if (!this.exports || selectedFaces.length === 0) {
      return jsExtrudeFaces(soup, selectedFaces, depth, 1.0 - Math.max(0.02, Math.min(0.95, inset)));
    }
    const ex = this.exports;
    const selArr = new Uint32Array(selectedFaces);
    const cPtr = this.copyF32ToWasm(soup.coords);
    const cntPtr = this.copyU32ToWasm(soup.faceCounts);
    const idxPtr = this.copyU32ToWasm(soup.faceIndices);
    const selPtr = this.copyU32ToWasm(selArr);
    try {
      ex.wasm_inset_faces(
        cPtr, soup.coords.length,
        cntPtr, soup.faceCounts.length,
        idxPtr, soup.faceIndices.length,
        selPtr, selArr.length,
        inset, depth
      );
      return this.readTopologyOut();
    } finally {
      ex.wasm_free_f32(cPtr, soup.coords.length);
      ex.wasm_free_u32(cntPtr, soup.faceCounts.length);
      ex.wasm_free_u32(idxPtr, soup.faceIndices.length);
      ex.wasm_free_u32(selPtr, selArr.length);
    }
  }

  bevelFaces(soup: PolygonSoup, selectedFaces: number[], width: number): PolygonSoup {
    if (!this.exports || selectedFaces.length === 0) {
      const w = Math.max(0.02, Math.min(0.48, width));
      return jsExtrudeFaces(soup, selectedFaces, w * 0.35, 1.0 - w);
    }
    const ex = this.exports;
    const selArr = new Uint32Array(selectedFaces);
    const cPtr = this.copyF32ToWasm(soup.coords);
    const cntPtr = this.copyU32ToWasm(soup.faceCounts);
    const idxPtr = this.copyU32ToWasm(soup.faceIndices);
    const selPtr = this.copyU32ToWasm(selArr);
    try {
      ex.wasm_bevel_faces(
        cPtr, soup.coords.length,
        cntPtr, soup.faceCounts.length,
        idxPtr, soup.faceIndices.length,
        selPtr, selArr.length,
        width
      );
      return this.readTopologyOut();
    } finally {
      ex.wasm_free_f32(cPtr, soup.coords.length);
      ex.wasm_free_u32(cntPtr, soup.faceCounts.length);
      ex.wasm_free_u32(idxPtr, soup.faceIndices.length);
      ex.wasm_free_u32(selPtr, selArr.length);
    }
  }

  subdivide(soup: PolygonSoup, smooth: boolean): PolygonSoup {
    if (!this.exports) {
      return jsSubdivide(soup);
    }
    const ex = this.exports;
    const cPtr = this.copyF32ToWasm(soup.coords);
    const cntPtr = this.copyU32ToWasm(soup.faceCounts);
    const idxPtr = this.copyU32ToWasm(soup.faceIndices);
    try {
      ex.wasm_subdivide(
        cPtr, soup.coords.length,
        cntPtr, soup.faceCounts.length,
        idxPtr, soup.faceIndices.length,
        smooth ? 1 : 0
      );
      return this.readTopologyOut();
    } finally {
      ex.wasm_free_f32(cPtr, soup.coords.length);
      ex.wasm_free_u32(cntPtr, soup.faceCounts.length);
      ex.wasm_free_u32(idxPtr, soup.faceIndices.length);
    }
  }

  buildRenderBuffers(soup: PolygonSoup, flatShading: boolean): CompiledRenderBuffers {
    if (!this.exports) {
      return new HalfEdgeTopology(soup).buildRenderBuffersJS(flatShading);
    }
    const ex = this.exports;
    const cPtr = this.copyF32ToWasm(soup.coords);
    const cntPtr = this.copyU32ToWasm(soup.faceCounts);
    const idxPtr = this.copyU32ToWasm(soup.faceIndices);
    try {
      ex.wasm_build_render_buffers(
        cPtr, soup.coords.length,
        cntPtr, soup.faceCounts.length,
        idxPtr, soup.faceIndices.length,
        flatShading ? 1 : 0
      );
      const buf = ex.memory.buffer;
      const positions = new Float32Array(buf, ex.wasm_render_pos_ptr(), ex.wasm_render_pos_len()).slice();
      let uvs = new Float32Array(buf, ex.wasm_render_uv_ptr(), ex.wasm_render_uv_len()).slice();
      if (soup.faceUvs && soup.faceUvs.length === uvs.length) {
        uvs = new Float32Array(soup.faceUvs);
      }
      const normals = new Float32Array(buf, ex.wasm_render_norm_ptr(), ex.wasm_render_norm_len()).slice();
      const indices = new Uint32Array(buf, ex.wasm_render_idx_ptr(), ex.wasm_render_idx_len()).slice();
      const triToFace = new Uint32Array(buf, ex.wasm_render_triface_ptr(), ex.wasm_render_triface_len()).slice();
      const wireframePairs = new Uint32Array(buf, ex.wasm_render_wire_ptr(), ex.wasm_render_wire_len()).slice();
      const val = new Float32Array(buf, ex.wasm_validation_ptr(), 14);

      return {
        positions,
        normals,
        uvs,
        indices,
        triToFace,
        wireframePairs,
        validation: {
          vertexCount: val[0] | 0,
          faceCount: val[1] | 0,
          triangleCount: val[2] | 0,
          boundaryEdges: val[3] | 0,
          zeroAreaFaces: val[4] | 0,
          ngonFaces: val[5] | 0,
          sizeStuds: [val[6], val[7], val[8]],
          isManifold: val[9] > 0.5,
          fitsUgc4k: val[10] > 0.5,
          fitsMeshPart10k: val[11] > 0.5,
          fitsExtended20k: val[12] > 0.5,
          fitsMaxStuds: val[13] > 0.5,
        },
        usedWasm: true,
      };
    } finally {
      ex.wasm_free_f32(cPtr, soup.coords.length);
      ex.wasm_free_u32(cntPtr, soup.faceCounts.length);
      ex.wasm_free_u32(idxPtr, soup.faceIndices.length);
    }
  }
}

export const wasmKernel = new WasmKernelBridge();

function jsExtrudeFaces(soup: PolygonSoup, selectedFaces: number[], distance: number, scale: number): PolygonSoup {
  const topo = new HalfEdgeTopology(soup);
  const sel = new Set(selectedFaces);
  const coords = Array.from(topo.positions);
  const counts: number[] = [];
  const indices: number[] = [];

  for (let f = 0; f < topo.faceCount; f++) {
    const verts = topo.getFaceVertices(f);
    if (!sel.has(f)) {
      counts.push(verts.length);
      indices.push(...verts);
    } else {
      const [nx, ny, nz] = topo.getFaceNormal(f);
      const [cx, cy, cz] = topo.getFaceCenter(f);
      const topVerts: number[] = [];
      for (const v of verts) {
        const px = topo.positions[v * 3];
        const py = topo.positions[v * 3 + 1];
        const pz = topo.positions[v * 3 + 2];
        const tx = cx + (px - cx) * scale + nx * distance;
        const ty = cy + (py - cy) * scale + ny * distance;
        const tz = cz + (pz - cz) * scale + nz * distance;
        const nv = (coords.length / 3) | 0;
        coords.push(tx, ty, tz);
        topVerts.push(nv);
      }
      counts.push(topVerts.length);
      indices.push(...topVerts);
      for (let i = 0; i < verts.length; i++) {
        const v0 = verts[i];
        const v1 = verts[(i + 1) % verts.length];
        const t1 = topVerts[(i + 1) % verts.length];
        const t0 = topVerts[i];
        counts.push(4);
        indices.push(v0, v1, t1, t0);
      }
    }
  }
  return {
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
  };
}

function jsSubdivide(soup: PolygonSoup): PolygonSoup {
  const topo = new HalfEdgeTopology(soup);
  const coords = Array.from(topo.positions);
  const counts: number[] = [];
  const indices: number[] = [];
  const edgeMid = new Map<string, number>();

  const getMid = (a: number, b: number): number => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const ex = edgeMid.get(key);
    if (ex !== undefined) return ex;
    const nv = (coords.length / 3) | 0;
    coords.push(
      (topo.positions[a * 3] + topo.positions[b * 3]) * 0.5,
      (topo.positions[a * 3 + 1] + topo.positions[b * 3 + 1]) * 0.5,
      (topo.positions[a * 3 + 2] + topo.positions[b * 3 + 2]) * 0.5
    );
    edgeMid.set(key, nv);
    return nv;
  };

  for (let f = 0; f < topo.faceCount; f++) {
    const verts = topo.getFaceVertices(f);
    const [cx, cy, cz] = topo.getFaceCenter(f);
    const fp = (coords.length / 3) | 0;
    coords.push(cx, cy, cz);
    for (let i = 0; i < verts.length; i++) {
      const prev = verts[(i + verts.length - 1) % verts.length];
      const curr = verts[i];
      const next = verts[(i + 1) % verts.length];
      const ePrev = getMid(prev, curr);
      const eNext = getMid(curr, next);
      counts.push(4);
      indices.push(curr, eNext, fp, ePrev);
    }
  }

  return {
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
  };
}
