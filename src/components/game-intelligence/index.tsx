"use client";

import { ArrowUpRight, Gamepad2, RefreshCw, Search, Settings2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { categories, categoryGames, providers, type Catalog, type Category, type Detail, type Game, type Point } from "../../game-intelligence/model";
import IntelligenceSettings from "./settings";
import Comparison from "./comparison";
import { comparisonLimit } from "../../game-intelligence/comparison";
import styles from "./intelligence.module.css";

const metrics = { playing: "CCU", visits: "Visits", favorites: "Favorites", rating: "Approval", growth: "24h CCU" } as const;
type Metric = keyof typeof metrics;
const compact = Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const percent = Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });
const date = (at: number) => new Date(at).toLocaleString();
function format(field: Metric, value: number | null) {
  if (value === null) return "—";
  if (field === "growth") return percent.format(value);
  if (field === "rating") return Math.round(value) + "%";
  return compact.format(value);
}
function GameIcon({ game }: { game: Game }) {
  return <div className={styles.gameIcon}>{game.icon
    // Public Roblox CDN images are already sized by Roblox.
    ? <img src={game.icon} alt="" width={52} height={52} loading="lazy" referrerPolicy="no-referrer" />
    : <Gamepad2 size={23} />}</div>;
}
async function read<T>(params: Record<string, string>, signal: AbortSignal) {
  const response = await fetch("/api/game-intelligence?" + new URLSearchParams(params), { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load Roblox game data.");
  return data as T;
}

function HistoryChart({ points }: { points: Point[] }) {
  const values = points.filter(point => point.playing !== null);
  if (values.length < 2) return null;
  const first = values[0].at, last = values.at(-1)!.at;
  const low = Math.min(...values.map(point => point.playing!));
  const high = Math.max(...values.map(point => point.playing!));
  const plot = values.map(point => [
    6 + ((point.at - first) / (last - first || 1)) * 388,
    76 - ((point.playing! - low) / (high - low || 1)) * 66,
  ].join(",")).join(" ");
  return <svg viewBox="0 0 400 82" className={styles.chart} role="img" aria-label={`Concurrent players, ${compact.format(low)} to ${compact.format(high)}`}>
    <path d="M6 76H394" stroke="var(--border)" />
    <polyline points={plot} stroke="var(--accent)" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke" />
  </svg>;
}

function Details({ selected, onClose }: { selected: Game; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState("");
  useEffect(() => {
    panel.current?.focus();
    const controller = new AbortController();
    read<Detail>({ game: selected.key }, controller.signal)
      .then(setDetail).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [selected.key]);
  const game = detail?.game ?? selected;
  return <section ref={panel} tabIndex={-1} className={styles.panel} aria-label="Game details">
    <div className={styles.detailHeader}><GameIcon game={game} /><div><h2>{game.name}</h2><p className={styles.muted}>{[game.creator, game.genre].filter(Boolean).join(" · ")}</p></div>
      <Button onClick={onClose} variant="outline" size="sm">Close</Button></div>
    <div className={styles.metrics}>{(Object.keys(metrics) as Metric[]).map(field => <div key={field}><span>{metrics[field]}</span><strong>{format(field, game[field])}</strong>{field !== "growth" && game.metricSources[field] && <span>{providers[game.metricSources[field].provider].name} · {date(game.metricSources[field].at)}</span>}</div>)}</div>
    {game.growthAt !== null && <p className={styles.muted}>24h CCU from {game.growthSource ? providers[game.growthSource].name : "Syntra observations"} · {date(game.growthAt)}</p>}
    {Object.keys(game.ranks).length > 0 && <p className={styles.muted}>{Object.entries(game.ranks).map(([chart, rank]) => { const source = game.rankSources[chart as Category]; return `${chart} #${rank}${source ? " (" + providers[source].name + ")" : ""}`; }).join(" · ")}</p>}
    {game.description && <p className={styles.description}>{game.description}</p>}
    <div className={styles.sourceLinks}>{game.sources.map(source => <a key={source.provider} href={source.url} target="_blank" rel="noreferrer" title={date(source.at)}>{providers[source.provider].name} <ArrowUpRight size={13} /></a>)}</div>
    <h3>History</h3>
    {error ? <p role="status">{error}</p> : !detail ? <p role="status">Loading history…</p> : !detail.history.length ? <p>No history available for this game yet.</p> : detail.history.map(series => {
      const latest = series.points.at(-1)!;
      return <div key={series.name} className={styles.series}>
        <h4>{series.url ? <a href={series.url} target="_blank" rel="noreferrer">{series.name}</a> : series.name}</h4>
        <HistoryChart points={series.points} />
        <p className={styles.muted}>{date(latest.at)}{latest.playing !== null && ` · ${format("playing", latest.playing)} CCU`}{latest.rating != null && ` · ${format("rating", latest.rating)} approval`}{latest.visits != null && ` · ${format("visits", latest.visits)} visits`}{latest.favorites != null && ` · ${format("favorites", latest.favorites)} favorites`}</p>
        <details><summary>View ${series.points.length} observations</summary><div className={styles.historyTable}>
          <table><thead><tr><th>Observed</th><th>CCU</th><th>Visits</th><th>Favorites</th><th>Approval</th></tr></thead>
            <tbody>{[...series.points].reverse().map((point, i) => <tr key={point.at + ":" + i}><td>{date(point.at)}</td><td>{point.playing?.toLocaleString() ?? "—"}</td><td>{point.visits?.toLocaleString() ?? "—"}</td><td>{point.favorites?.toLocaleString() ?? "—"}</td><td>{format("rating", point.rating ?? null)}</td></tr>)}</tbody>
          </table>
        </div></details>
      </div>;
    })}
  </section>;
}

export default function GameIntelligence({ act, draft, busy }: {
  act: (path: string, body: unknown) => Promise<{ id?: string } | undefined>;
  draft: (prompt: string) => void;
  busy: boolean;
}) {
  const [comparison, setComparison] = useState<Game[]>([]);
  function toggleComparison(game: Game) {
    setComparison(current => current.some(entry => entry.key === game.key)
      ? current.filter(entry => entry.key !== game.key)
      : current.length < comparisonLimit ? [...current, game] : current);
  }
  const [data, setData] = useState<Catalog>();
  const [category, setCategory] = useState<Category>("Trending");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"default" | Metric>("default");
  const [genre, setGenre] = useState("");
  const [minCCU, setMinCCU] = useState(0);
  const [selected, setSelected] = useState<Game | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [limit, setLimit] = useState(40);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = () => setVersion(current => current + 1);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      setLoading(true);
      try {
        const next = await read<Catalog>(query ? { q: query } : {}, controller.signal);
        if (!controller.signal.aborted) { setData(next); setError(""); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load game data.");
      } finally {
        pending = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 5 * 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [query, version]);
  const genres = useMemo(() => [...new Set(data?.games.map(game => game.genre).filter(Boolean) ?? [])].sort(), [data]);
  const visible = useMemo(() => {
    const games = query ? data?.games ?? [] : categoryGames(data?.games ?? [], category);
    const filtered = games.filter(game => (!genre || game.genre === genre) && (!minCCU || (game.playing ?? -1) >= minCCU));
    return sort === "default" ? filtered : filtered.sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity));
  }, [data, query, category, genre, minCCU, sort]);

  function search(event: FormEvent) {
    event.preventDefault();
    setLimit(40);
    setGenre("");
    setSelected(null);
    if (input.trim() === query) refresh();
    else { setData(undefined); setQuery(input.trim()); }
  }

  return <div className={styles.workspace}>
    <header className={styles.hero}>
      <div><p className={styles.kicker}>Roblox research</p><h2>Roblox charts and history</h2><p>Discover experiences and track what players are doing across public Roblox feeds.</p></div>
      <div className={styles.actions}>
        <Link href="/games" className="button button-outline">Project Games</Link>
        <Button variant="outline" aria-expanded={showSettings} onClick={() => setShowSettings(value => !value)}><Settings2 size={16} /> Sources</Button>
        <Button variant="outline" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</Button>
      </div>
    </header>
    {showSettings && <IntelligenceSettings onSave={refresh} />}
    <div className={styles.tabs} aria-label="Game categories">
      {categories.map(item => <button key={item} aria-pressed={!query && category === item} onClick={() => {
        if (query) setData(undefined);
        setCategory(item); setQuery(""); setInput(""); setSelected(null); setGenre(""); setLimit(40); setSort("default");
      }}>{item}</button>)}
    </div>
    <div className={styles.controls}>
      <form onSubmit={search} role="search"><input aria-label="Find a Roblox game" placeholder="Search games or creators" value={input} maxLength={100} onChange={e => setInput(e.target.value)} /><Button type="submit" size="sm"><Search size={15} /> Search</Button></form>
      <label>Genre<select value={genre} onChange={e => { setGenre(e.target.value); setLimit(40); }}><option value="">All genres</option>{genres.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Minimum CCU<select value={minCCU} onChange={e => setMinCCU(Number(e.target.value))}><option value={0}>Any</option><option value={100}>100+</option><option value={1000}>1,000+</option><option value={10000}>10,000+</option></select></label>
      <label>Sort<select value={sort} onChange={e => setSort(e.target.value as Metric | "default")}><option value="default">{query ? "Relevance" : "Category rank"}</option>{Object.entries(metrics).map(([field, label]) => <option value={field} key={field}>{label}</option>)}</select></label>
    </div>
    <div className={styles.feed} aria-label="Provider status">
      {data?.sources.map(source => <a href={providers[source.provider].docs} key={source.provider} target="_blank" rel="noreferrer"
        title={[source.at && date(source.at), source.error, source.retryAt && "Retry after " + date(source.retryAt)].filter(Boolean).join(" · ")}>
        <span data-status={source.status} />{providers[source.provider].name}<small>{source.status}</small>
      </a>)}
    </div>
    <div className={styles.listHeading}><h3>{query ? `Results for “${query}”` : category}</h3><small className={styles.muted}>
      {loading ? "Checking sources…" : `${visible.length.toLocaleString()} games`}
    </small></div>
    {error && <p className={styles.muted} role="alert">{error}</p>}
    {!query && <p className={styles.muted}>{category === "Rising" ? "Positive 24-hour CCU change from PlaySurge or Syntra observations about a day apart." : category === "Trending" || category === "Up-and-Coming" ? "Provider chart positions. Availability varies by source and region." : "Ranked within the tracked catalog. Counts reflect each provider’s latest available sample."}</p>}
    {comparison.length > 0 && <Comparison games={comparison} act={act} draft={draft} disabled={busy}
      clear={() => setComparison([])} remove={key => setComparison(current => current.filter(game => game.key !== key))} />}
    {selected && <Details key={selected.key} selected={selected} onClose={() => setSelected(null)} />}
    {visible.length > 0 ? <div className={styles.tableWrap}><table className={styles.ranking}>
      <thead><tr><th scope="col">#</th><th scope="col">Experience</th>{Object.entries(metrics).map(([key, label]) => <th key={key} scope="col">{label}</th>)}</tr></thead>
      <tbody>{visible.slice(0, limit).map((game, i) => <tr key={game.key} data-active={selected?.key === game.key}>
        <td title={game.rankSources[category] ? providers[game.rankSources[category]].name : undefined}>{sort === "default" && !query && (category === "Trending" || category === "Up-and-Coming") ? game.ranks[category] : i + 1}</td>
        <th scope="row"><button className={styles.gameButton} onClick={() => setSelected(game)} aria-pressed={selected?.key === game.key}><GameIcon game={game} /><span><strong>{game.name}</strong><small>{[game.creator, game.genre].filter(Boolean).join(" · ") || "Roblox experience"}</small></span></button></th>
        {(Object.keys(metrics) as Metric[]).map(field => <td key={field} title={game[field]?.toLocaleString()}>{format(field, game[field])}</td>)}
        <td><input type="checkbox" aria-label={`Compare ${game.name}`} checked={comparison.some(entry => entry.key === game.key)}
          disabled={comparison.length >= comparisonLimit && !comparison.some(entry => entry.key === game.key)}
          onChange={() => toggleComparison(game)} /></td>
      </tr>)}</tbody>
    </table></div> : !loading && !error && <p className={styles.empty}>No games match this view. Change the filters or check the enabled sources.</p>}
    {limit < visible.length && <Button className={styles.more} variant="outline" onClick={() => setLimit(value => value + 40)}>Show 40 more</Button>}
  </div>;
}
