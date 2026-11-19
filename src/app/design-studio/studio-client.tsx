"use client";

import Link from "next/link";
import { preload, preloadModule } from "react-dom";
import { ArrowLeft, Focus, MousePointer2, Redo2, Save, Square, Circle, Type, Frame, Hand, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDesktopPreferences } from "@/lib/desktop";
import { canvasModuleUrl, canvasWasmUrl } from "@/design-studio/assets";
import type { CanvasLayer, CanvasTool, DesignCanvas, mountDesignCanvas, prepareDesignCanvas } from "@/design-studio/canvas";

function loadCanvasRuntime(): Promise<{ mountDesignCanvas: typeof mountDesignCanvas; prepareDesignCanvas: typeof prepareDesignCanvas }> {
  // The Vue/CanvasKit runtime is prebundled separately to keep Next's graph and
  // Android build memory small. It mounts in this page's own DOM.
  const url = canvasModuleUrl;
  return import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
}

const tools = [
  ["SELECT", "Select", MousePointer2], ["HAND", "Pan", Hand], ["FRAME", "Frame", Frame],
  ["RECTANGLE", "Rectangle", Square], ["ELLIPSE", "Ellipse", Circle], ["TEXT", "Text", Type],
] as const;
type SavedDesign = { scene: string; revision: number };

