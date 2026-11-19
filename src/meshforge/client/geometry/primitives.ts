import { PolygonSoup, HalfEdgeTopology } from './halfEdgeMesh';

/**
 * Procedural & Primitive Mesh Generators (calibrated in Roblox Studs; 1 unit = 1 Stud)
 */

export function createCubeSoup(sizeX = 4, sizeY = 4, sizeZ = 4): PolygonSoup {
  const hx = sizeX * 0.5;
  const hy = sizeY * 0.5;
  const hz = sizeZ * 0.5;
  const coords = new Float32Array([
    -hx, -hy, -hz, // 0
     hx, -hy, -hz, // 1
     hx,  hy, -hz, // 2
    -hx,  hy, -hz, // 3
    -hx, -hy,  hz, // 4
     hx, -hy,  hz, // 5
     hx,  hy,  hz, // 6
    -hx,  hy,  hz, // 7
  ]);
  const faceCounts = new Uint32Array([4, 4, 4, 4, 4, 4]);
  const faceIndices = new Uint32Array([
    4, 5, 6, 7, // +Z front
    1, 0, 3, 2, // -Z back
    5, 1, 2, 6, // +X right
    0, 4, 7, 3, // -X left
    7, 6, 2, 3, // +Y top
    0, 1, 5, 4, // -Y bottom
  ]);
  return new HalfEdgeTopology({ coords, faceCounts, faceIndices }).projectUVs('box', 1);
}

export function createPlaneSoup(width = 8, depth = 8, segX = 4, segZ = 4): PolygonSoup {
  const sx = Math.max(1, segX | 0);
  const sz = Math.max(1, segZ | 0);
  const coords: number[] = [];
  for (let z = 0; z <= sz; z++) {
    const pz = ((z / sz) - 0.5) * depth;
    for (let x = 0; x <= sx; x++) {
      const px = ((x / sx) - 0.5) * width;
      coords.push(px, 0, pz);
    }
  }
  const counts: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const row = sx + 1;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const v0 = z * row + x;
      const v1 = v0 + 1;
      const v2 = v0 + row + 1;
      const v3 = v0 + row;
      counts.push(4);
      indices.push(v0, v3, v2, v1);
      uvs.push(
        x / sx, z / sz,
        x / sx, (z + 1) / sz,
        (x + 1) / sx, (z + 1) / sz,
        (x + 1) / sx, z / sz
      );
    }
  }
  return {
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
    faceUvs: new Float32Array(uvs),
  };
}

export function createCylinderSoup(radiusTop = 2, radiusBottom = 2, height = 4, radialSegs = 16): PolygonSoup {
  const seg = Math.max(3, radialSegs | 0);
  const hy = height * 0.5;
  const coords: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    coords.push(Math.cos(a) * radiusBottom, -hy, Math.sin(a) * radiusBottom);
  }
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    coords.push(Math.cos(a) * radiusTop, hy, Math.sin(a) * radiusTop);
  }
  const counts: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < seg; i++) {
    const next = (i + 1) % seg;
    // CCW outward side quad
    counts.push(4);
    indices.push(next, i, i + seg, next + seg);
  }
  // Top cap
  if (radiusTop > 1e-4) {
    counts.push(seg);
    for (let i = seg - 1; i >= 0; i--) indices.push(seg + i);
  }
  // Bottom cap
  counts.push(seg);
  for (let i = 0; i < seg; i++) indices.push(i);

  return new HalfEdgeTopology({
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
  }).projectUVs('cylindrical', 1);
}

export function createSphereSoup(radius = 2, rings = 10, segments = 16): PolygonSoup {
  const rSeg = Math.max(4, rings | 0);
  const sSeg = Math.max(6, segments | 0);
  const coords: number[] = [];
  coords.push(0, radius, 0); // 0 = north pole
  for (let r = 1; r < rSeg; r++) {
    const phi = (r / rSeg) * Math.PI;
    const y = Math.cos(phi) * radius;
    const sinP = Math.sin(phi) * radius;
    for (let s = 0; s < sSeg; s++) {
      const theta = (s / sSeg) * Math.PI * 2;
      coords.push(Math.cos(theta) * sinP, y, Math.sin(theta) * sinP);
    }
  }
  const southIdx = (coords.length / 3) | 0;
  coords.push(0, -radius, 0);

  const counts: number[] = [];
  const indices: number[] = [];

  // North cap tris
  for (let s = 0; s < sSeg; s++) {
    const next = (s + 1) % sSeg;
    counts.push(3);
    indices.push(0, 1 + next, 1 + s);
  }

  // Quad bands
  for (let r = 0; r < rSeg - 2; r++) {
    const rowA = 1 + r * sSeg;
    const rowB = rowA + sSeg;
    for (let s = 0; s < sSeg; s++) {
      const next = (s + 1) % sSeg;
      counts.push(4);
      indices.push(rowA + s, rowA + next, rowB + next, rowB + s);
    }
  }

  // South cap tris
  const lastRow = 1 + (rSeg - 2) * sSeg;
  for (let s = 0; s < sSeg; s++) {
    const next = (s + 1) % sSeg;
    counts.push(3);
    indices.push(lastRow + s, lastRow + next, southIdx);
  }

  return new HalfEdgeTopology({
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
  }).projectUVs('spherical', 1);
}

