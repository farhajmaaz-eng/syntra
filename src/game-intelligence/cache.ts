import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { workspaceDataDirectory } from "../lib/workspace-paths";
import { providers, type Provider, type SourceSettings, type SourceStatus } from "./model";

const keys = Object.keys(providers) as Provider[];
let instance: Database.Database | undefined;

export function intelligenceDb() {
  if (instance) return instance;
  const directory = workspaceDataDirectory();
  mkdirSync(directory, { recursive: true });
  const db = new Database(join(directory, "game-intelligence.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (provider TEXT PRIMARY KEY, settings TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_backoff (provider TEXT PRIMARY KEY, until INTEGER NOT NULL, error TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, body TEXT, updated INTEGER, retry INTEGER DEFAULT 0, lease INTEGER DEFAULT 0, error TEXT, touched INTEGER);
    CREATE TABLE IF NOT EXISTS observations (game TEXT, at INTEGER, playing INTEGER, visits INTEGER, favorites INTEGER, PRIMARY KEY (game, at));
    CREATE INDEX IF NOT EXISTS observations_time ON observations(at);
  `);
  return instance = db;
}

export function settings() {
  const result = {} as SourceSettings;
  const get = intelligenceDb().prepare("SELECT settings FROM sources WHERE provider=?");
  for (const key of keys) {
    const saved = get.get(key) as { settings: string } | undefined;
    const p = providers[key];
    result[key] = saved ? JSON.parse(saved.settings) : { enabled: true, minutes: p.minutes, endpoint: p.origin + p.path };
  }
  return result;
}

export function saveSettings(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Invalid source settings");
  const config = input as Partial<SourceSettings>;
  const previous = settings();
  for (const key of keys) {
    const value = config[key];
    if (!value || typeof value.enabled !== "boolean" || !Number.isInteger(value.minutes) || value.minutes < providers[key].minutes || value.minutes > 1440) {
      throw new Error(`Set a refresh interval from ${providers[key].minutes} to 1440 minutes for ${providers[key].name}.`);
    }
    const url = new URL(value.endpoint);
    if (url.origin !== providers[key].origin || url.username || url.password || url.search || url.hash ||
      !/^\/(?:api\/v1|explore-api\/v1)\/[a-z0-9_/-]+$/.test(url.pathname)) {
      throw new Error(`Use a public HTTPS path on ${providers[key].origin}, without credentials or query parameters.`);
    }
    previous[key] = { enabled: value.enabled, minutes: value.minutes, endpoint: url.href };
  }
  const db = intelligenceDb();
  const put = db.prepare("INSERT OR REPLACE INTO sources VALUES (?,?)");
  db.transaction(() => {
    for (const key of keys) put.run(key, JSON.stringify(previous[key]));
  })();
  return previous;
}

type Entry = { body: string | null; updated: number | null; retry: number; lease: number; error: string | null };
type Cached<T> = { data: T | null; source: SourceStatus };
const active = new Map<string, Promise<Cached<unknown>>>();
class ResponseError extends Error {
  constructor(message: string, readonly retryAt: number) { super(message); }
}

async function readBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty provider response");
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("Provider response exceeds size limit");
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function cached<T>(
  provider: Provider,
  key: string,
  url: string,
  config: SourceSettings,
  parse: (body: string, at: number) => T,
  minimum = 0,
): Promise<Cached<T>> {
  const setting = config[provider];
  if (!setting.enabled) return { data: null, source: { provider, status: "disabled", at: null } };
  const cacheKey = provider + ":" + key;
  const pending = active.get(cacheKey);
  if (pending) return pending as Promise<Cached<T>>;
  const db = intelligenceDb();
  const now = Date.now();
  const ttl = Math.max(setting.minutes, minimum) * 60_000;
  const get = () => db.prepare("SELECT body,updated,retry,lease,error FROM requests WHERE key=?").get(cacheKey) as Entry | undefined;
  const blocked = () => db.prepare("SELECT until,error FROM provider_backoff WHERE provider=? AND until>?").get(provider, now) as
    { until: number; error: string } | undefined;
  const claim = db.transaction(() => {
    const old = get();
    if (blocked() || old && (old.retry > now || old.lease > now || (old.updated ?? 0) + ttl > now)) return false;
    db.prepare(`INSERT INTO requests(key,lease,touched) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET lease=excluded.lease,touched=excluded.touched`).run(cacheKey, now + 12_000, now);
    db.prepare("DELETE FROM requests WHERE touched < ? AND lease < ?").run(now - 30 * 86_400_000, now);
    return true;
  });
  const read = (fresh = false): Cached<T> => {
    const row = get();
    const data = row?.body ? JSON.parse(row.body) as T : null;
    const backoff = blocked();
    const error = backoff?.error ?? row?.error;
    return { data, source: { provider, status: data === null ? "unavailable" :
      fresh || (!error && (row?.updated ?? 0) + ttl > Date.now()) ? "ready" : "cached",
      at: row?.updated ?? null, ...(error ? { error, retryAt: backoff?.until ?? row?.retry } : {}) } };
  };
  if (!claim.immediate()) return read();
  const fetchJob = (async () => {
    try {
      const response = await fetch(url, { redirect: "error", cache: "no-store",
        headers: { Accept: "application/json, text/csv;q=0.9", "User-Agent": "Syntra/1.0" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        const header = response.headers.get("retry-after");
        const seconds = header === null ? NaN : Number(header);
        const delay = Number.isFinite(seconds) ? seconds * 1000 : header ? Date.parse(header) - now : NaN;
        const fallback = response.status === 429 ? (provider === "playsurge" || provider === "rowatcher" ? 3_600_000 : 300_000) : 60_000;
        const retryAt = now + Math.max(60_000, Number.isFinite(delay) ? delay : fallback);
        if (response.status === 429) db.prepare(`INSERT INTO provider_backoff VALUES (?,?,?)
          ON CONFLICT(provider) DO UPDATE SET until=max(until,excluded.until),error=excluded.error`)
          .run(provider, retryAt, "HTTP 429");
        throw new ResponseError(`HTTP ${response.status}`, retryAt);
      }
      const body = await readBody(response);
      const parsed = parse(body, Date.now());
      db.prepare("UPDATE requests SET body=?,updated=?,retry=0,lease=0,error=NULL WHERE key=?")
        .run(JSON.stringify(parsed), Date.now(), cacheKey);
      return read(true);
    } catch (error) {
      const reason = error instanceof ResponseError ? error.message : "Request failed or returned an unusable response";
      db.prepare("UPDATE requests SET error=?,retry=?,lease=0 WHERE key=?")
        .run(reason, error instanceof ResponseError ? error.retryAt : now + 60_000, cacheKey);
      return read();
    }
  })();
  active.set(cacheKey, fetchJob);
  try { return await fetchJob; } finally { active.delete(cacheKey); }
}
