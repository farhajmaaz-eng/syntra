export function actionBodyLimit(path: string) {
  if (["chat", "tasks/create", "agents/message", "agents", "plans/approve", "codex/session/turn", "attention/reply", "review"].includes(path))
    return 8 * 1024 * 1024;
  if (path === "assets/save") return 3000000;
  if (["market/import", "telemetry/import"].includes(path)) return 1000000;
  return 128000;
}
