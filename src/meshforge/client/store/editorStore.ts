import { create } from 'zustand';
import {
  CompiledRenderBuffers,
  HalfEdgeTopology,
  PolygonSoup,
} from '../geometry/halfEdgeMesh';
import { wasmKernel } from '../geometry/wasmKernel';
import {
  buildPrimitiveSoup,
  createDefaultSceneDocument,
  PrimitiveKind,
  serializedToSoup,
  soupToSerialized,
} from '../../shared/sceneOps';
import {
  MaterialSpec,
  McpSyncEvent,
  ProjectSummary,
  RobloxPresetId,
  SceneNodeData,
  SerializedSceneDocument,
} from '../../shared/sceneSchema';
import { parseOBJToNode } from '../../shared/exporters';

export type InteractionMode = 'object' | 'vertex' | 'edge' | 'face';
export type GizmoMode = 'translate' | 'rotate' | 'scale' | 'select';
export type ViewportShading = 'solid' | 'material' | 'wireframe';
export type BottomPanelTab = 'mcp' | 'uv' | 'assets' | 'console';
export type RightInspectorTab = 'transform' | 'modeling' | 'material' | 'roblox';

export interface RuntimeMeshCache {
  soup: PolygonSoup;
  topology: HalfEdgeTopology;
  render: CompiledRenderBuffers;
  version: number; // Incremented on geometry/topology change for O(1) incremental Three.js checks
}

interface HistorySnapshot {
  label: string;
  sceneJson: string;
  selectedNodeId: string | null;
}

export interface LogEntry {
  id: string;
  time: string;
  source: 'system' | 'wasm' | 'mcp' | 'roblox' | 'cloud';
  message: string;
  level: 'info' | 'warn' | 'success' | 'error';
}

export interface EditorState {
  // Local persistence
  projectError: string | null;
  projectId: string;
  projectRevision: number;
  isDirty: boolean;
  autosaveStatus: 'saved' | 'saving' | 'unsaved' | 'conflict' | 'offline';
  projectsList: ProjectSummary[];
  lastMcpEventId: number;
  mcpEvents: McpSyncEvent[];

  // Engine Telemetry
  wasmReady: boolean;
  rendererBackend: 'WebGL2' | 'WebGPU';
  fps: number;
  drawCalls: number;
  frameTimeMs: number;

  // Scene Document & Compiled Half-Edge Caches
  scene: SerializedSceneDocument;
  meshCache: Record<string, RuntimeMeshCache>;

  // Selection & Modes
  mode: InteractionMode;
  gizmoMode: GizmoMode;
  shading: ViewportShading;
  showWireframeOverlay: boolean;
  showGrid: boolean;
  showRobloxAvatarScale: boolean;
  snapEnabled: boolean;

  selectedNodeId: string | null;
  selectedVertices: number[];
  selectedEdges: number[];
  selectedFaces: number[];

  // UI Panels & Modals
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  bottomPanelOpen: boolean;
  bottomTab: BottomPanelTab;
  inspectorTab: RightInspectorTab;
  activeModal: 'none' | 'projects' | 'export' | 'mcp_connect';

  // Undo / Redo Stack
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  // Console Logs
  logs: LogEntry[];

  // Lifecycle & Engine Init
  initEngine: () => Promise<void>;
  addLog: (source: LogEntry['source'], message: string, level?: LogEntry['level']) => void;
  setTelemetry: (fps: number, drawCalls: number, frameTimeMs: number, backend?: 'WebGL2' | 'WebGPU') => void;

  // Mode & UI Actions
  setMode: (mode: InteractionMode) => void;
  setGizmoMode: (gizmo: GizmoMode) => void;
  setShading: (shading: ViewportShading) => void;
  toggleFlag: (flag: 'showWireframeOverlay' | 'showGrid' | 'showRobloxAvatarScale' | 'snapEnabled' | 'leftSidebarOpen' | 'rightSidebarOpen' | 'bottomPanelOpen') => void;
  setBottomTab: (tab: BottomPanelTab) => void;
  setInspectorTab: (tab: RightInspectorTab) => void;
  setActiveModal: (modal: EditorState['activeModal']) => void;

  // Selection Actions
  selectNode: (nodeId: string | null) => void;
  selectElements: (kind: 'vertex' | 'edge' | 'face', indices: number[], additive?: boolean) => void;
  selectEdgeLoop: (edgeId: number, additive?: boolean) => void;
  selectAllElements: () => void;
  clearElementSelection: () => void;

