import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const workspaceDatabaseName = "syntra.sqlite";

export function workspaceDataDirectory() {
  return resolve(process.env.SYNTRA_DATA_DIR || process.env.FORGE_DATA_DIR || ".data");
}

export function workspaceDatabasePath(directory: string) {
  const current = resolve(directory, workspaceDatabaseName);
  const legacy = resolve(directory, "forge.sqlite");
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}
