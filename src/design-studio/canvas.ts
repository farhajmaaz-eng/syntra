import { createApp, defineComponent, h, reactive } from "vue";
import { CanvasRoot, CanvasSurface, provideEditor } from "@open-pencil/vue";
import { createDefaultEditorState, createEditor } from "@open-pencil/core/editor";
import { getCanvasKit } from "@open-pencil/core/canvaskit";
import { fontManager } from "@open-pencil/core/text";
import { decodeDesign, encodeDesign, type layerTypes } from "./scene";

export type CanvasTool = "SELECT" | "HAND" | (typeof layerTypes)[number];
export type CanvasLayer = {
  id: string; name: string; type: string; selected: boolean;
  x: number; y: number; width: number; height: number; text: string;
};
export type DesignCanvas = {
  dispose(): void;
  document(): string;
  setTool(tool: CanvasTool): void;
  select(id: string): void;
  update(id: string, changes: { name?: string; text?: string; x?: number; y?: number; width?: number; height?: number }): void;
  deleteSelection(): void;
  fit(): void;
  undo(): void;
  redo(): void;
};

let canvasKitReady: ReturnType<typeof getCanvasKit> | undefined;
export async function mountDesignCanvas(
  host: HTMLElement,
  serialized: string,
  callbacks: {
    changed(): void;
    layers(layers: CanvasLayer[]): void;
    ready(): void;
    failed(message: string): void;
  },
): Promise<DesignCanvas> {
  fontManager.setOnlineFontProviders({ google: false, fontsource: false, bunny: false, fontshare: false });
  fontManager.setBundledFontLocator((asset) => "/api/design-assets/" + asset.split("/").at(-1));
  canvasKitReady ??= getCanvasKit({ locateFile: () => "/api/design-assets/canvaskit.wasm" }).catch((error) => {
    canvasKitReady = undefined;
    throw error;
  });
  await canvasKitReady;
  const graph = decodeDesign(serialized);
  const state = reactive(createDefaultEditorState(graph.getPages()[0].id));
  const editor = createEditor({ graph, state });
  function announceLayers() {
    callbacks.layers(Array.from(graph.getAllNodes())
      .filter((node) => node.id !== graph.rootId && node.type !== "CANVAS")
      .map(({ id, name, type, x, y, width, height, text }) => ({
        id, name, type, x, y, width, height, text, selected: state.selectedIds.has(id),
      })));
  }
  let pending = 0;
  const changed = () => {
    if (graph.isApplyingLayout) return;
    callbacks.changed();
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(announceLayers);
  };
  const offGraph = graph.onNodeEvents({ created: changed, updated: changed, deleted: changed, reordered: changed, reparented: changed });
  const offSelected = editor.onEditorEvent("selection:changed", announceLayers);
  const app = createApp(defineComponent({
    setup() {
      provideEditor(editor);
      return () => h(CanvasRoot, {
        class: "design-canvas-root",
        onReady: () => { editor.zoomToFit(); callbacks.ready(); },
        onFailed: () => callbacks.failed("OpenPencil could not start the canvas."),
      }, () => h(CanvasSurface, { class: "design-surface" }));
    },
  }));
  app.config.errorHandler = (error) => callbacks.failed(error instanceof Error ? error.message : "Design canvas failed.");
  app.mount(host);
  announceLayers();
  return {
    document: () => encodeDesign(graph),
    setTool: (tool) => editor.setTool(tool),
    select: (id) => editor.select([id]),
    update: (id, changes) => editor.updateNode(id, changes),
    deleteSelection: () => editor.deleteSelected(),
    fit: () => editor.zoomToFit(),
    undo: () => editor.undo.undo(),
    redo: () => editor.undo.redo(),
    dispose() {
      offGraph();
      offSelected();
      cancelAnimationFrame(pending);
      app.unmount();
      editor.dispose();
    },
  };
}