  // Scene & Object Actions
  pushUndo: (label: string) => void;
  undo: () => void;
  redo: () => void;
  addPrimitive: (kind: PrimitiveKind, params?: Record<string, number>, customName?: string) => string;
  duplicateSelectedNode: () => void;
  deleteSelected: () => void;
  updateNodeTransform: (
    nodeId: string,
    patch: Partial<Pick<SceneNodeData, 'position' | 'rotation' | 'scale' | 'name' | 'visible' | 'locked' | 'anchored' | 'canCollide' | 'collisionFidelity' | 'materialId'>>,
    recordUndo?: boolean
  ) => void;
  updateSceneSettings: (patch: Partial<Pick<SerializedSceneDocument, 'name' | 'robloxPreset' | 'exportUnitScale' | 'upAxis' | 'gridSnapStuds' | 'angleSnapDeg'>>) => void;

  // Half-Edge Sub-Object Modeling Operations
  translateSelectedElements: (deltaLocal: [number, number, number], commitLabel?: string) => void;
  scaleSelectedElements: (factor: number) => void;
  extrudeSelection: (distance: number, scale?: number) => void;
  insetSelection: (inset: number, depth?: number) => void;
  bevelSelection: (width: number) => void;
  subdivideSelectedMesh: (smooth: boolean) => void;
  loopCutSelectedMesh: (edgeId?: number, t?: number) => void;
  weldSelectedVertices: () => void;
  projectSelectedUVs: (uvMode: 'box' | 'planar' | 'cylindrical' | 'spherical', uvScale?: number) => void;
  updateVertexUV: (halfEdgeId: number, u: number, v: number) => void;
  importOBJString: (objText: string, filename: string) => void;

  // Material Actions
  updateMaterial: (matId: string, patch: Partial<MaterialSpec>) => void;
  createMaterialForSelected: () => void;

  fetchProjectsList: () => Promise<void>;
  loadProject: (id: string, discard?: boolean) => Promise<boolean>;
  createProject: (name: string, copyCurrent?: boolean) => Promise<void>;
  saveProject: () => Promise<boolean>;
  pollMcpLiveSync: () => Promise<void>;
  executeLocalMcpToolCall: (toolName: string, args: Record<string, any>) => Promise<any>;
}

function compileMeshNode(node: SceneNodeData, materials: MaterialSpec[], prevVersion = 0): RuntimeMeshCache | null {
  if (node.type !== 'mesh' || !node.soup) return null;
  const soup = serializedToSoup(node.soup);
  const topology = new HalfEdgeTopology(soup);
  const mat = materials.find((m) => m.id === node.materialId);
  const render = wasmKernel.buildRenderBuffers(soup, mat?.flatShading ?? false);
  return {
    soup,
    topology,
    render,
    version: prevVersion + 1,
  };
}

function compileFullSceneCache(doc: SerializedSceneDocument): Record<string, RuntimeMeshCache> {
  const out: Record<string, RuntimeMeshCache> = {};
  for (const n of doc.nodes) {
    const c = compileMeshNode(n, doc.materials, 0);
    if (c) out[n.id] = c;
  }
  return out;
}

const initialDoc = createDefaultSceneDocument('Roblox Starter Workspace');
const api = '/api/meshforge';
const defaultProject = 'proj_default_workspace';
const projectKey = 'syntra-meshforge-project';
let loadingProject = false;
let syncing = false;
let saveInFlight: Promise<boolean> | null = null;

