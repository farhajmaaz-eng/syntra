import React, { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  Grid,
  Play,
  Sparkles,
  Terminal,
  Wand2,
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';

export const BottomWorkbench: React.FC = () => {
  const bottomOpen = useEditorStore((s) => s.bottomPanelOpen);
  const bottomTab = useEditorStore((s) => s.bottomTab);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const meshCache = useEditorStore((s) => s.meshCache);
  const scene = useEditorStore((s) => s.scene);
  const logs = useEditorStore((s) => s.logs);
  const mcpEvents = useEditorStore((s) => s.mcpEvents);

  // Interactive MCP Tool Runner states
  const [selectedTool, setSelectedTool] = useState<string>('create_mesh_primitive');
  const [toolArgsText, setToolArgsText] = useState<string>(
    JSON.stringify(
      {
        kind: 'stairs',
        name: 'Obby_Stairway',
        position: [6, 0, 0],
        color: '#3b82f6',
        robloxMaterial: 'DiamondPlate',
        params: { steps: 10, width: 5, height: 6, depth: 9 },
      },
      null,
      2
    )
  );
  const [mcpOutput, setMcpOutput] = useState<string>(
    '// MeshForge tool responses appear here.'
  );
  const [runningMcp, setRunningMcp] = useState<boolean>(false);

  // Interactive UV Canvas Editor state
  const uvCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [draggingHeId, setDraggingHeId] = useState<number | null>(null);

  const activeCache = selectedNodeId ? meshCache[selectedNodeId] : undefined;
  const activeNode = scene.nodes.find((n) => n.id === selectedNodeId);
  const activeMat = activeNode
    ? scene.materials.find((m) => m.id === activeNode.materialId) || scene.materials[0]
    : scene.materials[0];

  // Draw 2D UV Layout on Canvas
  useEffect(() => {
    if (!bottomOpen || bottomTab !== 'uv') return;
    const canvas = uvCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#101216';
    ctx.fillRect(0, 0, w, h);

    // Checkerboard 0..1 UV space
    const cells = 8;
    const stepX = w / cells;
    const stepY = h / cells;
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#171a20' : '#1d2129';
        ctx.fillRect(x * stepX, y * stepY, stepX, stepY);
      }
    }

    // Border & axes
    ctx.strokeStyle = '#333947';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    if (!activeCache) return;

    const topo = activeCache.topology;
    // Draw UV polygon cages
    ctx.strokeStyle = activeMat?.color || '#60a5fa';
    ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
    ctx.lineWidth = 1.15;

    for (let f = 0; f < topo.faceCount; f++) {
      const hes = topo.getFaceHalfEdges(f);
      if (hes.length < 3) continue;
      ctx.beginPath();
      hes.forEach((he, idx) => {
        const px = ((he.u % 1 + 1) % 1) * w;
        const py = (1 - ((he.v % 1 + 1) % 1)) * h;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Draw draggable UV corner vertices
    for (const he of topo.halfEdges) {
      const px = ((he.u % 1 + 1) % 1) * w;
      const py = (1 - ((he.v % 1 + 1) % 1)) * h;
      ctx.fillStyle = he.id === draggingHeId ? '#f59e0b' : '#e5e7eb';
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
    }
  }, [bottomOpen, bottomTab, activeCache, activeMat, draggingHeId]);

  if (!bottomOpen) return null;

  const presetMcpTemplates: Record<string, Record<string, any>> = {
    inspect_scene: {},
    create_mesh_primitive: {
      kind: 'stairs',
      name: 'Obby_Stairway',
      position: [6, 0, 0],
      color: '#3b82f6',
      robloxMaterial: 'DiamondPlate',
      params: { steps: 10, width: 5, height: 6, depth: 9 },
    },
    edit_mesh_topology: {
      target: activeNode?.name || 'SciFi_SupplyCrate',
      operation: 'extrude',
      faces: [0, 4],
      distance: 1.25,
      scale: 0.78,
    },
    assign_roblox_material: {
      target: activeNode?.name || 'SciFi_SupplyCrate',
      color: '#10b981',
      robloxMaterial: 'Neon',
      pattern: 'grid',
    },
    transform_node: {
      target: activeNode?.name || 'SciFi_SupplyCrate',
      position: [0, 3, 0],
      rotation: [0, 45, 0],
      collisionFidelity: 'PreciseConvexDecomposition',
    },
    validate_roblox_compatibility: {
      preset: 'MeshPart_Standard',
    },
    export_roblox_model: {
      format: 'glb',
      scalePreset: 'meters_0_28',
      upAxis: 'Y',
    },
  };

  const handleSelectToolTemplate = (tName: string) => {
    setSelectedTool(tName);
    setToolArgsText(JSON.stringify(presetMcpTemplates[tName] || {}, null, 2));
  };

  const handleRunMcpTool = async () => {
    setRunningMcp(true);
    try {
      const parsed = JSON.parse(toolArgsText || '{}');
      const res = await useEditorStore.getState().executeLocalMcpToolCall(selectedTool, parsed);
      const textPayload = res?.result?.content?.[0]?.text;
      setMcpOutput(textPayload || JSON.stringify(res, null, 2));
    } catch (err: any) {
      setMcpOutput(`Error: ${err?.message || String(err)}`);
    } finally {
      setRunningMcp(false);
    }
  };

  // UV Canvas Mouse Dragging
  const handleUvPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activeCache || !uvCanvasRef.current) return;
    const rect = uvCanvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const w = uvCanvasRef.current.width;
    const h = uvCanvasRef.current.height;

    let closestId: number | null = null;
    let bestD = 12;
    for (const he of activeCache.topology.halfEdges) {
      const px = ((he.u % 1 + 1) % 1) * w;
      const py = (1 - ((he.v % 1 + 1) % 1)) * h;
      const d = Math.hypot(px - mx, py - my);
      if (d < bestD) {
        bestD = d;
        closestId = he.id;
      }
    }
    if (closestId !== null) {
      useEditorStore.getState().pushUndo('Edit UV');
      setDraggingHeId(closestId);
    }
  };

  const handleUvPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingHeId === null || !uvCanvasRef.current) return;
    const rect = uvCanvasRef.current.getBoundingClientRect();
    const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    useEditorStore.getState().updateVertexUV(draggingHeId, u, v);
  };

  const robloxAssetLibrary = [
    {
      name: 'Sci-Fi Supply Crate',
      desc: 'Inset 6-sided hard-surface crate (108 tris)',
      spawn: () => useEditorStore.getState().addPrimitive('crate', { size: 4 }, 'SciFi_Crate'),
    },
    {
      name: 'Obby Modular Staircase',
      desc: '10-step convex collision-ready stairs',
      spawn: () =>
        useEditorStore
          .getState()
          .addPrimitive('stairs', { steps: 10, width: 6, height: 6, depth: 10 }, 'Obby_Stairs'),
    },
    {
      name: 'Roblox Spawn Baseplate (16×16)',
      desc: 'Subdivided stud grid floor tile',
      spawn: () =>
        useEditorStore
          .getState()
          .addPrimitive('plane', { width: 16, depth: 16, segX: 8, segZ: 8 }, 'Spawn_Baseplate'),
    },
    {
      name: 'Procedural Low-Poly Terrain',
      desc: '16×16 stud heightfield chunk',
      spawn: () =>
        useEditorStore
          .getState()
          .addPrimitive('terrain', { size: 16, resolution: 16, amplitude: 2.6, seed: 7 }, 'Hill_Chunk'),
    },
    {
      name: 'Speed-Pad Ramp Wedge',
      desc: '45° Roblox WedgePart ramp',
      spawn: () =>
        useEditorStore
          .getState()
          .addPrimitive('wedge', { sizeX: 6, sizeY: 3, sizeZ: 8 }, 'Boost_Ramp'),
    },
    {
      name: 'Portal Ring Torus',
      desc: 'Manifold quad-ring portal frame',
      spawn: () =>
        useEditorStore
          .getState()
          .addPrimitive('torus', { majorRadius: 3.2, minorRadius: 0.55, radialSegs: 12, tubularSegs: 24 }, 'Portal_Ring'),
    },
  ];

  return (
    <section
      id="bottom-workbench-panel"
      className="h-56 bg-[var(--sidebar-bg)] border-t border-[var(--border)] flex flex-col shrink-0 text-[12px]"
    >
      {/* Workbench Header Tabs */}
      <div className="h-7 bg-[var(--app-bg)] border-b border-[var(--border)] px-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {(
            [
              { id: 'assets', label: 'Roblox Prefabs', icon: Boxes },
              { id: 'uv', label: 'UV Editor', icon: Grid },
              { id: 'mcp', label: 'Agent Tools', icon: Wand2 },
              { id: 'console', label: `Engine & Sync Log (${logs.length})`, icon: Terminal },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = bottomTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => useEditorStore.getState().setBottomTab(t.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] border-b-2 transition-colors ${
                  active
                    ? 'border-[var(--mesh-accent-fill)] bg-[#191c23] text-white font-medium'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => useEditorStore.getState().toggleFlag('bottomPanelOpen')}
          className="p-1 text-[var(--text-muted)] hover:text-white"
          title="Collapse Bottom Panel"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-hidden">
        {/* 1. MCP tools */}
        {bottomTab === 'mcp' && (
          <div className="h-full grid grid-cols-12 divide-x divide-[var(--border)]">
            {/* Tool Selector & JSON-RPC Dispatcher */}
            <div className="col-span-5 p-2 flex flex-col gap-1.5 overflow-hidden">
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedTool}
                  onChange={(e) => handleSelectToolTemplate(e.target.value)}
                  className="flex-1 bg-[var(--app-bg)] border border-[var(--border)] rounded-md px-2 py-1 font-mono text-[11px] text-[var(--accent)]"
                >
                  {Object.keys(presetMcpTemplates).map((tool) => (
                    <option key={tool} value={tool}>
                      mcp.tool::{tool}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleRunMcpTool}
                  disabled={runningMcp}
                  className="flex items-center gap-1 px-2.5 py-1 bg-[var(--mesh-accent-fill)] hover:bg-[var(--mesh-accent-fill)] disabled:opacity-50 text-white font-medium rounded-md text-[11px]"
                >
                  <Play className="w-3 h-3" />
                  <span>{runningMcp ? 'Running...' : 'Invoke MCP'}</span>
                </button>
              </div>
              <textarea
                value={toolArgsText}
                onChange={(e) => setToolArgsText(e.target.value)}
                spellCheck={false}
                className="flex-1 bg-[var(--app-bg)] border border-[var(--surface-hover)] rounded-md p-1.5 font-mono text-[11px] text-[var(--text-primary)] resize-none focus:outline-none focus:border-[var(--mesh-accent-fill)]"
              />
            </div>

            {/* Tool Response Inspector */}
            <div className="col-span-4 p-2 flex flex-col overflow-hidden">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
                Tool response
              </div>
              <pre className="flex-1 bg-[var(--app-bg)] border border-[var(--surface-hover)] rounded-md p-2 font-mono text-[10.5px] text-[#a7f3d0] overflow-auto whitespace-pre-wrap">
                {mcpOutput}
              </pre>
            </div>

            {/* Live External Agent Sync Stream */}
            <div className="col-span-3 p-2 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  Live Agent Mutations
                </span>
                <span className="text-[10px] font-mono text-[#34d399]">Auto-Sync 2s</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-1 font-mono text-[10.5px]">
                {mcpEvents.length === 0 ? (
                  <div className="text-[var(--text-muted)] p-1.5">
                    Listening for remote AI agent tool calls on project{' '}
                    <span className="text-[var(--accent)]">{useEditorStore.getState().projectId}</span>...
                  </div>
                ) : (
                  mcpEvents
                    .slice()
                    .reverse()
                    .map((ev) => (
                      <div
                        key={ev.id}
                        className="p-1.5 bg-[#191d24] border border-[var(--border)] rounded"
                      >
                        <div className="flex justify-between text-[var(--accent)]">
                          <span>{ev.toolName}</span>
                          <span className="text-[var(--text-muted)]">r{ev.revision}</span>
                        </div>
                        <div className="text-[var(--text-primary)] truncate">{ev.resultSummary}</div>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* 2. Interactive 2D UV Unwrap & Vertex Pin Editor */}
        {bottomTab === 'uv' && (
          <div className="h-full flex items-center gap-4 px-3 py-2 overflow-hidden">
            <canvas
              ref={uvCanvasRef}
              width={184}
              height={184}
              onPointerDown={handleUvPointerDown}
              onPointerMove={handleUvPointerMove}
              onPointerUp={() => setDraggingHeId(null)}
              onPointerLeave={() => setDraggingHeId(null)}
              className="border border-[var(--border)] rounded-md cursor-crosshair shrink-0"
            />
            <div className="space-y-2 text-[11px] max-w-md">
              <div className="font-semibold text-white">
                Interactive Half-Edge UV Space [0..1] — {activeNode?.name || 'No Mesh Selected'}
              </div>
              <p className="text-[var(--text-secondary)] leading-relaxed">
                Drag any UV corner handle directly in the 2D canvas to tweak texture coordinates in real
                time, or re-project using standard Roblox SurfaceAppearance projections:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(['box', 'planar', 'cylindrical', 'spherical'] as const).map((m) => (
                  <button
                    key={m}
                    disabled={!activeNode}
                    onClick={() => useEditorStore.getState().projectSelectedUVs(m, 1)}
                    className="px-2.5 py-1 bg-[var(--surface-raised)] hover:bg-[var(--surface-hover)] border border-[var(--border)] rounded-md text-[var(--text-primary)] capitalize"
                  >
                    Project {m}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3. Roblox Asset & Procedural Prefab Browser */}
        {bottomTab === 'assets' && (
          <div className="h-full p-2.5 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 overflow-y-auto">
            {robloxAssetLibrary.map((asset) => (
              <button
                key={asset.name}
                onClick={asset.spawn}
                className="p-2.5 bg-[#1a1d24] hover:bg-[var(--surface-raised)] border border-[var(--border)] hover:border-[var(--accent)] rounded-md flex flex-col justify-between text-left transition-colors"
              >
                <div className="flex items-center justify-between">
                  <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                  <span className="text-[9.5px] font-mono text-[var(--text-muted)] uppercase">Stud Prefab</span>
                </div>
                <div>
                  <div className="font-semibold text-white text-[11.5px] mt-1">{asset.name}</div>
                  <div className="text-[10px] text-[var(--text-secondary)] mt-0.5 line-clamp-2">{asset.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* 4. System / WASM / Cloud / Roblox Log */}
        {bottomTab === 'console' && (
          <div className="h-full p-2 overflow-y-auto font-mono text-[11px] space-y-1 bg-[var(--app-bg)]">
            {logs
              .slice()
              .reverse()
              .map((l) => (
                <div key={l.id} className="flex items-start gap-2">
                  <span className="text-[var(--text-muted)] shrink-0">{l.time}</span>
                  <span
                    className={`px-1 rounded text-[10px] uppercase shrink-0 ${
                      l.source === 'wasm'
                        ? 'bg-[#172e25] text-[#34d399]'
                        : l.source === 'mcp'
                        ? 'bg-[#1b2942] text-[var(--accent)]'
                        : l.source === 'roblox'
                        ? 'bg-[#332414] text-[#fbbf24]'
                        : 'bg-[#22252d] text-[var(--text-secondary)]'
                    }`}
                  >
                    {l.source}
                  </span>
                  <span
                    className={
                      l.level === 'error'
                        ? 'text-[#f87171]'
                        : l.level === 'warn'
                        ? 'text-[#fbbf24]'
                        : l.level === 'success'
                        ? 'text-[#d1fae5]'
                        : 'text-[var(--text-primary)]'
                    }
                  >
                    {l.message}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  );
};
