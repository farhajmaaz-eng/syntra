import { metricDefinitions, telemetrySchema } from "./feature-contracts";

export type AnalyticsMetric = keyof typeof metricDefinitions;
export const analyticsCsvMaxBytes = 256 * 1024;

// A single Creator Dashboard chart has a timestamp and one metric value per row.
const csvPair = /^\s*(?:"((?:[^"]|"")*)"|([^",]*)),\s*(?:"((?:[^"]|"")*)"|([^",]*))\s*$/;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const zonedDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const decimal = /^\d+(?:\.\d+)?$/;

export function creatorAnalyticsUrl(universeId?: string | null) {
  return universeId && /^\d+$/.test(universeId)
    ? `https://create.roblox.com/dashboard/creations/experiences/${universeId}/overview`
    : "https://create.roblox.com/dashboard/creations";
}

export function parseAnalyticsCsv(
  csv: string,
  options: {
    gameId: string;
    universeId?: string | null;
    metric: AnalyticsMetric;
    percentAsRatio?: boolean;
    fetchedAt: string;
  },
) {
  if (csv.length > analyticsCsvMaxBytes) throw new Error("Choose a CSV under 256 KB.");
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2 || lines.length > 2001 || !csvPair.test(lines[0])) {
    throw new Error("Use a chart CSV with two columns and 1–2,000 observations.");
  }
  const points = lines.slice(1).flatMap((line, i) => {
    if (!line.trim()) return [];
    const row = csvPair.exec(line);
    const atText = (row?.[1] ?? row?.[2] ?? "").trim();
    const rawValue = (row?.[3] ?? row?.[4] ?? "").trim();
    const rowNumber = i + 2;
    const at = dateOnly.test(atText) ? `${atText}T00:00:00Z` : atText;
    const date = new Date(at);
    const day = new Date(`${at.slice(0, 10)}T00:00:00Z`);
    if (!zonedDateTime.test(at) || !Number.isFinite(date.getTime()) ||
      !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== at.slice(0, 10)) {
      throw new Error(`Row ${rowNumber} needs an ISO date or a timestamp with a time zone.`);
    }
    if (!rawValue) return []; // A missing observation must stay missing.
    const isPercentage = metricDefinitions[options.metric].unit === "%";
    const hasPercentSign = rawValue.endsWith("%");
    const numeric = isPercentage && hasPercentSign ? rawValue.slice(0, -1).trim() : rawValue;
    if (!decimal.test(numeric)) throw new Error(`Row ${rowNumber} needs a numeric value.`);
    const value = Number(numeric) * (isPercentage && options.percentAsRatio && !hasPercentSign ? 100 : 1);
    return [{ at: date.toISOString(), value }];
  });
  const result = telemetrySchema.safeParse({
    gameId: options.gameId,
    source: creatorAnalyticsUrl(options.universeId),
    fetchedAt: options.fetchedAt,
    quality: "exported",
    metrics: [{ metric: options.metric, points }],
  });
  if (!result.success) throw new Error(result.error.issues[0]?.message || "Invalid analytics CSV.");
  return result.data;
}
