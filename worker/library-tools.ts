import { z } from "zod";
import type { Role } from "../src/lib/roles";
import type { CodexDynamicTool } from "./codex";
import {
  libraryBrief,
  libraryGrep,
  libraryRead,
  librarySearch,
} from "./library";

const string = { type: "string" };
const definitions = [
  [
    "library_grep",
    "Find literal text in Syntra's playbooks and recipes, including Luau identifiers, punctuation and code. Each hit includes matching and neighboring lines, source links and a section ID for library_read. Line numbers are relative to the section. Search is ASCII case-insensitive unless caseSensitive is true.",
    {
      pattern: { type: "string", minLength: 1, maxLength: 120 },
      kind: {
        type: "string",
        enum: ["authored", "official", "playbook", "recipe", "personal", "all"],
      },
      id: string,
      caseSensitive: { type: "boolean" },
      context: { type: "integer", minimum: 0, maximum: 2 },
      offset: { type: "integer", minimum: 0, maximum: 10000 },
      limit: { type: "integer", minimum: 1, maximum: 15 },
    },
    ["pattern"],
  ],
  [
    "library_search",
    "Search the local Roblox reference library. Returns matching guides, matched section headings and snippets, plus do/avoid guidance. Use library_brief when you need the actual guidance text.",
    {
      query: string,
      agent: string,
      kind: {
        type: "string",
        enum: ["official", "playbook", "recipe", "personal"],
      },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
    ["query"],
  ],
  [
    "library_read",
    "Read an offline reference by ID. Returns section metadata; pass sectionId to read one section or offset to page through the full text. Always cite the reference ID and section heading.",
    {
      id: string,
      sectionId: string,
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1000, maximum: 24000 },
    },
    ["id"],
  ],
  [
    "library_brief",
    "Get a compact, cited task brief from the reference library: the matching sections for this agent, with summary, do/avoid notes and checklists. Prefer this over loading whole guides.",
    {
      query: string,
      agent: string,
      limit: { type: "integer", minimum: 1, maximum: 12 },
    },
    ["query"],
  ],
] as const;

type LibraryTool = (typeof definitions)[number][0];
export const libraryToolDefinitions: CodexDynamicTool[] = definitions.map(
  ([name, description, properties, required]) => ({
    name,
    description,
    inputSchema: {
      type: "object",
      properties,
      required: [...required],
      additionalProperties: false,
    },
  }),
);
export function isLibraryTool(name: string): name is LibraryTool {
  return definitions.some((definition) => definition[0] === name);
}

export function runLibraryTool(role: Role, name: LibraryTool, args: unknown) {
  if (name === "library_grep") {
    const { pattern, ...options } = z
      .object({
        pattern: z
          .string()
          .min(1)
          .max(120)
          .refine(
            (value) => value.trim() && !/[\r\n]/.test(value),
            "Search using a nonempty single line.",
          ),
        kind: z
          .enum([
            "authored",
            "official",
            "playbook",
            "recipe",
            "personal",
            "all",
          ])
          .optional(),
        id: z.string().max(200).optional(),
        caseSensitive: z.boolean().optional(),
        context: z.number().int().min(0).max(2).optional(),
        offset: z.number().int().min(0).max(10000).optional(),
        limit: z.number().int().min(1).max(15).optional(),
      })
      .parse(args);
    return libraryGrep(pattern, options);
  }

  const a = z
    .object({
      query: z.string().max(500).optional(),
      id: z.string().optional(),
      sectionId: z.string().optional(),
      agent: z.string().max(40).optional(),
      kind: z.enum(["official", "playbook", "recipe", "personal"]).optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(24000).optional(),
    })
    .parse(args);
  if (name === "library_brief")
    return libraryBrief(
      a.query || "",
      a.agent || role,
      Math.min(a.limit || 6, 12),
    );
  if (name === "library_search")
    return librarySearch(a.query || "", "", false, {
      agent: a.agent || role,
      kind: a.kind,
      limit: Math.min(a.limit || 8, 20),
    });
  const entry = libraryRead(a.id || "", { sectionId: a.sectionId });
  if (!entry) throw new Error("Library reference not found");
  if (a.sectionId) return { ...entry, nextOffset: null };
  const size = a.limit || 12000;
  return {
    ...entry,
    content: entry.content.slice(a.offset, a.offset + size),
    nextOffset: a.offset + size < entry.content.length ? a.offset + size : null,
  };
}
