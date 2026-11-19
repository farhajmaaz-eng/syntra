"use client";
import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Search,
  Plus,
  Star,
  ArrowLeft,
  ExternalLink,
  Check,
  X,
  Upload,
  Trash2,
  Pencil,
  Image as ImageIcon,
  Brain,
  ListChecks,
  Sparkles,
  Users,
} from "lucide-react";
import { Button } from "./ui/button";
import { ConfirmDialog, ResourceSkeleton } from "./ui/workspace-primitives";
import { safeResponseJson } from "@/lib/utils";
import { roles } from "@/lib/roles";
const categories = [
  "All references",
  "Agent playbooks",
  "Task recipes",
  "Official guides",
  "Security",
  "Data & architecture",
  "Luau & networking",
  "World building",
  "Performance",
  "UI & accessibility",
  "Game design",
  "Economy & live ops",
  "Testing & release",
  "My references",
];
const kindFor = (category: string) =>
  category === "Agent playbooks"
    ? "playbook"
    : category === "Task recipes"
      ? "recipe"
      : category === "Official guides"
        ? "official"
        : category === "My references"
          ? "personal"
          : "";
const kindLabel = (kind: string) =>
  kind === "official"
    ? "Roblox Creator Docs"
    : kind === "playbook"
      ? "Agent playbook"
      : kind === "recipe"
        ? "Task recipe"
        : kind === "personal"
          ? "Personal reference"
          : kind;
