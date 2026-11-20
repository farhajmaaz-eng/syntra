import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import { cached, intelligenceDb, saveSettings, settings } from "../src/game-intelligence/cache";
import { normalizeFeed } from "../src/game-intelligence/adapters";
import { categoryGames } from "../src/game-intelligence/model";
import { mergeGames } from "../src/game-intelligence/service";

const directory = mkdtempSync(join(tmpdir(), "syntra-games-"));
process.env.SYNTRA_DATA_DIR = directory;
afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  intelligenceDb().close();
  rmSync(directory, { recursive: true, force: true });
});

it("keeps official chart positions, source attribution and only deduplicates unambiguous identities", () => {
  const now = Date.now();
  const chart = normalizeFeed("roblox", { sorts: [
    { sortId: "top-trending", games: [
      { universeId: 1, rootPlaceId: 20, name: "Example 🧪 Game", creatorName: "Test Group", playerCount: 0, totalUpVotes: 8, totalDownVotes: 2 },
      { universeId: 2, rootPlaceId: 21, name: "Ad", isSponsored: true, playerCount: 100 },
    ] },
  ] }, now);
  const blox = normalizeFeed("bloxhub", { games: [
    { slug: "example-game", name: "Example Game", creator: "Test Group", playing: 20, visits: 600, trendingRank: 4 },
    { slug: "distinct-game", name: "Example Game", creator: "Other Group", playing: 10 },
  ] }, now);
  const surge = normalizeFeed("playsurge", { data: [{ id: 1, name: "Example Game", change_24h: 0.25 }] }, now);
  const games = mergeGames([...blox, ...chart, ...surge]);
  expect(games).toHaveLength(2);
  expect(categoryGames(games, "Trending")[0]).toMatchObject({
    key: "1", playing: 0, visits: 600, rating: 80, growth: 0.25,
    ranks: { Trending: 1 }, rankSources: { Trending: "roblox" },
    metricSources: { visits: { provider: "bloxhub" }, playing: { provider: "roblox" } },
  });
  expect(categoryGames(games, "Rising").map(game => game.key)).toEqual(["1"]);
  expect(categoryGames(games, "Most Favorited")).toEqual([]);
});

it("rejects off-provider endpoints and persists validated local settings", () => {
  const config = settings();
  expect(() => saveSettings({ ...config, bloxhub: { ...config.bloxhub, endpoint: "https://localhost/api/v1/games" } })).toThrow(/public HTTPS path/);
  expect(() => saveSettings({ ...config, playsurge: { ...config.playsurge, minutes: 1 } })).toThrow(/refresh interval/);
  expect(saveSettings({ ...config, bloxhub: { ...config.bloxhub, enabled: false } }).bloxhub.enabled).toBe(false);
  expect(settings().bloxhub.enabled).toBe(false);
});

it("coalesces a refresh, falls back to stale data, and honors rate limits across a provider", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const fetcher = vi.fn()
    .mockImplementationOnce(async () => Response.json({ source: "live" }))
    .mockImplementationOnce(async () => new Response("rate limit", { status: 429, headers: { "Retry-After": "300" } }));
  vi.stubGlobal("fetch", fetcher);
  const config = settings();
  const read = (key: string) => cached("rowatcher", key, config.rowatcher.endpoint, config, body => JSON.parse(body));
  const [first, other] = await Promise.all([read("test"), read("test")]);
  expect(first.data).toEqual({ source: "live" });
  expect(first).toEqual(other);
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 11 * 60_000);
  const stale = await read("test");
  expect(stale.source).toMatchObject({ status: "cached", error: "HTTP 429" });
  expect(stale.data).toEqual(first.data);
  expect((await read("another")).source).toMatchObject({ status: "unavailable", error: "HTTP 429" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});


it("serves a linked LiveOps universe with official metrics and cached history without loading chart rankings", async () => {
  const config = settings();
  saveSettings({
    ...config, gamestats: { ...config.gamestats, enabled: false },
    rowatcher: { ...config.rowatcher, enabled: false },
    playsurge: { ...config.playsurge, enabled: false },
  });
  const fetcher = vi.fn(async (address: string) => {
    const path = new URL(address).pathname;
    if (path === "/v1/games") return Response.json({ data: [
      { id: 99, rootPlaceId: 83, name: "Other game", playing: 900 },
      { id: 87, rootPlaceId: 18, name: "Linked game", playing: 0, visits: 43, maxPlayers: 14 },
    ] });
    if (path === "/v1/games/votes")
      return Response.json({ data: [{ id: 87, upVotes: 18, downVotes: 2 }] });
    if (path === "/v1/games/icons") return Response.json({ data: [] });
    throw new Error("Unrelated feed requested");
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const { GET } = await import("../src/app/api/game-intelligence/route");
    const req = () => new Request("http://localhost/api/game-intelligence?view=liveops&game=87");
    const response = await GET(req());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      game: { universeId: 87, playing: 0, visits: 43, rating: 90,
        voteCounts: { up: 18, total: 20 },
        serverCapacity: { value: 14, source: { provider: "roblox" } },
      },
      history: [{ name: "Syntra observations", points: [{ playing: 0, visits: 43 }] }],
    });
    expect((await GET(req())).status).toBe(200);
    expect(fetcher.mock.calls.map(([address]) => new URL(address).pathname).sort()).toEqual([
      "/v1/games", "/v1/games/icons", "/v1/games/votes",
    ]);
  } finally {
    vi.unstubAllGlobals();
    saveSettings(config);
  }
});
