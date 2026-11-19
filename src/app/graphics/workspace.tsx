"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Download,
  Layers3,
  Link2,
  Palette,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDesktopPreferences } from "@/lib/desktop";

type Workspace = {
  url: string;
  configured: boolean;
  legacy: { layers: number; warnings: string[] };
};

async function request<T>(suffix = "", method = "GET", body?: unknown) {
  const response = await fetch("/api/graphics" + suffix, {
    method,
    cache: "no-store",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Syntra Graphics request failed.");
  return result as T;
}

function download(name: string, contents: string, type: string) {
  const object = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.download = name;
  link.href = object;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(object), 1000);
}

export default function GraphicsWorkspace() {
  useDesktopPreferences();
  const [workspace, setWorkspace] = useState<Workspace>();
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    request<Workspace>()
      .then((value) => {
        if (active) setWorkspace(value);
      })
      .catch((error: Error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  async function perform(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError("");
    setStatus("");
    setWarnings([]);
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Syntra Graphics request failed.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="graphics-workspace">
      <header className="graphics-header">
        <Link href="/" className="button button-outline">
          <ArrowLeft size={16} /> Syntra
        </Link>
        <a
          href={workspace?.url ?? "https://design.penpot.app/"}
          target="_blank"
          rel="noreferrer"
          className="button"
        >
          Open Penpot <ArrowUpRight size={16} />
        </a>
      </header>
      <section className="graphics-hero">
        <Palette size={32} aria-hidden />
        <h1>Syntra Graphics</h1>
        <p>
          Design Roblox interfaces in Penpot and import editable UI into Studio.
        </p>
      </section>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {status && (
        <p className="alert" role="status">
          {status}
        </p>
      )}
      <div className="graphics-grid">
        <section className="graphics-card">
          <Link2 size={22} aria-hidden />
          <h2>Frame and Penpot</h2>
          <p>
            Open the connected Penpot file and keep its MCP session active while
            Frame works. Use Penpot’s editor for fills, corners, components,
            layouts, and design tokens.
          </p>
          <Button
            variant="outline"
            disabled={!workspace?.configured || Boolean(busy)}
            onClick={() =>
              void perform("check", async () => {
                const result = await request<{ page: string; layers: number }>(
                  "?op=connect",
                );
                setStatus(
                  `Connected to ${result.page} · ${result.layers} layers.`,
                );
              })
            }
          >
            {busy === "check" ? "Checking…" : "Check connection"}
          </Button>
          <details>
            <summary>
              {workspace?.configured
                ? "Update Penpot connection"
                : "Connect a Penpot file"}
            </summary>
            <form
              className="graphics-connection"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = Object.fromEntries(new FormData(form));
                void perform("save", async () => {
                  const saved = await request<
                    Pick<Workspace, "url" | "configured">
                  >("", "PUT", data);
                  form.reset();
                  setWorkspace((previous) => ({
                    ...saved,
                    legacy: previous?.legacy ?? { layers: 0, warnings: [] },
                  }));
                  setStatus(
                    "Connection saved. Open the file in Penpot and check the connection.",
                  );
                });
              }}
            >
              <label>
                Penpot editor URL
                <input
                  type="url"
                  name="fileUrl"
                  required
                  maxLength={3000}
                  defaultValue={workspace?.configured ? workspace.url : ""}
                  placeholder="https://design.penpot.app/#/workspace?…"
                />
              </label>
              <label>
                Penpot MCP server URL
                <input
                  type="password"
                  name="mcpUrl"
                  required={!workspace?.configured}
                  maxLength={3000}
                  autoComplete="off"
                  placeholder={
                    workspace?.configured
                      ? "Leave blank to keep the saved URL"
                      : "Copy from Penpot’s Integrations settings"
                  }
                />
              </label>
              <label>
                Session ID
                <input
                  name="sessionId"
                  required
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Copy from the MCP menu in the open Penpot file"
                />
              </label>
              <Button type="submit" size="sm" disabled={Boolean(busy)}>
                {busy === "save" ? "Saving…" : "Save connection"}
              </Button>
            </form>
            <a
              href="https://help.penpot.dev/mcp/"
              target="_blank"
              rel="noreferrer"
            >
              Penpot MCP setup <ArrowUpRight size={14} />
            </a>
          </details>
        </section>
        <section className="graphics-card">
          <Download size={22} aria-hidden />
          <h2>Roblox UI export</h2>
          <p>
            Select a board in Penpot and download a <code>.rbxmx</code> model.
            Insert it from file under <strong>StarterGui</strong> in Roblox
            Studio.
          </p>
          <Button
            disabled={!workspace?.configured || Boolean(busy)}
            onClick={() =>
              void perform("export", async () => {
                const result = await request<{
                  xml: string;
                  warnings: string[];
                }>("?op=export");
                download(
                  "syntra-graphics.rbxmx",
                  result.xml,
                  "application/xml",
                );
                setWarnings(result.warnings);
                setStatus("Roblox UI model downloaded.");
              })
            }
          >
            {busy === "export" ? "Preparing export…" : "Download editable UI"}
          </Button>
          <p>
            Export complex artwork as PNG in Penpot, then import it into Studio
            as an image asset.
          </p>
        </section>
        {Boolean(
          workspace?.legacy.layers || workspace?.legacy.warnings.length,
        ) && (
          <section className="graphics-card">
            <Layers3 size={22} aria-hidden />
            <h2>Saved Design Studio archive</h2>
            <p>
              Copy {workspace!.legacy.layers} supported saved layers into a
              board on the connected page.
            </p>
            <Button
              variant="outline"
              disabled={
                !workspace?.configured ||
                !workspace.legacy.layers ||
                Boolean(busy)
              }
              onClick={() =>
                void perform("migrate", async () => {
                  const result = await request<{
                    imported: number;
                    warnings: string[];
                  }>("", "POST");
                  setWarnings(result.warnings);
                  setStatus(
                    result.imported
                      ? `Copied ${result.imported} layers to Penpot.`
                      : "This saved revision is already present in Penpot.",
                  );
                })
              }
            >
              <Upload size={16} />{" "}
              {busy === "migrate" ? "Copying…" : "Copy saved design"}
            </Button>
            <a href="/api/design-studio" download="syntra-design-archive.json">
              Download original archive
            </a>
            {workspace!.legacy.warnings.length > 0 && (
              <details>
                <summary>Review migration differences</summary>
                <ul>
                  {workspace!.legacy.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
      </div>
      {warnings.length > 0 && (
        <section className="graphics-card">
          <h2>Review after transfer</h2>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
