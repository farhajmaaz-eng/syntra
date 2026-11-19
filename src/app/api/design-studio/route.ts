import { z } from "zod";
import { DesignConflict, maxDesignBytes, readDesign, saveDesign } from "../../../design-studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const respond = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

export function GET() {
  return respond(readDesign());
}

export async function PUT(request: Request) {
  const origin = request.headers.get("origin");
  let sameHost = false;
  if (origin) {
    try { sameHost = new URL(origin).host === request.headers.get("host"); }
    catch { /* An invalid origin cannot access this local write route. */ }
  }
  if (!sameHost || request.headers.get("sec-fetch-site") !== "same-origin") {
    return respond({ error: "Open Syntra Design Studio to save the document." }, 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return respond({ error: "Expected application/json." }, 415);
  }
  const limit = maxDesignBytes * 2;
  if (Number(request.headers.get("content-length")) > limit) {
    return respond({ error: "Design exceeds the save limit." }, 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return respond({ error: "Missing design." }, 400);
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return respond({ error: "Design exceeds the save limit." }, 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    const data = z.object({ scene: z.string().max(maxDesignBytes), revision: z.number().int().positive() })
      .parse(JSON.parse(body + decoder.decode()));
    return respond(saveDesign(data.scene, data.revision));
  } catch (error) {
    return respond(
      { error: error instanceof Error ? error.message : "Could not save design." },
      error instanceof DesignConflict ? 409 : 400,
    );
  }
}
