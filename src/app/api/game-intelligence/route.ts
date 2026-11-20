import { catalog, gameDetail, searchGames } from "../../../game-intelligence/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const key = query.get("game");
  try {
    const data = key ? await gameDetail(key, { direct: query.get("view") === "liveops" }) : query.get("q") ? await searchGames(query.get("q")!) : await catalog();
    const payload = data && "games" in data
      ? { ...data, games: data.games.map(game => ({ ...game, description: "" })) }
      : data;
    return Response.json(payload ?? { error: "Game could not be found in the enabled sources." }, {
      status: data ? 200 : 404,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Game intelligence is temporarily unavailable." }, { status: 503 });
  }
}
