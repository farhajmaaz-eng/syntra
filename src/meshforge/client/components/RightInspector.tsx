import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Layers,
  Palette,
  Plus,
  ShieldCheck,
  Sliders,
  Wrench,
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { validateSceneForRoblox } from '../../shared/sceneOps';
import {
  RobloxCollisionFidelity,
  RobloxPresetId,
  RobloxSurfaceMaterial,
} from '../../shared/sceneSchema';

const ROBLOX_MATERIALS: RobloxSurfaceMaterial[] = [
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
];

const COLLISION_MODES: RobloxCollisionFidelity[] = [
  'Default',
  'Hull',
  'Box',
  'PreciseConvexDecomposition',
];

export const RightInspector: React.FC = () => {
  const rightOpen = useEditorStore((s) => s.rightSidebarOpen);
  const tab = useEditorStore((s) => s.inspectorTab);
  const scene = useEditorStore((s) => s.scene);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const meshCache = useEditorStore((s) => s.meshCache);
  const mode = useEditorStore((s) => s.mode);
  const selectedVertices = useEditorStore((s) => s.selectedVertices);
  const selectedEdges = useEditorStore((s) => s.selectedEdges);
  const selectedFaces = useEditorStore((s) => s.selectedFaces);

  // Modeling tool numeric parameter states
  const [extrudeDist, setExtrudeDist] = useState(1.0);
  const [extrudeScale, setExtrudeScale] = useState(1.0);
  const [insetFactor, setInsetFactor] = useState(0.22);
  const [insetDepth, setInsetDepth] = useState(0.0);
  const [bevelWidth, setBevelWidth] = useState(0.18);
  const [loopSlide, setLoopSlide] = useState(0.5);
  const [uvScale, setUvScale] = useState(1.0);

  // Procedural generator parameter states
  const [stairsSteps, setStairsSteps] = useState(8);
  const [stairsHeight, setStairsHeight] = useState(6);
  const [terrainAmp, setTerrainAmp] = useState(2.4);
  const [terrainRes, setTerrainRes] = useState(16);

  const validation = useMemo(
    () => rightOpen && tab === 'roblox' ? validateSceneForRoblox(scene) : null,
    [rightOpen, tab, scene],
  );
  if (!rightOpen) return null;

  const selectedNode = scene.nodes.find((n) => n.id === selectedNodeId) || null;
  const activeCache = selectedNodeId ? meshCache[selectedNodeId] : undefined;
  const activeMaterial = selectedNode
    ? scene.materials.find((m) => m.id === selectedNode.materialId) || scene.materials[0]
    : scene.materials[0];

  return (
    <aside
      id="right-properties-inspector"
      className="w-72 bg-[var(--sidebar-bg)] border-l border-[var(--border)] flex flex-col h-full shrink-0 text-[12px]"
    >
      {/* Inspector Tab Bar */}
      <div className="grid grid-cols-4 bg-[var(--sidebar-bg)] border-b border-[var(--border)] text-[11px]">
        {(
          [
            { id: 'modeling', label: 'Mesh', icon: Wrench },
            { id: 'transform', label: 'Object', icon: Sliders },
            { id: 'material', label: 'Material', icon: Palette },
            { id: 'roblox', label: 'Roblox', icon: ShieldCheck },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => useEditorStore.getState().setInspectorTab(t.id)}
              className={`flex items-center justify-center gap-1 py-2 border-b-2 transition-colors ${
                active
                  ? 'border-[var(--mesh-accent-fill)] bg-[#191c22] text-white font-medium'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Inspector Body */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-3">
        {/* ================================================================
            TAB 1: HALF-EDGE MESH MODELING & PROCEDURAL GENERATORS
           ================================================================ */}
        {tab === 'modeling' && (
          <>
            {/* Active Topology Summary */}
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Half-Edge Topology
                </span>
                <span className="text-[10px] font-mono text-[#34d399]">
                  {activeCache?.render.usedWasm ? 'Rust WASM' : 'TS Kernel'}
                </span>
              </div>
              {selectedNode && activeCache ? (
                <div className="grid grid-cols-3 gap-1 pt-1 font-mono text-[11px]">
                  <div className="bg-[var(--sidebar-bg)] p-1.5 rounded border border-[var(--border)]">
                    <div className="text-[var(--text-muted)] text-[9.5px]">VERTS</div>
                    <div className="text-white font-semibold">
                      {activeCache.topology.vertexCount}
                    </div>
                  </div>
                  <div className="bg-[var(--sidebar-bg)] p-1.5 rounded border border-[var(--border)]">
                    <div className="text-[var(--text-muted)] text-[9.5px]">EDGES</div>
                    <div className="text-white font-semibold">
                      {activeCache.topology.edges.length}
                    </div>
                  </div>
                  <div className="bg-[var(--sidebar-bg)] p-1.5 rounded border border-[var(--border)]">
                    <div className="text-[var(--text-muted)] text-[9.5px]">FACES</div>
                    <div className="text-white font-semibold">
                      {activeCache.topology.faceCount}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-[var(--text-muted)]">Select a MeshPart to edit topology.</div>
              )}

              {selectedNode && (
                <div className="pt-1 flex items-center justify-between text-[11px] font-mono text-[var(--text-secondary)]">
                  <span>
                    Selected:{' '}
                    {mode === 'vertex'
                      ? `${selectedVertices.length} verts`
                      : mode === 'edge'
                      ? `${selectedEdges.length} edges`
                      : mode === 'face'
                      ? `${selectedFaces.length} faces`
                      : 'Object'}
                  </span>
                  {mode !== 'object' && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => useEditorStore.getState().selectAllElements()}
                        className="px-1.5 py-0.5 bg-[var(--surface-raised)] hover:bg-[var(--border)] rounded text-[10px] text-[var(--text-primary)]"
                      >
                        All (A)
                      </button>
                      <button
                        onClick={() => useEditorStore.getState().clearElementSelection()}
                        className="px-1.5 py-0.5 bg-[var(--surface-raised)] hover:bg-[var(--border)] rounded text-[10px] text-[var(--text-primary)]"
                      >
                        None
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Extrude Faces */}
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Extrude & Inset (WASM)
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <label className="space-y-0.5">
                  <span className="text-[var(--text-muted)] text-[10px]">Distance (st)</span>
                  <input
                    type="number"
                    step="0.25"
                    value={extrudeDist}
                    onChange={(e) => setExtrudeDist(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[var(--text-muted)] text-[10px]">Cap Scale</span>
                  <input
                    type="number"
                    step="0.05"
                    value={extrudeScale}
                    onChange={(e) => setExtrudeScale(parseFloat(e.target.value) || 1)}
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                  />
                </label>
              </div>
              <button
                disabled={!selectedNode}
                onClick={() => useEditorStore.getState().extrudeSelection(extrudeDist, extrudeScale)}
                className="w-full py-1.5 bg-[var(--mesh-accent-fill)] hover:bg-[var(--mesh-accent-fill)] disabled:opacity-40 text-white font-medium rounded-md"
              >
                Extrude Selected Faces (E)
              </button>

              <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                <label className="space-y-0.5">
                  <span className="text-[var(--text-muted)] text-[10px]">Inset (0.05..0.9)</span>
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="0.9"
                    value={insetFactor}
                    onChange={(e) => setInsetFactor(parseFloat(e.target.value) || 0.2)}
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[var(--text-muted)] text-[10px]">Depth (st)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={insetDepth}
                    onChange={(e) => setInsetDepth(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                  />
                </label>
              </div>
              <button
                disabled={!selectedNode}
                onClick={() => useEditorStore.getState().insetSelection(insetFactor, insetDepth)}
                className="w-full py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] disabled:opacity-40 text-[var(--text-primary)] rounded-md"
              >
                Inset Faces (I)
              </button>
            </div>

            {/* Bevel, Subdivide, Loop Cut & Weld */}
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Bevel / Subdivide / Loop Cut
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.04"
                  min="0.04"
                  max="0.45"
                  value={bevelWidth}
                  onChange={(e) => setBevelWidth(parseFloat(e.target.value) || 0.18)}
                  className="w-20 bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-[11px] text-white"
                />
                <button
                  disabled={!selectedNode}
                  onClick={() => useEditorStore.getState().bevelSelection(bevelWidth)}
                  className="flex-1 py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] disabled:opacity-40 text-[var(--text-primary)] rounded-md"
                >
                  Bevel Faces (B)
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="0.9"
                  value={loopSlide}
                  onChange={(e) => setLoopSlide(parseFloat(e.target.value) || 0.5)}
                  className="w-20 bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-[11px] text-white"
                />
                <button
                  disabled={!selectedNode}
                  onClick={() => useEditorStore.getState().loopCutSelectedMesh(undefined, loopSlide)}
                  className="flex-1 py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] disabled:opacity-40 text-[var(--text-primary)] rounded-md"
                >
                  Quad Loop Cut
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  disabled={!selectedNode}
                  onClick={() => useEditorStore.getState().subdivideSelectedMesh(false)}
                  className="py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] disabled:opacity-40 text-[var(--text-primary)] rounded-md text-[11px]"
                >
                  Linear Subdiv
                </button>
                <button
                  disabled={!selectedNode}
                  onClick={() => useEditorStore.getState().subdivideSelectedMesh(true)}
                  className="py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] disabled:opacity-40 text-[var(--text-primary)] rounded-md text-[11px]"
                >
                  Catmull-Clark
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  disabled={selectedVertices.length < 2}
                  onClick={() => useEditorStore.getState().weldSelectedVertices()}
                  className="py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] disabled:opacity-40 text-[var(--text-primary)] rounded-md text-[11px]"
                >
                  Weld Verts (M)
                </button>
                <button
                  disabled={!selectedNode || mode === 'object'}
                  onClick={() => useEditorStore.getState().scaleSelectedElements(0.85)}
                  className="py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] disabled:opacity-40 text-[var(--text-primary)] rounded-md text-[11px]"
                >
                  Shrink Sel 15%
                </button>
              </div>
            </div>

            {/* UV Projection */}
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  UV Unwrap / Projection
                </span>
                <input
                  type="number"
                  step="0.25"
                  value={uvScale}
                  onChange={(e) => setUvScale(parseFloat(e.target.value) || 1)}
                  className="w-14 bg-[var(--app-bg)] border border-[var(--border)] rounded px-1 py-0.5 font-mono text-[10px] text-white"
                  title="UV Tiling Scale"
                />
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(['box', 'planar', 'cylindrical', 'spherical'] as const).map((uMode) => (
                  <button
                    key={uMode}
                    disabled={!selectedNode}
                    onClick={() => useEditorStore.getState().projectSelectedUVs(uMode, uvScale)}
                    className="py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] rounded text-[11px] capitalize text-[var(--text-primary)]"
                  >
                    {uMode} UV
                  </button>
                ))}
              </div>
            </div>

            {/* Parametric Procedural Roblox Generators */}
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Procedural Roblox Generators
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <label className="space-y-0.5">
                  <span className="text-[var(--text-muted)] text-[10px]">Stair Steps</span>
                  <input
                    type="number"
                    min="2"
                    max="32"
                    value={stairsSteps}
                    onChange={(e) => setStairsSteps(parseInt(e.target.value, 10) || 8)}
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[var(--text-muted)] text-[10px]">Height (st)</span>
                  <input
                    type="number"
                    step="1"
                    value={stairsHeight}
                    onChange={(e) => setStairsHeight(parseFloat(e.target.value) || 6)}
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                  />
                </label>
              </div>
              <button
                onClick={() =>
                  useEditorStore
                    .getState()
                    .addPrimitive('stairs', { steps: stairsSteps, height: stairsHeight, width: 6, depth: stairsSteps })
                }
                className="w-full py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] rounded-md text-[11px] text-[var(--text-primary)]"
              >
                Generate Parametric Staircase
              </button>

              <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-1">
                <label className="space-y-0.5">
                  <span className="text-[var(--text-muted)] text-[10px]">Terrain Res</span>
                  <input
                    type="number"
                    min="4"
                    max="48"
                    value={terrainRes}
                    onChange={(e) => setTerrainRes(parseInt(e.target.value, 10) || 16)}
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                  />
                </label>
                <label className="space-y-0.5">
                  <span className="text-[var(--text-muted)] text-[10px]">Amp (st)</span>
                  <input
                    type="number"
                    step="0.4"
                    value={terrainAmp}
                    onChange={(e) => setTerrainAmp(parseFloat(e.target.value) || 2.4)}
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                  />
                </label>
              </div>
              <button
                onClick={() =>
                  useEditorStore.getState().addPrimitive('terrain', {
                    size: 16,
                    resolution: terrainRes,
                    amplitude: terrainAmp,
                    seed: Math.floor(Math.random() * 999),
                  })
                }
                className="w-full py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] rounded-md text-[11px] text-[var(--text-primary)]"
              >
                Generate Noise Terrain Chunk
              </button>
            </div>
          </>
        )}

        {/* ================================================================
            TAB 2: OBJECT TRANSFORM & ROBLOX PART PHYSICS PROPERTIES
           ================================================================ */}
        {tab === 'transform' && (
          <>
            {!selectedNode ? (
              <div className="text-[var(--text-muted)] text-[11px] py-4 text-center">
                No MeshPart selected.
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
                  <label className="block space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      MeshPart Name
                    </span>
                    <input
                      type="text"
                      value={selectedNode.name}
                      onChange={(e) =>
                        useEditorStore
                          .getState()
                          .updateNodeTransform(selectedNode.id, { name: e.target.value })
                      }
                      className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-white font-medium"
                    />
                  </label>
                </div>

                {/* Position / Rotation / Scale */}
                {(
                  [
                    { key: 'position', label: 'Position (Studs)', step: 0.25 },
                    { key: 'rotation', label: 'Orientation (Deg)', step: 5 },
                    { key: 'scale', label: 'Scale Multiplier', step: 0.1 },
                  ] as const
                ).map((vecGroup) => {
                  const vals = selectedNode[vecGroup.key];
                  return (
                    <div
                      key={vecGroup.key}
                      className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-1.5"
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        {vecGroup.label}
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                          <div key={axis} className="flex items-center bg-[var(--app-bg)] border border-[var(--border)] rounded overflow-hidden">
                            <span
                              className={`px-1 text-[10px] font-mono font-bold ${
                                idx === 0
                                  ? 'text-[#f87171]'
                                  : idx === 1
                                  ? 'text-[#4ade80]'
                                  : 'text-[var(--accent)]'
                              }`}
                            >
                              {axis}
                            </span>
                            <input
                              type="number"
                              step={vecGroup.step}
                              value={vals[idx]}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                const next: [number, number, number] = [...vals] as any;
                                next[idx] = v;
                                useEditorStore
                                  .getState()
                                  .updateNodeTransform(selectedNode.id, { [vecGroup.key]: next }, true);
                              }}
                              className="w-full bg-transparent px-1 py-1 font-mono text-[11px] text-white focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Roblox Studio Instance Properties */}
                <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                    Roblox Physics & Behavior
                  </div>
                  <label className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--text-primary)]">Anchored</span>
                    <input
                      type="checkbox"
                      checked={selectedNode.anchored}
                      onChange={(e) =>
                        useEditorStore
                          .getState()
                          .updateNodeTransform(selectedNode.id, { anchored: e.target.checked })
                      }
                      className="accent-[var(--mesh-accent-fill)]"
                    />
                  </label>
                  <label className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--text-primary)]">CanCollide</span>
                    <input
                      type="checkbox"
                      checked={selectedNode.canCollide}
                      onChange={(e) =>
                        useEditorStore
                          .getState()
                          .updateNodeTransform(selectedNode.id, { canCollide: e.target.checked })
                      }
                      className="accent-[var(--mesh-accent-fill)]"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-[var(--text-secondary)]">CollisionFidelity</span>
                    <select
                      value={selectedNode.collisionFidelity}
                      onChange={(e) =>
                        useEditorStore.getState().updateNodeTransform(selectedNode.id, {
                          collisionFidelity: e.target.value as RobloxCollisionFidelity,
                        })
                      }
                      className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 text-[11px] text-white"
                    >
                      {COLLISION_MODES.map((cm) => (
                        <option key={cm} value={cm}>
                          {cm}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}
          </>
        )}

        {/* ================================================================
            TAB 3: MATERIALS, PBR & PROCEDURAL ROBLOX TEXTURES
           ================================================================ */}
        {tab === 'material' && activeMaterial && (
          <div className="space-y-2.5">
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Assigned Material Slot
                </span>
                <button
                  onClick={() => useEditorStore.getState().createMaterialForSelected()}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 bg-[var(--surface-raised)] hover:bg-[var(--border)] rounded text-[10px] text-white"
                >
                  <Plus className="w-3 h-3" /> New
                </button>
              </div>

              {selectedNode && (
                <select
                  value={selectedNode.materialId}
                  onChange={(e) =>
                    useEditorStore
                      .getState()
                      .updateNodeTransform(selectedNode.id, { materialId: e.target.value })
                  }
                  className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-white text-[11px]"
                >
                  {scene.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.robloxMaterial})
                    </option>
                  ))}
                </select>
              )}

              <label className="block space-y-0.5">
                <span className="text-[10px] text-[var(--text-muted)]">Material Name</span>
                <input
                  type="text"
                  value={activeMaterial.name}
                  onChange={(e) =>
                    useEditorStore.getState().updateMaterial(activeMaterial.id, { name: e.target.value })
                  }
                  className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-white text-[11px]"
                />
              </label>

              <label className="block space-y-0.5">
                <span className="text-[10px] text-[var(--text-muted)]">Roblox Enum.Material</span>
                <select
                  value={activeMaterial.robloxMaterial}
                  onChange={(e) => {
                    const rm = e.target.value as RobloxSurfaceMaterial;
                    const patch: any = { robloxMaterial: rm };
                    if (rm === 'Metal' || rm === 'DiamondPlate') {
                      patch.metalness = 0.8;
                      patch.roughness = 0.25;
                    } else if (rm === 'Neon') {
                      patch.emissive = activeMaterial.color;
                      patch.emissiveIntensity = 0.85;
                    } else if (rm === 'Glass') {
                      patch.opacity = 0.5;
                      patch.roughness = 0.08;
                    } else {
                      patch.emissiveIntensity = 0;
                      patch.opacity = 1;
                    }
                    useEditorStore.getState().updateMaterial(activeMaterial.id, patch);
                  }}
                  className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-white text-[11px]"
                >
                  {ROBLOX_MATERIALS.map((rm) => (
                    <option key={rm} value={rm}>
                      Enum.Material.{rm}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* PBR Albedo / Roughness / Metalness */}
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                SurfaceAppearance PBR
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[var(--text-primary)]">Color3 Albedo</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={activeMaterial.color}
                    onChange={(e) =>
                      useEditorStore
                        .getState()
                        .updateMaterial(activeMaterial.id, { color: e.target.value })
                    }
                    className="w-6 h-6 bg-transparent border-0 cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-[var(--text-secondary)]">
                    {activeMaterial.color}
                  </span>
                </div>
              </div>

              <label className="block space-y-0.5">
                <div className="flex justify-between text-[10px] text-[var(--text-secondary)]">
                  <span>Roughness</span>
                  <span className="font-mono">{activeMaterial.roughness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={activeMaterial.roughness}
                  onChange={(e) =>
                    useEditorStore
                      .getState()
                      .updateMaterial(activeMaterial.id, { roughness: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[var(--mesh-accent-fill)]"
                />
              </label>

              <label className="block space-y-0.5">
                <div className="flex justify-between text-[10px] text-[var(--text-secondary)]">
                  <span>Metalness</span>
                  <span className="font-mono">{activeMaterial.metalness.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.02"
                  value={activeMaterial.metalness}
                  onChange={(e) =>
                    useEditorStore
                      .getState()
                      .updateMaterial(activeMaterial.id, { metalness: parseFloat(e.target.value) })
                  }
                  className="w-full accent-[var(--mesh-accent-fill)]"
                />
              </label>

              <label className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-primary)]">Flat Faceted Normals</span>
                <input
                  type="checkbox"
                  checked={activeMaterial.flatShading}
                  onChange={(e) =>
                    useEditorStore
                      .getState()
                      .updateMaterial(activeMaterial.id, { flatShading: e.target.checked })
                  }
                  className="accent-[var(--mesh-accent-fill)]"
                />
              </label>
            </div>

            {/* Procedural Texture Synthesizer */}
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Procedural UV Texture Map
              </div>
              <select
                value={activeMaterial.texture.pattern}
                onChange={(e) =>
                  useEditorStore.getState().updateMaterial(activeMaterial.id, {
                    texture: { ...activeMaterial.texture, pattern: e.target.value as any },
                  })
                }
                className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-white text-[11px]"
              >
                <option value="none">Solid Color (No Texture)</option>
                <option value="studs">Classic Roblox Studs Tile</option>
                <option value="checker">UV Calibration Checker</option>
                <option value="grid">Technical Trim Grid</option>
                <option value="brushed_metal">Brushed Anodized Metal</option>
                <option value="noise">Micro Surface Grain</option>
              </select>

              {activeMaterial.texture.pattern !== 'none' && (
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-[var(--text-muted)]">Repeat U</span>
                    <input
                      type="number"
                      min="1"
                      max="32"
                      value={activeMaterial.texture.scaleU}
                      onChange={(e) =>
                        useEditorStore.getState().updateMaterial(activeMaterial.id, {
                          texture: {
                            ...activeMaterial.texture,
                            scaleU: parseFloat(e.target.value) || 1,
                          },
                        })
                      }
                      className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-[10px] text-[var(--text-muted)]">Repeat V</span>
                    <input
                      type="number"
                      min="1"
                      max="32"
                      value={activeMaterial.texture.scaleV}
                      onChange={(e) =>
                        useEditorStore.getState().updateMaterial(activeMaterial.id, {
                          texture: {
                            ...activeMaterial.texture,
                            scaleV: parseFloat(e.target.value) || 1,
                          },
                        })
                      }
                      className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1.5 py-1 font-mono text-white"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================
            TAB 4: ROBLOX STUDIO COMPATIBILITY & SCALE VALIDATOR
           ================================================================ */}
        {tab === 'roblox' && validation && (
          <div className="space-y-2.5">
            <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                Roblox Target Profile
              </div>
              <select
                value={scene.robloxPreset}
                onChange={(e) =>
                  useEditorStore
                    .getState()
                    .updateSceneSettings({ robloxPreset: e.target.value as RobloxPresetId })
                }
                className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-white text-[11px]"
              >
                <option value="MeshPart_Standard">Standard MeshPart (10,000 tris)</option>
                <option value="EditableMesh_20k">EditableMesh / Extended (20,000 tris)</option>
                <option value="UGC_Accessory_4k">UGC Marketplace Accessory (4,000 tris)</option>
                <option value="Avatar_Cage_Outer">Layered Clothing Cage (Watertight)</option>
              </select>

              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                <label className="space-y-0.5">
                  <span className="text-[10px] text-[var(--text-muted)]">Export Unit Scale</span>
                  <select
                    value={scene.exportUnitScale}
                    onChange={(e) =>
                      useEditorStore
                        .getState()
                        .updateSceneSettings({ exportUnitScale: e.target.value as any })
                    }
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1 py-1 text-white text-[10.5px]"
                  >
                    <option value="meters_0_28">1 Stud = 0.28m (GLB)</option>
                    <option value="centimeters_28_0">1 Stud = 28cm (FBX)</option>
                    <option value="studs_1_0">1 Unit = 1 Stud (OBJ)</option>
                  </select>
                </label>

                <label className="space-y-0.5">
                  <span className="text-[10px] text-[var(--text-muted)]">Up Axis</span>
                  <select
                    value={scene.upAxis}
                    onChange={(e) =>
                      useEditorStore
                        .getState()
                        .updateSceneSettings({ upAxis: e.target.value as 'Y' | 'Z' })
                    }
                    className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded px-1 py-1 text-white text-[10.5px]"
                  >
                    <option value="Y">+Y Up (Roblox Native)</option>
                    <option value="Z">+Z Up (Blender Native)</option>
                  </select>
                </label>
              </div>
            </div>

            {/* Live Audit Status Card */}
            <div
              className={`p-2.5 rounded-md border ${
                validation.allCompatible
                  ? 'bg-[#13241c] border-[#1f5138] text-[#a7f3d0]'
                  : 'bg-[#2c1619] border-[#6e242b] text-[#fecaca]'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold text-[11.5px]">
                {validation.allCompatible ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-[#34d399]" />
                    <span>Roblox Studio Import Ready</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-[#f87171]" />
                    <span>Compatibility Warnings Detected</span>
                  </>
                )}
              </div>
              <div className="mt-1 text-[10.5px] font-mono opacity-90">
                Total: {validation.totalTriangles.toLocaleString()} tris across {validation.meshObjects}{' '}
                MeshPart(s)
              </div>
            </div>

            {/* Per-MeshPart Audit Breakdown */}
            <div className="space-y-1.5">
              {validation.perNode.map((item) => (
                <div
                  key={item.id}
                  className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-md space-y-1 text-[11px]"
                >
                  <div className="flex items-center justify-between font-medium text-white">
                    <span className="truncate">{item.name}</span>
                    <span className="font-mono text-[10px] text-[var(--text-secondary)]">
                      {item.report.triangleCount} tris
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-[var(--text-muted)]">
                    Size: {item.report.sizeStuds[0].toFixed(1)} × {item.report.sizeStuds[1].toFixed(1)} ×{' '}
                    {item.report.sizeStuds[2].toFixed(1)} studs
                  </div>
                  <div className="flex flex-wrap gap-1 pt-0.5 text-[10px] font-mono">
                    <span
                      className={`px-1 py-0.5 rounded ${
                        item.report.isManifold
                          ? 'bg-[#162d22] text-[#34d399]'
                          : 'bg-[#2e2415] text-[#fbbf24]'
                      }`}
                    >
                      {item.report.isManifold
                        ? 'Watertight'
                        : `${item.report.boundaryEdges} open edges`}
                    </span>
                    <span
                      className={`px-1 py-0.5 rounded ${
                        item.report.fitsMaxStuds
                          ? 'bg-[#1a2230] text-[var(--accent)]'
                          : 'bg-[#36191c] text-[#fca5a5]'
                      }`}
                    >
                      {item.report.fitsMaxStuds ? '≤2048st OK' : '>2048st Oversize'}
                    </span>
                  </div>
                  {item.issues.map((iss, idx) => (
                    <div key={idx} className="text-[10px] text-[#fca5a5] pt-0.5">
                      • {iss}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
