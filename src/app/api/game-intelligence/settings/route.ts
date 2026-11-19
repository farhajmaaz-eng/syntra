import { settings, saveSettings } from "../../../../game-intelligence/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(settings(), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
  const origin = request.headers.get("origin");
  let sameHost = false;
  if (origin) {
    try { sameHost = new URL(origin).host === request.headers.get("host"); }
    catch { /* Invalid origins are rejected. */ }
  }
  if (!sameHost || request.headers.get("sec-fetch-site") !== "same-origin") {
    return Response.json({ error: "Open Syntra Settings to save providers." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "Expected application/json." }, { status: 415 });
  }
  const reader = request.body?.getReader();
  try {
    if (!reader) throw new Error("Missing settings");
    const decoder = new TextDecoder();
    let text = "", size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12_000) {
        await reader.cancel();
        return Response.json({ error: "Settings exceed the size limit." }, { status: 413 });
      }
      text += decoder.decode(value, { stream: true });
    }
    return Response.json(saveSettings(JSON.parse(text + decoder.decode())));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save settings." }, { status: 400 });
  }
}
