import { randomUUID } from "node:crypto";
import { cached, intelligenceDb, settings } from "./cache";
import { count, historyPoints, iconUrl, normalize, normalizeFeed, num, obj, rows, slug } from "./adapters";
import { categories, categoryGames, providers, type Catalog, type Category, type Detail, type Game, type Point, type Provider, type Series, type SourceSettings } from "./model";

const hour = 3_600_000;
const day = 24 * hour;
const officialGames = "https://games.roblox.com/v1/games";
const officialIcons = "https://thumbnails.roblox.com/v1/games/icons";
const url = (base: string, query: Record<string, string>) => base + "?" + new URLSearchParams(query);
const withPath = (provider: Provider, path: string) => providers[provider].origin + path;

function feed(config: SourceSettings, provider: Provider, endpoint: string, query: Record<string, string> = {}, rank?: Category) {
  // Session IDs are generated only for the Roblox upstream request. They never alter the cache key.
  const key = url(endpoint, query);
  const request = provider === "roblox" && /explore-api|omni-search/.test(endpoint)
    ? url(endpoint, { ...query, sessionId: randomUUID() }) : key;
  return cached(provider, key, request, config, (text, at) => normalizeFeed(provider, JSON.parse(text), at, rank));
}

const normalizedName = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const identity = (game: Game) => game.creator && normalizedName(game.name) + "\n" + normalizedName(game.creator);
const fieldPriority: Provider[] = ["roblox", "rowatcher", "bloxhub", "gamestats", "playsurge"];

export function mergeGames(entries: Game[]) {
  const idsByIdentity = new Map<string, Set<string>>();
  for (const game of entries) {
    const label = identity(game);
    if (!game.universeId || !label) continue;
    const ids = idsByIdentity.get(label) ?? new Set<string>();
    ids.add(game.key);
    idsByIdentity.set(label, ids);
  }
  const games = new Map<string, Game>();
  const now = Date.now();
  const chartPriority: Provider[] = ["roblox", "gamestats", "bloxhub", "rowatcher", "playsurge"];
  const sorted = [...entries].sort((a, b) => {
    const fresh = (game: Game) => now - game.sources[0].at < 30 * 60_000;
    return Number(fresh(b)) - Number(fresh(a)) ||
      fieldPriority.indexOf(a.sources[0].provider) - fieldPriority.indexOf(b.sources[0].provider);
  });
  for (const row of sorted) {
    const ids = idsByIdentity.get(identity(row));
    const key = row.universeId || ids?.size !== 1 ? row.key : [...ids][0];
    const current = games.get(key);
    if (!current) {
      games.set(key, { ...row, key, ranks: { ...row.ranks }, rankSources: { ...row.rankSources }, metricSources: { ...row.metricSources }, sources: [...row.sources] });
      continue;
    }
    for (const field of ["name", "creator", "genre", "description", "icon"] as const) current[field] ||= row[field];
    current.universeId ??= row.universeId;
    current.placeId ??= row.placeId;
    for (const field of ["playing", "visits", "favorites", "rating"] as const) {
      const incoming = row.metricSources[field];
      const existing = current.metricSources[field];
      if (incoming && (!existing || (incoming.provider === existing.provider && incoming.at > existing.at))) {
        current[field] = row[field];
        current.metricSources[field] = incoming;
      }
    }
    if (row.serverCapacity && (!current.serverCapacity || row.serverCapacity.source.at > current.serverCapacity.source.at))
      current.serverCapacity = row.serverCapacity;
    if (row.voteCounts && (!current.voteCounts ||
      (row.voteCounts.source.provider === current.voteCounts.source.provider &&
        row.voteCounts.source.at > current.voteCounts.source.at))) {
      current.voteCounts = row.voteCounts;
    }
    if (row.growthAt !== null && (current.growthAt === null || row.growthAt > current.growthAt)) {
      current.growth = row.growth;
      current.growthAt = row.growthAt;
      current.growthSource = row.growthSource;
    }
    for (const category of categories) {
      const rank = row.ranks[category];
      const provider = row.rankSources[category];
      const existing = current.rankSources[category];
      if (rank !== undefined && provider && (!existing || chartPriority.indexOf(provider) < chartPriority.indexOf(existing))) {
        current.ranks[category] = rank;
        current.rankSources[category] = provider;
      }
    }
    for (const source of row.sources) {
      const existing = current.sources.find(item => item.provider === source.provider);
      if (!existing) current.sources.push(source);
      else if (source.at > existing.at) current.sources = current.sources.map(item => item === existing ? source : item);
    }
  }
  return [...games.values()];
}

