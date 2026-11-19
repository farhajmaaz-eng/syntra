// Syntra runs every agent through the official OpenAI Codex app-server.
// The Lead orchestrator uses the stronger model; all seven subagents use the
// same default so a delegated turn is predictable and inexpensive.
export const codexLeadModel = "gpt-6.2-sol";
export const codexSubagentModel = "gpt-6.1-terra";

export const codexAgentModels = {
  Lead: {
    model: codexLeadModel,
    reason: "Main Codex orchestrator that sets up and coordinates the seven subagents",
  },
  Architect: {
    model: codexSubagentModel,
    reason: "Systems design and code-context analysis",
  },
  Builder: {
    model: codexSubagentModel,
    reason: "Luau implementation and multi-step coding tools",
  },
  Frame: {
    model: codexSubagentModel,
    reason: "Interface implementation and visual context",
  },
  Scenic: {
    model: codexSubagentModel,
    reason: "World-building scripts and visual context",
  },
  Balance: {
    model: codexSubagentModel,
    reason: "Economy calculations and progression analysis",
  },
  Tester: {
    model: codexSubagentModel,
    reason: "Independent verification with real diff and Studio evidence",
  },
  Codex: {
    model: codexSubagentModel,
    reason: "Local repository coding, checks and reviewable diffs",
  },
} as const;

export const codexAgentModel = codexSubagentModel;
export type CodexAgentName = keyof typeof codexAgentModels;
