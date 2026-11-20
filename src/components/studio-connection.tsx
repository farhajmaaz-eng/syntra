"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { CustomSelect } from "./ui/custom-select";
import { DetailDrawer } from "./ui/workspace-primitives";
import { type Act } from "./feature-ui";
export default function StudioConnection({
  data,
  game,
  act,
  busy,
}: {
  data: any;
  game: any;
  act: Act;
  busy: boolean;
}) {
  const [oldId, setOldId] = useState(game.studio_id || ""),
    [newId, setNewId] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [name, setName] = useState(""),
    [same, setSame] = useState(false),
    [result, setResult] = useState("");
  useEffect(() => {
    setOldId(game.studio_id || "");
    setNewId("");
    setPreview(null);
  }, [game.id, game.studio_id]);
  const instances = data.settings.studioDiscovery?.instances || [];
  const sources = [
    ...new Set<string>([
      game.studio_id || "",
      ...data.runs
        .filter(
          (r: any) =>
            r.game_id === game.id &&
            !["accepted", "cancelled"].includes(r.status),
        )
        .map((r: any) => r.studio_id || ""),
    ]),
  ];
  const running = data.tasks.some((t: any) => t.status === "running");
  const stale =
    !!oldId &&
    data.settings.studioDiscovery &&
    !instances.some((s: any) => s.id === oldId);
  return (
    <section className="panel form">
      <h3>Studio connection</h3>
      <p>
        Bridge {data.settings.studioStatus || "not configured"}
        {data.settings.studioHealth?.checkedAt ? ` · Last checked ${new Date(data.settings.studioHealth.checkedAt).toLocaleTimeString()}` : ""}
      </p>
      <p>
        Project target: {game.studio_id || "Not assigned"}. Reconnecting
        refreshes available instances; existing runs switch only after your
        confirmation.
      </p>
      {stale && (
        <p role="alert" className="warning-text">
          The previous Studio instance is unavailable. Reopen the same game,
          refresh discovery and review a replacement below.
        </p>
      )}
      {!data.settings.paused && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void act("pause", { paused: true })}
        >
          Pause team for connection changes
        </Button>
      )}
      <div className="actions">
        <Button
          variant="outline"
          disabled={busy || (data.settings.studioStatus !== "connected" && running)}
          onClick={async () => {
            if (data.settings.studioStatus === "connected" || (await act("connect", {}))?.status === "connected")
              await act("studios", {});
          }}
        >
          {data.settings.studioStatus === "connected" ? "Refresh Studios" : "Connect Studio"}
        </Button>
        <Link className="text-link" href="/settings">
          MCP command & reset settings
        </Link>
      </div>
      {data.settings.studioDiscoveryError && (
        <p role="alert" className="warning-text">
          {data.settings.studioDiscoveryError}
        </p>
      )}
      {data.settings.studioStatus === "connected" && data.settings.studioDiscovery && !instances.length &&
        <p>No Studio windows are connected. Open the place and enable Studio as MCP server in Assistant.</p>}
      {!!instances.length && (
        <ul>
          {instances.map((s: any) => (
            <li key={s.id}>
              {s.name} · {s.id} · Place {s.placeId || "not reported"}
            </li>
          ))}
        </ul>
      )}
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setResult("");
          if (!data.settings.paused) {
            const paused = await act("pause", { paused: true });
            if (!paused) return;
          }
          const out = await act("studio/switch/preview", {
            gameId: game.id,
            oldStudioId: oldId,
            newStudioId: newId,
          });
          if (out) {
            setName("");
            setSame(false);
            setPreview(out);
          }
        }}
      >
        <label>
          Previous run target
          <CustomSelect
            aria-label="Previous run target"
            value={oldId}
            disabled={busy}
            onValueChange={(val) => {
              setOldId(val);
              setPreview(null);
            }}
          >
            {sources.map((id) => (
              <option key={id} value={id}>
                {id || "Unassigned after connection reset"}
              </option>
            ))}
          </CustomSelect>
        </label>
        <label>
          Choose a discovered Studio
          <CustomSelect
            aria-label="Choose a discovered Studio"
            value={newId}
            onValueChange={(value) => { setNewId(value); setPreview(null); }}
            disabled={busy || !instances.length}
          >
            <option value="">Select a Studio window</option>
            {instances.filter((s: any) => s.id !== oldId).map((s: any) => (
              <option key={s.id} value={s.id}>{s.name} · {s.placeId ? `Place ${s.placeId}` : "Place ID unavailable"} · {s.id}</option>
            ))}
          </CustomSelect>
        </label>
        <small>
          Syntra checks the selected window against the project. Existing runs only move after you confirm the switch.
        </small>
        <Button disabled={busy || running || !instances.some((s: any) => s.id === newId)}>Review Studio switch</Button>
      </form>
      {result && <p role="status">{result}</p>}
      {preview && (
        <DetailDrawer
          title="Confirm Studio switch"
          close={() => setPreview(null)}
        >
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const out = await act("studio/switch/confirm", {
                token: preview.token,
                confirmationName: name,
                sameGameConfirmed: same,
              });
              if (out) {
                setPreview(null);
                setResult(
                  "Studio switch approved. The team remains paused. Review queued work, then resume the team when ready.",
                );
              }
            }}
          >
            <p>
              Project: <strong>{preview.gameName}</strong>
            </p>
            <p>
              Previous: {preview.oldStudioId || "Unassigned"}
              <br />
              Replacement: {preview.newStudioId}
              <br />
              Studio: {preview.target.name}
              <br />
              Place:{" "}
              {preview.target.placeId ||
                "Not reported — verify the open game yourself"}
            </p>
            <p>
              {preview.runCount} unfinished runs and {preview.taskCount}{" "}
              unfinished tasks will use this target. Old pending Studio calls
              and approvals are cancelled. Fresh inspection and test evidence
              are required; completed operations are never replayed
              automatically.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={same}
                onChange={(e) => setSame(e.target.checked)}
                required
              />
              I verified this is the same game, including unsaved/local place
              contents.
            </label>
            <label>
              Type the project name to confirm
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <Button disabled={busy || !same || name !== preview.gameName}>
              Confirm switch
            </Button>
          </form>
        </DetailDrawer>
      )}
    </section>
  );
}
