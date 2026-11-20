import { providers, type Game, type Provider, type Category, type Point } from "./model";

export type Row = Record<string, unknown>;
export const obj = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(obj) : [];
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
export const num = (value: unknown) => {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};
export const count = (value: unknown) => {
  const result = num(value);
  return result !== null && Number.isSafeInteger(result) && result >= 0 ? result : null;
};
export const timestamp = (value: unknown) => typeof value === "number" ? count(value) : count(Date.parse(str(value)));
export const slug = (value: unknown) => /^[a-z0-9][a-z0-9-]{0,149}$/.test(str(value)) ? str(value) : "";
export function iconUrl(value: unknown) {
  try {
    const url = new URL(str(value));
    if (url.protocol === "https:" && /^[a-z0-9-]+\.rbxcdn\.com$/.test(url.hostname) && !url.username && !url.password && !url.port) return url.href;
  } catch {}
  return "";
}
export function normalize(provider: Provider, row: Row, at: number, rank?: [Category, number]): Game | null {
  const universeId = count(row.universeId ?? (provider === "bloxhub" ? null : row.id));
  const slugId = slug(row.slug);
  const name = str(row.name).slice(0, 250);
  if ((!universeId && !(provider === "bloxhub" && slugId)) || !name || row.isSponsored === true || row.optedOut === true) return null;
  const placeId = count(row.rootPlaceId ?? row.placeId);
  const ratio = provider === "bloxhub" ? num(row.robloxApprovalRating) : provider === "gamestats" ? num(row.likes) : null;
  const growth = provider === "playsurge" ? num(row.change_24h) : null;
  const ranks: Game["ranks"] = rank ? { [rank[0]]: rank[1] } : {};
  if (provider === "bloxhub") {
    if (count(row.trendingRank)) ranks.Trending = count(row.trendingRank)!;
    if (count(row.upAndComingRank)) ranks["Up-and-Coming"] = count(row.upAndComingRank)!;
  }
  const sourcePath = {
    roblox: placeId ? "/games/" + placeId : "/charts",
    rowatcher: "/games/" + universeId + (slugId ? "/" + slugId : ""),
    gamestats: "/game/" + universeId,
    playsurge: "/game/" + (slugId || universeId),
    bloxhub: "/games/" + slugId,
  }[provider];
  const source: Game["sources"][number] = { provider, at: timestamp(row.lastScraped ?? row.updatedAt) ?? at,
    url: (provider === "roblox" ? "https://www.roblox.com" : providers[provider].origin) + sourcePath };
  const playing = count(row.playing ?? row.playerCount ?? row.players);
  const visits = count(row.visits);
  const favorites = count(row.favorites ?? row.favoritedCount);
  const capacity = provider === "roblox" ? count(row.maxPlayers) : null;
  const up = count(row.upVotes ?? row.totalUpVotes ?? (provider === "rowatcher" ? row.likes : null));
  const down = count(row.downVotes ?? row.totalDownVotes ?? row.dislikes);
  const total = up !== null && down !== null && Number.isSafeInteger(up + down) ? up + down : null;
  const approval = up !== null && total ? up / total * 100 : ratio !== null && ratio >= 0 && ratio <= 100 ? ratio : null;
  return {
    key: universeId ? String(universeId) : "bloxhub:" + slugId, universeId, placeId, name,
    creator: (str(row.creator) || str(obj(row.creator).name) || str(row.creatorName)).slice(0, 200),
    genre: str(row.genre_l1 ?? row.genreL1 ?? row.category ?? row.genre).slice(0, 100),
    description: str(row.description).slice(0, 5000), icon: iconUrl(row.icon ?? row.iconUrl ?? row.thumb),
    playing, visits, favorites, rating: approval,
    ...(capacity === null ? {} : { serverCapacity: { value: capacity, source } }),
    ...(up !== null && total !== null ? { voteCounts: { up, total, source } } : {}),
    growth, growthAt: growth === null ? null : at, ...(growth === null ? {} : { growthSource: provider }),
    ranks, rankSources: Object.fromEntries(Object.keys(ranks).map(category => [category, provider])), sources: [source],
    metricSources: {
      ...(playing === null ? {} : { playing: source }), ...(visits === null ? {} : { visits: source }),
      ...(favorites === null ? {} : { favorites: source }), ...(approval === null ? {} : { rating: source }),
    },
  };
}

export function normalizeFeed(provider: Provider, payload: unknown, fetched: number, rank?: Category) {
  const data = obj(payload);
  const at = timestamp(data.asOf ?? obj(data.meta).updated ?? obj(data.meta).cachedAt) ?? fetched;
  if (provider === "roblox" && Array.isArray(data.sorts)) {
    const charts: Record<string, Category> = { "top-trending": "Trending", "up-and-coming": "Up-and-Coming", "top-playing-now": "Top CCU" };
    return rows(data.sorts).flatMap(sort => {
      const chart = charts[str(sort.sortId)];
      return chart ? rows(sort.games).map((row, index) => normalize(provider, row, at, [chart, index + 1])) : [];
    }).filter((game): game is Game => game !== null);
  }
  const raw = data.games ?? data.data;
  if (!Array.isArray(raw)) throw new Error("Unexpected provider response");
  return rows(raw).slice(0, 1500).map((row, index) => normalize(provider, row, at, rank ? [rank, index + 1] : undefined))
    .filter((game): game is Game => game !== null);
}

export function historyPoints(input: unknown, keys: { time: string; players: string; visits?: string; favorites?: string }): Point[] {
  return rows(input).flatMap(row => {
    const at = timestamp(row[keys.time]);
    const playing = count(row[keys.players]);
    return at === null || playing === null ? [] : [{ at, playing,
      ...(keys.visits ? { visits: count(row[keys.visits]) } : {}),
      ...(keys.favorites ? { favorites: count(row[keys.favorites]) } : {}),
    }];
  }).sort((a, b) => a.at - b.at).slice(-180);
}
