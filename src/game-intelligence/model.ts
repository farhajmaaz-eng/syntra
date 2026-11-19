export const categories = ["Trending", "Top CCU", "Rising", "Most Visited", "Most Favorited", "Up-and-Coming"] as const;
export type Category = typeof categories[number];
export const providers = {
  roblox: { name: "Roblox", origin: "https://apis.roblox.com", path: "/explore-api/v1/get-sorts", minutes: 5, docs: "https://www.roblox.com/charts" },
  rowatcher: { name: "RoWatcher", origin: "https://rowatcher.com", path: "/api/v1/games", minutes: 10, docs: "https://rowatcher.com/developers" },
  gamestats: { name: "RobloxGameStats", origin: "https://robloxgamestats.com", path: "/api/v1/charts/top-trending", minutes: 10, docs: "https://robloxgamestats.com/docs/api" },
  playsurge: { name: "PlaySurge", origin: "https://playsurge.gg", path: "/api/v1/games", minutes: 60, docs: "https://playsurge.gg/docs" },
  bloxhub: { name: "BloxHub", origin: "https://bloxhub.games", path: "/api/v1/games", minutes: 10, docs: "https://bloxhub.games/api" },
} as const;
export type Provider = keyof typeof providers;
export type SourceSettings = Record<Provider, { enabled: boolean; minutes: number; endpoint: string }>;
export type Source = { provider: Provider; url: string; at: number };
export type Game = {
  key: string; universeId: number | null; placeId: number | null; name: string;
  creator: string; genre: string; description: string; icon: string;
  playing: number | null; visits: number | null; favorites: number | null;
  rating: number | null; growth: number | null; growthAt: number | null; growthSource?: Provider;
  ranks: Partial<Record<Category, number>>; rankSources: Partial<Record<Category, Provider>>;
  metricSources: Partial<Record<"playing" | "visits" | "favorites" | "rating", Source>>; sources: Source[];
};
export type Point = { at: number; playing: number | null; visits?: number | null; favorites?: number | null; rating?: number | null };
export type Series = { name: string; url?: string; points: Point[] };
export type SourceStatus = { provider: Provider; status: "ready" | "cached" | "unavailable" | "disabled"; at: number | null; retryAt?: number; error?: string };
export type Catalog = { games: Game[]; sources: SourceStatus[] };
export type Detail = { game: Game; history: Series[] };

export function categoryGames(games: Game[], category: Category) {
  const rank = (game: Game) => game.ranks[category] ?? Infinity;
  switch (category) {
    case "Trending":
    case "Up-and-Coming":
      return games.filter(game => Number.isFinite(rank(game))).sort((a, b) => rank(a) - rank(b));
    case "Rising":
      return games.filter(game => game.growth !== null && game.growth > 0).sort((a, b) => b.growth! - a.growth!);
    case "Top CCU":
    case "Most Visited":
    case "Most Favorited": {
      const field = category === "Top CCU" ? "playing" : category === "Most Visited" ? "visits" : "favorites";
      return games.filter(game => game[field] !== null).sort((a, b) => b[field]! - a[field]!);
    }
  }
}