export function createWedgeSoup(sizeX = 4, sizeY = 4, sizeZ = 4): PolygonSoup {
  // Classic Roblox WedgePart
  const hx = sizeX * 0.5, hy = sizeY * 0.5, hz = sizeZ * 0.5;
  const coords = new Float32Array([
    -hx, -hy, -hz, // 0 back-bottom-left
     hx, -hy, -hz, // 1 back-bottom-right
     hx,  hy, -hz, // 2 back-top-right
    -hx,  hy, -hz, // 3 back-top-left
    -hx, -hy,  hz, // 4 front-bottom-left
     hx, -hy,  hz, // 5 front-bottom-right
  ]);
  const faceCounts = new Uint32Array([4, 4, 4, 3, 3]);
  const faceIndices = new Uint32Array([
    0, 1, 5, 4, // bottom
    1, 0, 3, 2, // vertical back
    4, 5, 2, 3, // sloped ramp
    5, 1, 2,    // right tri
    0, 4, 3,    // left tri
  ]);
  return new HalfEdgeTopology({ coords, faceCounts, faceIndices }).projectUVs('box', 1);
}

export function createTorusSoup(majorRadius = 2.5, minorRadius = 0.8, radialSegs = 12, tubularSegs = 20): PolygonSoup {
  const R = majorRadius;
  const r = minorRadius;
  const coords: number[] = [];
  for (let j = 0; j < tubularSegs; j++) {
    const u = (j / tubularSegs) * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let i = 0; i < radialSegs; i++) {
      const v = (i / radialSegs) * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      coords.push((R + r * cv) * cu, r * sv, (R + r * cv) * su);
    }
  }
  const counts: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j < tubularSegs; j++) {
    const jNext = (j + 1) % tubularSegs;
    for (let i = 0; i < radialSegs; i++) {
      const iNext = (i + 1) % radialSegs;
      const a = j * radialSegs + i;
      const b = jNext * radialSegs + i;
      const c = jNext * radialSegs + iNext;
      const d = j * radialSegs + iNext;
      counts.push(4);
      indices.push(a, d, c, b);
    }
  }
  return new HalfEdgeTopology({
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
  }).projectUVs('cylindrical', 1);
}

/**
 * Procedural Roblox Game Asset Generators
 */
export function createProceduralStairsSoup(steps = 8, width = 6, height = 6, depth = 8): PolygonSoup {
  const n = Math.max(2, Math.min(48, steps | 0));
  const hx = width * 0.5;
  const coords: number[] = [];
  const counts: number[] = [];
  const indices: number[] = [];

  const stepH = height / n;
  const stepD = depth / n;

  // Profile points along (y, z) on left (-hx) and right (+hx)
  // Bottom-back: (0, -depth/2), Bottom-front: (0, +depth/2)
  const profile: Array<[number, number]> = [[0, depth * 0.5]];
  for (let i = 0; i < n; i++) {
    const zFront = depth * 0.5 - i * stepD;
    const zBack = zFront - stepD;
    const yTop = (i + 1) * stepH;
    profile.push([yTop, zFront]);
    profile.push([yTop, zBack]);
  }
  profile.push([0, -depth * 0.5]);

  const m = profile.length;
  for (let i = 0; i < m; i++) {
    coords.push(-hx, profile[i][0], profile[i][1]); // left ring: 0..m-1
  }
  for (let i = 0; i < m; i++) {
    coords.push(hx, profile[i][0], profile[i][1]); // right ring: m..2m-1
  }

  // Perimeter quads connecting left and right profiles
  for (let i = 0; i < m; i++) {
    const next = (i + 1) % m;
    counts.push(4);
    indices.push(i, next, m + next, m + i);
  }

  // Left & Right side caps (decomposed into per-step column quads so faces stay convex!)
  // Instead of 1 concave N-gon, emit vertical column quads for each step
  const baseV = (coords.length / 3) | 0;
  for (let i = 0; i < n; i++) {
    const zFront = depth * 0.5 - i * stepD;
    const zBack = zFront - stepD;
    const yTop = (i + 1) * stepH;
    // Left quad
    const l0 = baseV + i * 8;
    coords.push(
      -hx, 0, zFront,
      -hx, 0, zBack,
      -hx, yTop, zBack,
      -hx, yTop, zFront,
      hx, 0, zFront,
      hx, 0, zBack,
      hx, yTop, zBack,
      hx, yTop, zFront
    );
    counts.push(4, 4);
    indices.push(l0, l0 + 3, l0 + 2, l0 + 1);
    indices.push(l0 + 4, l0 + 5, l0 + 6, l0 + 7);
  }

  return new HalfEdgeTopology({
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
  }).projectUVs('box', 1);
}