function enrich(config: SourceSettings, ids: number[]) {
  if (!ids.length) return Promise.resolve([]);
  return Promise.all([
    feed(config, "roblox", officialGames, { universeIds: ids.join(",") }),
    cached("roblox", "votes:" + ids.join(","), url(officialGames + "/votes", { universeIds: ids.join(",") }),
      config, (text, at) => {
        const data = obj(JSON.parse(text)).data;
        if (!Array.isArray(data)) throw new Error("Unexpected votes response");
        return rows(data).map(row => ({ ...row, at }));
      }, 30),
    cached("roblox", "icons:" + ids.join(","), url(officialIcons, {
      universeIds: ids.join(","), size: "150x150", format: "Png", isCircular: "false",
    }), config, (text) => {
      const data = obj(JSON.parse(text)).data;
      if (!Array.isArray(data)) throw new Error("Unexpected thumbnails response");
      return rows(data).flatMap(row => row.state === "Completed" && count(row.targetId) && iconUrl(row.imageUrl)
        ? [[String(row.targetId), iconUrl(row.imageUrl)] as const] : []);
    }, 60),
  ]).then(([stats, votes, images]) => {
    const icons = new Map(images.data ?? []);
    const byId = new Map((votes.data ?? []).map(row => [String(obj(row).id), row]));
    return (stats.data ?? []).map(game => {
      const vote = byId.get(game.key);
      const approved = vote && normalize("roblox", { ...vote, name: game.name, placeId: game.placeId }, vote.at);
      return { ...game, icon: icons.get(game.key) ?? game.icon,
        rating: approved?.rating ?? game.rating,
        voteCounts: approved?.voteCounts ?? game.voteCounts,
        metricSources: approved?.metricSources.rating ? { ...game.metricSources, rating: approved.metricSources.rating } : game.metricSources };
    });
  });
}

function observe(games: Game[]) {
  const db = intelligenceDb();
  const insert = db.prepare("INSERT OR IGNORE INTO observations VALUES (?,?,?,?,?)");
  const now = Date.now();
  const prior = db.prepare("SELECT playing FROM observations WHERE game=? AND at BETWEEN ? AND ? AND playing>0 ORDER BY ABS(at-?) LIMIT 1");
  db.transaction(() => {
    for (const game of games) {
      const observed = game.metricSources.playing?.at;
      if (observed && observed <= now && observed >= now - 2 * day && game.playing !== null) {
        const bucket = Math.floor(observed / hour) * hour;
        insert.run(game.key, bucket, game.playing, game.visits, game.favorites);
        // Use the provider's reported day-over-day comparison where available.
        if (game.growthAt !== null && now - game.growthAt > 2 * day) {
          game.growth = game.growthAt = null;
          delete game.growthSource;
        }
        if (game.growth === null) {
          const old = prior.get(game.key, bucket - 26 * hour, bucket - 22 * hour, bucket - day) as { playing: number } | undefined;
          if (old) { game.growth = (game.playing - old.playing) / old.playing; game.growthAt = observed; }
        }
      }
    }
    db.prepare("DELETE FROM observations WHERE at < ?").run(now - 14 * day);
  }).immediate();
}

