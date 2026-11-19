import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import {
  applyMaterialPreset,
  applyMeshOperationToDoc,
  buildPrimitiveSoup,
  countSceneStats,
  PrimitiveKind,
  soupToSerialized,
  validateSceneForRoblox,
} from './shared/sceneOps';
import { exportSceneToFBX, exportSceneToGLB, exportSceneToOBJ } from './shared/exporters';
import {
  RobloxCollisionFidelity,
  RobloxPresetId,
  RobloxSurfaceMaterial,
  SceneNodeData,
  SerializedSceneDocument,
} from './shared/sceneSchema';

export interface McpProjectAccessor {
  loadProject(projectId: string): Promise<{ doc: SerializedSceneDocument; revision: number }>;
  saveProject(
    projectId: string,
    doc: SerializedSceneDocument,
    expectedRevision: number,
    toolName: string,
    argsJson: string,
    summary: string,
    actor?: string
  ): Promise<number>;
}

export function createRobloxMcpServer(accessor: McpProjectAccessor, defaultProjectId: string): McpServer {
  const server = new McpServer({
    name: 'meshforge-roblox-mcp',
    version: '1.0.0',
  });

  // 1. Inspect Scene Hierarchy & Roblox Budget
  server.tool(
    'inspect_scene',
    'Inspect all 3D mesh objects, materials, transforms, and Roblox Studio compatibility metrics for a project.',
    {
      projectId: z.string().optional().describe('Target project ID (defaults to active header/query project)'),
    },
    async ({ projectId }) => {
      const pid = projectId || defaultProjectId;
      const { doc, revision } = await accessor.loadProject(pid);
      const validation = validateSceneForRoblox(doc);
      const payload = {
        projectId: pid,
        revision,
        sceneName: doc.name,
        robloxPreset: doc.robloxPreset,
        exportUnitScale: doc.exportUnitScale,
        upAxis: doc.upAxis,
        materials: doc.materials.map((m) => ({
          id: m.id,
          name: m.name,
          color: m.color,
          robloxMaterial: m.robloxMaterial,
        })),
        nodes: doc.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          visible: n.visible,
          positionStuds: n.position,
          rotationDeg: n.rotation,
          scale: n.scale,
          anchored: n.anchored,
          canCollide: n.canCollide,
          collisionFidelity: n.collisionFidelity,
          materialId: n.materialId,
          polygonCount: n.soup?.faceCounts.length ?? 0,
          vertexCount: n.soup ? (n.soup.coords.length / 3) | 0 : 0,
        })),
        validation,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    }
  );

  // 2. Create Primitive or Procedural Roblox Asset
  server.tool(
    'create_mesh_primitive',
    'Create a 3D mesh primitive or procedural Roblox asset (cube, cylinder, sphere, wedge, torus, plane, stairs, terrain, crate) in Stud units.',
    {
      projectId: z.string().optional(),
      kind: z.enum(['cube', 'plane', 'cylinder', 'sphere', 'wedge', 'torus', 'stairs', 'terrain', 'crate']),
      name: z.string().optional().describe('Node name in Roblox Workspace Outliner'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('Position [x, y, z] in Roblox Studs'),
      rotation: z.tuple([z.number(), z.number(), z.number()]).optional().describe('Euler rotation [rx, ry, rz] in degrees'),
      scale: z.tuple([z.number(), z.number(), z.number()]).optional(),
      color: z.string().optional().describe('Hex color e.g. #ef4444'),
      robloxMaterial: z
        .enum([
          'SmoothPlastic',
          'Neon',
          'Metal',
          'DiamondPlate',
          'CorrodedMetal',
          'Wood',
          'WoodPlanks',
          'Slate',
          'Concrete',
          'Brick',
          'Granite',
          'Glass',
          'ForceField',
        ])
        .optional(),
      params: z.record(z.string(), z.number()).optional().describe('Optional generator parameters (e.g. sizeX, height, steps, amplitude)'),
    },
    async (args) => {
      const pid = args.projectId || defaultProjectId;
      const { doc, revision } = await accessor.loadProject(pid);
      const subdivisions = ['segX', 'segZ', 'radialSegs', 'rings', 'segments', 'tubularSegs', 'steps', 'resolution'];
      if (subdivisions.some((key) => (args.params?.[key] ?? 1) > 128)) {
        throw new Error('Primitive subdivisions must be at most 128.');
      }
      const soup = buildPrimitiveSoup(args.kind as PrimitiveKind, args.params || {});
      const nodeId = `node_${Math.random().toString(36).slice(2, 9)}`;
      const nodeName = args.name || `${args.kind.charAt(0).toUpperCase() + args.kind.slice(1)}_${doc.nodes.length + 1}`;

      const node: SceneNodeData = {
        id: nodeId,
        name: nodeName,
        parentId: null,
        type: 'mesh',
        visible: true,
        locked: false,
        anchored: true,
        canCollide: true,
        castShadow: true,
        collisionFidelity: 'Default',
        position: args.position || [0, 2, 0],
        rotation: args.rotation || [0, 0, 0],
        scale: args.scale || [1, 1, 1],
        pivotOffset: [0, 0, 0],
        materialId: doc.materials[0]?.id || 'mat_smooth_plastic',
        soup: soupToSerialized(soup),
      };
      doc.nodes.push(node);

      if (args.color || args.robloxMaterial) {
        applyMaterialPreset(doc, nodeId, {
          color: args.color,
          robloxMaterial: args.robloxMaterial as RobloxSurfaceMaterial | undefined,
        });
      }

      const summary = `Created ${args.kind} '${nodeName}' (${nodeId}) at [${node.position.join(', ')}] studs`;
      const rev = await accessor.saveProject(pid, doc, revision, 'create_mesh_primitive', JSON.stringify(args), summary);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, revision: rev, nodeId, name: nodeName, summary }, null, 2),
          },
        ],
      };
    }
  );

  // 3. Transform / Configure Node
  server.tool(
    'transform_node',
    'Modify position (Studs), Euler rotation (deg), scale, visibility, or Roblox physics properties of a scene node.',
    {
      projectId: z.string().optional(),
      target: z.string().describe('Node ID or exact/case-insensitive node name'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional(),
      rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
      scale: z.tuple([z.number(), z.number(), z.number()]).optional(),
      name: z.string().optional(),
      anchored: z.boolean().optional(),
      canCollide: z.boolean().optional(),
      collisionFidelity: z.enum(['Default', 'Hull', 'Box', 'PreciseConvexDecomposition']).optional(),
      visible: z.boolean().optional(),
    },
    async (args) => {
      const pid = args.projectId || defaultProjectId;
      const { doc, revision } = await accessor.loadProject(pid);
      const node = doc.nodes.find(
        (n) => n.id === args.target || n.name.toLowerCase() === args.target.toLowerCase()
      );
      if (!node) {
        return { isError: true, content: [{ type: 'text', text: `Node '${args.target}' not found.` }] };
      }
      if (args.position) node.position = args.position;
      if (args.rotation) node.rotation = args.rotation;
      if (args.scale) node.scale = args.scale;
      if (args.name) node.name = args.name;
      if (args.anchored !== undefined) node.anchored = args.anchored;
      if (args.canCollide !== undefined) node.canCollide = args.canCollide;
      if (args.collisionFidelity) node.collisionFidelity = args.collisionFidelity as RobloxCollisionFidelity;
      if (args.visible !== undefined) node.visible = args.visible;

      const summary = `Updated transform/properties of '${node.name}'`;
      const rev = await accessor.saveProject(pid, doc, revision, 'transform_node', JSON.stringify(args), summary);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, revision: rev, node: { id: node.id, name: node.name, position: node.position, rotation: node.rotation, scale: node.scale } }, null, 2) }],
      };
    }
  );

  // 4. Topological Half-Edge Mesh Editing (Extrude, Inset, Bevel, Subdivide, Loop Cut, Project UVs)
  server.tool(
    'edit_mesh_topology',
    'Execute Blender-like half-edge topological operations (extrude, inset, bevel, subdivide, loop_cut, project_uvs) on a mesh.',
    {
      projectId: z.string().optional(),
      target: z.string().describe('Target mesh node ID or name'),
      operation: z.enum(['extrude', 'inset', 'bevel', 'subdivide', 'loop_cut', 'project_uvs']),
      faces: z.array(z.number().int().nonnegative()).optional().describe('Polygon face indices to operate on'),
      distance: z.number().optional().describe('Extrusion distance in Studs'),
      scale: z.number().optional().describe('Extrusion cap scale factor (default 1.0)'),
      inset: z.number().optional().describe('Inset factor 0.05..0.9'),
      depth: z.number().optional().describe('Inset depth offset in Studs'),
      width: z.number().optional().describe('Bevel chamfer width 0.02..0.45'),
      smooth: z.boolean().optional().describe('True for Catmull-Clark smooth subdivision, false for linear quad split'),
      edgeId: z.number().int().nonnegative().optional().describe('Seed edge ID for loop_cut'),
      t: z.number().min(0.05).max(0.95).optional().describe('Loop cut slide factor (default 0.5)'),
      uvMode: z.enum(['box', 'planar', 'cylindrical', 'spherical']).optional(),
      uvScale: z.number().optional(),
    },
    async (args) => {
      const pid = args.projectId || defaultProjectId;
      const { doc, revision } = await accessor.loadProject(pid);
      const { updatedNode, summary } = applyMeshOperationToDoc(doc, args.target, args.operation, args);
      const rev = await accessor.saveProject(pid, doc, revision, 'edit_mesh_topology', JSON.stringify(args), summary);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: true,
                revision: rev,
                summary,
                vertexCount: updatedNode.soup ? (updatedNode.soup.coords.length / 3) | 0 : 0,
                faceCount: updatedNode.soup?.faceCounts.length ?? 0,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // 5. Assign Material & Procedural Surface Texture
  server.tool(
    'assign_roblox_material',
    'Assign PBR + Roblox SurfaceMaterial (SmoothPlastic, Neon, Metal, DiamondPlate, Wood, etc.) and procedural UV pattern.',
    {
      projectId: z.string().optional(),
      target: z.string(),
      color: z.string().describe('Hex color #rrggbb'),
      robloxMaterial: z
        .enum([
          'SmoothPlastic',
          'Neon',
          'Metal',
          'DiamondPlate',
          'CorrodedMetal',
          'Wood',
          'WoodPlanks',
          'Slate',
          'Concrete',
          'Brick',
          'Granite',
          'Glass',
          'ForceField',
        ])
        .optional(),
      roughness: z.number().min(0).max(1).optional(),
      metalness: z.number().min(0).max(1).optional(),
      pattern: z.enum(['none', 'studs', 'checker', 'grid', 'noise', 'brushed_metal']).optional(),
    },
    async (args) => {
      const pid = args.projectId || defaultProjectId;
      const { doc, revision } = await accessor.loadProject(pid);
      const summary = applyMaterialPreset(doc, args.target, args);
      const rev = await accessor.saveProject(pid, doc, revision, 'assign_roblox_material', JSON.stringify(args), summary);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, revision: rev, summary }, null, 2) }],
      };
    }
  );

  // 6. Delete Node
  server.tool(
    'delete_node',
    'Delete a mesh or folder node from the scene.',
    {
      projectId: z.string().optional(),
      target: z.string(),
    },
    async ({ projectId, target }) => {
      const pid = projectId || defaultProjectId;
      const { doc, revision } = await accessor.loadProject(pid);
      const idx = doc.nodes.findIndex((n) => n.id === target || n.name.toLowerCase() === target.toLowerCase());
      if (idx < 0) {
        return { isError: true, content: [{ type: 'text', text: `Node '${target}' not found.` }] };
      }
      const [removed] = doc.nodes.splice(idx, 1);
      for (const node of doc.nodes) {
        if (node.parentId === removed.id) node.parentId = removed.parentId;
      }
      const summary = `Deleted node '${removed.name}' (${removed.id})`;
      const rev = await accessor.saveProject(pid, doc, revision, 'delete_node', JSON.stringify({ target }), summary);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, revision: rev, summary }, null, 2) }],
      };
    }
  );

  // 7. Validate Roblox Compatibility
  server.tool(
    'validate_roblox_compatibility',
    'Validate scene against Roblox Studio triangle budgets (4k UGC, 10k MeshPart, 20k EditableMesh), 2048-stud max bounds, and manifold cage integrity.',
    {
      projectId: z.string().optional(),
      preset: z.enum(['MeshPart_Standard', 'EditableMesh_20k', 'UGC_Accessory_4k', 'Avatar_Cage_Outer']).optional(),
    },
    async ({ projectId, preset }) => {
      const pid = projectId || defaultProjectId;
      const { doc, revision } = await accessor.loadProject(pid);
      if (preset) doc.robloxPreset = preset as RobloxPresetId;
      const report = validateSceneForRoblox(doc);
      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }],
      };
    }
  );

  // 8. Export Model (OBJ, GLB, FBX)
  server.tool(
    'export_roblox_model',
    'Export the current scene or selected nodes to OBJ, binary GLB (base64), or Autodesk FBX 7.4 ASCII with Roblox Stud/Meter scaling.',
    {
      projectId: z.string().optional(),
      format: z.enum(['obj', 'glb', 'fbx']),
      scalePreset: z.enum(['studs_1_0', 'meters_0_28', 'centimeters_28_0']).optional(),
      upAxis: z.enum(['Y', 'Z']).optional(),
    },
    async ({ projectId, format, scalePreset, upAxis }) => {
      const pid = projectId || defaultProjectId;
      const { doc, revision } = await accessor.loadProject(pid);
      const stats = countSceneStats(doc);

      if (format === 'obj') {
        const { obj, mtl } = exportSceneToOBJ(doc, { scalePreset, upAxis });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ format: 'obj', stats, objPreviewLength: obj.length, obj, mtl }, null, 2),
            },
          ],
        };
      }
      if (format === 'fbx') {
        const fbx = exportSceneToFBX(doc, { scalePreset, upAxis });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ format: 'fbx', stats, byteLength: fbx.length, fbx }, null, 2),
            },
          ],
        };
      }
      const glb = exportSceneToGLB(doc, { scalePreset, upAxis });
      let binary = '';
      for (let i = 0; i < glb.byteLength; i++) binary += String.fromCharCode(glb[i]);
      const base64 = btoa(binary);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ format: 'glb', stats, byteLength: glb.byteLength, glbBase64: base64 }, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

export async function handleMcpHttpRequest(
  req: Request,
  accessor: McpProjectAccessor,
  defaultProjectId: string,
  parsedBody: unknown,
): Promise<Response> {
  const server = createRobloxMcpServer(accessor, defaultProjectId);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless Edge Worker mode: zero sticky-isolate requirement!
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req, { parsedBody });
}
