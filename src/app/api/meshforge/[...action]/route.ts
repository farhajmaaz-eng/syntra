import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { handleMcpHttpRequest } from "../../../../meshforge/mcp";
import {
  createMeshProject, defaultMeshProject, listMeshProjects, maxMeshBodyBytes,
  MeshProjectError, readMeshProject, saveMeshProject, syncMeshProject,
} from "../../../../meshforge/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBody(request: Request, limit: number) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new MeshProjectError("Expected application/json.", 415);
  }
  if (Number(request.headers.get("content-length")) > limit) {
    throw new MeshProjectError("Request is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new MeshProjectError("Missing JSON body.", 400);
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      void reader.cancel();
      throw new MeshProjectError("Request is too large.", 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode()) as unknown;
}

function fromEditor(request: Request) {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function hasMcpKey(request: Request) {
  const configured = process.env.SYNTRA_ILLUSTRATE_MCP_KEY || process.env.SYNTRA_MESHFORGE_MCP_KEY;
  const header = request.headers.get("authorization");
  if (!configured || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(configured);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const saveBody = z.object({ scene: z.unknown(), revision });

async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string[] }> },
) {
  const action = await params.then(({ action }) => action);
  const [resource, id, operation] = action;
  const url = new URL(request.url);
  try {
    if ((resource === "mcp" || resource === "tools") && action.length === 1) {
      if (request.method !== "POST") {
        return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
      }
      const editor = resource === "tools";
      if (editor ? !fromEditor(request) : !hasMcpKey(request)) {
        return json({ error: "Illustrate tool authorization required." }, editor ? 403 : 401);
      }
      const projectId = url.searchParams.get("projectId") || defaultMeshProject;
      const actor = editor ? "editor" : "mcp";
      const checkScope = (id: string) => {
        if (id !== projectId) throw new MeshProjectError("Tool project must match the endpoint project.", 403);
      };
      return await handleMcpHttpRequest(request, {
        async loadProject(id) {
          checkScope(id);
          const { scene: doc, revision } = readMeshProject(id);
          return { doc, revision };
        },
        async saveProject(id, doc, expectedRevision, toolName, argsJson, summary) {
          checkScope(id);
          return saveMeshProject(id, expectedRevision, doc, { actor, toolName, argsJson, summary }).revision;
        },
      }, projectId, await readBody(request, 128 * 1024));
    }

    if (resource !== "projects") return json({ error: "Not found." }, 404);
    if (request.method === "GET") {
      if (action.length === 1) return json({ projects: listMeshProjects() });
      if (action.length === 2) return json(readMeshProject(id));
      if (action.length === 3 && operation === "sync") {
        const sinceRevision = revision.parse(Number(url.searchParams.get("sinceRevision") || 0));
        const sinceEventId = revision.parse(Number(url.searchParams.get("sinceEventId") || 0));
        return json(syncMeshProject(id, sinceRevision, sinceEventId));
      }
    }

    if (request.method === "POST" && action.length === 1) {
      if (!fromEditor(request)) return json({ error: "Open the Syntra editor to create a project." }, 403);
      const { scene } = z.object({ scene: z.unknown() }).parse(await readBody(request, maxMeshBodyBytes));
      return json(createMeshProject(scene), 201);
    }
    if (request.method === "PUT" && action.length === 2) {
      if (!fromEditor(request)) return json({ error: "Open the Syntra editor to save a project." }, 403);
      const { scene, revision } = saveBody.parse(await readBody(request, maxMeshBodyBytes));
      return json(saveMeshProject(id, revision, scene));
    }
    return json({ error: "Not found." }, 404);
  } catch (error) {
    if (error instanceof MeshProjectError) return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ error: "Invalid mesh scene or request." }, 400);
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON." }, 400);
    return json({ error: "MeshForge storage is unavailable." }, 500);
  }
}

export { handle as GET, handle as POST, handle as PUT };