const catalogPending = new Map<string, Promise<Catalog>>();
async function collectCatalog(config: SourceSettings): Promise<Catalog> {
  const primary = (provider: Provider, params?: Record<string, string>, rank?: Category) => feed(config, provider, config[provider].endpoint, params, rank);
  const [roblox, rowatcher, stats, surge, blox, rising, upcoming] = await Promise.all([
    primary("roblox", { device: "computer", country: "US" }),
    primary("rowatcher", { sort: "playing" }),
    primary("gamestats", {}, "Trending"),
    primary("playsurge", { limit: "75" }),
    primary("bloxhub"),
    feed(config, "playsurge", withPath("playsurge", "/api/v1/rising"), { limit: "40" }),
    feed(config, "gamestats", withPath("gamestats", "/api/v1/charts/up-and-coming"), {}, "Up-and-Coming"),
  ]);
  const gathered = [roblox, rowatcher, stats, surge, blox, rising, upcoming].flatMap(result => result.data ?? []);
  const initial = mergeGames(gathered);
  const ids = [...new Set([...categories.flatMap(category => categoryGames(initial, category).slice(0, 18)), ...initial]
    .flatMap(game => game.universeId ? [game.universeId] : []))].slice(0, 100);
  const extra = config.roblox.enabled
    ? (await Promise.all([enrich(config, ids.slice(0, 50)), enrich(config, ids.slice(50))])).flat() : [];
  const games = mergeGames([...extra, ...gathered]);
  observe(games);
  return { games, sources: [roblox, rowatcher, stats, surge, blox].map(result => result.source) };
}

export function catalog() {
  const config = settings();
  const key = JSON.stringify(config);
  const pending = catalogPending.get(key);
  if (pending) return pending;
  const next = collectCatalog(config).finally(() => catalogPending.delete(key));
  catalogPending.set(key, next);
  return next;
}

export async function searchGames(query: string) {
  const q = query.trim().toLowerCase().slice(0, 100);
  const config = settings();
  const searchEndpoint = "https://apis.roblox.com/search-api/omni-search";
  const search = q.length < 2 ? null : cached("roblox", "search:" + q,
    url(searchEndpoint, { searchQuery: q, sessionId: randomUUID(), pageType: "games" }),
    config, (text, at) => {
      const groups = obj(JSON.parse(text)).searchResults;
      if (!Array.isArray(groups)) throw new Error("Unexpected Roblox search response");
      return normalizeFeed("roblox", { data: rows(groups).filter(group => group.contentGroupType === "Game").flatMap(group => rows(group.contents)) }, at);
    }, 30);
  const fallback = q.length < 2 ? null : feed(config, "gamestats", withPath("gamestats", "/api/v1/search"), { q });
  const [index, official, other] = await Promise.all([catalog(), search, fallback]);
  const matched = index.games.filter(game => (game.name + " " + game.creator).toLowerCase().includes(q) || game.key === q || String(game.placeId) === q);
  const remote = [...official?.data ?? [], ...other?.data ?? []];
  const numeric = /^[1-9]\d{0,15}$/.test(q) ? count(q) : null;
  const ids = [...new Set([...(numeric ? [numeric] : []), ...remote.flatMap(game => game.universeId ? [game.universeId] : [])])].slice(0, 40);
  const extra = config.roblox.enabled ? await enrich(config, ids) : [];
  const games = mergeGames([...extra, ...matched, ...remote]).sort((a, b) => {
    const relevance = (game: Game) => game.key === q || String(game.placeId) === q ? 3 :
      game.name.toLowerCase().startsWith(q) ? 2 : game.name.toLowerCase().includes(q) ? 1 : 0;
    return relevance(b) - relevance(a) || (b.playing ?? -1) - (a.playing ?? -1);
  }).slice(0, 100);
  observe(games);
  return { games, sources: index.sources };
}

