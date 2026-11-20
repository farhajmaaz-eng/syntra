"use client";

import { useState } from "react";
import {
  analyticsCsvMaxBytes,
  creatorAnalyticsUrl,
  parseAnalyticsCsv,
  type AnalyticsMetric,
} from "@/lib/analytics-csv";
import { metricDefinitions } from "@/lib/feature-contracts";
import { DetailDrawer } from "./ui/workspace-primitives";
import { CustomSelect } from "./ui/custom-select";
import { Button } from "./ui/button";

export default function AnalyticsCsv({ gameId, universeId, close, submit }: {
  gameId: string;
  universeId?: string | null;
  close: () => void;
  submit: (payload: ReturnType<typeof parseAnalyticsCsv>) => Promise<unknown>;
}) {
  const [metric, setMetric] = useState<AnalyticsMetric>("dau");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <DetailDrawer title="Import Creator Dashboard CSV" close={close}>
      <form className="form" onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const file = form.get("csv");
        if (!(file instanceof File) || !file.size || file.size > analyticsCsvMaxBytes) {
          setError("Choose a CSV under 256 KB.");
          return;
        }
        setError("");
        setSaving(true);
        try {
          const payload = parseAnalyticsCsv(await file.text(), {
            gameId,
            universeId,
            fetchedAt: new Date().toISOString(),
            metric,
            percentAsRatio: form.has("ratio"),
          });
          if (await submit(payload)) close();
          else setError("Could not save the analytics import. Check the workspace connection and try again.");
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not read the CSV.");
        } finally {
          setSaving(false);
        }
      }}>
        <p>Export one chart from a Creator Dashboard you can access. Use a two-column CSV with the date first and the value second.</p>
        <a className="text-link" href={creatorAnalyticsUrl(universeId)} target="_blank" rel="noreferrer">Open Creator Dashboard</a>
        <label>
          Metric in this file
          <CustomSelect aria-label="Metric in this file" value={metric}
            onValueChange={(value) => setMetric(value as AnalyticsMetric)}>
            {Object.entries(metricDefinitions).map(([id, definition]) =>
              <option key={id} value={id}>{definition.label} ({definition.unit})</option>
            )}
          </CustomSelect>
        </label>
        {metricDefinitions[metric].unit === "%" && (
          <label className="checkbox"><input type="checkbox" name="ratio" /> Values use decimals such as 0.24 for 24%</label>
        )}
        <label>Chart CSV<input name="csv" type="file" accept=".csv,text/csv" required /></label>
        {error && <p className="failure-text" role="alert">{error}</p>}
        <Button disabled={saving}>{saving ? "Importing…" : "Import observations"}</Button>
      </form>
    </DetailDrawer>
  );
}
