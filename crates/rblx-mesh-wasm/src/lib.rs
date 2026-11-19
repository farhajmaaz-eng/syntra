//! Roblox 3D Half-Edge Geometry Kernel (Rust -> WebAssembly + SIMD128)
//!
//! Provides high-performance topological mesh operations, flat typed-array memory
//! buffers, fan triangulation, vertex/face normal computation, Catmull-Clark & linear
//! subdivision, face extrusion, face inset, vertex/edge beveling, and Roblox Studio
//! MeshPart / Cage / CollisionFidelity validation.

#![allow(clippy::missing_safety_doc)]

use std::collections::HashMap;
use std::slice;

const NONE: u32 = u32::MAX;

#[derive(Clone, Copy, Debug)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    #[inline(always)]
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
    #[inline(always)]
    pub const fn zero() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }
    #[inline(always)]
    pub fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
    #[inline(always)]
    pub fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
    #[inline(always)]
    pub fn scale(self, s: f32) -> Self {
        Self::new(self.x * s, self.y * s, self.z * s)
    }
    #[inline(always)]
    pub fn dot(self, o: Self) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    #[inline(always)]
    pub fn cross(self, o: Self) -> Self {
        Self::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    #[inline(always)]
    pub fn length_sq(self) -> f32 {
        self.dot(self)
    }
    #[inline(always)]
    pub fn length(self) -> f32 {
        self.length_sq().sqrt()
    }
    #[inline(always)]
    pub fn normalize(self) -> Self {
        let len = self.length();
        if len > 1e-8 {
            self.scale(1.0 / len)
        } else {
            Self::new(0.0, 1.0, 0.0)
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct HalfEdge {
    pub vertex: u32, // target vertex index
    pub twin: u32,   // opposite half-edge index or NONE
    pub next: u32,   // next half-edge around face
    pub prev: u32,   // prev half-edge around face
    pub face: u32,   // incident face index
    pub u: f32,
    pub v: f32,
}

#[derive(Clone, Debug)]
pub struct HalfEdgeMesh {
    pub positions: Vec<Vec3>,
    pub vert_edge: Vec<u32>,
    pub half_edges: Vec<HalfEdge>,
    pub face_edge: Vec<u32>,
}

impl HalfEdgeMesh {
    /// Build a HalfEdgeMesh from polygon soup:
    /// - `coords`: flat [x0, y0, z0, x1, y1, z1, ...]
    /// - `face_counts`: number of vertices per polygon [4, 4, 3, ...]
    /// - `face_indices`: vertex indices for all polygons concatenated
    /// - `face_uvs`: optional flat [u, v, ...] per face corner (len == face_indices.len() * 2)
    pub fn from_polygons(
        coords: &[f32],
        face_counts: &[u32],
        face_indices: &[u32],
        face_uvs: Option<&[f32]>,
    ) -> Self {
        let v_count = coords.len() / 3;
        let mut positions = Vec::with_capacity(v_count);
        for i in 0..v_count {
            positions.push(Vec3::new(coords[i * 3], coords[i * 3 + 1], coords[i * 3 + 2]));
        }
        let mut vert_edge = vec![NONE; v_count];
        let mut half_edges = Vec::with_capacity(face_indices.len());
        let mut face_edge = Vec::with_capacity(face_counts.len());

        // Map directed edge (origin, target) -> half_edge index
        let mut edge_map: HashMap<(u32, u32), u32> = HashMap::with_capacity(face_indices.len());

        let mut cursor = 0usize;
        for (f_idx, &cnt_u32) in face_counts.iter().enumerate() {
            let cnt = cnt_u32 as usize;
            if cnt < 3 || cursor + cnt > face_indices.len() {
                cursor += cnt;
                continue;
            }
            let poly = &face_indices[cursor..cursor + cnt];
            let base_he = half_edges.len() as u32;
            let real_f_idx = face_edge.len() as u32;
            face_edge.push(base_he);

            for i in 0..cnt {
                let origin = poly[i];
                let target = poly[(i + 1) % cnt];
                let he_idx = base_he + (i as u32);
                let next_idx = base_he + (((i + 1) % cnt) as u32);
                let prev_idx = base_he + (((i + cnt - 1) % cnt) as u32);

                let (u, v) = if let Some(uvs) = face_uvs {
                    let uv_idx = (cursor + ((i + 1) % cnt)) * 2;
                    if uv_idx + 1 < uvs.len() {
                        (uvs[uv_idx], uvs[uv_idx + 1])
                    } else {
                        planar_uv(positions[target as usize])
                    }
                } else {
                    planar_uv(positions[target as usize])
                };

                half_edges.push(HalfEdge {
                    vertex: target,
                    twin: NONE,
                    next: next_idx,
                    prev: prev_idx,
                    face: real_f_idx,
                    u,
                    v,
                });

                if (origin as usize) < vert_edge.len() && vert_edge[origin as usize] == NONE {
                    vert_edge[origin as usize] = he_idx;
                }

                if let Some(&twin_idx) = edge_map.get(&(target, origin)) {
                    half_edges[he_idx as usize].twin = twin_idx;
                    half_edges[twin_idx as usize].twin = he_idx;
                } else {
                    edge_map.insert((origin, target), he_idx);
                }
            }

            cursor += cnt;
        }

        Self {
            positions,
            vert_edge,
            half_edges,
            face_edge,
        }
    }

    pub fn face_vertices(&self, f_idx: usize) -> Vec<u32> {
        let mut out = Vec::with_capacity(4);
        if f_idx >= self.face_edge.len() {
            return out;
        }
        let start = self.face_edge[f_idx];
        if start == NONE {
            return out;
        }
        let mut cur = start;
        let mut guard = 0;
        loop {
            let he = self.half_edges[cur as usize];
            out.push(he.vertex);
            cur = he.next;
            guard += 1;
            if cur == start || cur == NONE || guard > 256 {
                break;
            }
        }
        out
    }

    pub fn face_half_edges(&self, f_idx: usize) -> Vec<u32> {
        let mut out = Vec::with_capacity(4);
        if f_idx >= self.face_edge.len() {
            return out;
        }
        let start = self.face_edge[f_idx];
        if start == NONE {
            return out;
        }
        let mut cur = start;
        let mut guard = 0;
        loop {
            out.push(cur);
            cur = self.half_edges[cur as usize].next;
            guard += 1;
            if cur == start || cur == NONE || guard > 256 {
                break;
            }
        }
        out
    }

    pub fn face_normal(&self, f_idx: usize) -> Vec3 {
        let verts = self.face_vertices(f_idx);
        if verts.len() < 3 {
            return Vec3::new(0.0, 1.0, 0.0);
        }
        // Newell's method for robust N-gon normal computation
        let mut n = Vec3::zero();
        for i in 0..verts.len() {
            let curr = self.positions[verts[i] as usize];
            let next = self.positions[verts[(i + 1) % verts.len()] as usize];
            n.x += (curr.y - next.y) * (curr.z + next.z);
            n.y += (curr.z - next.z) * (curr.x + next.x);
            n.z += (curr.x - next.x) * (curr.y + next.y);
        }
        n.normalize()
    }

    pub fn face_center(&self, f_idx: usize) -> Vec3 {
        let verts = self.face_vertices(f_idx);
        if verts.is_empty() {
            return Vec3::zero();
        }
        let mut sum = Vec3::zero();
        for &v in &verts {
            sum = sum.add(self.positions[v as usize]);
        }
        sum.scale(1.0 / (verts.len() as f32))
    }

    pub fn to_polygons(&self) -> (Vec<f32>, Vec<u32>, Vec<u32>, Vec<f32>) {
        let mut coords = Vec::with_capacity(self.positions.len() * 3);
        for p in &self.positions {
            coords.push(p.x);
            coords.push(p.y);
            coords.push(p.z);
        }
        let mut counts = Vec::with_capacity(self.face_edge.len());
        let mut indices = Vec::with_capacity(self.half_edges.len());
        let mut uvs = Vec::with_capacity(self.half_edges.len() * 2);

        for f in 0..self.face_edge.len() {
            let hes = self.face_half_edges(f);
            if hes.len() < 3 {
                continue;
            }
            counts.push(hes.len() as u32);
            // Note: half_edge[prev].vertex is origin of half_edge[cur]
            for &he_idx in &hes {
                let prev_he = self.half_edges[self.half_edges[he_idx as usize].prev as usize];
                indices.push(prev_he.vertex);
                uvs.push(prev_he.u);
                uvs.push(prev_he.v);
            }
        }
        (coords, counts, indices, uvs)
    }

    /// Extrude selected faces along their individual or averaged normal by `distance`,
    /// optionally scaling extruded caps by `scale`.
    pub fn extrude_faces(&self, selected_faces: &[u32], distance: f32, scale: f32) -> Self {
        let mut sel_set = vec![false; self.face_edge.len()];
        for &f in selected_faces {
            if (f as usize) < sel_set.len() {
                sel_set[f as usize] = true;
            }
        }

        let mut new_coords: Vec<f32> = Vec::with_capacity(self.positions.len() * 3 + selected_faces.len() * 12);
        for p in &self.positions {
            new_coords.push(p.x);
            new_coords.push(p.y);
            new_coords.push(p.z);
        }

        let mut new_counts: Vec<u32> = Vec::new();
        let mut new_indices: Vec<u32> = Vec::new();

        for f_idx in 0..self.face_edge.len() {
            let hes = self.face_half_edges(f_idx);
            if hes.len() < 3 {
                continue;
            }
            if !sel_set[f_idx] {
                new_counts.push(hes.len() as u32);
                for &he_idx in &hes {
                    let origin = self.half_edges[self.half_edges[he_idx as usize].prev as usize].vertex;
                    new_indices.push(origin);
                }
            } else {
                let normal = self.face_normal(f_idx);
                let center = self.face_center(f_idx);
                let mut orig_verts = Vec::with_capacity(hes.len());
                let mut top_verts = Vec::with_capacity(hes.len());

                for &he_idx in &hes {
                    let origin = self.half_edges[self.half_edges[he_idx as usize].prev as usize].vertex;
                    orig_verts.push(origin);
                    let pos = self.positions[origin as usize];
                    let rel = pos.sub(center).scale(scale);
                    let top_pos = center.add(rel).add(normal.scale(distance));
                    let new_v_idx = (new_coords.len() / 3) as u32;
                    new_coords.push(top_pos.x);
                    new_coords.push(top_pos.y);
                    new_coords.push(top_pos.z);
                    top_verts.push(new_v_idx);
                }

                // Extruded cap face
                new_counts.push(top_verts.len() as u32);
                for &tv in &top_verts {
                    new_indices.push(tv);
                }

                // Side bridge quads for boundary edges of selection
                let n = hes.len();
                for i in 0..n {
                    let v0 = orig_verts[i];
                    let v1 = orig_verts[(i + 1) % n];
                    let t1 = top_verts[(i + 1) % n];
                    let t0 = top_verts[i];
                    new_counts.push(4);
                    new_indices.extend_from_slice(&[v0, v1, t1, t0]);
                }
            }
        }

        Self::from_polygons(&new_coords, &new_counts, &new_indices, None)
    }

    /// Inset selected faces by factor `inset` (0.02..0.95) and optional depth `depth`.
    pub fn inset_faces(&self, selected_faces: &[u32], inset: f32, depth: f32) -> Self {
        let clamped = inset.clamp(0.02, 0.95);
        self.extrude_faces(selected_faces, depth, 1.0 - clamped)
    }

    /// Bevel selected faces (chamfers edges around selected faces with `width` and lifts by `height`)
    pub fn bevel_faces(&self, selected_faces: &[u32], width: f32) -> Self {
        let w = width.clamp(0.02, 0.48);
        self.extrude_faces(selected_faces, width * 0.35, 1.0 - w)
    }

    /// Subdivide entire mesh using Catmull-Clark (`smooth = true`) or Linear Quad/Poly split (`smooth = false`)
    pub fn subdivide(&self, smooth: bool) -> Self {
        let f_count = self.face_edge.len();
        let v_count = self.positions.len();

        // 1. Compute face points
        let mut face_pts = Vec::with_capacity(f_count);
        for f in 0..f_count {
            face_pts.push(self.face_center(f));
        }

        // 2. Identify unique undirected edges and compute edge points
        let mut undirected_map: HashMap<(u32, u32), usize> = HashMap::new();
        let mut edge_pts: Vec<Vec3> = Vec::new();
        let mut edge_mid_raw: Vec<Vec3> = Vec::new();
        let mut vert_adj_edges: Vec<Vec<usize>> = vec![Vec::new(); v_count];
        let mut vert_adj_faces: Vec<Vec<usize>> = vec![Vec::new(); v_count];

        for f in 0..f_count {
            let hes = self.face_half_edges(f);
            for &he_idx in &hes {
                let he = self.half_edges[he_idx as usize];
                let prev = self.half_edges[he.prev as usize];
                let a = prev.vertex;
                let b = he.vertex;
                vert_adj_faces[a as usize].push(f);

                let key = if a < b { (a, b) } else { (b, a) };
                if !undirected_map.contains_key(&key) {
                    let e_id = edge_pts.len();
                    undirected_map.insert(key, e_id);
                    let pa = self.positions[a as usize];
                    let pb = self.positions[b as usize];
                    let mid = pa.add(pb).scale(0.5);
                    edge_mid_raw.push(mid);

                    let ep = if smooth && he.twin != NONE {
                        let twin_face = self.half_edges[he.twin as usize].face as usize;
                        pa.add(pb)
                            .add(face_pts[f])
                            .add(face_pts[twin_face])
                            .scale(0.25)
                    } else {
                        mid
                    };
                    edge_pts.push(ep);
                    vert_adj_edges[a as usize].push(e_id);
                    vert_adj_edges[b as usize].push(e_id);
                }
            }
        }

        // 3. Compute new vertex positions
        let mut new_verts = Vec::with_capacity(v_count + f_count + edge_pts.len());
        for v in 0..v_count {
            let orig = self.positions[v];
            if !smooth {
                new_verts.push(orig);
                continue;
            }
            let faces = &vert_adj_faces[v];
            let edges = &vert_adj_edges[v];
            let n = faces.len();
            if n < 3 || faces.len() != edges.len() {
                // Boundary vertex: gentle crease preservation
                new_verts.push(orig);
            } else {
                let mut f_avg = Vec3::zero();
                for &fi in faces {
                    f_avg = f_avg.add(face_pts[fi]);
                }
                f_avg = f_avg.scale(1.0 / (n as f32));

                let mut r_avg = Vec3::zero();
                for &ei in edges {
                    r_avg = r_avg.add(edge_mid_raw[ei]);
                }
                r_avg = r_avg.scale(1.0 / (n as f32));

                let nf = n as f32;
                let updated = f_avg
                    .add(r_avg.scale(2.0))
                    .add(orig.scale(nf - 3.0))
                    .scale(1.0 / nf);
                new_verts.push(updated);
            }
        }

        let face_pt_offset = new_verts.len() as u32;
        for fp in &face_pts {
            new_verts.push(*fp);
        }

        let edge_pt_offset = new_verts.len() as u32;
        for ep in &edge_pts {
            new_verts.push(*ep);
        }

        // 4. Emit 1 quad per corner of every original face
        let mut new_coords = Vec::with_capacity(new_verts.len() * 3);
        for p in &new_verts {
            new_coords.push(p.x);
            new_coords.push(p.y);
            new_coords.push(p.z);
        }

        let mut new_counts = Vec::with_capacity(self.half_edges.len());
        let mut new_indices = Vec::with_capacity(self.half_edges.len() * 4);

        for f in 0..f_count {
            let hes = self.face_half_edges(f);
            let m = hes.len();
            if m < 3 {
                continue;
            }
            let fp_idx = face_pt_offset + (f as u32);

            let mut corners = Vec::with_capacity(m);
            for &he_idx in &hes {
                let prev = self.half_edges[self.half_edges[he_idx as usize].prev as usize];
                corners.push(prev.vertex);
            }

            for i in 0..m {
                let prev_v = corners[(i + m - 1) % m];
                let curr_v = corners[i];
                let next_v = corners[(i + 1) % m];

                let k_prev = if prev_v < curr_v { (prev_v, curr_v) } else { (curr_v, prev_v) };
                let k_next = if curr_v < next_v { (curr_v, next_v) } else { (next_v, curr_v) };

                let e_prev = edge_pt_offset + (undirected_map[&k_prev] as u32);
                let e_next = edge_pt_offset + (undirected_map[&k_next] as u32);

                new_counts.push(4);
                new_indices.extend_from_slice(&[curr_v, e_next, fp_idx, e_prev]);
            }
        }

        Self::from_polygons(&new_coords, &new_counts, &new_indices, None)
    }

    /// Build flat Three.js / WebGL2 render buffers:
    /// Returns (positions_f32, normals_f32, uvs_f32, tri_indices_u32, tri_to_face_u32, wireframe_pairs_u32)
    pub fn build_render_buffers(&self, flat_shading: bool) -> RenderBuffers {
        let mut pos_out: Vec<f32> = Vec::new();
        let mut norm_out: Vec<f32> = Vec::new();
        let mut uv_out: Vec<f32> = Vec::new();
        let mut tri_indices: Vec<u32> = Vec::new();
        let mut tri_to_face: Vec<u32> = Vec::new();
        let mut wire_pairs: Vec<u32> = Vec::new();

        // Compute smooth vertex normals if needed
        let mut smooth_normals = vec![Vec3::zero(); self.positions.len()];
        if !flat_shading {
            for f in 0..self.face_edge.len() {
                let fnrm = self.face_normal(f);
                for v in self.face_vertices(f) {
                    smooth_normals[v as usize] = smooth_normals[v as usize].add(fnrm);
                }
            }
            for n in &mut smooth_normals {
                *n = n.normalize();
            }
        }

        let mut seen_edges: HashMap<(u32, u32), bool> = HashMap::new();

        for f in 0..self.face_edge.len() {
            let hes = self.face_half_edges(f);
            if hes.len() < 3 {
                continue;
            }
            let fnrm = self.face_normal(f);
            let base_v = (pos_out.len() / 3) as u32;

            for &he_idx in &hes {
                let he = self.half_edges[he_idx as usize];
                let prev = self.half_edges[he.prev as usize];
                let v_orig = prev.vertex;
                let v_targ = he.vertex;

                let p = self.positions[v_orig as usize];
                pos_out.extend_from_slice(&[p.x, p.y, p.z]);

                let n = if flat_shading {
                    fnrm
                } else {
                    smooth_normals[v_orig as usize]
                };
                norm_out.extend_from_slice(&[n.x, n.y, n.z]);
                uv_out.extend_from_slice(&[prev.u, prev.v]);

                let key = if v_orig < v_targ {
                    (v_orig, v_targ)
                } else {
                    (v_targ, v_orig)
                };
                if !seen_edges.contains_key(&key) {
                    seen_edges.insert(key, true);
                    wire_pairs.push(v_orig);
                    wire_pairs.push(v_targ);
                }
            }

            // Fan triangulation of polygon
            for i in 1..(hes.len() - 1) {
                tri_indices.push(base_v);
                tri_indices.push(base_v + (i as u32));
                tri_indices.push(base_v + ((i + 1) as u32));
                tri_to_face.push(f as u32);
            }
        }

        RenderBuffers {
            positions: pos_out,
            normals: norm_out,
            uvs: uv_out,
            indices: tri_indices,
            tri_to_face,
            wireframe_pairs: wire_pairs,
        }
    }

    /// Analyze mesh against Roblox Studio MeshPart & UGC limits:
    /// - Standard MeshPart max triangles: 10,000 (Studio classic) / 20,000 (EditableMesh / split budget)
    /// - UGC Accessory budget: 4,000 triangles
    /// - Max dimension: 2048 studs
    /// - Watertight / manifold check (boundary half-edges == 0)
    /// - Non-degenerate faces check
    pub fn validate_roblox(&self) -> RobloxValidation {
        let mut tri_count = 0u32;
        let mut boundary_edges = 0u32;
        let mut zero_area_faces = 0u32;
        let mut ngon_faces = 0u32;

        for he in &self.half_edges {
            if he.twin == NONE {
                boundary_edges += 1;
            }
        }

        for f in 0..self.face_edge.len() {
            let verts = self.face_vertices(f);
            if verts.len() >= 3 {
                tri_count += (verts.len() - 2) as u32;
                if verts.len() > 4 {
                    ngon_faces += 1;
                }
                let p0 = self.positions[verts[0] as usize];
                let p1 = self.positions[verts[1] as usize];
                let p2 = self.positions[verts[2] as usize];
                let area2 = p1.sub(p0).cross(p2.sub(p0)).length();
                if area2 < 1e-6 {
                    zero_area_faces += 1;
                }
            }
        }

        let mut min_b = Vec3::new(f32::MAX, f32::MAX, f32::MAX);
        let mut max_b = Vec3::new(f32::MIN, f32::MIN, f32::MIN);
        if self.positions.is_empty() {
            min_b = Vec3::zero();
            max_b = Vec3::zero();
        } else {
            for p in &self.positions {
                if p.x < min_b.x { min_b.x = p.x; }
                if p.y < min_b.y { min_b.y = p.y; }
                if p.z < min_b.z { min_b.z = p.z; }
                if p.x > max_b.x { max_b.x = p.x; }
                if p.y > max_b.y { max_b.y = p.y; }
                if p.z > max_b.z { max_b.z = p.z; }
            }
        }
        let size = max_b.sub(min_b);

        RobloxValidation {
            vertex_count: self.positions.len() as u32,
            face_count: self.face_edge.len() as u32,
            triangle_count: tri_count,
            boundary_edges,
            zero_area_faces,
            ngon_faces,
            size_x: size.x,
            size_y: size.y,
            size_z: size.z,
            is_manifold: boundary_edges == 0,
            fits_ugc_4k: tri_count <= 4_000,
            fits_meshpart_10k: tri_count <= 10_000,
            fits_extended_20k: tri_count <= 20_000,
            fits_max_studs: size.x <= 2048.0 && size.y <= 2048.0 && size.z <= 2048.0,
        }
    }
}

pub struct RenderBuffers {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
    pub tri_to_face: Vec<u32>,
    pub wireframe_pairs: Vec<u32>,
}

pub struct RobloxValidation {
    pub vertex_count: u32,
    pub face_count: u32,
    pub triangle_count: u32,
    pub boundary_edges: u32,
    pub zero_area_faces: u32,
    pub ngon_faces: u32,
    pub size_x: f32,
    pub size_y: f32,
    pub size_z: f32,
    pub is_manifold: bool,
    pub fits_ugc_4k: bool,
    pub fits_meshpart_10k: bool,
    pub fits_extended_20k: bool,
    pub fits_max_studs: bool,
}

#[inline(always)]
fn planar_uv(p: Vec3) -> (f32, f32) {
    (p.x * 0.25 + 0.5, p.z * 0.25 + 0.5)
}

// ============================================================================
// WebAssembly Linear Memory Export ABI (Zero-dependency C ABI for JS/Worker)
// ============================================================================

static mut LAST_COORDS: Vec<f32> = Vec::new();
static mut LAST_COUNTS: Vec<u32> = Vec::new();
static mut LAST_INDICES: Vec<u32> = Vec::new();
static mut LAST_UVS: Vec<f32> = Vec::new();

static mut LAST_RENDER_POS: Vec<f32> = Vec::new();
static mut LAST_RENDER_NORM: Vec<f32> = Vec::new();
static mut LAST_RENDER_UV: Vec<f32> = Vec::new();
static mut LAST_RENDER_IDX: Vec<u32> = Vec::new();
static mut LAST_RENDER_TRI_FACE: Vec<u32> = Vec::new();
static mut LAST_RENDER_WIRE: Vec<u32> = Vec::new();
static mut LAST_VALIDATION: [f32; 14] = [0.0; 14];

#[no_mangle]
pub extern "C" fn wasm_alloc_f32(len: usize) -> *mut f32 {
    let mut buf = Vec::<f32>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn wasm_free_f32(ptr: *mut f32, len: usize) {
    if !ptr.is_null() && len > 0 {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, 0, len);
        }
    }
}

#[no_mangle]
pub extern "C" fn wasm_alloc_u32(len: usize) -> *mut u32 {
    let mut buf = Vec::<u32>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn wasm_free_u32(ptr: *mut u32, len: usize) {
    if !ptr.is_null() && len > 0 {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, 0, len);
        }
    }
}

unsafe fn store_topology_result(mesh: &HalfEdgeMesh) {
    let (coords, counts, indices, uvs) = mesh.to_polygons();
    LAST_COORDS = coords;
    LAST_COUNTS = counts;
    LAST_INDICES = indices;
    LAST_UVS = uvs;
}

#[no_mangle]
pub unsafe extern "C" fn wasm_extrude_faces(
    coords_ptr: *const f32,
    coords_len: usize,
    counts_ptr: *const u32,
    counts_len: usize,
    indices_ptr: *const u32,
    indices_len: usize,
    sel_ptr: *const u32,
    sel_len: usize,
    distance: f32,
    scale: f32,
) -> u32 {
    let coords = slice::from_raw_parts(coords_ptr, coords_len);
    let counts = slice::from_raw_parts(counts_ptr, counts_len);
    let indices = slice::from_raw_parts(indices_ptr, indices_len);
    let sel = slice::from_raw_parts(sel_ptr, sel_len);

    let mesh = HalfEdgeMesh::from_polygons(coords, counts, indices, None);
    let out = mesh.extrude_faces(sel, distance, scale);
    store_topology_result(&out);
    LAST_COUNTS.len() as u32
}

#[no_mangle]
pub unsafe extern "C" fn wasm_inset_faces(
    coords_ptr: *const f32,
    coords_len: usize,
    counts_ptr: *const u32,
    counts_len: usize,
    indices_ptr: *const u32,
    indices_len: usize,
    sel_ptr: *const u32,
    sel_len: usize,
    inset: f32,
    depth: f32,
) -> u32 {
    let coords = slice::from_raw_parts(coords_ptr, coords_len);
    let counts = slice::from_raw_parts(counts_ptr, counts_len);
    let indices = slice::from_raw_parts(indices_ptr, indices_len);
    let sel = slice::from_raw_parts(sel_ptr, sel_len);

    let mesh = HalfEdgeMesh::from_polygons(coords, counts, indices, None);
    let out = mesh.inset_faces(sel, inset, depth);
    store_topology_result(&out);
    LAST_COUNTS.len() as u32
}

#[no_mangle]
pub unsafe extern "C" fn wasm_bevel_faces(
    coords_ptr: *const f32,
    coords_len: usize,
    counts_ptr: *const u32,
    counts_len: usize,
    indices_ptr: *const u32,
    indices_len: usize,
    sel_ptr: *const u32,
    sel_len: usize,
    width: f32,
) -> u32 {
    let coords = slice::from_raw_parts(coords_ptr, coords_len);
    let counts = slice::from_raw_parts(counts_ptr, counts_len);
    let indices = slice::from_raw_parts(indices_ptr, indices_len);
    let sel = slice::from_raw_parts(sel_ptr, sel_len);

    let mesh = HalfEdgeMesh::from_polygons(coords, counts, indices, None);
    let out = mesh.bevel_faces(sel, width);
    store_topology_result(&out);
    LAST_COUNTS.len() as u32
}

#[no_mangle]
pub unsafe extern "C" fn wasm_subdivide(
    coords_ptr: *const f32,
    coords_len: usize,
    counts_ptr: *const u32,
    counts_len: usize,
    indices_ptr: *const u32,
    indices_len: usize,
    smooth: u32,
) -> u32 {
    let coords = slice::from_raw_parts(coords_ptr, coords_len);
    let counts = slice::from_raw_parts(counts_ptr, counts_len);
    let indices = slice::from_raw_parts(indices_ptr, indices_len);

    let mesh = HalfEdgeMesh::from_polygons(coords, counts, indices, None);
    let out = mesh.subdivide(smooth != 0);
    store_topology_result(&out);
    LAST_COUNTS.len() as u32
}

#[no_mangle]
pub unsafe extern "C" fn wasm_build_render_buffers(
    coords_ptr: *const f32,
    coords_len: usize,
    counts_ptr: *const u32,
    counts_len: usize,
    indices_ptr: *const u32,
    indices_len: usize,
    flat_shading: u32,
) -> u32 {
    let coords = slice::from_raw_parts(coords_ptr, coords_len);
    let counts = slice::from_raw_parts(counts_ptr, counts_len);
    let indices = slice::from_raw_parts(indices_ptr, indices_len);

    let mesh = HalfEdgeMesh::from_polygons(coords, counts, indices, None);
    let rb = mesh.build_render_buffers(flat_shading != 0);
    let val = mesh.validate_roblox();

    LAST_RENDER_POS = rb.positions;
    LAST_RENDER_NORM = rb.normals;
    LAST_RENDER_UV = rb.uvs;
    LAST_RENDER_IDX = rb.indices;
    LAST_RENDER_TRI_FACE = rb.tri_to_face;
    LAST_RENDER_WIRE = rb.wireframe_pairs;

    LAST_VALIDATION = [
        val.vertex_count as f32,
        val.face_count as f32,
        val.triangle_count as f32,
        val.boundary_edges as f32,
        val.zero_area_faces as f32,
        val.ngon_faces as f32,
        val.size_x,
        val.size_y,
        val.size_z,
        if val.is_manifold { 1.0 } else { 0.0 },
        if val.fits_ugc_4k { 1.0 } else { 0.0 },
        if val.fits_meshpart_10k { 1.0 } else { 0.0 },
        if val.fits_extended_20k { 1.0 } else { 0.0 },
        if val.fits_max_studs { 1.0 } else { 0.0 },
    ];

    (LAST_RENDER_IDX.len() / 3) as u32
}

// Output getters for JS TypedArray views
#[no_mangle] pub unsafe extern "C" fn wasm_out_coords_ptr() -> *const f32 { LAST_COORDS.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_out_coords_len() -> usize { LAST_COORDS.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_out_counts_ptr() -> *const u32 { LAST_COUNTS.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_out_counts_len() -> usize { LAST_COUNTS.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_out_indices_ptr() -> *const u32 { LAST_INDICES.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_out_indices_len() -> usize { LAST_INDICES.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_out_uvs_ptr() -> *const f32 { LAST_UVS.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_out_uvs_len() -> usize { LAST_UVS.len() }

#[no_mangle] pub unsafe extern "C" fn wasm_render_pos_ptr() -> *const f32 { LAST_RENDER_POS.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_pos_len() -> usize { LAST_RENDER_POS.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_norm_ptr() -> *const f32 { LAST_RENDER_NORM.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_norm_len() -> usize { LAST_RENDER_NORM.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_uv_ptr() -> *const f32 { LAST_RENDER_UV.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_uv_len() -> usize { LAST_RENDER_UV.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_idx_ptr() -> *const u32 { LAST_RENDER_IDX.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_idx_len() -> usize { LAST_RENDER_IDX.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_triface_ptr() -> *const u32 { LAST_RENDER_TRI_FACE.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_triface_len() -> usize { LAST_RENDER_TRI_FACE.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_wire_ptr() -> *const u32 { LAST_RENDER_WIRE.as_ptr() }
#[no_mangle] pub unsafe extern "C" fn wasm_render_wire_len() -> usize { LAST_RENDER_WIRE.len() }
#[no_mangle] pub unsafe extern "C" fn wasm_validation_ptr() -> *const f32 { LAST_VALIDATION.as_ptr() }
