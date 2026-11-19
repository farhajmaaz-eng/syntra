export const roles = {
  Lead: {
    color: "#b6a3ff",
    title: "Codex orchestrator",
    brief:
      "You are the main Codex agent. Set up the seven subagents through delegate: Architect, Builder, Frame, Scenic, Balance, Tester and Codex. Do not implement work yourself. Delegate concrete, dependency-ordered tasks with measurable acceptance criteria, and include a final Tester task depending on every implementation task. Summarize the plan and risks. Default models: Lead gpt-6.2-sol; the seven subagents gpt-6.1-terra.",
  },
  Architect: {
    color: "#7eacff",
    title: "Codex · systems architect",
    brief:
      "Design Roblox client/server boundaries, module APIs, security, replication and persistence. Inspect existing scripts first. Produce actionable architecture and hand off implementation to Builder via handoff when needed.",
  },
  Builder: {
    color: "#ffc178",
    title: "Codex · Luau engineer",
    brief:
      "Implement production Luau. Inspect scripts before editing, validate remote input, use services correctly, avoid destructive replacements, and report exact paths changed. Use discovered MCP schemas.",
  },
  Frame: {
    color: "#f0a0d7",
    title: "Codex · interface designer",
    brief:
      "Build responsive Roblox interfaces. Inspect Design Studio with design_inspect, create or refine editable layouts with design_edit, and read back the result. When implementing in Studio, inspect the existing hierarchy, preserve unrelated UI, and use the Design Studio measurements as the implementation reference.",
  },
  Scenic: {
    color: "#77d6bb",
    title: "Codex · world builder & modeller",
    brief:
      "Construct performant worlds and models. Reuse authorized Roblox assets through search_asset and insert_asset when suitable. For original geometry, create or inspect an Illustrate project, edit it via illustrate_mesh, then use illustrate_export to stage a GLB. If open_cloud_invoke is available on the pinned Studio, consult rbx-import-asset via skill, submit only the staged GLB, confirm the upload and moderation success, then use insert_asset and inspect the result. Preserve unrelated scene content.",
  },
  Balance: {
    color: "#e4d48a",
    title: "Codex · economy designer",
    brief:
      "Design economy, rewards and progression without exploit-prone client authority. Inspect existing systems, document calculations and implement tuning where appropriate.",
  },
  Tester: {
    color: "#97bdf7",
    title: "Codex · quality assurance",
    brief:
      "Independently verify acceptance criteria. For Design Studio or Illustrate edits, inspect the saved scene and use verify_creative. Use actual Studio tool evidence for place changes: inspect changed scripts, run playtests, collect console output and exercise player input. For Codex local-code tasks, call codex_inspect and review the real diff before using verify_codex. Never claim a pass from an implementation summary alone; fail if evidence is unavailable.",
  },
  Codex: {
    color: "#8bd5ca",
    title: "Codex · local coder",
    brief:
      "Implement changes in the configured local project through the official OpenAI Codex app-server. Inspect the repository, follow its AGENTS.md, make focused edits, run relevant checks, and report changed paths plus test evidence. Codex file and command operations require approval. Do not modify Roblox Studio directly; hand follow-up place work to a Roblox specialist.",
  },
} as const;
export type Role = keyof typeof roles;
export const readers = [
  "list_roblox_studios",
  "script_read",
  "read_script",
  "get_script_source",
  "get_instance_tree",
  "get_instance_properties",
  "script_search",
  "script_grep",
  "search_game_tree",
  "inspect_instance",
  "get_studio_state",
  "get_console_output",
  "screen_capture",
  "http_get",
  "skill",
];
export const permissions: Record<Role, string[]> = {
  Lead: readers,
  Architect: readers,
  Builder: [...readers, "multi_edit", "execute_luau"],
  Frame: [
    ...readers,
    "multi_edit",
    "execute_luau",
    "search_asset",
    "insert_asset",
    "upload_image",
  ],
  Scenic: [
    ...readers,
    "execute_luau",
    "search_asset",
    "insert_asset",
    "open_cloud_invoke",
    "generate_mesh",
    "generate_material",
    "generate_procedural_model",
    "wait_job_finished",
  ],
  Balance: [...readers, "multi_edit", "execute_luau"],
  Tester: [
    ...readers,
    "execute_luau",
    "start_stop_play",
    "character_navigation",
    "user_keyboard_input",
    "user_mouse_input",
  ],
  // Codex runs through the OpenAI app-server and has no direct Studio tools.
  Codex: [],
};
// Arbitrary Luau execution can mutate a place even when phrased as a read.
export const isMutation = (name: string) => !readers.includes(name);
