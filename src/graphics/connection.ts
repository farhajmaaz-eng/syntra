import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { workspaceDataDirectory } from "../lib/workspace-paths";

const defaultUrl = "https://design.penpot.app/";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const loopback = (url: URL) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
const settingsSchema = z.strictObject({
  fileUrl: z.string().trim().max(3000),
  mcpUrl: z.string().trim().max(3000),
  sessionId: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{0,200}$/i, "Invalid Penpot session ID.")
    .default(""),
});

function urlFrom(value: string) {
  const url = URL.parse(value);
  if (
    !url ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url)))
  ) {
    throw new Error("Use HTTPS or a loopback HTTP address for Penpot.");
  }
  return url;
}
function fileFrom(value: string) {
  const url = urlFrom(value);
  const params = new URLSearchParams(
    url.hash.split("?")[1] ?? url.search.slice(1),
  );
  const fileId = params.get("file-id"),
    pageId = params.get("page-id");
  if (!fileId || !uuid.test(fileId) || !pageId || !uuid.test(pageId)) {
    throw new Error(
      "Open a page in your Penpot file and paste the full address from the browser.",
    );
  }
  if (params.has("userToken") || url.searchParams.has("userToken")) {
    throw new Error("Paste the address from the browser into Penpot file address.");
  }
  return { url: url.href, fileId, pageId };
}

function readConnection() {
  try {
    const path = join(workspaceDataDirectory(), "penpot-connection.json");
    return settingsSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      throw new Error("Could not read the saved Penpot connection.");
    }
    return {
      fileUrl: process.env.SYNTRA_PENPOT_FILE_URL ?? "",
      mcpUrl: process.env.SYNTRA_PENPOT_MCP_URL ?? "",
      sessionId: process.env.SYNTRA_PENPOT_SESSION_ID ?? "",
    };
  }
}

export function graphicsWorkspace() {
  const config = readConnection();
  const file = config.fileUrl
    ? fileFrom(config.fileUrl)
    : { url: defaultUrl, fileId: null, pageId: null };
  return {
    ...file,
    configured: Boolean(file.fileId && config.mcpUrl),
  };
}

function validateConnection(config: z.infer<typeof settingsSchema>) {
  const file = fileFrom(config.fileUrl);
  const mcp = urlFrom(config.mcpUrl);
  if (!(
    (mcp.origin === new URL(file.url).origin &&
      mcp.pathname === "/mcp/stream") ||
    (loopback(mcp) && mcp.pathname === "/mcp")
  )) {
    throw new Error(
      "Use the Server URL from the same Penpot site as your file, or the local Penpot MCP server URL.",
    );
  }
  return { file, mcp, sessionId: config.sessionId };
}

export function penpotConnection() {
  const config = readConnection();
  if (!config.fileUrl || !config.mcpUrl)
    throw new Error("Connect a Penpot file in Syntra Graphics first.");
  return validateConnection(settingsSchema.parse(config));
}

export function prepareGraphicsConnection(raw: unknown) {
  const candidate = z
    .strictObject({
      fileUrl: z.string(),
      mcpUrl: z.string(),
      sessionId: z.string().optional(),
    })
    .parse(raw);
  const config = settingsSchema.parse({
    ...candidate,
    mcpUrl: candidate.mcpUrl.trim() || readConnection().mcpUrl,
  });
  return { config, connection: validateConnection(config) };
}

export function saveGraphicsConnection({
  config,
  connection: { file },
}: ReturnType<typeof prepareGraphicsConnection>) {
  const dir = workspaceDataDirectory();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporary = join(dir, `penpot-connection.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(config), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, join(dir, "penpot-connection.json"));
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* Renamed successfully or never created. */
    }
  }
  return { ...file, configured: true };
}
