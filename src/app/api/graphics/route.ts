import { checkPenpotConnection, readPenpotScene } from "../../../graphics/penpot";
import {
  graphicsWorkspace,
  prepareGraphicsConnection,
  saveGraphicsConnection,
} from "../../../graphics/connection";
import { exportRobloxGui } from "../../../graphics/roblox";
import { legacyDesign, migrateLegacyDesign } from "../../../graphics/migration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Syntra Graphics request failed.";
}
export async function GET(request: Request) {
  const operation = new URL(request.url).searchParams.get("op");
  try {
    if (operation === "connect") {
      const scene = await readPenpotScene();
      return json({ page: scene.name, layers: scene.layers.length });
    }
    if (operation === "export") {
      const { xml, warnings } = exportRobloxGui(await readPenpotScene());
      return json({ xml, warnings });
    }
    const legacy = legacyDesign();
    const workspace = graphicsWorkspace();
    return json({
      url: workspace.url,
      configured: workspace.configured,
      legacy: { layers: legacy.layers.length, warnings: legacy.warnings },
    });
  } catch (error) {
    return json({ error: message(error) }, 422);
  }
}
function fromWorkspace(request: Request) {
  let sameHost = false;
  try {
    sameHost =
      new URL(request.headers.get("origin") ?? "").host ===
      request.headers.get("host");
  } catch {
    /* Non-browser requests cannot migrate a design. */
  }
  return sameHost && request.headers.get("sec-fetch-site") === "same-origin";
}
export async function POST(request: Request) {
  if (!fromWorkspace(request))
    return json({ error: "Open Syntra Graphics to migrate a design." }, 403);
  try {
    return json(await migrateLegacyDesign());
  } catch (error) {
    return json({ error: message(error) }, 422);
  }
}

export async function PUT(request: Request) {
  if (!fromWorkspace(request))
    return json({ error: "Open Syntra Graphics to save the connection." }, 403);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return json({ error: "Expected JSON." }, 415);
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let body = "",
    bytes = 0;
  try {
    if (!reader) throw new Error("Missing connection details.");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8000) {
        await reader.cancel();
        return json({ error: "Connection settings are too large." }, 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    const candidate = prepareGraphicsConnection(JSON.parse(body + decoder.decode()));
    const check = await checkPenpotConnection(candidate.connection);
    return json({ ...saveGraphicsConnection(candidate), ...check });
  } catch (error) {
    // Validation messages must never echo the typed MCP URL or its token.
    return json(
      {
        error:
          error instanceof SyntaxError
            ? "Invalid connection settings."
            : message(error),
      },
      400,
    );
  }
}
