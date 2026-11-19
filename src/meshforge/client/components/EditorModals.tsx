import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  FolderPlus,
  Terminal,
  X,
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { validateSceneForRoblox } from '../../shared/sceneOps';
import {
  exportSceneToFBX,
  exportSceneToGLB,
  exportSceneToOBJ,
  meshExportName,
} from '../../shared/exporters';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const EditorModals: React.FC = () => {
  const activeModal = useEditorStore((s) => s.activeModal);
  const projectError = useEditorStore((s) => s.projectError);
  const conflicted = useEditorStore((s) => s.autosaveStatus === "conflict");
  const projectsList = useEditorStore((s) => s.projectsList);
  const projectId = useEditorStore((s) => s.projectId);
  const scene = useEditorStore((s) => s.scene);
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId);

  const [newProjName, setNewProjName] = useState('New Roblox Asset');
  const [projectBusy, setProjectBusy] = useState(false);

  // Export options states
  const [exportFormat, setExportFormat] = useState<'glb' | 'fbx' | 'obj'>('glb');
  const [exportScope, setExportScope] = useState<'all' | 'selected'>('all');
  const [exportScale, setExportScale] = useState<'meters_0_28' | 'centimeters_28_0' | 'studs_1_0'>(
    scene.exportUnitScale
  );
  const [exportUp, setExportUp] = useState<'Y' | 'Z'>(scene.upAxis);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const validation = useMemo(
    () => activeModal === 'export' ? validateSceneForRoblox(scene) : null,
    [activeModal, scene],
  );
  useEffect(() => {
    const dialog = dialogRef.current;
    if (activeModal === 'none' || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [activeModal]);

  if (activeModal === 'none') return null;

  const close = () => useEditorStore.getState().setActiveModal('none');

  const copyToClipboard = async (txt: string, label: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setCopiedText(label);
    } catch {
      setCopiedText("failed");
    }
    setTimeout(() => setCopiedText(null), 1800);
  };

  const handleDownloadExport = () => {
    const cleanBase = meshExportName(scene.name);
    const selectedIds =
      exportScope === 'selected' && selectedNodeId ? [selectedNodeId] : undefined;

    if (exportScope === 'selected' && !selectedNodeId) return;
    if (exportFormat === 'glb') {
      const glbBytes = exportSceneToGLB(scene, {
        scalePreset: exportScale,
        upAxis: exportUp,
        selectedNodeIds: selectedIds,
      });
      triggerDownload(
        new Blob([glbBytes.buffer as ArrayBuffer], { type: 'model/gltf-binary' }),
        `${cleanBase}.glb`
      );
      useEditorStore
        .getState()
        .addLog('roblox', `Exported binary glTF 2.0 '${cleanBase}.glb' (${glbBytes.byteLength} bytes).`, 'success');
    } else if (exportFormat === 'fbx') {
      const fbxText = exportSceneToFBX(scene, {
        scalePreset: exportScale,
        upAxis: exportUp,
        selectedNodeIds: selectedIds,
      });
      triggerDownload(new Blob([fbxText], { type: 'application/octet-stream' }), `${cleanBase}.fbx`);
      useEditorStore
        .getState()
        .addLog('roblox', `Exported Autodesk FBX 7.4 '${cleanBase}.fbx' (${fbxText.length} bytes).`, 'success');
    } else {
      const { obj, mtl } = exportSceneToOBJ(scene, {
        scalePreset: exportScale,
        upAxis: exportUp,
        selectedNodeIds: selectedIds,
        triangulate: true,
      });
      triggerDownload(new Blob([obj], { type: 'text/plain' }), `${cleanBase}.obj`);
      triggerDownload(new Blob([mtl], { type: 'text/plain' }), `${cleanBase}.mtl`);
      useEditorStore
        .getState()
        .addLog('roblox', `Exported Wavefront OBJ + MTL '${cleanBase}.obj'.`, 'success');
    }
    close();
  };

  const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const mcpUrl = `${originUrl}/api/illustrate/mcp?projectId=${encodeURIComponent(projectId)}`;
  const codexCommand = `codex mcp add syntra-illustrate --url "${mcpUrl}" --bearer-token-env-var SYNTRA_ILLUSTRATE_MCP_KEY`;
  const claudeConfigJson = JSON.stringify(
    {
      mcpServers: {
        'syntra-illustrate': {
          type: 'streamable-http',
          url: mcpUrl,
          headers: { Authorization: 'Bearer YOUR_CONFIGURED_KEY' },
        },
      },
    },
    null,
    2
  );

  return (
    <dialog ref={dialogRef} className="meshforge-dialog" aria-labelledby="meshforge-modal-title"
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <div>
        {/* Modal Header */}
        <div className="h-9 px-3 bg-[var(--app-bg)] border-b border-[var(--border)] flex items-center justify-between">
          <span id="meshforge-modal-title" className="font-semibold text-white tracking-wide text-[13px]">
            {activeModal === 'projects' && 'Mesh projects'}
            {activeModal === 'export' && 'Roblox Studio 3D Exporter (GLB / FBX / OBJ)'}
            {activeModal === 'mcp_connect' && 'Connect Codex to Illustrate'}
          </span>
          <button onClick={close} aria-label="Close dialog" className="p-1 text-[var(--text-secondary)] hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {activeModal === 'projects' && (
          <div className="p-4 space-y-3">
            {projectError && <p role="alert" className="text-[var(--danger)]">{projectError}</p>}
            <div className="p-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-md space-y-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                New mesh project
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newProjName}
                  onChange={(e) => setNewProjName(e.target.value)}
                  className="flex-1 bg-[var(--app-bg)] border border-[var(--border)] rounded-md px-2 py-1 text-white select-text"
                  placeholder="Project Name..."
                />
                <button
                  disabled={projectBusy || !newProjName.trim()}
                  onClick={async () => {
                    setProjectBusy(true);
                    try { await useEditorStore.getState().createProject(newProjName, conflicted); }
                    finally { setProjectBusy(false); }
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 bg-[var(--mesh-accent-fill)] hover:bg-[var(--mesh-accent-fill)] text-white font-medium rounded-md"
                >
                  <FolderPlus className="w-3.5 h-3.5" /> {conflicted ? "Save a copy" : "Create"}
                </button>
              </div>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {projectsList.map((p) => {
                const isCurrent = p.id === projectId;
                return (
                  <button
                    key={p.id}
                    disabled={projectBusy}
                    onClick={async () => {
                      if (isCurrent && !conflicted) { close(); return; }
                      const discard = isCurrent && conflicted;
                      if (discard && !window.confirm("Reload the saved scene and discard edits in this tab?")) return;
                      setProjectBusy(true);
                      try {
                        if (await useEditorStore.getState().loadProject(p.id, discard)) close();
                      } finally { setProjectBusy(false); }
                    }}
                    className={`w-full text-left p-2.5 rounded-md border cursor-pointer flex items-center justify-between ${
                      isCurrent
                        ? 'bg-[var(--accent-wash)] border-[var(--mesh-accent-fill)] text-white'
                        : 'bg-[var(--app-bg)] border-[var(--border)] hover:border-[var(--border)] text-[var(--text-primary)]'
                    }`}
                  >
                    <div>
                      <div className="font-semibold flex items-center gap-1.5">
                        <span>{p.name}</span>
                        <span className="text-[10px] font-mono px-1 bg-[var(--surface-raised)] text-[var(--accent)] rounded">
                          r{p.revision}
                        </span>
                      </div>
                      <div className="text-[10.5px] font-mono text-[var(--text-muted)] mt-0.5">
                        {p.triangleCount.toLocaleString()} tris • {p.objectCount} objects • ID: {p.id}
                      </div>
                    </div>
                    <span className="text-[11px] text-[var(--accent)] font-medium">
                      {isCurrent ? conflicted ? 'Reload saved' : 'Active' : 'Open'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ===================================================================
            MODAL 3: ROBLOX STUDIO EXPORT (GLB / FBX / OBJ + VALIDATION)
           =================================================================== */}
        {activeModal === 'export' && validation && (
          <div className="p-4 space-y-3">
            <p className="text-[11px] text-[var(--text-secondary)]">
              Keep GLB and +Y Up for the default Roblox Studio workflow. Open Studio’s 3D Importer to import your export.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  { id: 'glb', title: 'glTF 2.0 (.glb)', sub: 'Recommended Studio PBR' },
                  { id: 'fbx', title: 'Autodesk (.fbx)', sub: 'FBX 7.4 ASCII (28cm/st)' },
                  { id: 'obj', title: 'Wavefront (.obj)', sub: 'OBJ + MTL MeshPart' },
                ] as const
              ).map((fmt) => (
                <button
                  key={fmt.id}
                  onClick={() => {
                    setExportFormat(fmt.id);
                    if (fmt.id === 'fbx') setExportScale('centimeters_28_0');
                    else if (fmt.id === 'glb') setExportScale('meters_0_28');
                    else setExportScale('studs_1_0');
                  }}
                  className={`p-2.5 rounded-md border text-left ${
                    exportFormat === fmt.id
                      ? 'bg-[#1f304d] border-[var(--mesh-accent-fill)] text-white'
                      : 'bg-[var(--app-bg)] border-[var(--border)] text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  <div className="font-semibold text-[12px]">{fmt.title}</div>
                  <div className="text-[10px] opacity-80 mt-0.5">{fmt.sub}</div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <label className="space-y-1">
                <span className="text-[var(--text-secondary)]">Scope</span>
                <select
                  value={exportScope}
                  onChange={(e) => setExportScope(e.target.value as any)}
                  className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-white"
                >
                  <option value="all">Entire Workspace</option>
                  <option value="selected" disabled={!selectedNodeId}>
                    Selected MeshPart Only
                  </option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[var(--text-secondary)]">Roblox Scale Factor</span>
                <select
                  value={exportScale}
                  onChange={(e) => setExportScale(e.target.value as any)}
                  className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-white"
                >
                  <option value="meters_0_28">0.28m / Stud (GLB)</option>
                  <option value="centimeters_28_0">28.0cm / Stud (FBX)</option>
                  <option value="studs_1_0">1.0 Unit / Stud (Raw)</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-[var(--text-secondary)]">World Up Axis</span>
                <select
                  value={exportUp}
                  onChange={(e) => setExportUp(e.target.value as 'Y' | 'Z')}
                  className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded-md px-2 py-1.5 text-white"
                >
                  <option value="Y">+Y Up (Roblox Studio)</option>
                  <option value="Z">+Z Up (Blender)</option>
                </select>
              </label>
            </div>

            {/* Pre-Export Compatibility Summary */}
            <div className="p-2.5 bg-[var(--app-bg)] border border-[var(--border)] rounded-md font-mono text-[11px] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-secondary)]">Preset: {validation.preset}</span>
                <span className={validation.allCompatible ? 'text-[#34d399]' : 'text-[#fbbf24]'}>
                  {validation.allCompatible ? 'PASS' : 'CHECK WARNINGS'}
                </span>
              </div>
              <div className="text-[var(--text-muted)]">
                Triangles: {validation.totalTriangles.toLocaleString()} | Vertices:{' '}
                {validation.totalVertices.toLocaleString()} | Objects: {validation.meshObjects}
              </div>
            </div>

            <button
              onClick={handleDownloadExport}
              disabled={exportScope === "selected" && !selectedNodeId}
              className="w-full py-2 bg-[var(--mesh-accent-fill)] hover:bg-[var(--mesh-accent-fill)] text-white font-semibold rounded-md flex items-center justify-center gap-1.5"
            >
              <Download className="w-4 h-4" />
              <span>Download .{exportFormat.toUpperCase()} for Roblox Studio</span>
            </button>
          </div>
        )}

        {/* ===================================================================
            MODAL 4: REMOTE MCP SERVER CONFIGURATION & LIVE SYNC
           =================================================================== */}
        {activeModal === 'mcp_connect' && (
          <div className="p-4 space-y-3">
            <div className="flex items-start gap-2 p-2.5 bg-[#13221c] border border-[#1f4d37] rounded-md text-[11px] text-[#a7f3d0]">
              <CheckCircle2 className="w-4 h-4 text-[#34d399] shrink-0 mt-0.5" />
              <div>
                Scenic and Codex inside Syntra already have Illustrate tools. For Codex CLI,
                set the same <code>SYNTRA_ILLUSTRATE_MCP_KEY</code> in the Syntra server and Codex environments,
                then run the command below. Save the scene before asking an agent to edit it.
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                <span>Codex CLI</span>
                <button onClick={() => copyToClipboard(codexCommand, 'codex')} className="flex items-center gap-1 text-[var(--accent)] hover:underline">
                  <Copy className="w-3 h-3" /> {copiedText === 'codex' ? 'Copied!' : 'Copy command'}
                </button>
              </div>
              <pre className="bg-[var(--app-bg)] border border-[var(--border)] p-2 rounded-md font-mono text-[11px] select-all overflow-x-auto">{codexCommand}</pre>
            </div>
            {copiedText === "failed" && <p role="status">Clipboard unavailable. Select the text to copy it.</p>}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                <span>Streamable HTTP Endpoint (Project Scoped)</span>
                <button
                  onClick={() => copyToClipboard(mcpUrl, 'url')}
                  className="flex items-center gap-1 text-[var(--accent)] hover:underline"
                >
                  <Copy className="w-3 h-3" /> {copiedText === 'url' ? 'Copied!' : 'Copy URL'}
                </button>
              </div>
              <code className="block bg-[var(--app-bg)] border border-[var(--border)] p-2 rounded-md font-mono text-[11px] text-[var(--accent)] select-all break-all">
                {mcpUrl}
              </code>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                <span className="flex items-center gap-1">
                  <Terminal className="w-3.5 h-3.5" /> Other MCP clients
                </span>
                <button
                  onClick={() => copyToClipboard(claudeConfigJson, 'cfg')}
                  className="flex items-center gap-1 text-[var(--accent)] hover:underline"
                >
                  <Copy className="w-3 h-3" /> {copiedText === 'cfg' ? 'Copied!' : 'Copy JSON'}
                </button>
              </div>
              <pre className="bg-[var(--app-bg)] border border-[var(--border)] p-2.5 rounded-md font-mono text-[10.5px] text-[var(--text-primary)] overflow-x-auto select-all">
                {claudeConfigJson}
              </pre>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
};