export async function gameDetail(key: string, { direct = false } = {}): Promise<Detail | null> {
  if (!/^(?:[1-9]\d{0,15}|bloxhub:[a-z0-9][a-z0-9-]{0,149})$/.test(key)) return null;
  const config = settings();
  const requestedId = count(key);
  const index = direct && requestedId ? null : await catalog();
  const found = index?.games.find(game => game.key === key);
  const id = found?.universeId ?? requestedId;
  const bloxSource = found?.sources.find(source => source.provider === "bloxhub");
  const bloxSlug = slug(bloxSource?.url.split("/").at(-1));
  const single = async (provider: Provider, endpoint: string) => cached(provider, endpoint, endpoint, config, (text, at) =>
    normalize(provider, obj(JSON.parse(text)), at));
  const [extra, stats, blox] = await Promise.all([
    id && config.roblox.enabled ? enrich(config, [id]) : [],
    id && !found ? single("gamestats", withPath("gamestats", `/api/v1/games/${id}`)) : null,
    bloxSlug ? single("bloxhub", withPath("bloxhub", `/api/v1/games/${bloxSlug}`)) : null,
  ]);
  const candidates = mergeGames([
    ...extra,
    ...(found ? [found] : []),
    ...(stats?.data ? [stats.data] : []),
    ...(blox?.data ? [blox.data] : []),
  ]);
  const matched = candidates.find(game => id ? game.universeId === id :
    game.key === key || game.sources.some(source =>
      source.provider === "bloxhub" && source.url.endsWith("/" + bloxSlug)));
  if (!matched) return direct && requestedId ? gameDetail(key) : null;
  const game = matched;
  observe([game]);

  const history: Series[] = [];
  const local = intelligenceDb().prepare("SELECT at,playing,visits,favorites FROM observations WHERE game=? ORDER BY at DESC LIMIT 180").all(game.key) as Point[];
  if (local.length) history.push({ name: "Syntra observations", points: local.reverse() });
  async function add(provider: Provider, endpoint: string, name: string, parse: (text: string) => Point[]) {
    const result = await cached(provider, endpoint, endpoint, config, parse, 360);
    const citation = game.sources.find(source => source.provider === provider)?.url;
    if (result.data?.length) return { name, url: citation || providers[provider].docs, points: result.data };
  }
  const hourly = id ? cached("gamestats", `series:${id}`, withPath("gamestats", `/api/v1/games/${id}/series?days=7`), config, text => {
    const data = obj(JSON.parse(text));
    if (!Array.isArray(data.hours) || !Array.isArray(data.days)) throw new Error("Unexpected historical series");
    return {
      ccu: historyPoints(data.hours, { time: "t", players: "v" }),
      daily: rows(data.days).flatMap(row => {
        const at = count(row.t), visits = count(row.visits), rating = num(row.likes);
        return at === null || (visits === null && rating === null) ? [] : [{ at, playing: null, visits, rating }];
      }).sort((a, b) => a.at - b.at).slice(-180),
    };
  }, 360) : null;
  const series = await Promise.all([
    id && add("rowatcher", withPath("rowatcher", `/api/v1/games/${id}/history.csv?days=30`),
      "RoWatcher daily average", text => {
        const [header, ...lines] = text.trim().split(/\r?\n/);
        if (header !== "date,playing_avg,playing_min,playing_max") throw new Error("Unexpected history CSV");
        return historyPoints(lines.map(line => {
          const [date, players] = line.split(",");
          return { date, players };
        }), { time: "date", players: "players" });
      }),
    id && add("playsurge", withPath("playsurge", `/api/v1/games/${id}/history?range=1w`),
      "PlaySurge samples", text => historyPoints(rows(obj(obj(JSON.parse(text)).data).points).map(row => ({
        ...row, ts: (num(row.ts) ?? 0) * 1000,
      })), { time: "ts", players: "playing" })),
  ]);
  for (const item of series) if (item) history.push(item);
  const statsHistory = (await hourly)?.data;
  if (id && statsHistory) {
    const citation = withPath("gamestats", `/game/${id}`);
    if (statsHistory.ccu.length) history.push({
      name: "RobloxGameStats hourly CCU (may include estimates)", url: citation, points: statsHistory.ccu,
    });
    if (statsHistory.daily.length) history.push({
      name: "RobloxGameStats daily visits and approval (may include estimates)", url: citation, points: statsHistory.daily,
    });
  }
  return { game, history };
}
