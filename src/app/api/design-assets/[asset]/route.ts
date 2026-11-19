import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";

const fonts = new Set([
  "Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-SemiBold.ttf", "Inter-Bold.ttf",
  "Inter-ExtraBold.ttf", "NotoNaskhArabic-Regular.ttf",
]);

export async function GET(_request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const wasm = asset === "canvaskit.wasm";
  if (!wasm && !fonts.has(asset)) return new Response(null, { status: 404 });
  const file = join(process.cwd(), "node_modules",
    wasm ? "canvaskit-wasm/bin" : "@open-pencil/core/assets", asset);
  const bytes = await readFile(file);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": wasm ? "application/wasm" : "font/ttf",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