export const useEditorStore = create<EditorState>((set, get) => ({
  projectError: null,
  projectId: defaultProject,
  projectRevision: 1,
  isDirty: false,
  autosaveStatus: 'saved',
  projectsList: [],
  lastMcpEventId: 0,
  mcpEvents: [],

  wasmReady: false,
  rendererBackend: 'WebGL2',
  fps: 60,
  drawCalls: 1,
  frameTimeMs: 1.2,

  scene: initialDoc,
  meshCache: compileFullSceneCache(initialDoc),

  mode: 'object',
  gizmoMode: 'translate',
  shading: 'material',
  showWireframeOverlay: true,
  showGrid: true,
  showRobloxAvatarScale: false,
  snapEnabled: true,

  selectedNodeId: initialDoc.nodes[0]?.id || null,
  selectedVertices: [],
  selectedEdges: [],
  selectedFaces: [],

  leftSidebarOpen: true,
  rightSidebarOpen: true,
  bottomPanelOpen: true,
  bottomTab: 'assets',
  inspectorTab: 'modeling',
  activeModal: 'none',

  undoStack: [],
  redoStack: [],

  logs: [
    {
      id: 'boot_1',
      time: new Date().toLocaleTimeString(),
      source: 'system',
      message: 'MeshForge Roblox 3D Engine initialized (1 unit = 1 Roblox Stud, 0.28m).',
      level: 'info',
    },
  ],

  addLog(source, message, level = 'info') {
    set((s) => ({
      logs: [
        ...s.logs.slice(-79),
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          time: new Date().toLocaleTimeString(),
          source,
          message,
          level,
        },
      ],
    }));
  },

  setTelemetry(fps, drawCalls, frameTimeMs, backend) {
    set((s) => ({
      fps,
      drawCalls,
      frameTimeMs,
      rendererBackend: backend || s.rendererBackend,
    }));
  },

  async initEngine() {
    const ready = await wasmKernel.init('/wasm/rblx_mesh_wasm.wasm');
    set((s) => ({
      wasmReady: ready,
      meshCache: compileFullSceneCache(s.scene),
    }));
    get().addLog(
      'wasm',
      ready
        ? 'Rust WebAssembly Half-Edge SIMD128 kernel online (/wasm/rblx_mesh_wasm.wasm).'
        : 'TypeScript Half-Edge fallback kernel active.',
      ready ? 'success' : 'warn'
    );

    let project = defaultProject;
    try { project = localStorage.getItem(projectKey) || defaultProject; } catch {}
    if (!get().isDirty && !(await get().loadProject(project, true)) && project !== defaultProject) {
      await get().loadProject(defaultProject, true);
    }
    await get().fetchProjectsList();
  },

  setMode(mode) {
    set({ mode });
  },
  setGizmoMode(gizmoMode) {
    set({ gizmoMode });
  },
  setShading(shading) {
    set({ shading });
  },
  toggleFlag(flag) {
    set((s) => ({ [flag]: !s[flag] } as any));
  },
  setBottomTab(bottomTab) {
    set({ bottomTab, bottomPanelOpen: true });
  },
  setInspectorTab(inspectorTab) {
    set({ inspectorTab, rightSidebarOpen: true });
  },
  setActiveModal(activeModal) {
    set({ activeModal });
  },

  selectNode(nodeId) {
    set({
      selectedNodeId: nodeId,
      selectedVertices: [],
      selectedEdges: [],
      selectedFaces: [],
    });
  },

  selectElements(kind, indices, additive = false) {
    set((s) => {
      const key =
        kind === 'vertex' ? 'selectedVertices' : kind === 'edge' ? 'selectedEdges' : 'selectedFaces';
      const current = s[key];
      if (!additive) {
        return { [key]: Array.from(new Set(indices)) } as any;
      }
      const next = new Set(current);
      for (const idx of indices) {
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
      }
      return { [key]: Array.from(next) } as any;
    });
  },

  selectEdgeLoop(edgeId, additive = false) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;
    const loop = cache.topology.getEdgeLoop(edgeId);
    get().selectElements('edge', loop, additive);
    get().addLog('wasm', `Selected quad edge ring (${loop.length} edges) from seed edge #${edgeId}.`, 'info');
  },

  selectAllElements() {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;
    if (s.mode === 'vertex') {
      set({ selectedVertices: Array.from({ length: cache.topology.vertexCount }, (_, i) => i) });
    } else if (s.mode === 'edge') {
      set({ selectedEdges: cache.topology.edges.map((e) => e.id) });
    } else if (s.mode === 'face') {
      set({ selectedFaces: Array.from({ length: cache.topology.faceCount }, (_, i) => i) });
    }
  },

  clearElementSelection() {
    set({ selectedVertices: [], selectedEdges: [], selectedFaces: [] });
  },

  pushUndo(label) {
    const s = get();
    const snap: HistorySnapshot = {
      label,
      sceneJson: JSON.stringify(s.scene),
      selectedNodeId: s.selectedNodeId,
    };
    set({
      undoStack: [...s.undoStack.slice(-39), snap],
      redoStack: [],
      isDirty: true,
      autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
    });
  },

  undo() {
    const s = get();
    if (s.undoStack.length === 0) return;
    const prev = s.undoStack[s.undoStack.length - 1];
    const currentSnap: HistorySnapshot = {
      label: 'Redo',
      sceneJson: JSON.stringify(s.scene),
      selectedNodeId: s.selectedNodeId,
    };
    const restoredDoc = JSON.parse(prev.sceneJson) as SerializedSceneDocument;
    set({
      scene: restoredDoc,
      meshCache: compileFullSceneCache(restoredDoc),
      selectedNodeId: prev.selectedNodeId,
      selectedVertices: [],
      selectedEdges: [],
      selectedFaces: [],
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, currentSnap],
      isDirty: true,
      autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
    });
    get().addLog('system', `Undo: ${prev.label}`, 'info');
  },

  redo() {
    const s = get();
    if (s.redoStack.length === 0) return;
    const next = s.redoStack[s.redoStack.length - 1];
    const currentSnap: HistorySnapshot = {
      label: 'Undo',
      sceneJson: JSON.stringify(s.scene),
      selectedNodeId: s.selectedNodeId,
    };
    const restoredDoc = JSON.parse(next.sceneJson) as SerializedSceneDocument;
    set({
      scene: restoredDoc,
      meshCache: compileFullSceneCache(restoredDoc),
      selectedNodeId: next.selectedNodeId,
      selectedVertices: [],
      selectedEdges: [],
      selectedFaces: [],
      undoStack: [...s.undoStack, currentSnap],
      redoStack: s.redoStack.slice(0, -1),
      isDirty: true,
      autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
    });
    get().addLog('system', 'Redo applied.', 'info');
  },

  addPrimitive(kind, params = {}, customName) {
    get().pushUndo(`Add ${kind}`);
    const s = get();
    const soup = buildPrimitiveSoup(kind, params);
    const id = `node_${Math.random().toString(36).slice(2, 9)}`;
    const name = customName || `${kind.charAt(0).toUpperCase() + kind.slice(1)}_${s.scene.nodes.length + 1}`;
    const yDefault = kind === 'plane' || kind === 'terrain' || kind === 'stairs' ? 0 : 2;
    const newNode: SceneNodeData = {
      id,
      name,
      parentId: null,
      type: 'mesh',
      visible: true,
      locked: false,
      anchored: true,
      canCollide: true,
      castShadow: true,
      collisionFidelity: 'Default',
      position: [0, yDefault, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      pivotOffset: [0, 0, 0],
      materialId: s.scene.materials[0]?.id || 'mat_smooth_plastic',
      soup: soupToSerialized(soup),
    };

    const nextScene: SerializedSceneDocument = {
      ...s.scene,
      nodes: [...s.scene.nodes, newNode],
    };
    const compiled = compileMeshNode(newNode, nextScene.materials, 0)!;

    set({
      scene: nextScene,
      meshCache: { ...s.meshCache, [id]: compiled },
      selectedNodeId: id,
      mode: 'object',
      selectedVertices: [],
      selectedEdges: [],
      selectedFaces: [],
    });
    get().addLog('wasm', `Added '${name}' (${compiled.render.validation.triangleCount} tris).`, 'success');
    return id;
  },

  duplicateSelectedNode() {
    const s = get();
    const orig = s.scene.nodes.find((n) => n.id === s.selectedNodeId);
    if (!orig) return;
    get().pushUndo(`Duplicate ${orig.name}`);
    const clone: SceneNodeData = JSON.parse(JSON.stringify(orig));
    clone.id = `node_${Math.random().toString(36).slice(2, 9)}`;
    clone.name = `${orig.name}_Copy`;
    clone.position = [orig.position[0] + 2, orig.position[1], orig.position[2] + 2];

    const nextScene = { ...s.scene, nodes: [...s.scene.nodes, clone] };
    const compiled = compileMeshNode(clone, nextScene.materials, 0);
    set({
      scene: nextScene,
      meshCache: compiled ? { ...s.meshCache, [clone.id]: compiled } : s.meshCache,
      selectedNodeId: clone.id,
    });
    get().addLog('system', `Duplicated '${orig.name}' -> '${clone.name}'`, 'info');
  },

  deleteSelected() {
    const s = get();
    if (!s.selectedNodeId) return;

    if (s.mode === 'face' && s.selectedFaces.length > 0) {
      get().pushUndo('Delete Faces');
      const cache = s.meshCache[s.selectedNodeId];
      if (!cache) return;
      const nextSoup = cache.topology.deleteFaces(s.selectedFaces);
      const nextNodes = s.scene.nodes.map((n) =>
        n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
      );
      const updatedNode = nextNodes.find((n) => n.id === s.selectedNodeId)!;
      const nextCache = compileMeshNode(updatedNode, s.scene.materials, cache.version)!;
      set({
        scene: { ...s.scene, nodes: nextNodes },
        meshCache: { ...s.meshCache, [s.selectedNodeId]: nextCache },
        selectedFaces: [],
      });
      get().addLog('wasm', `Deleted ${s.selectedFaces.length} polygon face(s).`, 'info');
      return;
    }

    const target = s.scene.nodes.find((n) => n.id === s.selectedNodeId);
    if (!target) return;
    get().pushUndo(`Delete ${target.name}`);
    const remaining = s.scene.nodes.filter((n) => n.id !== s.selectedNodeId).map((n) =>
      n.parentId === target.id ? { ...n, parentId: target.parentId } : n
    );
    const nextMeshCache = { ...s.meshCache };
    delete nextMeshCache[s.selectedNodeId];
    set({
      scene: { ...s.scene, nodes: remaining },
      meshCache: nextMeshCache,
      selectedNodeId: remaining[0]?.id || null,
      selectedVertices: [],
      selectedEdges: [],
      selectedFaces: [],
    });
    get().addLog('system', `Deleted object '${target.name}'.`, 'info');
  },

  updateNodeTransform(nodeId, patch, recordUndo = false) {
    if (recordUndo) get().pushUndo('Transform Node');
    set((s) => {
      const nextNodes = s.scene.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n));
      const nextScene = { ...s.scene, nodes: nextNodes };
      let nextCache = s.meshCache;
      if (patch.materialId) {
        const node = nextNodes.find((n) => n.id === nodeId);
        if (node) {
          const c = compileMeshNode(node, nextScene.materials, s.meshCache[nodeId]?.version || 0);
          if (c) nextCache = { ...s.meshCache, [nodeId]: c };
        }
      }
      return {
        scene: nextScene,
        meshCache: nextCache,
        isDirty: true,
        autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
      };
    });
  },

  updateSceneSettings(patch) {
    set((s) => ({
      scene: { ...s.scene, ...patch },
      isDirty: true,
      autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
    }));
  },

  // Half-Edge Vertex / Edge / Face Local Displacement (incremental BufferAttribute path)
  translateSelectedElements(deltaLocal, commitLabel) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;

    const affectedVerts = new Set<number>();
    if (s.mode === 'vertex') {
      s.selectedVertices.forEach((v) => affectedVerts.add(v));
    } else if (s.mode === 'edge') {
      for (const eid of s.selectedEdges) {
        const e = cache.topology.edges[eid];
        if (e) {
          affectedVerts.add(e.v0);
          affectedVerts.add(e.v1);
        }
      }
    } else if (s.mode === 'face') {
      for (const fid of s.selectedFaces) {
        cache.topology.getFaceVertices(fid).forEach((v) => affectedVerts.add(v));
      }
    }
    if (affectedVerts.size === 0) return;

    if (commitLabel) get().pushUndo(commitLabel);

    const nextCoords = new Float32Array(cache.soup.coords);
    for (const v of affectedVerts) {
      nextCoords[v * 3] += deltaLocal[0];
      nextCoords[v * 3 + 1] += deltaLocal[1];
      nextCoords[v * 3 + 2] += deltaLocal[2];
    }

    const nextSoup: PolygonSoup = {
      coords: nextCoords,
      faceCounts: cache.soup.faceCounts,
      faceIndices: cache.soup.faceIndices,
      faceUvs: cache.soup.faceUvs,
    };

    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const updatedNode = nextNodes.find((n) => n.id === s.selectedNodeId)!;
    const compiled = compileMeshNode(updatedNode, s.scene.materials, cache.version)!;

    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
      isDirty: true,
      autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
    });
  },

  scaleSelectedElements(factor) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;

    const verts = new Set<number>();
    if (s.mode === 'vertex') s.selectedVertices.forEach((v) => verts.add(v));
    else if (s.mode === 'edge') {
      s.selectedEdges.forEach((eid) => {
        const e = cache.topology.edges[eid];
        if (e) { verts.add(e.v0); verts.add(e.v1); }
      });
    } else if (s.mode === 'face') {
      s.selectedFaces.forEach((fid) => cache.topology.getFaceVertices(fid).forEach((v) => verts.add(v)));
    }
    if (verts.size === 0) return;

    get().pushUndo('Scale Elements');
    let cx = 0, cy = 0, cz = 0;
    verts.forEach((v) => {
      cx += cache.soup.coords[v * 3];
      cy += cache.soup.coords[v * 3 + 1];
      cz += cache.soup.coords[v * 3 + 2];
    });
    cx /= verts.size; cy /= verts.size; cz /= verts.size;

    const nextCoords = new Float32Array(cache.soup.coords);
    verts.forEach((v) => {
      nextCoords[v * 3] = cx + (nextCoords[v * 3] - cx) * factor;
      nextCoords[v * 3 + 1] = cy + (nextCoords[v * 3 + 1] - cy) * factor;
      nextCoords[v * 3 + 2] = cz + (nextCoords[v * 3 + 2] - cz) * factor;
    });

    const nextSoup: PolygonSoup = { ...cache.soup, coords: nextCoords };
    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;
    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
    });
  },

  extrudeSelection(distance, scale = 1.0) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;

    const targetFaces =
      s.selectedFaces.length > 0
        ? s.selectedFaces
        : [Math.min(4, Math.max(0, cache.topology.faceCount - 1))];

    get().pushUndo('Extrude Faces');
    const t0 = performance.now();
    const nextSoup = wasmKernel.extrudeFaces(cache.soup, targetFaces, distance, scale);
    const dt = (performance.now() - t0).toFixed(2);

    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;

    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
      mode: 'face',
      selectedFaces: [targetFaces[0]],
    });
    get().addLog('wasm', `Extruded ${targetFaces.length} face(s) by ${distance} studs in ${dt}ms.`, 'success');
  },

  insetSelection(inset, depth = 0) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;
    const targetFaces =
      s.selectedFaces.length > 0
        ? s.selectedFaces
        : Array.from({ length: cache.topology.faceCount }, (_, i) => i);

    get().pushUndo('Inset Faces');
    const nextSoup = wasmKernel.insetFaces(cache.soup, targetFaces, inset, depth);
    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;
    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
      selectedFaces: [],
    });
    get().addLog('wasm', `Inset ${targetFaces.length} face(s) (inset=${inset}, depth=${depth}).`, 'success');
  },

  bevelSelection(width) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;
    const targetFaces =
      s.selectedFaces.length > 0
        ? s.selectedFaces
        : Array.from({ length: cache.topology.faceCount }, (_, i) => i);

    get().pushUndo('Bevel Mesh');
    const nextSoup = wasmKernel.bevelFaces(cache.soup, targetFaces, width);
    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;
    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
      selectedFaces: [],
    });
    get().addLog('wasm', `Beveled ${targetFaces.length} face(s) (width=${width}).`, 'success');
  },

  subdivideSelectedMesh(smooth) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;
    if (cache.render.validation.triangleCount > 12000) {
      get().addLog('roblox', 'Subdivision blocked: result would exceed Roblox 20,000-triangle EditableMesh ceiling.', 'warn');
      return;
    }

    get().pushUndo(smooth ? 'Catmull-Clark Subdivide' : 'Linear Subdivide');
    const t0 = performance.now();
    const nextSoup = wasmKernel.subdivide(cache.soup, smooth);
    const dt = (performance.now() - t0).toFixed(2);

    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;
    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
      selectedVertices: [],
      selectedEdges: [],
      selectedFaces: [],
    });
    get().addLog(
      'wasm',
      `${smooth ? 'Catmull-Clark' : 'Linear'} subdivision -> ${compiled.render.validation.triangleCount} tris (${dt}ms).`,
      'success'
    );
  },

  loopCutSelectedMesh(edgeId, t = 0.5) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;
    const seed = edgeId ?? s.selectedEdges[0] ?? 0;

    get().pushUndo('Loop Cut');
    const nextSoup = cache.topology.loopCut(seed, t);
    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;
    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
      selectedEdges: [],
    });
    get().addLog('wasm', `Inserted quad edge loop cut across ring from edge #${seed} (t=${t}).`, 'success');
  },

  weldSelectedVertices() {
    const s = get();
    if (!s.selectedNodeId || s.selectedVertices.length < 2) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;

    get().pushUndo('Weld Vertices');
    const nextSoup = cache.topology.weldVertices(s.selectedVertices);
    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;
    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
      selectedVertices: [],
    });
    get().addLog('wasm', `Welded ${s.selectedVertices.length} vertices to centroid.`, 'success');
  },

  projectSelectedUVs(uvMode, uvScale = 1.0) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;

    get().pushUndo(`UV Project (${uvMode})`);
    const nextSoup = cache.topology.projectUVs(uvMode, uvScale);
    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(nextSoup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;
    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
    });
    get().addLog('wasm', `Projected ${uvMode.toUpperCase()} UVs (scale ${uvScale}).`, 'success');
  },

  updateVertexUV(halfEdgeId, u, v) {
    const s = get();
    if (!s.selectedNodeId) return;
    const cache = s.meshCache[s.selectedNodeId];
    if (!cache) return;
    const soup = cache.topology.toSoup();
    if (!soup.faceUvs || halfEdgeId * 2 + 1 >= soup.faceUvs.length) return;
    soup.faceUvs[halfEdgeId * 2] = u;
    soup.faceUvs[halfEdgeId * 2 + 1] = v;

    const nextNodes = s.scene.nodes.map((n) =>
      n.id === s.selectedNodeId ? { ...n, soup: soupToSerialized(soup) } : n
    );
    const compiled = compileMeshNode(nextNodes.find((n) => n.id === s.selectedNodeId)!, s.scene.materials, cache.version)!;
    set({
      scene: { ...s.scene, nodes: nextNodes },
      meshCache: { ...s.meshCache, [s.selectedNodeId]: compiled },
      isDirty: true,
      autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
    });
  },

  importOBJString(objText, filename) {
    const s = get();
    const cleanName = filename.replace(/\.[^.]+$/, '') || 'Imported_OBJ';
    const node = parseOBJToNode(objText, cleanName);
    get().pushUndo(`Import ${filename}`);
    node.materialId = s.scene.materials[0]?.id || 'mat_smooth_plastic';
    const nextScene = { ...s.scene, nodes: [...s.scene.nodes, node] };
    const compiled = compileMeshNode(node, nextScene.materials, 0)!;
    set({
      scene: nextScene,
      meshCache: { ...s.meshCache, [node.id]: compiled },
      selectedNodeId: node.id,
    });
    get().addLog('roblox', `Imported '${cleanName}' (${compiled.render.validation.triangleCount} triangles).`, 'success');
  },

  updateMaterial(matId, patch) {
    set((s) => {
      const nextMats = s.scene.materials.map((m) => (m.id === matId ? { ...m, ...patch } : m));
      const nextScene = { ...s.scene, materials: nextMats };
      const nextCache = { ...s.meshCache };
      for (const n of nextScene.nodes) {
        if (n.materialId === matId) {
          const c = compileMeshNode(n, nextMats, nextCache[n.id]?.version || 0);
          if (c) nextCache[n.id] = c;
        }
      }
      return {
        scene: nextScene,
        meshCache: nextCache,
        isDirty: true,
        autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
      };
    });
  },

  createMaterialForSelected() {
    const s = get();
    if (!s.selectedNodeId) return;
    get().pushUndo('New Material');
    const id = `mat_${Math.random().toString(36).slice(2, 8)}`;
    const newMat: MaterialSpec = {
      id,
      name: `Material_${s.scene.materials.length + 1}`,
      color: '#60a5fa',
      roughness: 0.35,
      metalness: 0.15,
      emissive: '#000000',
      emissiveIntensity: 0,
      opacity: 1,
      wireframe: false,
      flatShading: false,
      robloxMaterial: 'SmoothPlastic',
      texture: { pattern: 'none', scaleU: 4, scaleV: 4, secondaryColor: '#1e3a8a' },
    };
    const nextNodes = s.scene.nodes.map((n) => (n.id === s.selectedNodeId ? { ...n, materialId: id } : n));
    const nextScene = { ...s.scene, materials: [...s.scene.materials, newMat], nodes: nextNodes };
    set({
      scene: nextScene,
      isDirty: true,
      autosaveStatus: s.autosaveStatus === 'conflict' ? 'conflict' : 'unsaved',
    });
  },

  // ========================================================================
  // Local projects and live MCP sync
  async fetchProjectsList() {
    try {
      const res = await fetch(`${api}/projects`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not list mesh projects.');
      const data = await res.json();
      set({ projectsList: data.projects });
    } catch {
      set({ projectError: 'Could not list mesh projects.' });
    }
  },

  async loadProject(id, discard = false) {
    if (loadingProject) return false;
    if (!discard && get().isDirty && !(await get().saveProject())) return false;
    loadingProject = true;
    const previousScene = get().scene;
    set({ projectError: null });
    try {
      const res = await fetch(`${api}/projects/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not open this mesh project.');
      const data = await res.json();
      const doc = data.scene as SerializedSceneDocument;
      if (get().scene !== previousScene) return false;
      const meshCache = compileFullSceneCache(doc);
      try { localStorage.setItem(projectKey, data.id); } catch {}
      set({
        projectId: data.id, projectRevision: data.revision,
        scene: doc, meshCache, selectedNodeId: doc.nodes[0]?.id || null,
        selectedVertices: [], selectedEdges: [], selectedFaces: [],
        undoStack: [], redoStack: [], isDirty: false, autosaveStatus: 'saved',
        lastMcpEventId: 0, mcpEvents: [],
      });
      return true;
    } catch {
      set({ projectError: 'Could not open this mesh project.', autosaveStatus: 'offline' });
      return false;
    } finally {
      loadingProject = false;
    }
  },

  async createProject(name, copyCurrent = false) {
    const title = name.trim();
    if (!title) return;
    if (!copyCurrent && get().isDirty && !(await get().saveProject())) return;
    const scene = copyCurrent ? { ...get().scene, name: title } : createDefaultSceneDocument(title);
    try {
      const res = await fetch(`${api}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const { id } = await res.json();
      if (await get().loadProject(id, true)) set({ activeModal: 'none' });
      await get().fetchProjectsList();
    } catch (error) {
      set({ projectError: error instanceof Error ? error.message : 'Could not create this mesh project.' });
    }
  },

  async saveProject() {
    if (saveInFlight) return saveInFlight;
    const snapshot = get();
    if (loadingProject || snapshot.autosaveStatus === 'conflict') return false;
    if (!snapshot.isDirty) return true;
    set({ autosaveStatus: 'saving', projectError: null });
    saveInFlight = (async () => {
      try {
        const res = await fetch(`${api}/projects/${encodeURIComponent(snapshot.projectId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: snapshot.projectRevision, scene: snapshot.scene }),
        });
        const data = await res.json();
        if (!res.ok) {
          set({ autosaveStatus: res.status === 409 ? 'conflict' : 'unsaved', projectError: data.error });
          return false;
        }
        const unchanged = get().scene === snapshot.scene;
        set({ projectRevision: data.revision, isDirty: !unchanged, autosaveStatus: unchanged ? 'saved' : 'unsaved' });
        return unchanged;
      } catch {
        set({ autosaveStatus: 'offline', projectError: 'Save failed. Your edits are still in this tab.' });
        return false;
      }
    })();
    try {
      return await saveInFlight;
    } finally {
      saveInFlight = null;
    }
  },

  async pollMcpLiveSync() {
    const before = get();
    if (syncing || loadingProject || saveInFlight || before.isDirty) return;
    syncing = true;
    try {
      const res = await fetch(`${api}/projects/${encodeURIComponent(before.projectId)}/sync?sinceRevision=${before.projectRevision}&sinceEventId=${before.lastMcpEventId}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const current = get();
      if (current.projectId !== before.projectId || current.projectRevision !== before.projectRevision ||
        current.isDirty || loadingProject || saveInFlight) return;
      const events: McpSyncEvent[] = data.events || [];
      if (events.length) {
        set({ lastMcpEventId: events.at(-1)!.id, mcpEvents: [...current.mcpEvents, ...events].slice(-80) });
      }
      if (data.scene && data.revision > current.projectRevision) {
        const doc = data.scene as SerializedSceneDocument;
        set({
          projectRevision: data.revision, scene: doc, meshCache: compileFullSceneCache(doc),
          selectedNodeId: doc.nodes.some((node) => node.id === current.selectedNodeId) ? current.selectedNodeId : doc.nodes[0]?.id || null,
          selectedVertices: [], selectedEdges: [], selectedFaces: [], undoStack: [], redoStack: [],
        });
      }
    } catch {
      // The next visible sync can recover from a transient failure.
    } finally {
      syncing = false;
    }
  },

  async executeLocalMcpToolCall(toolName, args) {
    if (get().isDirty && !(await get().saveProject())) {
      throw new Error('Save or resolve the current scene changes first.');
    }
    const { projectId } = get();
    const res = await fetch(`${api}/tools?projectId=${encodeURIComponent(projectId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
        params: { name: toolName, arguments: { ...args, projectId } },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'MeshForge MCP request failed.');
    await get().pollMcpLiveSync();
    return data;
  },

}));
