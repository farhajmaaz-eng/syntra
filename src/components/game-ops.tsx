"use client";
import StudioConnection from "./studio-connection";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Gamepad2, Link2, Plus, Upload } from "lucide-react";
import {
  gameStages,
  metricDefinitions,
  displayDate,
} from "@/lib/feature-contracts";
import { useResource } from "@/lib/use-resource";
import type { Detail } from "../game-intelligence/model";
import AnalyticsCsv from "./analytics-csv";
import { Button } from "./ui/button";
import { CustomSelect } from "./ui/custom-select";
import { DetailDrawer, EmptyState } from "./ui/workspace-primitives";
import {
  ImportDialog,
  ResourceState,
  StatusChip,
  type Act,
} from "./feature-ui";
export default function GameOps({
  data,
  liveOps,
  selectedGame,
  chooseGame,
  act,
  busy,
  newTask,
}: {
  data: any;
  liveOps: boolean;
  selectedGame: string;
  chooseGame: (id: string) => void;
  act: Act;
  busy: boolean;
  newTask: (initial?: string) => void;
}) {
  const [tab, setTab] = useState(liveOps ? "Public activity" : "Overview"),
    [add, setAdd] = useState(false),
    [edit, setEdit] = useState(false),
    [importing, setImporting] = useState<"csv" | "json" | null>(null),
    [discovery, setDiscovery] = useState<any>(null),
    [range, setRange] = useState("30");
  const studios: { id: string; name: string; placeId: string; universeId: string }[] =
    data.settings.studioDiscovery?.instances || [];
  const game = data.games.find((g: any) => g.id === selectedGame);
  const telemetry = useResource(
    game && liveOps && !["Public activity", "Fixes & Reports"].includes(tab) && !data.standaloneMode
      ? `telemetry?gameId=${encodeURIComponent(game.id)}`
      : null,
    data.settings.featureRevision || 0,
  );
  const snapshots: any[] = telemetry.data?.gameId === game?.id ? telemetry.data?.snapshots ?? [] : [];
  const [source, setSource] = useState("");
  const sources = [...new Set(snapshots.map((s) => s.source))];
  const selectedSource = sources.includes(source) ? source : sources[0];
  const scoped = snapshots.filter((s) => s.source === selectedSource);
  const newest = scoped[0];
  let latest = 0;
  for (const snapshot of scoped)
    for (const metric of snapshot.metrics)
      for (const point of metric.points)
        latest = Math.max(latest, Date.parse(point.at));
  const from = range === "all" ? 0 : latest - Number(range) * 86400000;
  const observations = new Map<string, any>();
  for (const s of [...scoped].reverse())
    for (const m of s.metrics)
      for (const p of m.points)
        if (Date.parse(p.at) >= from)
          observations.set(`${m.metric}:${p.series}:${p.at}`, {
            ...p,
            metric: m.metric,
            quality: s.quality,
          });
  const points = [...observations.values()].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  const runIds = new Set(
    data.runs.filter((r: any) => r.game_id === game?.id).map((r: any) => r.id),
  );
  const tasks = data.tasks.filter((t: any) => runIds.has(t.run_id));
  const failures = tasks.filter((t: any) => ["failed", "blocked"].includes(t.status)).length;
  const tabs = liveOps ? [
    "Public activity",
    "Charts",
    "Players",
    "Sessions / Retention",
    "Trends",
    "Benchmarks",
    "Fixes & Reports",
  ] : ["Overview", "Fixes & Reports"];
  return (
    <div className="v2-stack">
      <div className="toolbar">
        <h2>Projects</h2>
        {!liveOps && <><Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            const out = await act("studios", {});
            if (out) setDiscovery(out);
          }}
        >
          <Link2 size={14} />
          Discover Studios
        </Button>
        <Button onClick={() => setAdd(true)}>
          <Plus size={14} />
          Add project
        </Button></>}
      </div>
      {discovery && (
        <section className="panel">
          <h3>Discovered Studio instances</h3>
          <pre>{JSON.stringify(discovery.content, null, 2)}</pre>
        </section>
      )}
      <div className="v2-game-grid">
        {data.games.map((g: any) => (
          <button
            key={g.id}
            className={`panel v2-game-select ${g.id === selectedGame ? "selected" : ""}`}
            onClick={() => chooseGame(g.id)}
          >
            <Gamepad2 size={22} />
            <span>
              <strong>{g.name}</strong>
              <small>
                {g.studio_id
                  ? `Studio ${g.studio_id}`
                  : "No Studio instance · planning project"}
              </small>
            </span>
            <StatusChip status={g.stage || "prototype"} />
          </button>
        ))}
      </div>
      {!data.games.length && (
        <section className="panel">
          <EmptyState icon={<Gamepad2 />} title="No games registered">
            Create a planning project, or discover a Studio instance and
            register it.
          </EmptyState>
        </section>
      )}
      {game && (
        <>
          <div className="toolbar">
            <div>
              <h2>{game.name}</h2>
              <p className="muted-text">
                Lifecycle: {game.stage || "prototype"} · manually maintained ·{" "}
                {game.universe_id
                  ? `Universe ${game.universe_id}`
                  : "Universe ID not connected"}
              </p>
            </div>
            {!liveOps && (
              <Button variant="outline" onClick={() => setEdit(true)}>
                Edit project
              </Button>
            )}
          </div>
          {!liveOps && <StudioConnection
            key={game.id}
            data={data}
            game={game}
            act={act}
            busy={busy}
          />}
          <div className="tabs" role="group" aria-label="Game analytics views">
            {tabs.map((t) => (
              <button
                key={t}
                className={tab === t ? "current" : ""}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t}{t === "Fixes & Reports" && failures > 0 ? ` (${failures} need attention)` : ""}
              </button>
            ))}
          </div>
          {tab === "Public activity" ? (
            <PublicActivity key={game.universe_id ?? game.id} universeId={game.universe_id} newTask={newTask} />
          ) : tab === "Overview" ? (
            <>
              <div className="stats overview-stats">
                <div>
                  <span>Tasks</span>
                  <strong>{tasks.length}</strong>
                  <label>
                    {tasks.filter((t: any) => t.status === "running").length}{" "}
                    working
                  </label>
                </div>
                <div>
                  <span>Review</span>
                  <strong>
                    {
                      data.runs.filter(
                        (r: any) => runIds.has(r.id) && r.status === "review",
                      ).length
                    }
                  </strong>
                  <label>requests awaiting acceptance</label>
                </div>
                <div>
                  <span>Build status</span>
                  <strong className="v2-small-stat">
                    {tasks.some((t: any) => t.status === "failed")
                      ? "Needs attention"
                      : tasks.some((t: any) => t.status === "running")
                        ? "In progress"
                        : tasks.length
                          ? "See task evidence"
                          : "No builds yet"}
                  </strong>
                  <label>Derived from tracked work</label>
                </div>
                <div>
                  <span>Telemetry</span>
                  <Link href="/liveops" className="text-link">Open LiveOps <ArrowUpRight size={13} /></Link>
                  <label>Public activity and creator analytics</label>
                </div>
              </div>
              <section className="panel form">
                <h3>Latest work</h3>
                {tasks.slice(0, 5).map((t: any) => (
                  <Link
                    className="v2-row-link"
                    key={t.id}
                    href={`/tasks?task=${encodeURIComponent(t.id)}`}
                  >
                    <span>{t.title}</span>
                    <StatusChip status={t.status} />
                    <ArrowUpRight size={13} />
                  </Link>
                ))}
                {!tasks.length && (
                  <p>No work has been queued for this project.</p>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    newTask(
                      `Plan the next development milestone for ${game.name}. Include acceptance criteria and independent verification.`,
                    )
                  }
                >
                  Create project task
                </Button>
                <Link href="/reviews" className="text-link">
                  Open reviews <ArrowUpRight size={13} />
                </Link>
              </section>
            </>
          ) : tab === "Fixes & Reports" ? (
            <section className="panel form">
              <h3>Tracked failures and test reports</h3>
              {tasks
                .filter(
                  (t: any) =>
                    ["failed", "blocked"].includes(t.status) ||
                    t.agent === "Tester",
                )
                .map((t: any) => (
                  <div className="v2-report" key={t.id}>
                    <Link
                      href={`/tasks?task=${encodeURIComponent(t.id)}`}
                      className="text-link"
                    >
                      {t.title} <ArrowUpRight size={13} />
                    </Link>
                    <StatusChip status={t.status} />
                    <p>{t.error || t.result || "No result recorded"}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        newTask(
                          `Investigate task ${t.id}: ${t.title}. Evidence: ${t.error || t.result || "Inspect the task ledger"}. Verify the fix in Studio.`,
                        )
                      }
                    >
                      Create investigation
                    </Button>
                  </div>
                ))}
              {!tasks.some(
                (t: any) =>
                  ["failed", "blocked"].includes(t.status) ||
                  t.agent === "Tester",
              ) && (
                <p>
                  No failures or test reports have been recorded for this
                  project.
                </p>
              )}
            </section>
          ) : (
            <>
              <section className="panel v2-source-banner">
                <div>
                  <h3>
                    {newest
                      ? "Imported analytics · not a live feed"
                      : "Telemetry is not connected"}
                  </h3>
                  <p>
                    {newest ? (
                      <>
                        <a
                          href={newest.source}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {newest.source}
                        </a>{" "}
                        · {newest.quality} · collected{" "}
                        {displayDate(newest.fetchedAt)}
                      </>
                    ) : (
                      "Import analytics from a Creator Dashboard you can access. Public player counts are available under Public activity."
                    )}
                  </p>
                </div>
                {data.standaloneMode ? (
                  <small>Start the Syntra worker to save analytics imports.</small>
                ) : (
                  <div className="actions">
                    <Button variant="outline" onClick={() => setImporting("csv")}>
                      <Upload size={14} /> Import CSV
                    </Button>
                    <Button variant="outline" onClick={() => setImporting("json")}>Import JSON</Button>
                  </div>
                )}
              </section>
              <ResourceState
                loading={telemetry.loading}
                error={telemetry.error}
                variant="charts"
              >
                {snapshots.length ? (
                  <>
                    <div className="toolbar">
                      <label>
                        Source
                        <CustomSelect
                          variant="bar"
                          aria-label="Source"
                          value={selectedSource || ""}
                          onValueChange={setSource}
                        >
                          {sources.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </CustomSelect>
                      </label>
                      <label>
                        Observation window
                        <CustomSelect
                          variant="bar"
                          aria-label="Observation window"
                          value={range}
                          onValueChange={setRange}
                        >
                          <option value="7">7 days</option>
                          <option value="30">30 days</option>
                          <option value="90">90 days</option>
                          <option value="all">All observations</option>
                        </CustomSelect>
                      </label>
                      <small>
                        Window ends at the latest imported observation. Gaps are
                        not zero-filled.
                      </small>
                    </div>
                    {tab === "Trends" || tab === "Benchmarks" ? (
                      <div className="v2-chart-grid">
                        {Object.entries(metricDefinitions).map(([key, def]) => {
                          const primary = points.find((p) => p.metric === key)?.series;
                          const ps = points.filter((p) => p.metric === key && p.series === primary);
                          if (ps.length < 2) return null;
                          const delta = ps.at(-1).value - ps[0].value;
                          const values = ps.map((p) => p.value).sort((a, b) => a - b);
                          return (
                            <section className="panel form" key={key}>
                              <h3>{def.label}</h3>
                              <p>
                                {tab === "Trends"
                                  ? `${delta >= 0 ? "+" : ""}${delta.toLocaleString()} ${def.unit} between ${displayDate(ps[0].at)} and ${displayDate(ps.at(-1).at)}`
                                  : `Observed range: ${values[0].toLocaleString()}–${values.at(-1)!.toLocaleString()} ${def.unit}. Median: ${median(values).toLocaleString()}.`}
                              </p>
                              <small>
                                Source: {selectedSource} · {ps.length}{" "}
                                observations · {ps[0].series}. This is an
                                imported project baseline, not an industry
                                benchmark.
                              </small>
                              {tab === "Trends" && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    newTask(
                                      `Investigate ${def.label} for ${game.name}. Observed change: ${delta} ${def.unit} from ${ps[0].at} to ${ps.at(-1).at}. Source: ${selectedSource}. Explain uncertainty and gather evidence before changing the game.`,
                                    )
                                  }
                                >
                                  Investigate trend
                                </Button>
                              )}
                            </section>
                          );
                        })}
                        {!Object.keys(metricDefinitions).some(
                          (k) =>
                            points.filter((p) => p.metric === k).length >= 2,
                        ) && (
                          <p className="plain-empty">
                            At least two comparable observations are needed for
                            trends or baselines.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="v2-chart-grid">
                        {Object.entries(metricDefinitions)
                          .filter(
                            ([, d]) => tab === "Charts" || d.group === tab,
                          )
                          .map(([key, def]) => (
                            <ChartPanel
                              key={key}
                              title={def.label}
                              unit={def.unit}
                              points={points.filter((p) => p.metric === key)}
                            />
                          ))}
                      </div>
                    )}
                  </>
                ) : (
                  <EmptyState
                    icon={<Gamepad2 />}
                    title="No analytics observations yet"
                  >
                    No charts or player metrics will be shown until you import
                    real data. Files must include a source, collection time,
                    quality and metric observations.
                  </EmptyState>
                )}
              </ResourceState>
            </>
          )}
        </>
      )}
      {(add || edit) && (
        <DetailDrawer
          title={edit ? "Edit project" : "Add a project"}
          subtitle="Studio IDs connect local execution; universe and place IDs identify the Roblox experience."
          close={() => {
            setAdd(false);
            setEdit(false);
          }}
        >
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const studioId = f.get("studioId");
              const studio = studios.find((item) => item.id === studioId);
              const universeId = f.get("universeId") || studio?.universeId || "";
              const placeId = f.get("placeId") || studio?.placeId || "";
              const out = await act(
                edit ? "games/update" : "games",
                edit
                  ? {
                      id: game.id,
                      name: f.get("name"),
                      studioId,
                      stage: f.get("stage"),
                      universeId,
                      placeId,
                    }
                  : {
                      name: f.get("name"),
                      studioId,
                      universeId,
                      placeId,
                    },
              );
              if (out) {
                setAdd(false);
                setEdit(false);
              }
            }}
          >
            <label>
              Game name
              <input
                name="name"
                required
                defaultValue={edit ? game.name : ""}
              />
            </label>
            <label>
              Roblox Studio window
              <CustomSelect name="studioId" aria-label="Roblox Studio window" defaultValue={edit ? game.studio_id : ""}>
                <option value="">Planning project</option>
                {edit && game.studio_id && !studios.some((studio) => studio.id === game.studio_id) && (
                  <option value={game.studio_id}>Current target · unavailable</option>
                )}
                {studios.map((studio) => (
                  <option key={studio.id} value={studio.id}>
                    {studio.name} · {studio.placeId ? `Place ${studio.placeId}` : studio.id}
                  </option>
                ))}
              </CustomSelect>
            </label>
            {!studios.length && <p>Enable Studio as an MCP server to see open places here.</p>}
            <>
              {edit && (
                <label>
                  Lifecycle stage
                  <CustomSelect
                    name="stage"
                    aria-label="Lifecycle stage"
                    defaultValue={game.stage}
                  >
                    {gameStages.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </CustomSelect>
                </label>
              )}
              <label>
                Roblox universe ID
                <input
                  name="universeId"
                  pattern="[0-9]*"
                  defaultValue={edit ? game.universe_id : ""}
                />
              </label>
              <label>
                Roblox place ID
                <input
                  name="placeId"
                  pattern="[0-9]*"
                  defaultValue={edit ? game.place_id : ""}
                />
              </label>
            </>
            <p>
              These fields configure future work. To switch unfinished runs, use
              Studio connection → Review Studio switch. Draft plans bind their
              Studio target only when you explicitly approve execution.
            </p>
            <Button disabled={busy}>
              {edit ? "Save project" : "Add project"}
            </Button>
          </form>
        </DetailDrawer>
      )}
      {importing === "csv" && game && (
        <AnalyticsCsv
          key={game.id}
          gameId={game.id}
          universeId={game.universe_id}
          close={() => setImporting(null)}
          submit={(value) => act("telemetry/import", value)}
        />
      )}
      {importing === "json" && game && (
        <ImportDialog
          title="Import analytics"
          description="Use a JSON export from a source you are authorized to access. No credentials are stored in this export."
          template={{
            gameId: game.id,
            source: "https://create.roblox.com/dashboard/analytics",
            fetchedAt: "ISO 8601 collection time",
            quality: "exported",
            metrics: [{ metric: "dau", points: [] }],
          }}
          close={() => setImporting(null)}
          submit={(value) =>
            act("telemetry/import", { ...value, gameId: game.id })
          }
        />
      )}
    </div>
  );
}
function median(sorted: number[]) {
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}
export function ChartPanel({
  title,
  unit,
  points,
  attribution = "Imported observations",
}: {
  title: string;
  unit: string;
  points: any[];
  attribution?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  if (!points.length)
    return (
      <section className="panel v2-chart">
        <h3>{title}</h3>
        <p className="plain-empty">
          No {title.toLowerCase()} observations in this window.
        </p>
      </section>
    );
  const grouped = new Map<string, typeof points>();
  for (const p of points) {
    const seriesPoints = grouped.get(p.series) ?? [];
    seriesPoints.push(p);
    grouped.set(p.series, seriesPoints);
  }
  const series = [...grouped.keys()];
  const plotted = series.map((name) => {
    const group = grouped.get(name)!;
    if (group.length <= 180) return group;
    return Array.from({ length: 180 }, (_, index) =>
      group[Math.round(index * (group.length - 1) / 179)],
    );
  });
  const colors = [
    "var(--accent)",
    "#34d399",
    "#fbbf24",
    "#60a5fa",
    "#f87171",
    "#56d39c",
  ];
  const { xMin, xMax, maxValue } = points.reduce(
    (bounds, point) => {
      const date = Date.parse(point.at);
      return {
        xMin: Math.min(bounds.xMin, date),
        xMax: Math.max(bounds.xMax, date),
        maxValue: Math.max(bounds.maxValue, point.value),
      };
    },
    { xMin: Infinity, xMax: -Infinity, maxValue: 1 },
  );
  const yMax = unit === "%" ? 100 : maxValue * 1.1;
  const x = (p: any) =>
      48 +
      (xMax === xMin ? 210 : ((Date.parse(p.at) - xMin) / (xMax - xMin)) * 420),
    y = (p: any) => 158 - (p.value / yMax) * 130;
  return (
    <section className="panel v2-chart">
      <h3>{title}</h3>
      <small>{unit} · {attribution}{points.length > plotted.flat().length ? " · Chart samples long series" : ""}</small>
      <svg
        role="img"
        aria-label={`${title}, ${points.length} observations`}
        viewBox="0 0 500 200"
      >
        <title>
          {title} ({unit})
        </title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="48"
              x2="470"
              y1={158 - f * 130}
              y2={158 - f * 130}
              stroke="var(--border)"
            />
            <text x="42" y={162 - f * 130} textAnchor="end">
              {Math.round(yMax * f * 10) / 10}
            </text>
          </g>
        ))}
        {series.map((s, i) => (
          <g key={s}>
            <polyline
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth="2"
              points={plotted[i]
                .map((p) => `${x(p)},${y(p)}`)
                .join(" ")}
            />
            {plotted[i].map((p) => (
                <circle
                  key={`${p.at}:${p.series}`}
                  cx={x(p)}
                  cy={y(p)}
                  r="2.5"
                  fill={colors[i % colors.length]}
                >
                  <title>
                    {displayDate(p.at)}: {p.value} {unit} · {p.series} ·{" "}
                    {p.quality}
                  </title>
                </circle>
              ))}
          </g>
        ))}
        <text x="48" y="185">
          {new Date(xMin).toLocaleDateString()}
        </text>
        <text x="470" y="185" textAnchor="end">
          {new Date(xMax).toLocaleDateString()}
        </text>
      </svg>
      <div className="v2-chart-legend">
        {series.map((s, i) => (
          <span key={s}>
            <i style={{ background: colors[i % colors.length] }} />
            {s}
          </span>
        ))}
      </div>
      <details onToggle={(event) => setShowTable(event.currentTarget.open)}>
        <summary>View data table{points.length > 250 ? " (latest 250 observations)" : ""}</summary>
        {showTable && <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Observed</th>
                <th>Series</th>
                <th>{unit}</th>
                <th>Quality</th>
              </tr>
            </thead>
            <tbody>
              {points.slice(-250).map((p) => (
                <tr key={`${p.series}:${p.at}`}>
                  <td>{displayDate(p.at)}</td>
                  <td>{p.series}</td>
                  <td>{p.value}</td>
                  <td>{p.quality}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </details>
    </section>
  );
}

function PublicActivity({ universeId, newTask }: {
  universeId?: string | null;
  newTask: (initial?: string) => void;
}) {
  const resource = useResource<Detail>(
    universeId ? `game-intelligence?view=liveops&game=${encodeURIComponent(universeId)}` : null,
  );
  const { game, history } = resource.data ?? {};
  const metrics = [
    ["playing", "Players online"], ["visits", "Lifetime visits"],
    ["favorites", "Favorites"], ["rating", "Like ratio"],
  ] as const;
  const series = (history ?? []).filter((entry) => entry.points.some((point) => point.playing !== null));
  if (!universeId) return (
    <section className="panel form">
      <h3>Link a Roblox experience</h3>
      <p>Add its universe ID under Games → Edit project to see public activity here.</p>
      <Link href="/games" className="text-link">Manage projects <ArrowUpRight size={13} /></Link>
    </section>
  );
  return (
    <>
    {resource.error && <Button variant="outline" onClick={resource.refresh}>Retry public activity</Button>}
    <ResourceState loading={resource.loading} error={resource.error} variant="charts">
      {game && (
        <div className="v2-stack">
          <section className="panel v2-source-banner">
            <div>
              <h3>{game.name}</h3>
              <p>Source timestamps show when each public metric was collected. Peak players here is the highest comparable observation in a series.</p>
            </div>
            <Button variant="outline" onClick={resource.refresh}>Refresh public activity</Button>
          </section>
          <div className="overview-stats stats">
            {metrics.map(([field, label]) => {
              const value = game[field];
              const source = game.metricSources[field];
              return <div key={field}>
                <span className="metric-label">{label}</span>
                <strong>{value === null ? "—" : `${value.toLocaleString()}${field === "rating" ? "%" : ""}`}</strong>
                {source ? (
                  <a className="text-link" href={source.url} target="_blank" rel="noreferrer">
                    {displayDate(new Date(source.at).toISOString())} <ArrowUpRight size={13} />
                  </a>
                ) : <small>Source did not report this metric</small>}
              </div>;
            })}
          </div>
          <div className="v2-chart-grid">
            {series.map(({ name, url, points }) => {
              const observations = points.flatMap(({ at, playing }) => playing === null ? [] : [{
                at: new Date(at).toISOString(), value: playing, series: name, quality: name.includes("estimates") ? "May include estimates" : "Sampled",
              }]);
              const peak = observations.reduce((high, point) => Math.max(high, point.value), 0);
              const latest = observations.at(-1)!;
              return (
                <div className="v2-stack" key={name}>
                  <ChartPanel title="Players over time" unit="players" points={observations} attribution="Public observations" />
                  <section className="panel form">
                    <p>Highest observed count in {name}: <strong>{peak.toLocaleString()}</strong></p>
                    {url && <a className="text-link" href={url} target="_blank" rel="noreferrer">Open data source <ArrowUpRight size={13} /></a>}
                    {observations.length > 1 && (
                      <Button variant="outline" size="sm" onClick={() => newTask(
                        `Investigate public player activity for universe ${universeId}. ${name} shows ${observations[0].value} players at ${observations[0].at} and ${latest.value} at ${latest.at}. Highest observation in this window: ${peak}. ${url ? `Source: ${url}. ` : ""}Check data coverage, consider changes in traffic and releases, and recommend a measurement plan. Avoid inferring retention or causation from these counts.`,
                      )}>Investigate player activity</Button>
                    )}
                  </section>
                </div>
              );
            })}
            {!series.length && <p>No player history available. Syntra records observations as public data is fetched.</p>}
          </div>
          <section className="panel form">
            <h3>Server capacity and creator analytics</h3>
            {game.serverCapacity ? (
              <p>
                Roblox reports a limit of <strong>{game.serverCapacity.value.toLocaleString()} players per server</strong>.{" "}
                <a className="text-link" href={game.serverCapacity.source.url} target="_blank" rel="noreferrer">
                  {displayDate(new Date(game.serverCapacity.source.at).toISOString())} <ArrowUpRight size={13} />
                </a>
              </p>
            ) : <p>The source did not report a per-server player limit.</p>}
            <p>DAU, retention, session length and paying-player metrics require an authorized export. Public feeds do not report live server occupancy, FPS, ping, joins, or drop-off.</p>
          </section>
        </div>
      )}
    </ResourceState>
    </>
  );
}