export default function DesignStudioClient() {
  preloadModule(canvasModuleUrl);
  preload(canvasWasmUrl, { as: "fetch", crossOrigin: "anonymous", type: "application/wasm" });
  useDesktopPreferences();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<DesignCanvas | null>(null);
  const revision = useRef(0);
  const generation = useRef(0);
  const saved = useRef(0);
  const busy = useRef(false);
  const conflict = useRef(false);
  const [active, setActive] = useState<CanvasTool>("SELECT");
  const [layers, setLayers] = useState<CanvasLayer[]>([]);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Opening design…");
  const [error, setError] = useState("");
  const [restart, setRestart] = useState(0);

  const save = useCallback(async () => {
    if (!canvas.current || busy.current || generation.current === saved.current || conflict.current) return;
    busy.current = true;
    const current = generation.current;
    setStatus("Saving…");
    try {
      const response = await fetch("/api/design-studio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: revision.current, scene: canvas.current.document() }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) conflict.current = true;
        throw new Error(result.error || "Could not save design.");
      }
      revision.current = result.revision;
      saved.current = current;
      setStatus(generation.current === current ? "Saved locally" : "Unsaved edits");
      setError("");
    } catch (error) {
      setStatus(conflict.current ? "Save conflict" : "Unsaved edits");
      setError(error instanceof Error ? error.message : "Could not save design.");
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let polling = false;
    const controller = new AbortController();
    let mount: typeof import("@/design-studio/canvas").mountDesignCanvas | undefined;

    async function open(data: SavedDesign) {
      if (!host.current || !mount || disposed) return;
      canvas.current?.dispose();
      canvas.current = null;
      revision.current = data.revision;
      generation.current = saved.current = 0;
      conflict.current = false;
      setActive("SELECT");
      const instance = await mount(host.current, data.scene, {
        changed() { generation.current++; setStatus("Unsaved edits"); },
        layers: (next) => { if (!disposed) setLayers(next); },
        ready() { if (!disposed) { setReady(true); setStatus("Saved locally"); } },
        failed(message) { if (!disposed) { setError(message); setStatus("Canvas unavailable"); } },
      });
      if (disposed) instance.dispose();
      else canvas.current = instance;
    }

    const load = async () => {
      const response = await fetch("/api/design-studio", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Could not load the saved design.");
      return response.json() as Promise<SavedDesign>;
    };
    const runtime = loadCanvasRuntime().then(async module => {
      if (!disposed) await module.prepareDesignCanvas();
      return module;
    });
    void Promise.all([runtime, load()]).then(async ([module, scene]) => {
      mount = module.mountDesignCanvas;
      await open(scene);
    }).catch((error) => {
      if (!disposed) { setError(String(error.message || error)); setStatus("Canvas unavailable"); }
    });
    const timer = setInterval(async () => {
      if (document.hidden || disposed || !canvas.current || polling || busy.current || conflict.current) return;
      if (generation.current !== saved.current) { void save(); return; }
      polling = true;
      try {
        const data = await load();
        if (!disposed && data.revision > revision.current && generation.current === saved.current && !busy.current) {
          await open(data);
        }
      } catch {
        // A later poll can recover a transient connection error.
      } finally {
        polling = false;
      }
    }, 2500);
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (generation.current !== saved.current) event.preventDefault();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", beforeUnload);
      canvas.current?.dispose();
      canvas.current = null;
    };
  }, [restart, save]);

  function reload() {
    if (busy.current) return;
    if (generation.current !== saved.current && !window.confirm("Discard local edits and reload the saved design?")) return;
    setReady(false);
    setError("");
    setStatus("Opening design…");
    setRestart((current) => current + 1);
  }

  const selected = layers.find((layer) => layer.selected);

  return (
    <main className="design-workspace" aria-label="Syntra Design Studio">
      <header className="design-toolbar">
        <Link href="/" className="button button-outline" aria-label="Back to Syntra"><ArrowLeft size={16} /> Syntra</Link>
        <h1>Design Studio</h1>
        <div className="design-tools" aria-label="Canvas tools">
          {tools.map(([tool, name, Icon]) => (
            <Button key={tool} variant={active === tool ? "default" : "ghost"} size="sm" title={name}
              aria-label={name} aria-pressed={active === tool} disabled={!ready}
              onClick={() => { canvas.current?.setTool(tool); setActive(tool); }}><Icon size={16} /></Button>
          ))}
        </div>
        <div className="design-actions">
          <Button variant="ghost" size="sm" aria-label="Undo" disabled={!ready} onClick={() => canvas.current?.undo()}><Undo2 size={16} /></Button>
          <Button variant="ghost" size="sm" aria-label="Redo" disabled={!ready} onClick={() => canvas.current?.redo()}><Redo2 size={16} /></Button>
          <Button variant="ghost" size="sm" aria-label="Fit design" disabled={!ready} onClick={() => canvas.current?.fit()}><Focus size={16} /></Button>
          <Button size="sm" disabled={!ready} onClick={() => void save()}><Save size={15} /> Save</Button>
        </div>
      </header>
      {error && <div className="alert error design-error" role="alert">{error} <Button variant="outline" size="sm" onClick={reload}>Reload saved design</Button></div>}
      <div className="design-body">
        <aside className="design-layers" aria-label="Layers">
          <div className="design-layer-heading"><strong>Layers</strong>
            <Button variant="ghost" size="sm" aria-label="Delete selected layers"
              disabled={!layers.some((layer) => layer.selected)} onClick={() => canvas.current?.deleteSelection()}><Trash2 size={15} /></Button>
          </div>
          {layers.map(({ id, name, type, selected }) => (
            <button key={id} className="design-layer" aria-pressed={selected} onClick={() => canvas.current?.select(id)}>
              <span>{name || type}</span><small>{type.toLowerCase()}</small>
            </button>
          ))}
          {!layers.length && <p className="muted-text">Choose a canvas tool to draw your first layer.</p>}
          {selected && (
            <section className="design-properties" aria-label="Selected layer properties">
              <label>Name<input key={selected.id + selected.name} maxLength={200} defaultValue={selected.name}
                onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== selected.name) canvas.current?.update(selected.id, { name });
                }} /></label>
              <div className="design-dimensions">
                {(["x", "y", "width", "height"] as const).map((field) => (
                  <label key={field}>{field}<input type="number" step="any"
                    key={selected.id + field + selected[field]} defaultValue={Math.round(selected[field] * 100) / 100}
                    onBlur={(event) => {
                      const value = event.currentTarget.valueAsNumber;
                      if (Number.isFinite(value) && Math.abs(value) <= 100000 &&
                          (!["width", "height"].includes(field) || value > 0) &&
                          value !== Math.round(selected[field] * 100) / 100) {
                        canvas.current?.update(selected.id, { [field]: value });
                      }
                    }} /></label>
                ))}
              </div>
              {selected.type === "TEXT" && <label>Text<textarea key={selected.id + selected.text}
                maxLength={4000} defaultValue={selected.text}
                onBlur={(event) => {
                  const text = event.currentTarget.value;
                  if (text !== selected.text) canvas.current?.update(selected.id, { text });
                }} /></label>}
            </section>
          )}
        </aside>
        <div ref={host} className="design-canvas-host" aria-label="Design canvas" />
      </div>
      <footer className="design-status" role="status">{status}</footer>
    </main>
  );
}
