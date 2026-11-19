import React, { useEffect, useState } from 'react';
import { useDesktopPreferences } from '@/lib/desktop';
import { TopHeader } from './components/TopHeader';
import { LeftOutlinerAndTools } from './components/LeftOutlinerAndTools';
import { RightInspector } from './components/RightInspector';
import { BottomWorkbench } from './components/BottomWorkbench';
import { EditorModals } from './components/EditorModals';
import { Viewport3D } from './viewport/Viewport3D';
import { useEditorStore } from './store/editorStore';

export const App: React.FC = () => {
  useDesktopPreferences();
  const [ready, setReady] = useState(false);
  const projectError = useEditorStore((state) => state.projectError);
  useEffect(() => {
    let active = true;
    if (window.matchMedia('(max-width: 800px)').matches) {
      useEditorStore.setState({ leftSidebarOpen: false, rightSidebarOpen: false, bottomPanelOpen: false });
    }
    void useEditorStore.getState().initEngine().finally(() => {
      if (active) setReady(true);
    });

    // Autosave debounced loop (every 6 seconds when dirty)
    const autosaveTimer = window.setInterval(() => {
      const st = useEditorStore.getState();
      if (!document.hidden && st.isDirty && st.autosaveStatus !== 'saving' && st.autosaveStatus !== 'conflict') {
        void st.saveProject();
      }
    }, 6000);

    // Live MCP synchronization loop (every 2.2 seconds)
    const mcpSyncTimer = window.setInterval(() => {
      if (!document.hidden) void useEditorStore.getState().pollMcpLiveSync();
    }, 2200);

    // Blender & Desktop Creative Software Keyboard Shortcuts
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const st = useEditorStore.getState();
      if (st.activeModal !== 'none') return;
      if (e.defaultPrevented || e.isComposing || e.altKey ||
          target?.closest('input,textarea,select,button,a,[contenteditable]')) return;
      if ((e.ctrlKey || e.metaKey) && !['z', 'y', 's', 'r'].includes(e.key.toLowerCase())) return;
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void st.saveProject();
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        st.loopCutSelectedMesh();
        return;
      }
      if (e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        st.duplicateSelectedNode();
        return;
      }

      switch (e.key) {
        case '1':
          st.setMode('vertex');
          break;
        case '2':
          st.setMode('edge');
          break;
        case '3':
          st.setMode('face');
          break;
        case '4':
          st.setMode('object');
          break;
        case 'q':
        case 'Q':
          st.setGizmoMode('select');
          break;
        case 'g':
        case 'G':
          st.setGizmoMode('translate');
          break;
        case 'r':
        case 'R':
          st.setGizmoMode('rotate');
          break;
        case 's':
        case 'S':
          st.setGizmoMode('scale');
          break;
        case 'e':
        case 'E':
          if (!ctrl) st.extrudeSelection(1.0, 1.0);
          break;
        case 'i':
        case 'I':
          if (!ctrl) st.insetSelection(0.22, 0);
          break;
        case 'b':
        case 'B':
          if (!ctrl) st.bevelSelection(0.18);
          break;
        case 'm':
        case 'M':
          if (st.mode === 'vertex') st.weldSelectedVertices();
          break;
        case 'a':
        case 'A':
          if (st.mode !== 'object') st.selectAllElements();
          break;
        case 'Delete':
        case 'Backspace':
        case 'x':
        case 'X':
          st.deleteSelected();
          break;
      }
    };

    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (useEditorStore.getState().isDirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warnUnsaved);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      active = false;
      window.clearInterval(autosaveTimer);
      window.clearInterval(mcpSyncTimer);
      window.removeEventListener('beforeunload', warnUnsaved);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!ready) return <main className="meshforge-loading" aria-busy="true">Loading Illustrate…</main>;

  return (
    <main className="meshforge flex flex-col overflow-hidden" aria-label="Syntra Illustrate editor">
      <TopHeader />
      {projectError && <div role="alert" className="meshforge-error">{projectError}</div>}
      <div className="meshforge-editor-body flex-1 flex min-h-0 overflow-hidden">
        <LeftOutlinerAndTools />
        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <Viewport3D />
          <BottomWorkbench />
        </div>
        <RightInspector />
      </div>
      <EditorModals />
    </main>
  );
};
