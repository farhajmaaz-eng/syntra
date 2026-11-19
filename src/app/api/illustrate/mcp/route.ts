import { POST as meshPost } from "../../meshforge/[...action]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return meshPost(request, { params: Promise.resolve({ action: ["mcp"] }) });
}
