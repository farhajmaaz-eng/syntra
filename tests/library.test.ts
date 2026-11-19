import { it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const dir = mkdtempSync(resolve(tmpdir(), "forge-library-"));
process.env.FORGE_DATA_DIR = dir;
const { librarySearch, libraryRead, libraryAction, libraryBrief, libraryStats } =
  await import("../worker/library");
const { db } = await import("../worker/store");
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
it("seeds the official pack, agent playbooks and task recipes", () => {
  const stats = libraryStats();
  expect(stats.official).toBeGreaterThanOrEqual(90);
  expect(stats.playbooks).toBeGreaterThanOrEqual(8);
  expect(stats.recipes).toBeGreaterThanOrEqual(12);
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
