import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./store";

db.exec(`CREATE TABLE IF NOT EXISTS library_entries(id TEXT PRIMARY KEY,title TEXT NOT NULL,category TEXT NOT NULL,summary TEXT NOT NULL,content TEXT NOT NULL,payload TEXT NOT NULL,starred INTEGER DEFAULT 0,updated TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE VIRTUAL TABLE IF NOT EXISTS library_fts USING fts5(title,category,summary,content,content='library_entries',content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS library_ai AFTER INSERT ON library_entries BEGIN INSERT INTO library_fts(rowid,title,category,summary,content) VALUES(new.rowid,new.title,new.category,new.summary,new.content); END;
CREATE TRIGGER IF NOT EXISTS library_ad AFTER DELETE ON library_entries BEGIN INSERT INTO library_fts(library_fts,rowid,title,category,summary,content) VALUES('delete',old.rowid,old.title,old.category,old.summary,old.content); END;
CREATE TRIGGER IF NOT EXISTS library_au AFTER UPDATE OF title,category,summary,content ON library_entries BEGIN INSERT INTO library_fts(library_fts,rowid,title,category,summary,content) VALUES('delete',old.rowid,old.title,old.category,old.summary,old.content); INSERT INTO library_fts(rowid,title,category,summary,content) VALUES(new.rowid,new.title,new.category,new.summary,new.content); END;
CREATE TABLE IF NOT EXISTS library_sections(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,ordinal INTEGER NOT NULL,heading TEXT NOT NULL,content TEXT NOT NULL,chars INTEGER NOT NULL,FOREIGN KEY(entry_id) REFERENCES library_entries(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS library_sections_entry ON library_sections(entry_id,ordinal);
CREATE VIRTUAL TABLE IF NOT EXISTS library_section_fts USING fts5(heading,content,content='library_sections',content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS library_section_ai AFTER INSERT ON library_sections BEGIN INSERT INTO library_section_fts(rowid,heading,content) VALUES(new.rowid,new.heading,new.content); END;
CREATE TRIGGER IF NOT EXISTS library_section_ad AFTER DELETE ON library_sections BEGIN INSERT INTO library_section_fts(library_section_fts,rowid,heading,content) VALUES('delete',old.rowid,old.heading,old.content); END;
CREATE TRIGGER IF NOT EXISTS library_section_au AFTER UPDATE OF heading,content ON library_sections BEGIN INSERT INTO library_section_fts(library_section_fts,rowid,heading,content) VALUES('delete',old.rowid,old.heading,old.content); INSERT INTO library_section_fts(rowid,heading,content) VALUES(new.rowid,new.heading,new.content); END;`);

const officialSeeds = JSON.parse(
  readFileSync(resolve("library/official.json"), "utf8"),
) as any[];
let playbookSeeds: any[] = [];
try {
  playbookSeeds = JSON.parse(
    readFileSync(resolve("library/playbooks.json"), "utf8"),
  ).entries;
} catch {
  // The playbook pack is optional so an older checkout still boots.
}
const seeds = [...officialSeeds, ...playbookSeeds];

const put = db.prepare(
  `INSERT INTO library_entries(id,title,category,summary,content,payload) VALUES (@id,@title,@category,@summary,@content,@payload) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,summary=excluded.summary,content=excluded.content,payload=excluded.payload,updated=CURRENT_TIMESTAMP`,
);
const deleteSections = db.prepare(
  "DELETE FROM library_sections WHERE entry_id=?",
);
const insertSection = db.prepare(
  "INSERT INTO library_sections(id,entry_id,ordinal,heading,content,chars) VALUES (?,?,?,?,?,?)",
);

/**
 * Split a reference into retrieval-sized sections. This mirrors the useful
 * part of RoAutomation's vault library: agents receive the matching section,
 * not the whole document. Headings are the primary boundaries; long prose is
 * split into ~4,000-character paragraphs so a search result stays focused.
 */
