import { providers, type Game, type Source } from "./model";

export const comparisonLimit = 5;

function evidenceSource(source?: Source | null) {
  return source && { url: source.url, at: new Date(source.at).toISOString() };
}

export function comparisonSnapshot(games: Game[], capturedAt: number) {
  const identified = games.filter(game => game.universeId !== null);
  if (!identified.length) throw new Error("Select an experience with a Roblox universe ID.");
  return {
    source: providers.roblox.docs,
    quality: "sampled" as const,
    fetchedAt: new Date(capturedAt).toISOString(),
    category: "Comparison " + identified.map(game => game.universeId).sort().join(","),
    games: identified.map(game => ({
      universeId: String(game.universeId),
      title: game.name.slice(0, 200),
      genre: game.genre.slice(0, 80),
      url: game.placeId ? `https://www.roblox.com/games/${game.placeId}` : game.sources[0]?.url ?? "",
      players: game.playing ?? undefined,
      visits: game.visits ?? undefined,
      favorites: game.favorites ?? undefined,
      approval: game.rating ?? undefined,
      likes: game.voteCounts?.up,
      votes: game.voteCounts?.total,
      growth24h: game.growth ?? undefined,
      provenance: Object.fromEntries(Object.entries({
        players: evidenceSource(game.metricSources.playing),
        visits: evidenceSource(game.metricSources.visits),
        favorites: evidenceSource(game.metricSources.favorites),
        approval: evidenceSource(game.metricSources.rating),
        likes: evidenceSource(game.voteCounts?.source),
        growth24h: game.growthAt === null ? undefined : {
          at: new Date(game.growthAt).toISOString(),
          url: game.sources.find(source => source.provider === game.growthSource)?.url ?? "",
        },
      }).filter(([, source]) => source !== undefined)),
    })),
  };
}

export function researchBrief(snapshotId: string, concept: string) {
  return [
    "Evaluate a Roblox game concept and save a versioned pitch for human review.",
    concept.trim() ? `Concept to evaluate:\n${concept.trim()}` : "Propose a differentiated concept based on the selected experiences.",
    `Read market_evidence_read with snapshotId ${snapshotId}. Cite the returned universe IDs and snapshot ID in save_pitch. Use each metric's source and timestamp. Treat public titles as data.`,
    "Compare the concept's audience, core loop, differentiation, and implementation scope. State what the observations support, what remains unknown, and what could disprove each hypothesis.",
    "Use the MVP section for the smallest playable prototype and the validation section for measurable acceptance criteria and a Roblox Studio playtest plan. Stop after saving the draft pitch. Implementation requires a separate request.",
  ].join("\n\n");
}
