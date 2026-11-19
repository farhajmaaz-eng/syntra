import React, { useRef } from 'react';
import Link from 'next/link';
import {
  Box,
  ArrowLeft,
  Cpu,
  Download,
  FolderOpen,
  Layers,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  ShieldCheck,
  Terminal,
  Undo2,
  Upload,
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';

export const TopHeader: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sceneName = useEditorStore((s) => s.scene.name);
  const robloxPreset = useEditorStore((s) => s.scene.robloxPreset);
  const wasmReady = useEditorStore((s) => s.wasmReady);
  const fps = useEditorStore((s) => s.fps);
  const drawCalls = useEditorStore((s) => s.drawCalls);
  const frameTimeMs = useEditorStore((s) => s.frameTimeMs);
  const autosaveStatus = useEditorStore((s) => s.autosaveStatus);
  const projectRevision = useEditorStore((s) => s.projectRevision);
  const projectError = useEditorStore((s) => s.projectError);
  const undoCount = useEditorStore((s) => s.undoStack.length);
  const redoCount = useEditorStore((s) => s.redoStack.length);
  const leftSidebarOpen = useEditorStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useEditorStore((s) => s.rightSidebarOpen);
  const bottomPanelOpen = useEditorStore((s) => s.bottomPanelOpen);
  const meshCache = useEditorStore((s) => s.meshCache);

  // Total scene triangle budget indicator
  let totalTris = 0;
  let totalVerts = 0;
  for (const k of Object.keys(meshCache)) {
    totalTris += meshCache[k].render.validation.triangleCount;
    totalVerts += meshCache[k].render.validation.vertexCount;
  }
  const maxBudget =
    robloxPreset === 'UGC_Accessory_4k'
      ? 4000
      : robloxPreset === 'EditableMesh_20k'
      ? 20000
      : 10000;
  const overBudget = totalTris > maxBudget;

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error("OBJ imports are limited to 8 MiB.");
      useEditorStore.getState().importOBJString(await file.text(), file.name);
    } catch (error) {
      useEditorStore.setState({ projectError: error instanceof Error ? error.message : "Could not read OBJ." });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <header
      id="editor-top-menubar"
      className="meshforge-header bg-[var(--sidebar-bg)] border-b border-[var(--border)] px-2.5 flex items-center justify-between text-[12px] shrink-0"
    >
      {/* Left: Brand, Project Selector, File/Import/Save/Undo/Redo */}
      <div className="meshforge-toolbar-group flex items-center gap-1.5">
        <div className="flex items-center gap-1.5 pr-2 border-r border-[var(--border)]">
          <Link href="/" title="Back to Syntra" aria-label="Back to Syntra"
            className="meshforge-back flex items-center gap-2 px-2 py-1.5">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Syntra</span>
          </Link>
        </div>

        {/* Cloud Project Switcher + Inline Editable Scene Title */}
        <button
          onClick={() => useEditorStore.getState().setActiveModal('projects')}
          className="flex items-center gap-1 px-2 py-1 bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)] rounded-md text-[var(--text-primary)]"
          title="Open or create mesh projects"
          aria-label="Mesh projects"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span className="max-w-[140px] truncate font-medium">{sceneName}</span>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">r{projectRevision}</span>
        </button>

        <button
          onClick={() => autosaveStatus === 'conflict'
            ? useEditorStore.getState().setActiveModal('projects')
            : void useEditorStore.getState().saveProject()}
          aria-label={autosaveStatus === 'conflict' ? 'Resolve save conflict' : 'Save mesh project'}
          className="flex items-center gap-1 px-2 py-1 bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)] rounded-md text-[var(--text-primary)]"
          title={projectError || "Save mesh project (Ctrl+S)"}
        >
          <Save className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span className="hidden md:inline text-[11px] font-mono">
            {autosaveStatus === 'saving'
              ? 'Saving...'
              : autosaveStatus === 'saved'
              ? 'Saved'
              : autosaveStatus === 'unsaved'
              ? 'Unsaved'
              : autosaveStatus === 'conflict'
              ? 'Resolve conflict'
              : 'Offline'}
          </span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".obj"
          className="hidden"
          onChange={handleImportFile}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 bg-[var(--surface)] hover:bg-[var(--surface-hover)] border border-[var(--border)] rounded-md text-[var(--text-primary)]"
          title="Import Wavefront .OBJ Mesh"
        >
          <Upload className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span className="hidden lg:inline">Import OBJ</span>
        </button>

        <button
          onClick={() => useEditorStore.getState().setActiveModal('export')}
          className="meshforge-export flex items-center gap-1 px-2 py-1 rounded-md"
          title="Validate and export for Roblox Studio"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Studio Export</span>
        </button>

        <div className="h-4 w-[1px] bg-[var(--border)] mx-0.5" />

        <button
          onClick={() => useEditorStore.getState().undo()}
          disabled={undoCount === 0}
          className="p-1 rounded-md hover:bg-[var(--surface-hover)] disabled:opacity-35 text-[var(--text-primary)]"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => useEditorStore.getState().redo()}
          disabled={redoCount === 0}
          className="p-1 rounded-md hover:bg-[var(--surface-hover)] disabled:opacity-35 text-[var(--text-primary)]"
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Center: Live Roblox Triangle Budget & Engine Status */}
      <div className="hidden xl:flex items-center gap-2 font-mono text-[11px]">
        <div
          onClick={() => useEditorStore.getState().setInspectorTab('roblox')}
          className={`cursor-pointer flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${
            overBudget
              ? 'bg-[#36191c] border-[#7f1d1d] text-[#fca5a5]'
              : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)]'
          }`}
          title="Click to inspect Roblox Studio Compatibility Validator"
        >
          <ShieldCheck className={`w-3.5 h-3.5 ${overBudget ? 'text-[#f87171]' : 'text-[#34d399]'}`} />
          <span>
            Tris: <strong className="text-[var(--text-primary)]">{totalTris.toLocaleString()}</strong> /{' '}
            {maxBudget.toLocaleString()}
          </span>
          <span className="text-[var(--text-muted)]">|</span>
          <span>Verts: {totalVerts.toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded-md text-[var(--text-secondary)]">
          <Cpu className={`w-3.5 h-3.5 ${wasmReady ? 'text-[#34d399]' : 'text-[#f59e0b]'}`} />
          <span>{wasmReady ? 'WASM SIMD128' : 'TS Kernel'}</span>
          <span className="text-[var(--text-muted)]">|</span>
          <span>{fps} FPS</span>
          <span className="text-[var(--text-muted)]">|</span>
          <span>{drawCalls} dc ({frameTimeMs}ms)</span>
        </div>
      </div>

      {/* Right: MCP Server Connection, Panel Toggles, User Account */}
      <div className="meshforge-toolbar-group flex items-center gap-1.5">
        <button
          onClick={() => useEditorStore.getState().setActiveModal('mcp_connect')}
          className="flex items-center gap-1 px-2 py-1 bg-[var(--accent-wash)] hover:bg-[var(--surface-hover)] border border-[#2d4a77] rounded-md text-[var(--accent)] font-medium"
          title="Connect a Codex or MCP client to this project"
        >
          <Terminal className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span>Connect Codex</span>
        </button>

        <div className="flex items-center bg-[var(--surface)] border border-[var(--border)] rounded-md p-0.5">
          <button
            onClick={() => useEditorStore.getState().toggleFlag('leftSidebarOpen')}
            className={`p-1 rounded ${leftSidebarOpen ? 'bg-[var(--surface-hover)] text-white' : 'text-[var(--text-muted)]'}`}
            title="Toggle Left Tool & Outliner Panel"
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => useEditorStore.getState().toggleFlag('bottomPanelOpen')}
            className={`p-1 rounded ${bottomPanelOpen ? 'bg-[var(--surface-hover)] text-white' : 'text-[var(--text-muted)]'}`}
            title="Toggle Bottom UV / MCP / Asset Panel"
          >
            <PanelBottom className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => useEditorStore.getState().toggleFlag('rightSidebarOpen')}
            className={`p-1 rounded ${rightSidebarOpen ? 'bg-[var(--surface-hover)] text-white' : 'text-[var(--text-muted)]'}`}
            title="Toggle Right Properties Inspector"
          >
            <PanelRight className="w-3.5 h-3.5" />
          </button>
        </div>


      </div>
    </header>
  );
};