export default function Library() {
  const [items, setItems] = useState<any[]>([]),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("All references"),
    [starred, setStarred] = useState(false),
    [agent, setAgent] = useState(""),
    [stats, setStats] = useState<any>(null),
    [brief, setBrief] = useState<any>(null),
    [briefLoading, setBriefLoading] = useState(false),
    [article, setArticle] = useState<any>(null),
    [editing, setEditing] = useState<any>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [saving, setSaving] = useState(false),
    [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const r = await fetch(
          "/api/library?" +
            new URLSearchParams({
              q: query,
              category:
                ["All references", "My references", "Agent playbooks", "Task recipes", "Official guides"].includes(category)
                  ? ""
                  : category,
              kind: kindFor(category),
              agent,
              starred: String(starred),
            }),
          { signal: c.signal },
        );
        const data = await safeResponseJson(r);
        if (!r.ok) throw new Error(data.error);
        setItems(
          category === "My references"
            ? data.filter((x: any) => x.kind === "personal")
            : data,
        );
        setError("");
      } catch (e) {
        if (!c.signal.aborted) setError(String(e));
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      c.abort();
      clearTimeout(timeout);
    };
  }, [query, category, starred, agent, revision]);
  useEffect(() => {
    void fetch("/api/library?stats=true")
      .then((r) => safeResponseJson(r))
      .then(setStats)
      .catch(() => {});
  }, [revision]);
  async function read(id: string, sectionId?: string) {
    setLoading(true);
    try {
      const r = await fetch(
        "/api/library?id=" +
          encodeURIComponent(id) +
          (sectionId ? "&section=" + encodeURIComponent(sectionId) : ""),
      );
      const a = await safeResponseJson(r);
      if (!r.ok || !a) throw new Error(a?.error || "Reference not found");
      setArticle(a);
      setEditing(null);
      setError("");
      document.querySelector(".main")?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  async function action(name: string, body: any) {
    setSaving(true);
    try {
      const r = await fetch("/api/library/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await safeResponseJson(r);
      if (!r.ok) throw new Error(result.error);
      setRevision((v) => v + 1);
      setError("");
      return result;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setSaving(false);
    }
  }
  async function makeBrief() {
    setBriefLoading(true);
    setBrief(null);
    try {
      const r = await fetch(
        "/api/library?" +
          new URLSearchParams({
            brief: query || "Roblox game development",
            agent,
            limit: "6",
          }),
      );
      const value = await safeResponseJson(r);
      if (!r.ok) throw new Error(value.error || "Brief unavailable");
      setBrief(value);
    } catch (e) {
      setError(String(e));
    } finally {
      setBriefLoading(false);
    }
  }
  async function favorite(a: any) {
    if (await action("star", { id: a.id, starred: !a.starred })) {
      if (article?.id === a.id) setArticle({ ...article, starred: !a.starred });
    }
  }
  const fresh = () => {
    setArticle(null);
    setEditing({
      title: "",
      summary: "",
      category: "My references",
      source: "",
      content: "",
      image: "",
      agents: [],
    });
  };
  return (
    <div className="reference-library">
      <div className="library-intro">
        <div>
          <span className="section-kicker">Reference index</span>
          <h2>Development library</h2>
          <p>
            Official Roblox guides, agent playbooks, task recipes and the
            knowledge you collect along the way. Agents get the matching
            section, not the whole manual.
          </p>
          {stats && (
            <small className="library-stats">
              {stats.total} references · {stats.official} official ·{" "}
              {stats.playbooks} agent playbooks · {stats.recipes} recipes ·{" "}
              {stats.sections.toLocaleString()} searchable sections
            </small>
          )}
        </div>
        <Button onClick={fresh}>
          <Plus size={16} /> Add reference
        </Button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="library-layout">
        <aside className="library-categories">
          <span className="nav-label">BROWSE TOPICS</span>
          {categories.map((c) => (
            <button
              className={category === c && !starred ? "selected" : ""}
              onClick={() => {
                setCategory(c);
                setStarred(false);
                setArticle(null);
                setEditing(null);
              }}
              key={c}
            >
              {c === "All references" ? (
                <BookOpen size={15} />
              ) : (
                <span className="category-mark" />
              )}
              {c}
            </button>
          ))}
          <button
            className={starred ? "selected" : ""}
            onClick={() => {
              setStarred((v) => !v);
              setCategory("All references");
              setArticle(null);
              setEditing(null);
            }}
          >
            <Star size={15} /> Saved references
          </button>
          <div className="library-agent-note">
            <BookOpen size={19} />
            <strong>Agent access</strong>
            <p>
              All eight Codex agents can search sections, request a cited task
              brief and read only the passages they need. Official text is saved
              locally and attributed to its Creator Documentation revision.
            </p>
            <small>
              RoAutomation-style retrieval: heading-aware chunks, relevance
              ranking and a bounded context budget. External images and links may
              need an internet connection.
            </small>
          </div>
        </aside>
        <div className="library-main">
          {editing ? (
            <form
              className="panel form library-editor"
              onSubmit={async (e) => {
                e.preventDefault();
                const result = await action("save", editing);
                if (result) {
                  setEditing(null);
                  await read(result.id);
                }
              }}
            >
              <div className="panel-heading">
                <h3>{editing.id ? "Edit reference" : "Add reference"}</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  <X size={15} /> Cancel
                </Button>
              </div>
              <label>
                Title
                <input
                  required
                  maxLength={200}
                  value={editing.title}
                  onChange={(e) =>
                    setEditing({ ...editing, title: e.target.value })
                  }
                />
              </label>
              <div className="form-grid">
                <label>
                  Category
                  <input
                    required
                    maxLength={80}
                    value={editing.category}
                    onChange={(e) =>
                      setEditing({ ...editing, category: e.target.value })
                    }
                    list="library-topic-list"
                  />
                  <datalist id="library-topic-list">
                    {categories
                      .filter((c) => c !== "All references")
                      .map((c) => (
                        <option key={c} value={c} />
                      ))}
                  </datalist>
                </label>
                <label>
                  Source URL (optional)
                  <input
                    type="url"
                    value={editing.source}
                    placeholder="https://…"
                    onChange={(e) =>
                      setEditing({ ...editing, source: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                Short description
                <textarea
                  rows={2}
                  maxLength={1000}
                  value={editing.summary}
                  onChange={(e) =>
                    setEditing({ ...editing, summary: e.target.value })
                  }
                />
              </label>
              <label>
                Guide or notes (Markdown)
                <textarea
                  rows={16}
                  maxLength={60000}
                  value={editing.content}
                  onChange={(e) =>
                    setEditing({ ...editing, content: e.target.value })
                  }
                  placeholder="Write your workflow, checklists, examples, and lessons learned…"
                />
              </label>
              <label className="library-file">
                <Upload size={15} /> Import Markdown or text
                <input
                  type="file"
                  accept=".md,.txt,text/plain,text/markdown"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 60000) {
                      setError("Text imports must be under 60 KB");
                      return;
                    }
                    setEditing({
                      ...editing,
                      content: await f.text(),
                      title:
                        editing.title || f.name.replace(/\.(md|txt)$/i, ""),
                    });
                  }}
                />
              </label>
              <label>
                Cover image URL (optional)
                <input
                  type="url"
                  value={editing.image.startsWith("data:") ? "" : editing.image}
                  placeholder="https://…"
                  onChange={(e) =>
                    setEditing({ ...editing, image: e.target.value })
                  }
                />
              </label>
              <label className="library-file">
                <ImageIcon size={15} /> Or attach a small image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 30000) {
                      setError(
                        "Use an image under 30 KB, or provide an HTTPS image URL",
                      );
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () =>
                      setEditing({ ...editing, image: reader.result });
                    reader.readAsDataURL(f);
                  }}
                />
              </label>
              {editing.image && (
                <img
                  className="reference-cover"
                  src={editing.image}
                  alt="Reference cover preview"
                  referrerPolicy="no-referrer"
                />
              )}
              <p>
                Save a source link, your own guide, or both. Imported text stays
                local and is searchable by the agents.
              </p>
              <Button disabled={saving}>
                Save reference <Check size={15} />
              </Button>
            </form>
          ) : article ? (
            <article className="panel reference-reader">
              <div className="reader-toolbar">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setArticle(null)}
                >
                  <ArrowLeft size={15} /> All references
                </Button>
                <div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      article.starred ? "Unsave reference" : "Save reference"
                    }
                    onClick={() => favorite(article)}
                    disabled={saving}
                  >
                    <Star
                      size={17}
                      fill={article.starred ? "currentColor" : "none"}
                    />
                  </Button>
                  {article.kind === "personal" && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit reference"
                        onClick={() => setEditing({ ...article })}
                      >
                        <Pencil size={16} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete reference"
                        onClick={() => setConfirmDeleteId(article.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <span className="section-kicker">
                {article.category} ·{" "}
                {article.kind === "official"
                  ? "OFFICIAL REFERENCE"
                  : "YOUR REFERENCE"}
              </span>
              <h2>{article.title}</h2>
              <p className="reader-summary">{article.summary}</p>
              <div className="reference-meta">
                <span>
                  {Math.max(
                    1,
                    Math.ceil(article.content.split(/\s+/).length / 220),
                  )}{" "}
                  min read
                </span>
                <span>{article.attribution}</span>
                <span>
                  {article.kind === "official" ? (
                    <a
                      href="https://creativecommons.org/licenses/by/4.0/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      CC BY 4.0
                    </a>
                  ) : (
                    article.license
                  )}
                </span>
              </div>
              {article.agents?.length > 0 && (
                <div className="library-agents">
                  <Users size={14} />
                  {article.agents.map((name: string) => (
                    <span className="badge" key={name}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
              {article.source && (
                <a
                  className="text-link source-link"
                  href={article.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open original source <ExternalLink size={14} />
                </a>
              )}
              {article.kind === "official" && (
                <p className="source-version">
                  Saved {new Date(article.retrieved).toLocaleDateString()} ·{" "}
                  <a
                    href={article.source_file}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source revision {article.revision.slice(0, 8)}
                  </a>
                  . Official documentation can change; check the live source for
                  current policies and limits. Practical notes below are Syntra’s
                  editorial guidance.
                </p>
              )}
              {article.sections?.length > 1 && !article.section && (
                <details className="library-toc" open>
                  <summary>
                    <ListChecks size={15} /> On this page ({article.sectionCount} sections)
                  </summary>
                  <ol>
                    {article.sections.map((section: any) => (
                      <li key={section.id}>
                        <button onClick={() => read(article.id, section.id)}>
                          {section.heading}
                        </button>
                        <small>{section.chars.toLocaleString()} chars</small>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {article.section && (
                <div className="library-section-heading">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => read(article.id)}
                  >
                    <ArrowLeft size={14} /> Full guide
                  </Button>
                  <span className="badge">{article.section.heading}</span>
                </div>
              )}
              {article.checklist?.length > 0 && (
                <section className="library-checklist">
                  <h3>
                    <ListChecks size={16} /> Checklist
                  </h3>
                  <ul>
                    {article.checklist.map((item: string) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              )}
              {article.image && (
                <img
                  className="reference-cover"
                  src={article.image}
                  alt={
                    article.kind === "official"
                      ? "Syntra diagram illustrating " + article.title
                      : article.title + " reference image"
                  }
                  referrerPolicy="no-referrer"
                />
              )}
              {article.do?.length > 0 && (
                <div className="reference-advice">
                  <section>
                    <h3>
                      <Check size={16} /> Do this
                    </h3>
                    <ul>
                      {article.do.map((s: string) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h3>
                      <X size={16} /> Avoid this
                    </h3>
                    <ul>
                      {article.avoid.map((s: string) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
              <div className="reference-markdown">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a
                        href={resolveReference(href, article)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {children}
                      </a>
                    ),
                    img: ({ src, alt }) =>
                      typeof src === "string" ? (
                        <img
                          loading="lazy"
                          src={resolveReference(src, article)}
                          alt={alt || "Documentation illustration"}
                          referrerPolicy="no-referrer"
                        />
                      ) : null,
                  }}
                >
                  {article.content ||
                    "This reference links to an external resource. Open the original source above."}
                </Markdown>
              </div>
            </article>
          ) : (
            <>
              <div className="library-search library-toolbar">
                <Search size={18} />
                <input
                  aria-label="Search library"
                  placeholder="Search guides, code examples, or a topic…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Filter by agent"
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                >
                  <option value="">All agents</option>
                  {Object.keys(roles).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={briefLoading}
                  onClick={makeBrief}
                  title="Build a cited brief for the selected agent"
                >
                  <Sparkles size={14} />
                  {briefLoading ? "Briefing…" : "Brief"}
                </Button>
                <span>{items.length} references</span>
              </div>
              {brief && (
                <section className="panel library-brief">
                  <div className="panel-heading">
                    <h3>
                      <Brain size={16} /> Task brief
                      <small>
                        {brief.count} sections · {brief.chars.toLocaleString()}{" "}
                        characters
                      </small>
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setBrief(null)}
                    >
                      Close
                    </Button>
                  </div>
                  {brief.sections?.length ? (
                    brief.sections.map((section: any) => (
                      <article key={section.sectionId}>
                        <strong>{section.title}</strong>
                        <small>
                          {section.heading} · {kindLabel(section.kind)} ·{" "}
                          <code>[library:{section.id}]</code>
                        </small>
                        <Markdown remarkPlugins={[remarkGfm]}>
                          {section.content}
                        </Markdown>
                      </article>
                    ))
                  ) : (
                    <p className="muted-text">No matching reference sections.</p>
                  )}
                </section>
              )}
              {loading ? (
                <ResourceSkeleton
                  variant="cards"
                  label="Searching your library"
                />
              ) : items.length ? (
                <div className="reference-grid">
                  {items.map((a) => (
                    <article className="panel reference-card" key={a.id}>
                      <div className="reference-card-top">
                        <span className={`badge library-kind ${a.kind}`}>
                          {kindLabel(a.kind)}
                        </span>
                        <button
                          aria-label={
                            a.starred ? "Unsave " + a.title : "Save " + a.title
                          }
                          onClick={() => favorite(a)}
                          disabled={saving}
                        >
                          <Star
                            size={16}
                            fill={a.starred ? "currentColor" : "none"}
                          />
                        </button>
                      </div>
                      <button
                        className="reference-open"
                        onClick={() => read(a.id)}
                      >
                        <BookOpen size={24} />
                        <h3>{a.title}</h3>
                        <p>{a.summary || "Your saved guide or reference."}</p>
                        {a.matches?.[0]?.snippet && (
                          <p className="library-match">
                            <strong>{a.matches[0].heading}:</strong>{" "}
                            {a.matches[0].snippet}
                          </p>
                        )}
                      </button>
                      <div className="reference-card-footer">
                        <small>
                          {kindLabel(a.kind)} · {a.category}
                        </small>
                        <button onClick={() => read(a.id)}>Read guide →</button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="panel empty">
                  <BookOpen />
                  <h3>No references found</h3>
                  <p>
                    Try another search, choose a topic, or add a reference of
                    your own.
                  </p>
                  <Button onClick={fresh}>Add reference</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this personal reference?"
          confirmLabel="Delete reference"
          pending={saving}
          close={() => setConfirmDeleteId(null)}
          confirm={async () => {
            const id = confirmDeleteId;
            if (await action("delete", { id })) {
              setConfirmDeleteId(null);
              setArticle(null);
            }
          }}
        >
          This removes the saved note from your personal reference library. Official
          documentation articles are unaffected.
        </ConfirmDialog>
      )}
    </div>
  );
}
function resolveReference(value: string | undefined, article: any) {
  if (!value) return "";
  try {
    const base =
      article.source_file?.replace(
        "https://github.com/Roblox/creator-docs/blob/",
        "https://raw.githubusercontent.com/Roblox/creator-docs/",
      ) ||
      article.source ||
      "https://create.roblox.com/docs/";
    const u = new URL(value, base);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
