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
        <section className="graphics-card graphics-connect-card">
          <Link2 size={22} aria-hidden />
          <h2>Connect Penpot</h2>
          <form
            className="graphics-connection"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = Object.fromEntries(new FormData(form));
              void perform("connect", async () => {
                const saved = await request<
                  Pick<Workspace, "url" | "configured"> & { page: string }
                >("", "PUT", data);
                const serverUrl = form.elements.namedItem("mcpUrl");
                if (serverUrl instanceof HTMLInputElement) serverUrl.value = "";
                setWorkspace((previous) => ({
                  url: saved.url,
                  configured: saved.configured,
                  legacy: previous?.legacy ?? { layers: 0, warnings: [] },
                }));
                setStatus(
                  `Connected to ${saved.page}. Keep the Penpot tab open while Frame works.`,
                );
              });
            }}
          >
            <label>
              Server URL
              <small>
                In Penpot, go to Your account → Integrations → MCP Server.
                Enable it, generate an MCP key if prompted, then choose Copy server URL.
              </small>
              <input
                type="password"
                name="mcpUrl"
                required={!workspace?.configured}
                maxLength={3000}
                autoComplete="off"
                placeholder={workspace?.configured ? "Leave blank to use the saved URL" : undefined}
              />
            </label>
            <label>
              Penpot file address
              <small>
                Open the page you want to use. Choose MCP → Connect, then
                paste the address from your browser.
              </small>
              <input
                type="url"
                name="fileUrl"
                required
                maxLength={3000}
                defaultValue={workspace?.configured ? workspace.url : ""}
              />
            </label>
            <p className="graphics-connection-note">
              Keep MCP connected only in the Penpot tab you want to use.
              Choose MCP → Disconnect in any other connected tabs.
            </p>
            <Button type="submit" size="sm" disabled={Boolean(busy) || !workspace}>
              {busy === "connect" ? "Connecting…" : "Connect"}
            </Button>
          </form>
          <a href="https://help.penpot.dev/mcp/" target="_blank" rel="noreferrer">
            Penpot MCP setup <ArrowUpRight size={14} />
          </a>
        </section>
        <section className="graphics-card graphics-export-card">
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
