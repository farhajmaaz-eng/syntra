import { createHash, randomUUID } from "node:crypto";
import { db, get } from "./store";
import { canRememberApproval } from "../src/lib/approval-display";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, stable(item)]));
  return value;
}

export function canonicalPermissionInput(value: unknown) {
  return JSON.stringify(stable(value));
}

export function studioApprovalScope(
  run: { game_id: string; studio_id: string },
  agent: string,
  tool: string,
  args: unknown,
) {
  if (!canRememberApproval({ provider: "studio", tool, args }) || !run.game_id || !run.studio_id) return "";
  const project = db.prepare("SELECT place_id,universe_id FROM games WHERE id=?").get(run.game_id);
  if (!project) return "";
  return createHash("sha256").update(canonicalPermissionInput({
    agent, tool, args, studio: run.studio_id, project, game: run.game_id,
    connector: [get("mcpCommand"), get("mcpArgs")],
  })).digest("hex");
}

export function rememberedApproval(scope: string) {
  return scope && (db.prepare("SELECT id FROM permission_grants WHERE scope=?")
    .get(scope) as { id: string } | undefined)?.id;
}

export function auditPermission(id: string, verdict: string, note: string) {
  db.prepare("INSERT INTO review_events(id,target_kind,target_id,verdict,note) VALUES (?,'permission',?,?,?)")
    .run(randomUUID(), id, verdict, note);
}
