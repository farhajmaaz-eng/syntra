import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SceneGraph } from "@open-pencil/scene-graph";
import { workspaceDataDirectory } from "../lib/workspace-paths";
import { decodeDesign, encodeDesign } from "./scene";

export const maxDesignBytes = 2 * 1024 * 1024;
export const designId = "workspace";
export class DesignConflict extends Error {}

let database: Database.Database | undefined;
function storage() {
  if (database) return database;
  const directory = workspaceDataDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new Database(join(directory, "design-studio.sqlite"));
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE IF NOT EXISTS designs(id TEXT PRIMARY KEY, scene TEXT NOT NULL, revision INTEGER NOT NULL)");
  db.prepare("INSERT OR IGNORE INTO designs VALUES(?,?,1)").run(designId, encodeDesign(new SceneGraph()));
  database = db;
  return db;
}

export function readDesign() {
  return storage().prepare("SELECT scene,revision FROM designs WHERE id=?").get(designId) as {
    scene: string;
    revision: number;
  };
}

export function readDesignSince(revision: number) {
  const row = storage().prepare("SELECT CASE WHEN revision = ? THEN NULL ELSE scene END AS scene, revision FROM designs WHERE id=?")
    .get(revision, designId) as { scene: string | null; revision: number };
  return row.scene === null ? undefined : { scene: row.scene, revision: row.revision };
}

export function saveDesign(scene: string, revision: number) {
  if (Buffer.byteLength(scene) > maxDesignBytes) throw new Error("Design exceeds 2 MiB.");
  const graph = decodeDesign(scene);
  const result = storage().prepare("UPDATE designs SET scene=?,revision=revision+1 WHERE id=? AND revision=?")
    .run(encodeDesign(graph), designId, revision);
  if (!result.changes) throw new DesignConflict("Design changed in another editor. Refresh and reapply your edits.");
  return { revision: revision + 1 };
}
