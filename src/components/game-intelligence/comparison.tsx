"use client";

import { useState } from "react";
import { ArrowUpRight, GitCompareArrows, Lightbulb, X } from "lucide-react";
import { Button } from "../ui/button";
import { comparisonLimit, comparisonSnapshot, researchBrief } from "../../game-intelligence/comparison";
import { providers, type Game } from "../../game-intelligence/model";
import styles from "./intelligence.module.css";

const fields = {
  playing: "Concurrent players",
  visits: "Visits",
  favorites: "Favorites",
  rating: "Approval",
  growth: "24h CCU change",
} as const;
export default function Comparison({ games, remove, clear, act, draft, disabled }: {
  games: Game[];
  remove: (key: string) => void;
  clear: () => void;
  act: (path: string, body: unknown) => Promise<{ id?: string } | undefined>;
  draft: (prompt: string) => void;
  disabled: boolean;
}) {
  const [concept, setConcept] = useState("");
  const [error, setError] = useState("");
  const identifiedCount = games.filter(game => game.universeId !== null).length;

  async function handoff() {
    setError("");
    try {
      const result = await act("market/import", comparisonSnapshot(games, Date.now()));
      if (!result?.id) throw new Error("Could not save the comparison to Market. Check the worker connection and try again.");
      draft(researchBrief(result.id, concept));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the comparison.");
    }
  }

  return <section className={styles.panel} aria-label="Experience comparison">
    <div className={styles.listHeading}>
      <h3><GitCompareArrows size={17} /> Compare experiences</h3>
      <Button variant="ghost" size="sm" onClick={clear}>Clear selection</Button>
    </div>
    <p className={styles.muted}>{games.length} of {comparisonLimit} selected. Each cell links to its source and shows when it was observed.</p>
    <div className={styles.historyTable}>
      <table className={styles.comparisonTable}>
        <thead><tr><th scope="col">Metric</th>{games.map(game => <th key={game.key} scope="col">
          {game.name} <button onClick={() => remove(game.key)} aria-label={`Remove ${game.name}`}><X size={13} /></button>
        </th>)}</tr></thead>
        <tbody>
          {Object.entries(fields).map(([raw, label]) => {
            const field = raw as keyof typeof fields;
            return <tr key={field}><th scope="row">{label}</th>{games.map(game => {
              const value = game[field];
              const source = field === "growth"
                ? game.sources.find(item => item.provider === game.growthSource)
                : game.metricSources[field];
              const at = field === "growth" ? game.growthAt : source?.at;
              const observed = at == null ? "" : new Date(at).toLocaleString();
              return <td key={game.key}>
                {value === null ? "—" : field === "rating" ? `${value.toFixed(1)}%` :
                  field === "growth" ? new Intl.NumberFormat(undefined, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 1 }).format(value) : value.toLocaleString()}
                {source ? <a href={source.url} target="_blank" rel="noreferrer">{providers[source.provider].name} <ArrowUpRight size={11} /> · {observed}</a> :
                  observed && <small>Syntra observations · {observed}</small>}
              </td>;
            })}</tr>;
          })}
        </tbody>
      </table>
    </div>
    <div className={styles.comparisonHandoff}>
      <label>Concept to evaluate <span>(optional)</span>
        <textarea rows={2} maxLength={1500} value={concept} onChange={event => setConcept(event.target.value)}
          placeholder="A co-op delivery game where players plan routes through a flooded city" />
      </label>
      <Button onClick={() => void handoff()} disabled={disabled || !identifiedCount}><Lightbulb size={15} /> Draft with Lead</Button>
      {identifiedCount !== games.length && <small className={styles.muted}>Saving research evidence requires a Roblox universe ID. {identifiedCount} of {games.length} selected experiences qualify.</small>}
      {error && <small role="alert">{error}</small>}
    </div>
  </section>;
}
