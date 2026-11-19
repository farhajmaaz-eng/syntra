export class OperationError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public uncertain = false,
  ) {
    super(message);
  }
}

function scrub(text: string) {
  return text
    .split(process.env.CODEX_API_KEY || "\u0000")
    .join("[REDACTED]")
    .replace(/\b(?:sk-or-v1-|nvapi-|sk-)[A-Za-z0-9._-]{16,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}

export function redact(value: unknown): string {
  return scrub(value instanceof Error ? value.message : String(value));
}

export function publicData(value: any): any {
  const keys = [process.env.CODEX_API_KEY].filter(Boolean) as string[];
  function walk(v: any): any {
    if (typeof v === "string") {
      let text = v
        .replace(/\b(?:sk-or-v1-|nvapi-|sk-)[A-Za-z0-9._-]{16,}/g, "[REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
      for (const key of keys) text = text.split(key).join("[REDACTED]");
      return text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x)]),
      );
    return v;
  }
  return walk(value);
}
