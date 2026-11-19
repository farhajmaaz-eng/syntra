import { it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import authored from "../library/playbooks.json";
import official from "../library/official.json";
const dir = mkdtempSync(resolve(tmpdir(), "syntra-library-"));
process.env.SYNTRA_DATA_DIR = dir;
const { librarySearch, libraryRead, libraryAction, libraryBrief, libraryStats, libraryGrep } =
  await import("../worker/library");
const { db } = await import("../worker/store");
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
it("seeds the official pack, agent playbooks and task recipes", () => {
  const stats = libraryStats();
  expect(stats.official).toBe(official.length);
  expect(stats.playbooks + stats.recipes).toBe(authored.entries.length);
  expect(librarySearch().length).toBe(stats.total);
  const results = librarySearch("RemoteEvent", "", false, { kind: "official" });
  expect(results.length).toBeGreaterThan(0);
  const article = libraryRead(results[0].id);
  expect(article.content.length).toBeGreaterThan(100);
  expect(article.license).toBe("CC BY 4.0");
  expect(article.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(article.sections.length).toBeGreaterThan(0);
  expect(() => librarySearch('" OR * - ()')).not.toThrow();
});

it("indexes distinct authored guides with primary sources and valid related IDs", () => {
  const ids = new Set([...authored.entries, ...official].map(({ id }) => id));
  expect(ids.size).toBe(authored.entries.length + official.length);
  const categories = new Set(["Agent playbooks", ...official.map(({ category }) => category)]);
  for (const entry of authored.entries) {
    expect(categories.has(entry.category)).toBe(true);
    expect(entry.sources.length).toBeGreaterThan(0);
    expect(entry.sources.every(({ url }) =>
      ["create.roblox.com", "luau.org", "rojo.space"].includes(new URL(url).hostname),
    )).toBe(true);
    expect(entry.related.every((id) => ids.has(id))).toBe(true);
    expect(libraryRead(entry.id).sections.length).toBeGreaterThanOrEqual(2);
  }
});

it.each([
  ["ProcessReceipt duplicate PurchaseId", "Builder", "playbook-purchase-receipts"],
  ["MemoryStore queue invisibility redelivery", "Architect", "playbook-cross-server"],
  ["Path.Blocked moving goal", "Scenic", "recipe-npc-pathfinding"],
  ["MicroProfiler p95 frame time", "Tester", "recipe-performance-triage"],
  ["strict Luau tagged union", "Codex", "playbook-luau-contracts"],
  ["server authority replication snapshot delta", "Architect", "playbook-network-sync"],
  ["live schemaVersion rollback", "Architect", "recipe-save-migration"],
])("ranks implementation guidance first for %s", (query, agent, guideId) => {
  const [result] = librarySearch(query, "", false, { agent, limit: 1 });
  expect(result.id).toBe(guideId);
  const brief = libraryBrief(query, agent, 3);
  expect(brief.sections[0].id).toBe(guideId);
  expect(new Set(brief.sections.map(({ id }) => id)).size).toBe(brief.count);
  expect(brief.text).toContain(result.sources[0].url);
  expect(brief.chars).toBeLessThanOrEqual(24000);
});
it("retrieves heading-aware sections and builds a cited agent brief", () => {
  const results = librarySearch("client server remote validation", "", false, {
    agent: "Builder",
    kind: "playbook",
  });
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].matches?.length).toBeGreaterThan(0);
  const section = results[0].matches[0];
  const sectionArticle = libraryRead(results[0].id, { sectionId: section.sectionId });
  expect(sectionArticle.section.heading).toBe(section.heading);
  expect(sectionArticle.content.length).toBeGreaterThan(50);
  const brief = libraryBrief("client server remote validation", "Builder", 3);
  expect(brief.count).toBeGreaterThan(0);
  expect(brief.chars).toBeLessThanOrEqual(24000);
  expect(brief.text).toContain("[library:");
});
it("persists editable personal references, bookmarks and FTS updates", () => {
  const { id } = libraryAction("save", {
    title: "Quest reference",
    category: "Game design",
    summary: "Personal lesson",
    content: "A cobaltquartz quest example",
    source: "",
  });
  if (!id) throw new Error("Save did not return a reference ID");
  expect(librarySearch("cobaltquartz").map((x) => x.id)).toContain(id);
  libraryAction("star", { id, starred: true });
  expect(librarySearch("", "", true).map((x) => x.id)).toContain(id);
  libraryAction("save", {
    id,
    title: "Updated quest",
    category: "Game design",
    summary: "Updated",
    content: "A moonpearl reward",
    source: "",
  });
  expect(librarySearch("cobaltquartz")).toHaveLength(0);
  expect(librarySearch("moonpearl")[0].title).toBe("Updated quest");
  expect(libraryRead(id).starred).toBe(true);
  libraryAction("delete", { id });
  expect(libraryRead(id)).toBeNull();
});
it("protects official entries and rejects executable image links", () => {
  expect(() =>
    libraryAction("delete", { id: librarySearch()[0].id }),
  ).toThrow();
  expect(() =>
    libraryAction("save", {
      title: "Bad",
      category: "My references",
      summary: "",
      content: "Test",
      image: "javascript:alert(1)",
    }),
  ).toThrow();
});


it("greps literal code with section context and pagination", () => {
  const first = libraryGrep("ProcessReceipt", { kind: "playbook", limit: 1 });
  expect(first.results).toHaveLength(1);
  const [match] = first.results;
  expect(match.text).toMatch(/ProcessReceipt/i);
  const section = libraryRead(match.id, { sectionId: match.sectionId });
  expect(section.content.split("\n")[match.line - 1].slice(match.column - 1)).toMatch(/^ProcessReceipt/i);
  expect(match.sources.length).toBeGreaterThan(0);
  expect(first.nextOffset).toBe(1);
  expect(libraryGrep("ProcessReceipt", { kind: "playbook", offset: 1 }).results[0]).not.toEqual(match);
  expect(libraryGrep("processreceipt", { caseSensitive: true }).results).toEqual([]);
  expect(libraryGrep("ProcessReceipt.*").results).toEqual([]);
});
