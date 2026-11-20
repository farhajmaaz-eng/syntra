import { describe, expect, it } from "vitest";
import { parseAnalyticsCsv } from "../src/lib/analytics-csv";

const options = { gameId: "project", universeId: "17", metric: "d1_retention" as const,
  fetchedAt: "2025-03-11T00:00:00Z", percentAsRatio: true };

describe("Creator Dashboard chart import", () => {
  it("preserves zero, skips blanks, and converts percentages only as requested", () => {
    const input = '\uFEFF"Date","Value"\r\n"2025-03-07","0.25"\r\n2025-03-08,0\r\n2025-03-09,\r\n2025-03-10,35%';
    expect(parseAnalyticsCsv(input, options)).toMatchObject({
      gameId: "project",
      source: "https://create.roblox.com/dashboard/creations/experiences/17/overview",
      quality: "exported",
      metrics: [{ metric: "d1_retention", points: [
        { at: "2025-03-07T00:00:00.000Z", value: 25 },
        { at: "2025-03-08T00:00:00.000Z", value: 0 },
        { at: "2025-03-10T00:00:00.000Z", value: 35 },
      ] }],
    });
    expect(parseAnalyticsCsv("Date,Value\n2025-03-01,0.25", { ...options, percentAsRatio: false })
      .metrics[0].points[0].value).toBe(0.25);
  });

  it.each([
    ["Date,Value,Segment\n2025-03-01,10,Desktop", /two columns/],
    ["Date,Value\n2025-02-30,1", /ISO date/],
    ["Date,Value\n2025-03-01,2", /0 to 100/],
    ["Date,Value\n2025-03-01,0\n2025-03-01,0", /Duplicate/],
    ["Date,Value\n2025-03-12,0", /precede collection time/],
    ["Date,Value\n2025-03-01,unknown", /numeric value/],
  ])("rejects unsupported data %s", (csv, error) => {
    expect(() => parseAnalyticsCsv(csv, options)).toThrow(error);
  });
});