export function splitLibrarySections(title: string, content: string) {
  const lines = String(content || "").split(/\r?\n/);
  const raw: Array<{ heading: string; content: string }> = [];
  let heading = title;
  let buffer: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) raw.push({ heading, content: text });
    buffer = [];
  };
  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence;
    const match = !inFence && line.match(/^#{1,3}\s+(.+?)\s*#*\s*$/);
    if (match) {
      flush();
      heading = match[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();

  const sections: Array<{ heading: string; content: string }> = [];
  for (const section of raw) {
    if (section.content.length <= 4000) {
      sections.push(section);
      continue;
    }
    let chunk = "";
    let part = 1;
    const flushPart = () => {
      if (!chunk.trim()) return;
      sections.push({
        heading: part > 1 ? `${section.heading} (part ${part})` : section.heading,
        content: chunk.trim(),
      });
      chunk = "";
      part += 1;
    };
    for (const paragraph of section.content.split(/\n{2,}/)) {
      if (chunk && chunk.length + paragraph.length + 2 > 4000) flushPart();
      if (paragraph.length > 4000) {
        for (let index = 0; index < paragraph.length; index += 3500) {
          if (chunk) flushPart();
          chunk = paragraph.slice(index, index + 3500);
          flushPart();
        }
      } else {
        chunk += (chunk ? "\n\n" : "") + paragraph;
      }
    }
    flushPart();
  }
  return sections;
}

function replaceSections(entry: any) {
  const sections = splitLibrarySections(entry.title, entry.content);
  db.transaction(() => {
    deleteSections.run(entry.id);
    sections.forEach((section, ordinal) => {
      insertSection.run(
        `${entry.id}:${ordinal}`,
        entry.id,
        ordinal,
        section.heading,
        section.content,
        section.content.length,
      );
    });
  })();
}

function seedEntry(entry: any) {
  const payload = JSON.stringify(entry);
  const old: any = db
    .prepare("SELECT payload FROM library_entries WHERE id=?")
    .get(entry.id);
  const sectionCount: any = db
    .prepare("SELECT COUNT(*) AS count FROM library_sections WHERE entry_id=?")
    .get(entry.id);
  if (!old || old.payload !== payload || !sectionCount?.count) {
    put.run({
      id: entry.id,
      title: entry.title,
      category: entry.category,
      summary: entry.summary,
      content: entry.content,
      payload,
    });
    replaceSections(entry);
  }
}

db.transaction(() => {
  for (const entry of seeds) seedEntry(entry);
})();

export function resetLibrary() {
  db.prepare("DELETE FROM library_sections").run();
  db.prepare("DELETE FROM library_entries").run();
  for (const entry of seeds) seedEntry(entry);
}

function unpack(row: any, full = false) {
  if (!row) return null;
  const entry = JSON.parse(row.payload);
  if (!full) delete entry.content;
  return { ...entry, starred: !!row.starred, updated: row.updated };
}

const readSectionMetadata = db.prepare(
  "SELECT id,heading,ordinal,chars FROM library_sections WHERE entry_id=? ORDER BY ordinal",
);
const readSections = db.prepare(
  "SELECT id,heading,ordinal,chars,content FROM library_sections WHERE entry_id=? ORDER BY ordinal",
);
const readSection = db.prepare(
  "SELECT id,heading,ordinal,chars,content FROM library_sections WHERE id=? AND entry_id=?",
);

function withSections(entry: any, includeContent = false) {
  const sections = (includeContent ? readSections : readSectionMetadata).all(
    entry.id,
  );
  return { ...entry, sections, sectionCount: sections.length };
}

export function libraryRead(
  id: string,
  options: { sectionId?: string; includeSectionContent?: boolean } = {},
) {
  const row = db
    .prepare("SELECT * FROM library_entries WHERE id=?")
    .get(id);
  if (!row) return null;
  const entry = withSections(unpack(row, true), options.includeSectionContent);
  if (options.sectionId) {
    const section = readSection.get(options.sectionId, id) as any;
    if (!section) return null;
    return { ...entry, section, content: section.content };
  }
  return entry;
}

type GrepKind = "authored" | "official" | "playbook" | "recipe" | "personal" | "all";
type GrepSection = {
  id: string; entryId: string; heading: string; content: string; title: string;
  source: string | null; sources: string | null;
};

const grepSections = db.prepare(`
  SELECT s.id,s.entry_id AS entryId,s.heading,s.content,e.title,
    json_extract(e.payload,'$.source') AS source, json_extract(e.payload,'$.sources') AS sources
  FROM library_sections s JOIN library_entries e ON e.id=s.entry_id
  WHERE (@id IS NULL OR e.id=@id)
    AND (@kind='all'
      OR (@kind='authored' AND json_extract(e.payload,'$.kind') IN ('playbook','recipe'))
      OR json_extract(e.payload,'$.kind')=@kind)
    AND instr(CASE WHEN @sensitive THEN s.content ELSE lower(s.content) END, @needle)>0
  ORDER BY s.entry_id,s.ordinal
`);

export function libraryGrep(pattern: string, options: {
  kind?: GrepKind; id?: string; caseSensitive?: boolean; context?: number; offset?: number; limit?: number;
} = {}) {
  const kind = options.kind ?? "authored";
  const context = Math.min(options.context ?? 1, 2);
  const offset = options.offset ?? 0;
  const limit = Math.min(options.limit ?? 10, 15);
  const results: Array<{
    id: string; title: string; sectionId: string; heading: string;
    line: number; column: number; text: string;
    context: Array<{ line: number; text: string }>; sources: string[];
  }> = [];
  if (!pattern.trim() || /[\r\n]/.test(pattern)) return { pattern, kind, results, nextOffset: null };
  // SQLite lower() is ASCII-only. Match the same way when locating exact columns.
  const fold = (value: string) => options.caseSensitive ? value : value.replace(/[A-Z]/g, letter => letter.toLowerCase());
  const needle = fold(pattern);
  let seen = 0;
  const shorten = (line: string, start = 0) => (start ? "…" : "") + line.slice(start, start + 180) +
    (line.length > start + 180 ? "…" : "");
  const sections = grepSections.iterate({
    id: options.id ?? null, kind, sensitive: options.caseSensitive ? 1 : 0, needle,
  });
  for (const section of sections as Iterable<GrepSection>) {
    const lines = section.content.split("\n");
    for (const [index, line] of lines.entries()) {
      const column = fold(line).indexOf(needle);
      if (column === -1 || seen++ < offset) continue;
      if (results.length === limit) return { pattern, kind, results, nextOffset: offset + limit };
      const from = Math.max(0, index - context);
      const refs = section.sources ? JSON.parse(section.sources) as Array<{ url: string }> : [];
      results.push({
        id: section.entryId, title: section.title, sectionId: section.id, heading: section.heading,
        line: index + 1, column: column + 1, text: shorten(line, Math.max(0, column - 35)),
        context: lines.slice(from, index + context + 1).flatMap((text, i) =>
          from + i === index ? [] : [{ line: from + i + 1, text: shorten(text) }]),
        sources: [...new Set([section.source, ...refs.map(ref => ref.url)].filter((url): url is string => Boolean(url)))].slice(0, 3),
      });
    }
  }
  return { pattern, kind, results, nextOffset: null };
}

export type LibrarySearchOptions = {
  agent?: string;
  kind?: string;
  limit?: number;
  sectionLimit?: number;
};

function searchTokens(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
}

function filters(
  alias: string,
  category: string,
  starred: boolean,
  options: LibrarySearchOptions,
) {
  let sql = "";
  const args: any[] = [];
  if (category) {
    sql += ` AND ${alias}.category=?`;
    args.push(category);
  }
  if (starred) sql += ` AND ${alias}.starred=1`;
  if (options.kind) {
    sql += ` AND json_extract(${alias}.payload,'$.kind')=?`;
    args.push(options.kind);
  }
  if (options.agent) {
    sql += ` AND EXISTS (SELECT 1 FROM json_each(${alias}.payload,'$.agents') WHERE json_each.value=?)`;
    args.push(options.agent);
  }
  return { sql, args };
}

/**
 * Search entries and their sections. Results keep the entry metadata plus up
 * to three matching sections, so an agent can open the right passage without
 * pulling a 30,000-word document into context.
 */
export function librarySearch(
  query = "",
  category = "",
  starred = false,
  options: LibrarySearchOptions = {},
) {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 200);
  const sectionLimit = Math.min(Math.max(options.sectionLimit ?? 80, 1), 200);
  const tokens = [...new Set(searchTokens(query))].slice(0, 12);
  const match = tokens.map((token) => `"${token}"*`).join(" OR ");
  const entries = new Map<string, any>();

  const entryFilter = filters("e", category, starred, options);
  let entrySql = match
    ? `SELECT e.*, bm25(library_fts,8,3,2,1) AS score FROM library_fts f JOIN library_entries e ON e.rowid=f.rowid WHERE library_fts MATCH ?`
    : `SELECT e.*, 0 AS score FROM library_entries e WHERE 1=1`;
  const entryArgs: any[] = match ? [match] : [];
  entrySql += entryFilter.sql;
  entryArgs.push(...entryFilter.args);
  entrySql += match
    ? " ORDER BY score,e.title LIMIT ?"
    : " ORDER BY e.starred DESC,e.title LIMIT ?";
  entryArgs.push(limit * 2);
  for (const row of db.prepare(entrySql).all(...entryArgs) as any[]) {
    const entry = unpack(row);
    entry.score = row.score;
    entries.set(row.id, entry);
  }

  if (match) {
    const sectionFilter = filters("e", category, starred, options);
    const sectionSql = `SELECT s.id AS section_id,s.entry_id,s.heading,s.ordinal,s.chars,
      snippet(library_section_fts,1,'','','…',24) AS snippet,
      bm25(library_section_fts,5,1) AS score,
      e.*
      FROM library_section_fts f
      JOIN library_sections s ON s.rowid=f.rowid
      JOIN library_entries e ON e.id=s.entry_id
      WHERE library_section_fts MATCH ?${sectionFilter.sql}
      ORDER BY score LIMIT ?`;
    const sectionArgs = [match, ...sectionFilter.args, sectionLimit];
    for (const row of db.prepare(sectionSql).all(...sectionArgs) as any[]) {
      const entry = entries.get(row.entry_id) ?? unpack(row);
      entry.matches ??= [];
      entry.matches.push({
        sectionId: row.section_id,
        heading: row.heading,
        ordinal: row.ordinal,
        chars: row.chars,
        snippet: row.snippet,
        score: row.score,
      });
      entry.score = Math.min(entry.score ?? Infinity, row.score);
      entries.set(row.entry_id, entry);
    }
  }

  return [...entries.values()]
    .map((entry) => {
      if (entry.matches?.length) {
        entry.matches.sort((a: any, b: any) => a.score - b.score);
        entry.matches = entry.matches.slice(0, 3);
      }
      if (tokens.length) {
        // Compare exact title and tag matches before BM25. A navigation guide
        // that mentions an API in passing should not bury its implementation.
        const terms = new Set(searchTokens([entry.title, ...(entry.tags || [])].join(" ")));
        entry.termMatches = tokens.filter((token) => terms.has(token)).length;
      }
      return entry;
    })
    .sort((a, b) => {
      if (!match && a.starred !== b.starred) return Number(b.starred) - Number(a.starred);
      const termMatches = (b.termMatches ?? 0) - (a.termMatches ?? 0);
      if (termMatches) return termMatches;
      const score = (a.score ?? 0) - (b.score ?? 0);
      if (score) return score;
      return String(a.title).localeCompare(String(b.title));
    })
    .slice(0, limit)
    .map(({ termMatches: _termMatches, ...entry }) => withSections(entry));
}

/**
 * Return a compact, cited task brief for one agent. This is the agent-facing
 * upgrade over "read the whole guide": it retrieves the matching sections,
 * includes the practical do/avoid/checklist notes, and stays within a bounded
 * context budget.
 */
export function libraryBrief(
  query = "",
  agent = "",
  limit = 6,
) {
  const results = librarySearch(query, "", false, {
    agent: agent || undefined,
    limit: Math.max(limit * 2, 12),
    sectionLimit: Math.max(limit * 4, 24),
  });
  const selected: any[] = [];
  let total = 0;
  const budget = 24000;
  const groups = [];
  for (const entry of results) {
    const matches = entry.matches?.length
      ? entry.matches
      : entry.sections?.slice(0, 1).map((section: any) => ({
          sectionId: section.id,
          heading: section.heading,
        })) || [];
    if (matches.length) groups.push({ entry, matches });
  }
  // Prefer a relevant section from several guides before letting one guide
  // consume multiple slots in a short brief.
  for (let rank = 0; rank < 3; rank++) {
    for (const { entry, matches } of groups) {
      if (selected.length >= limit || total >= budget) break;
      const match = matches[rank];
      if (!match) continue;
      const section = readSection.get(match.sectionId, entry.id) as any;
      if (!section) continue;
      const remaining = budget - total;
      if (remaining < 500) break;
      const content = section.content.slice(0, remaining);
      if (!content.trim()) continue;
      selected.push({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        kind: entry.kind,
        summary: entry.summary,
        agents: entry.agents,
        source: entry.source,
        sources: entry.sources || (entry.source ? [{ title: entry.title, url: entry.source }] : []),
        license: entry.license,
        heading: section.heading,
        content,
        sectionId: section.id,
        do: entry.do || [],
        avoid: entry.avoid || [],
        checklist: entry.checklist || [],
      });
      total += content.length;
    }
    if (selected.length >= limit || total >= budget) break;
  }
  const cited = new Set<string>();
  const text = selected
    .map((section) => {
      const tips = [
        ...(section.do || []).map((item: string) => `- Do: ${item}`),
        ...(section.avoid || []).map((item: string) => `- Avoid: ${item}`),
        ...(section.checklist || []).map((item: string) => `- Check: ${item}`),
      ];
      const sources = section.sources
        .filter(({ url }: { url: string }) => !cited.has(url))
        .map(({ title, url }: { title: string; url: string }) => {
          cited.add(url);
          return `- Source: ${title} — ${url}`;
        });
      const notes = [...tips, ...sources];
      return `## ${section.title} — ${section.heading}\n[library:${section.id}#${section.heading}]\n${section.summary ? section.summary + "\n" : ""}${section.content}${notes.length ? "\n\n" + notes.join("\n") : ""}`;
    })
    .join("\n\n");
  return {
    query,
    agent,
    count: selected.length,
    chars: total,
    sections: selected,
    text,
    citations: selected.map(
      (section) => `${section.id}#${section.heading}`,
    ),
  };
}

export function libraryStats() {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN json_extract(payload,'$.kind')='official' THEN 1 ELSE 0 END) AS official,
        SUM(CASE WHEN json_extract(payload,'$.kind')='playbook' THEN 1 ELSE 0 END) AS playbooks,
        SUM(CASE WHEN json_extract(payload,'$.kind')='recipe' THEN 1 ELSE 0 END) AS recipes,
        SUM(CASE WHEN json_extract(payload,'$.kind')='personal' THEN 1 ELSE 0 END) AS personal
        FROM library_entries`,
    )
    .get() as any;
  const sections = db
    .prepare("SELECT COUNT(*) AS count FROM library_sections")
    .get() as any;
  return {
    total: row.total || 0,
    official: row.official || 0,
    playbooks: row.playbooks || 0,
    recipes: row.recipes || 0,
    personal: row.personal || 0,
    sections: sections.count || 0,
  };
}

const webUrl = z
  .string()
  .max(2000)
  .refine((s) => !s || /^https?:\/\//i.test(s), "Use an http(s) source URL");
const schema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(200),
  category: z.string().min(1).max(80),
  summary: z.string().max(1000),
  content: z.string().max(60000),
  source: webUrl.default(""),
  image: z
    .string()
    .max(80000)
    .refine(
      (s) =>
        !s ||
        /^https:\/\//i.test(s) ||
        /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s),
      "Use an HTTPS image URL or upload a PNG, JPEG or WebP",
    )
    .default(""),
  agents: z.array(z.string()).max(8).default([]),
  tags: z.array(z.string().max(40)).max(20).default([]),
  checklist: z.array(z.string().max(300)).max(30).default([]),
  level: z.enum(["starter", "intermediate", "advanced"]).default("starter"),
});
export function libraryAction(action: string, body: any) {
  if (action === "save") {
    const a = schema.parse(body);
    if (!a.content.trim() && !a.source)
      throw new Error("Add guide text or a source link");
    if (a.id && libraryRead(a.id)?.kind !== "personal")
      throw new Error("Only personal references can be edited");
    const id = a.id || randomUUID();
    const entry = {
      ...a,
      id,
      kind: "personal",
      retrieved: new Date().toISOString(),
      attribution: "Your workspace",
      license: "User supplied",
      do: [],
      avoid: [],
      related: [],
    };
    put.run({
      id,
      title: a.title,
      category: a.category,
      summary: a.summary,
      content: a.content,
      payload: JSON.stringify(entry),
    });
    replaceSections(entry);
    return { id };
  }
  const a = z
    .object({ id: z.string(), starred: z.boolean().optional() })
    .parse(body);
  const entry = libraryRead(a.id);
  if (!entry) throw new Error("Reference not found");
  if (action === "star") {
    db.prepare("UPDATE library_entries SET starred=? WHERE id=?").run(
      Number(!!a.starred),
      a.id,
    );
    return { ok: true };
  }
  if (action === "delete") {
    if (entry.kind !== "personal")
      throw new Error("Official references are maintained by the source pack");
    db.prepare("DELETE FROM library_sections WHERE entry_id=?").run(a.id);
    db.prepare("DELETE FROM library_entries WHERE id=?").run(a.id);
    return { ok: true };
  }
  throw new Error("Unknown library action");
}
