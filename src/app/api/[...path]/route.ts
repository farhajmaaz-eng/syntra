import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function proxyExternal(req: NextRequest, path: string[]) {
  const secret = await readFile(
    resolve(process.env.FORGE_DATA_DIR || ".data", "worker.secret"),
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
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(330000),
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

  if (req.method === "GET" && joinedPath === "health") {
    if (!externalMode) {
      const service = await import("../../../../worker/service");
      service.ensureEmbeddedWorkerStarted();
    }
    return NextResponse.json(
      {
        ok: true,
        mode: externalMode ? "external" : "embedded",
        uptimeSec: Math.round(process.uptime()),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (externalMode) {
    try {
      return await proxyExternal(req, path);
    } catch {
      return NextResponse.json(
        {
          error: "Worker unavailable. Run npm run worker in a separate terminal.",
        },
        { status: 503 },
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

    const raw = await req.text();
    const limit =
      joinedPath === "assets/save"
        ? 3000000
        : ["market/import", "telemetry/import"].includes(joinedPath)
          ? 1000000
          : 128000;
    if (raw.length > limit) {
      throw new Error("Request too large");
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
