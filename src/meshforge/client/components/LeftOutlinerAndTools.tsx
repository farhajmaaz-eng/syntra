import React from 'react';
import {
  Box,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Grid,
  Lock,
  Maximize2,
  MousePointer,
  Move,
  Plus,
  RotateCw,
  Scissors,
  Sparkles,
  Trash2,
  Triangle,
  Unlock,
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { PrimitiveKind } from '../../shared/sceneOps';

export const LeftOutlinerAndTools: React.FC = () => {
  const leftOpen = useEditorStore((s) => s.leftSidebarOpen);
  const gizmoMode = useEditorStore((s) => s.gizmoMode);
  const mode = useEditorStore((s) => s.mode);
  const nodes = useEditorStore((s) => s.scene.nodes);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);
  const meshCache = useEditorStore((s) => s.meshCache);

  if (!leftOpen) {
    return (
      <aside className="w-10 bg-[var(--sidebar-bg)] border-r border-[var(--border)] flex flex-col items-center py-2 gap-1.5 shrink-0">
        {(
          [
            { id: 'select', icon: MousePointer, title: 'Select (Q)' },
            { id: 'translate', icon: Move, title: 'Move (G)' },
            { id: 'rotate', icon: RotateCw, title: 'Rotate (R)' },
            { id: 'scale', icon: Maximize2, title: 'Scale (S)' },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => useEditorStore.getState().setGizmoMode(t.id)}
              className={`w-7 h-7 flex items-center justify-center rounded-md border ${
                gizmoMode === t.id
                  ? 'bg-[var(--mesh-accent-fill)] border-[var(--accent)] text-white'
                  : 'bg-[#1d2026] border-[var(--border)] text-[var(--text-secondary)] hover:text-white'
              }`}
              title={t.title}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </aside>
    );
  }

  const quickPrimitives: Array<{ kind: PrimitiveKind; label: string }> = [
    { kind: 'cube', label: 'Block' },
    { kind: 'cylinder', label: 'Cylinder' },
    { kind: 'sphere', label: 'Sphere' },
    { kind: 'wedge', label: 'Wedge' },
    { kind: 'torus', label: 'Torus' },
    { kind: 'plane', label: 'Baseplate' },
    { kind: 'stairs', label: 'Stairs' },
    { kind: 'crate', label: 'Crate' },
    { kind: 'terrain', label: 'Terrain' },
  ];

  return (
    <aside
      id="left-tool-outliner-sidebar"
      className="w-64 bg-[var(--sidebar-bg)] border-r border-[var(--border)] flex h-full shrink-0 text-[12px]"
    >
      {/* Narrow Blender-like Vertical Tool Strip */}
      <div className="w-10 bg-[var(--sidebar-bg)] border-r border-[var(--border)] flex flex-col items-center py-2 gap-1.5 shrink-0">
        {(
          [
            { id: 'select', icon: MousePointer, title: 'Select Only (Q)' },
            { id: 'translate', icon: Move, title: 'Move Gizmo (G)' },
            { id: 'rotate', icon: RotateCw, title: 'Rotate Gizmo (R)' },
            { id: 'scale', icon: Maximize2, title: 'Scale Gizmo (S)' },
          ] as const
        ).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => useEditorStore.getState().setGizmoMode(t.id)}
              className={`w-7 h-7 flex items-center justify-center rounded-md border ${
                gizmoMode === t.id
                  ? 'bg-[var(--mesh-accent-fill)] border-[var(--accent)] text-white'
                  : 'bg-[var(--surface)] border-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-white'
              }`}
              title={t.title}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}

        <div className="w-5 h-[1px] bg-[var(--border)] my-1" />

        {/* Direct Topological Quick Actions */}
        <button
          onClick={() => useEditorStore.getState().extrudeSelection(1.0, 1.0)}
          disabled={!selectedNodeId}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--surface)] border border-[var(--surface-hover)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-white disabled:opacity-35 font-mono text-[11px] font-semibold"
          title="Extrude Selected Face(s) +1.0 Stud (E)"
        >
          E
        </button>
        <button
          onClick={() => useEditorStore.getState().insetSelection(0.22, 0)}
          disabled={!selectedNodeId}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--surface)] border border-[var(--surface-hover)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-white disabled:opacity-35 font-mono text-[11px] font-semibold"
          title="Inset Selected Face(s) (I)"
        >
          I
        </button>
        <button
          onClick={() => useEditorStore.getState().bevelSelection(0.18)}
          disabled={!selectedNodeId}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--surface)] border border-[var(--surface-hover)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-white disabled:opacity-35 font-mono text-[11px] font-semibold"
          title="Bevel / Chamfer Faces (B)"
        >
          B
        </button>
        <button
          onClick={() => useEditorStore.getState().loopCutSelectedMesh()}
          disabled={!selectedNodeId}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--surface)] border border-[var(--surface-hover)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-white disabled:opacity-35"
          title="Quad Edge Loop Cut (Ctrl+R)"
        >
          <Scissors className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => useEditorStore.getState().subdivideSelectedMesh(false)}
          disabled={!selectedNodeId}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--surface)] border border-[var(--surface-hover)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-white disabled:opacity-35"
          title="Linear Quad Subdivision"
        >
          <Grid className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => useEditorStore.getState().subdivideSelectedMesh(true)}
          disabled={!selectedNodeId}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--surface)] border border-[var(--surface-hover)] text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-white disabled:opacity-35"
          title="Catmull-Clark Smooth Subdivision"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => useEditorStore.getState().duplicateSelectedNode()}
          disabled={!selectedNodeId}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--surface)] border border-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-white disabled:opacity-35"
          title="Duplicate Selected Object (Shift+D)"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => useEditorStore.getState().deleteSelected()}
          disabled={!selectedNodeId}
          className="w-7 h-7 flex items-center justify-center rounded-md bg-[var(--surface)] border border-[var(--surface-hover)] text-[#f87171] hover:bg-[#3a1d21] disabled:opacity-35"
          title="Delete Selected Object or Faces (X / Delete)"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Column: Add Primitives + Roblox Workspace Outliner */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Add Mesh / Procedural Section */}
        <div className="p-2 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Create Roblox Part / Mesh
            </span>
            <Plus className="w-3 h-3 text-[var(--text-muted)]" />
          </div>
          <div className="grid grid-cols-3 gap-1">
            {quickPrimitives.map((p) => (
              <button
                key={p.kind}
                onClick={() => useEditorStore.getState().addPrimitive(p.kind)}
                className="px-1.5 py-1 bg-[var(--surface-raised)] hover:bg-[var(--border)] border border-[var(--border)] rounded-md text-[11px] text-[var(--text-primary)] hover:text-white truncate text-center"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scene Hierarchy / Workspace Explorer */}
        <div className="px-2.5 py-1.5 bg-[#14161a] border-b border-[var(--border)] flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Workspace Hierarchy ({nodes.length})
          </span>
          <span className="text-[10px] font-mono text-[var(--accent)] uppercase">{mode}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
          {nodes.length === 0 && (
            <div className="text-[11px] text-[var(--text-muted)] px-2 py-4 text-center">
              Workspace empty. Create a primitive above or prompt MCP Agent.
            </div>
          )}
          {nodes.map((node) => {
            const selected = node.id === selectedNodeId;
            const triCount = meshCache[node.id]?.render.validation.triangleCount ?? 0;
            return (
              <div
                key={node.id}
                onClick={() => useEditorStore.getState().selectNode(node.id)}
                className={`group flex items-center justify-between px-2 py-1 rounded-md cursor-pointer border ${
                  selected
                    ? 'bg-[var(--accent-wash)] border-[var(--mesh-accent-fill)] text-white'
                    : 'bg-transparent border-transparent text-[var(--text-primary)] hover:bg-[var(--surface-raised)]'
                }`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Box className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`} />
                  <span className="truncate font-medium text-[11.5px]">{node.name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-1">
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{triCount}t</span>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      useEditorStore
                        .getState()
                        .updateNodeTransform(node.id, { visible: !node.visible });
                    }}
                    className="p-0.5 text-[var(--text-muted)] hover:text-white"
                    title={node.visible ? 'Hide MeshPart' : 'Show MeshPart'}
                  >
                    {node.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-[#ef4444]" />}
                  </button>
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      useEditorStore
                        .getState()
                        .updateNodeTransform(node.id, { locked: !node.locked });
                    }}
                    className="p-0.5 text-[var(--text-muted)] hover:text-white"
                    title={node.locked ? 'Unlock' : 'Lock'}
                  >
                    {node.locked ? <Lock className="w-3 h-3 text-[#f59e0b]" /> : <Unlock className="w-3 h-3 opacity-40 group-hover:opacity-100" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Keyboard Shortcut Reference Footer */}
        <div className="p-2 border-t border-[var(--border)] bg-[var(--sidebar-bg)] text-[10px] font-mono text-[var(--text-muted)] space-y-0.5">
          <div className="flex justify-between">
            <span>1/2/3: V/E/F Mode</span>
            <span>Tab: Obj/Edit</span>
          </div>
          <div className="flex justify-between">
            <span>G/R/S: Gizmos</span>
            <span>E / I / B: Mesh Ops</span>
          </div>
          <div className="flex justify-between">
            <span>Alt+Click: Loop</span>
            <span>Ctrl+Z/Y: Undo</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
