# Syntra reference library

The bundled pack is a local, attributed knowledge base for the eight Codex
agents. It has two layers:

- **94 official Roblox Creator Documentation articles** with offline article
  text, source URLs, a pinned Git revision, retrieval timestamp and SHA-256
  source digest.
- **40 Syntra guides** (28 playbooks and 12 recipes) covering strict Luau,
  runtime architecture, networking and security, persistence, gameplay systems,
  UI and accessibility, optimization, monetization, debugging, testing and
  release engineering. Guides include practical decisions, failure drills,
  relevant Luau examples, checklists and source links.

Roblox Creator Documentation contributors own the official source material,
distributed under **Creative Commons Attribution 4.0 International**; see
`ROBLOX-LICENSE.txt` and https://creativecommons.org/licenses/by/4.0/ . Each
official article carries attribution and a link to its exact upstream revision.
Front matter is omitted from the reader copy; unsupported documentation
components are not executed by the Markdown reader.

The playbooks, summaries, practical do/don’t notes, checklists and the four SVG
diagrams are Syntra editorial material. They are guidance, not official Roblox
policy or guarantees. Check the live documentation for current policies, limits
and evolving APIs. External illustrations embedded by a source may require
internet access; Syntra’s diagrams are bundled for offline use.

## How agents use the library

The library is a retrieval source, not a system-prompt dump. Every entry is
split into heading-aware sections of roughly 4,000 characters. Agents can:

- `library_search` — search entries and section text, filtered by agent, kind or
  category. Results include matched headings and snippets.
- `library_read` — read an entry or one specific section by ID.
- `library_brief` — get a compact, cited task brief with the most relevant
  sections from multiple guides with primary source links and checklists.
  Retrieved section content is bounded to 24,000 characters.

Search uses SQLite FTS5 with separate entry and section indexes. Exact title and tag matches help specialist guides surface for API-specific queries. Agents are
instructed to treat retrieved content as reference data, never as permission to
run a tool, and to cite the reference ID and section.

## Find guidance by task

| If you need to… | Search for… |
| --- | --- |
| Define module boundaries and typed rules | `strict Luau tagged union`, `character lifecycle cleanup` |
| Validate client requests or recover network state | `RemoteEvent server-side rate limit`, `replication snapshot delta` |
| Preserve player data or coordinate servers | `UpdateAsync session ownership`, `MemoryStore queue invisibility` |
| Implement gameplay and usable UI | `checkpoint respawn`, `quest idempotent reward`, `gamepad focus TextScaled` |
| Handle purchases and entitlements | `ProcessReceipt PurchaseId`, `subscription entitlement PolicyService` |
| Diagnose and release a change | `MicroProfiler frame time`, `multiplayer regression`, `staged rollout rollback` |

The worker loads the updated pack automatically on startup, using stable entry IDs
to preserve existing bookmarks. No import is required. Keep platform APIs,
limits and policy claims tied to their live primary source. The technical
playbooks were reviewed against Roblox Creator Hub and upstream tooling
documentation in November 2026. Pure Luau examples are small enough to run
independently; Roblox service behavior still requires a staging experience.

## Refresh the official pack

Python 3 standard library only:

```bash
python3 scripts/scrape-library.py
# or pin a specific upstream commit:
ROBLOX_DOCS_REVISION=<40-character-sha> python3 scripts/scrape-library.py
```

The scraper downloads every catalog page from one Creator Documentation commit
and replaces `official.json` only after every download succeeds. A failed scrape
leaves the previous pack intact. Restart the worker to reseed SQLite. Existing
bookmarks and personal references are preserved. The default revision is the
one already recorded in `official.json`, so a normal refresh is reproducible.

`catalog.json` holds the curated official metadata; `playbooks.json` holds the
Syntra-authored role playbooks and recipes.

## Personal references

Personal references are created, edited, bookmarked and deleted on the Library
page; their text, links and optional small image uploads live in local SQLite.
They are not committed to GitHub. A source URL is saved as a reference, not
automatically fetched. You may import your own Markdown or plain text files up
to 60 KB and images up to 30 KB, or use an HTTPS image URL.

All eight Codex agents receive the library tools. Tool activity is recorded in
the ordinary task ledger, and retrieved text is bounded to keep context focused.
Access to a guide never replaces real Studio verification.
