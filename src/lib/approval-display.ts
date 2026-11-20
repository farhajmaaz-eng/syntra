import { operationRisk } from "./feature-contracts";
import { readers } from "./roles";

type Approval = { provider?: string; tool: string; args?: unknown };

export function approvalArgs(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function approvalRisk(approval: Approval) {
  if (approval.provider === "codex" && /^(codex\/command|codex\/permissions)$/.test(approval.tool))
    return approval.tool === "codex/command" ? "command execution" : "expanded permissions";
  const args = approvalArgs(approval.args);
  if (approval.tool === "codex/fileChange") {
    if (args.grantRoot) return "expanded permissions";
    if (Array.isArray(args.files) && args.files.some((file) => {
      const kind = approvalArgs(approvalArgs(file).kind);
      return kind.type === "delete" || kind.move_path || kind.movePath;
    })) return "destructive operation";
  }
  if ((approval.tool === "design_edit" && Array.isArray(args.actions) &&
       args.actions.some((action) => approvalArgs(action).action === "delete")) ||
      (approval.tool === "illustrate_mesh" && args.tool === "delete_node"))
    return "destructive operation";
  return approval.tool === "open_cloud_invoke" && args.method === "GET" ? null : operationRisk(approval.tool);
}

export function studioReads(tool: string, args: unknown) {
  return readers.includes(tool) || ["search_asset", "wait_job_finished"].includes(tool) ||
    (tool === "open_cloud_invoke" && approvalArgs(args).method === "GET");
}

export function canRememberApproval(approval: Approval) {
  return approval.provider === "studio" && ["multi_edit", "insert_asset"].includes(approval.tool) && !approvalRisk(approval);
}

export function describeApproval(approval: Approval) {
  const args = approvalArgs(approval.args);
  const risk = approvalRisk(approval);
  const string = (...values: unknown[]) => values.find((value): value is string => typeof value === "string" && !!value);
  const files = Array.isArray(args.files) ? args.files : [];
  const resource = string(args.path, args.file_path, args.target_path, args.assetId, args.asset_id, args.projectId, args.grantRoot,
    files.length === 1 ? approvalArgs(files[0]).path : files.length ? `${files.length} project files` : undefined, args.cwd, args.studio_id);
  const action = {
    "multi_edit": "Edit a Roblox script",
    "insert_asset": "Insert a Roblox asset",
    "execute_luau": "Run Luau code in Studio",
    "open_cloud_invoke": "Call Roblox Open Cloud",
    "start_stop_play": (args.is_start ?? args.start ?? (args.mode === "start_play" || args.mode === "run_server")) ? "Start a Studio playtest" : "Stop a Studio playtest",
    "codex/command": "Run a local command",
    "codex/fileChange": "Modify local project files",
    "codex/permissions": "Request additional permissions",
    "codex/question": "Answer a Codex question",
    "design_edit": "Edit layers in Syntra Graphics",
    "illustrate_mesh": "Modify an Illustrate model",
  }[approval.tool] || approval.tool.replaceAll("_", " ");
  return {
    action, resource: resource || (approval.tool === "design_edit" ? "Connected Penpot page" : approval.provider === "codex" ? "Codex project" : "Pinned Studio"),
    risk,
    detail: string(args.command, args.reason),
    effect: risk ? `This request can perform ${risk}. Review its exact details before allowing it.`
      : studioReads(approval.tool, args) ? "Reads workspace information."
        : "Can change the affected workspace. Exact details are available below.",
  };
}
