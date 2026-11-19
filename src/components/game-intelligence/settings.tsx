"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { providers, type Provider, type SourceSettings } from "../../game-intelligence/model";
import styles from "./intelligence.module.css";

export default function IntelligenceSettings({ onSave }: { onSave?: () => void }) {
  const [config, setConfig] = useState<SourceSettings>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/game-intelligence/settings").then(async response => {
      if (!response.ok) throw new Error("Could not read sources.");
      const next = await response.json();
      if (active) setConfig(next);
    }).catch(() => { if (active) setStatus("Could not read sources. Reload this page to retry."); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/game-intelligence/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save sources.");
      setConfig(result);
      setStatus("Source settings saved.");
      onSave?.();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save sources.");
    } finally { setBusy(false); }
  }

  return <section className={styles.panel} id="game-intelligence-sources">
    <h2>Roblox data sources</h2>
    <p className={styles.muted}>Refresh intervals control when Syntra checks feeds while Games or a research tool is in use. Feed paths must stay on the provider's public API. RobloxGameStats offers its public API for personal and non-commercial use.</p>
    {config ? <form className={styles.sourcesForm} onSubmit={save}>
      {(Object.keys(providers) as Provider[]).map(key => {
        const provider = providers[key], source = config[key];
        const update = (changes: Partial<SourceSettings[Provider]>) =>
          setConfig(current => current && ({ ...current, [key]: { ...current[key], ...changes } }));
        return <fieldset key={key} disabled={busy}>
          <legend>{provider.name}</legend>
          <label className={styles.check}><input type="checkbox" checked={source.enabled} onChange={e => update({ enabled: e.target.checked })} /> Enabled</label>
          <label>Refresh (minutes)<input type="number" min={provider.minutes} max={1440} required value={Number.isNaN(source.minutes) ? "" : source.minutes} onChange={e => update({ minutes: e.target.valueAsNumber })} /></label>
          <label>Catalog endpoint<input type="url" required value={source.endpoint} onChange={e => update({ endpoint: e.target.value })} /></label>
          <a href={provider.docs} target="_blank" rel="noreferrer">Source documentation</a>
        </fieldset>;
      })}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save sources"}</Button>
    </form> : !status && <p role="status">Loading settings…</p>}
    {status && <p role="status">{status}</p>}
  </section>;
}
