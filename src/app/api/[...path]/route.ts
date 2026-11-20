import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { workspaceDataDirectory } from "@/lib/workspace-paths";
import { actionBodyLimit } from "@/lib/action-body-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readActionBody(req: NextRequest, path: string) {
  if (!req.body) return "";
  const limit = actionBodyLimit(path);
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return raw + decoder.decode();
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error(`Request body exceeds ${limit.toLocaleString()} bytes.`);
      }
      raw += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function proxyExternal(req: NextRequest, path: string[], raw: string) {
  const secret = await readFile(
    resolve(workspaceDataDirectory(), "worker.secret"),
    "utf8",
  );
  const r = await fetch(
    `http://127.0.0.1:${process.env.WORKER_PORT || 4318}/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`,
    {
      method: req.method,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: req.method === "POST" ? raw : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(path[0] === "health" ? 2000 : 330000),
    },
  );
  return new NextResponse(await r.arrayBuffer(), {
    status: r.status,
    headers: {
      "Content-Type": r.headers.get("Content-Type") || "application/json",
      "Content-Disposition": r.headers.get("Content-Disposition") || "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const joinedPath = path.join("/");
  const externalMode = process.env.WORKER_EXTERNAL === "1";
  let raw = "";

  if (req.method === "POST") {
    const origin = req.headers.get("origin");
    const fetchSite = req.headers.get("sec-fetch-site");
    const originHost = origin && URL.parse(origin)?.host;
    if ((origin && originHost !== req.headers.get("host")) ||
        (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
      return NextResponse.json({ error: "Open the Syntra workspace to change its state." }, { status: 403 });
    }
    try {
      raw = await readActionBody(req, joinedPath);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read the request body." }, { status: 413 });
    }
  }

  if (req.method === "GET" && joinedPath === "health" && !externalMode) {
    const service = await import("../../../../worker/service");
    service.ensureEmbeddedWorkerStarted();
    return NextResponse.json(
      {
        ok: true,
        mode: "embedded",
        uptimeSec: Math.round(process.uptime()),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (externalMode) {
    try {
      return await proxyExternal(req, path, raw);
    } catch {
      return NextResponse.json(
        {
          error: "Worker unavailable. Run npm run worker in a separate terminal.",
          ...(joinedPath === "health" ? { ok: false, mode: "external" } : {}),
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const service = await import("../../../../worker/service");
  service.ensureEmbeddedWorkerStarted();

  try {
    if (req.method === "GET") {
      const result = service.handleWorkerGet(
        joinedPath,
        req.nextUrl.searchParams,
      );
      if (result.kind === "binary") {
        return new NextResponse(new Uint8Array(result.bytes), {
          status: 200,
          headers: {
            "Content-Type": result.mime,
            "Content-Disposition": `${result.inline ? "inline" : "attachment"}; filename="${result.filename}"`,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
          },
        });
      }
      if (result.kind === "json") {
        return NextResponse.json(result.data, {
          headers: { "Cache-Control": "no-store" },
        });
      }
      return NextResponse.json(
        {},
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (req.method !== "POST") {
      return NextResponse.json(
        {},
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    let body: unknown = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON request body" },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    const result = await service.action(joinedPath, body);
    return NextResponse.json(service.publicData(result), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: service.redact(e) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export { handle as GET, handle as POST };