export function createProceduralTerrainChunkSoup(
  size = 16,
  resolution = 16,
  amplitude = 2.4,
  frequency = 0.35,
  seed = 42
): PolygonSoup {
  const seg = Math.max(2, Math.min(64, resolution | 0));
  const coords: number[] = [];
  const counts: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  const hash2d = (x: number, z: number) => {
    const s = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smoothNoise = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2d(ix, iz);
    const b = hash2d(ix + 1, iz);
    const c = hash2d(ix, iz + 1);
    const d = hash2d(ix + 1, iz + 1);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  };

  for (let z = 0; z <= seg; z++) {
    const pz = ((z / seg) - 0.5) * size;
    for (let x = 0; x <= seg; x++) {
      const px = ((x / seg) - 0.5) * size;
      const n1 = smoothNoise(px * frequency, pz * frequency);
      const n2 = smoothNoise(px * frequency * 2.1, pz * frequency * 2.1) * 0.5;
      const py = ((n1 + n2) / 1.5 - 0.35) * amplitude;
      coords.push(px, py, pz);
    }
  }

  const row = seg + 1;
  for (let z = 0; z < seg; z++) {
    for (let x = 0; x < seg; x++) {
      const v0 = z * row + x;
      const v1 = v0 + 1;
      const v2 = v0 + row + 1;
      const v3 = v0 + row;
      counts.push(4);
      indices.push(v0, v3, v2, v1);
      uvs.push(
        x / seg, z / seg,
        x / seg, (z + 1) / seg,
        (x + 1) / seg, (z + 1) / seg,
        (x + 1) / seg, z / seg
      );
    }
  }

  return {
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
    faceUvs: new Float32Array(uvs),
  };
}

export function createProceduralCrateRigSoup(size = 4, frameInset = 0.22, recessDepth = -0.22): PolygonSoup {
  // Creates a Roblox sci-fi / industrial crate by insetting & extruding all 6 faces of a cube
  const cube = createCubeSoup(size, size, size);
  const topo = new HalfEdgeTopology(cube);
  const coords = Array.from(topo.positions);
  const counts: number[] = [];
  const indices: number[] = [];
  const scale = 1 - Math.max(0.05, Math.min(0.45, frameInset));

  for (let f = 0; f < topo.faceCount; f++) {
    const verts = topo.getFaceVertices(f);
    const [nx, ny, nz] = topo.getFaceNormal(f);
    const [cx, cy, cz] = topo.getFaceCenter(f);
    const inner: number[] = [];
    for (const v of verts) {
      const px = topo.positions[v * 3];
      const py = topo.positions[v * 3 + 1];
      const pz = topo.positions[v * 3 + 2];
      const nv = (coords.length / 3) | 0;
      coords.push(
        cx + (px - cx) * scale + nx * recessDepth,
        cy + (py - cy) * scale + ny * recessDepth,
        cz + (pz - cz) * scale + nz * recessDepth
      );
      inner.push(nv);
    }
    counts.push(4);
    indices.push(...inner);
    for (let i = 0; i < 4; i++) {
      counts.push(4);
      indices.push(verts[i], verts[(i + 1) % 4], inner[(i + 1) % 4], inner[i]);
    }
  }

  return new HalfEdgeTopology({
    coords: new Float32Array(coords),
    faceCounts: new Uint32Array(counts),
    faceIndices: new Uint32Array(indices),
  }).projectUVs('box', 1);
}

export function createRobloxAvatarBoundsReference(): PolygonSoup {
  // Standard R15 Roblox character bounding reference (5 studs tall, 4 studs wide, 2 studs deep)
  return createCubeSoup(4, 5, 2);
}
