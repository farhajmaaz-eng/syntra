"use client";
import { Button } from "./ui/button";
import { Avatar } from "./agent-avatar";
export default function AgentForm({
  agent: a,
  codexModels = [],
  busy,
  save,
}: {
  agent: any;
  codexModels?: any[];
  busy: boolean;
  save: (b: any) => void;
}) {
  return (
    <form
      className="panel form spaced"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        save({
          name: a.name,
          model: f.get("model"),
          temperature: a.temperature ?? 0.2,
          max_tokens: a.max_tokens || 4096,
          enabled: f.get("enabled") === "on",
          prompt: f.get("prompt"),
          timeout_ms: a.timeout_ms || 180000,
          context_limit: a.context_limit || 64000,
          spending_limit: 0,
        });
      }}
    >
      <h3>
        <Avatar name={a.name} size="mini" />
        {a.name} configuration
      </h3>
      <p className="muted-text">
        Every Syntra agent runs through the official OpenAI Codex app-server.
        The Lead orchestrator creates the seven subagents through delegation;
        each subagent gets its own Codex thread and model. Authentication and
        project access are configured on the Codex page.
      </p>
      <div className="form-grid">
        <label>
          Codex model ID
          <input
            name="model"
            required
            maxLength={200}
            defaultValue={a.model}
            list="codex-model-options"
          />
          <datalist id="codex-model-options">
            {codexModels
              .filter((model: any) => !model.hidden)
              .map((model: any) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
          </datalist>
        </label>
      </div>
      <p className="muted-text">
        Default topology: <strong>Lead</strong> uses <code>gpt-6.2-sol</code>;
        the seven subagents use <code>gpt-6.1-terra</code>. Refresh the model
        catalog from the Codex page before choosing a new ID.
      </p>
      <label>
        Independent system prompt
        <textarea
          name="prompt"
          rows={5}
          defaultValue={a.prompt}
          required
        />
      </label>
      <label className="checkbox">
        <input type="checkbox" name="enabled" defaultChecked={!!a.enabled} />{" "}
        Agent enabled
      </label>
      <Button disabled={busy}>Save agent settings</Button>
    </form>
  );
}
