import { open } from "node:fs/promises";
import { canvasWasmUrl } from "../../../../design-studio/assets";
import { join } from "node:path";

export const runtime = "nodejs";

const fonts = new Set([
  "Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-SemiBold.ttf", "Inter-Bold.ttf",
  "Inter-ExtraBold.ttf", "NotoNaskhArabic-Regular.ttf",
]);

export async function GET(request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const wasm = asset === "canvaskit.wasm";
  if (!wasm && !fonts.has(asset)) return new Response(null, { status: 404 });
  const file = join(process.cwd(), "node_modules",
    wasm ? "canvaskit-wasm/bin" : "@open-pencil/core/assets", asset);
  const handle = await open(file);
  const versioned = wasm && new URL(request.url).search === canvasWasmUrl.slice(canvasWasmUrl.indexOf("?"));
  return new Response(handle.readableWebStream({ autoClose: true }) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": wasm ? "application/wasm" : "font/ttf",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
