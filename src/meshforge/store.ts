import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { workspaceDataDirectory } from "../lib/workspace-paths";
import { countSceneStats, createDefaultSceneDocument } from "./shared/sceneOps";
import { validateScene } from "./shared/validateScene";
import type { SerializedSceneDocument } from "./shared/sceneSchema";

export const defaultMeshProject = "proj_default_workspace";
export const maxMeshBodyBytes = 8 * 1024 * 1024;

export class MeshProjectError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let database: Database.Database | undefined;
export function closeMeshStorage() {
  database?.close();
  database = undefined;
}

function storage() {
  if (database) return database;
  const directory = workspaceDataDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new Database(join(directory, "meshforge.sqlite"));
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS mesh_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, scene TEXT NOT NULL, preset TEXT NOT NULL,
      triangles INTEGER NOT NULL, objects INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mesh_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES mesh_projects(id) ON DELETE CASCADE,
      actor TEXT NOT NULL, tool_name TEXT NOT NULL, args_json TEXT NOT NULL, result_summary TEXT NOT NULL,
      revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS mesh_events_project ON mesh_events(project_id, id);
  `);
  const doc = createDefaultSceneDocument("Roblox Starter Workspace");
  const stats = countSceneStats(doc);
  db.prepare("INSERT OR IGNORE INTO mesh_projects(id,name,scene,preset,triangles,objects) VALUES(?,?,?,?,?,?)")
    .run(defaultMeshProject, doc.name, JSON.stringify(doc), doc.robloxPreset, stats.triangleCount, stats.objectCount);
  database = db;
  return db;
}

type Project = { id: string; name: string; scene: string; revision: number };
export function readMeshProject(id: string) {
  const row = storage().prepare("SELECT id,name,scene,revision FROM mesh_projects WHERE id=?").get(id) as Project | undefined;
  if (!row) throw new MeshProjectError("Mesh project not found.", 404);
  return { ...row, scene: JSON.parse(row.scene) as SerializedSceneDocument };
}

export function listMeshProjects() {
  return storage().prepare(`SELECT id,name,preset AS robloxPreset,triangles AS triangleCount,
    objects AS objectCount,revision,updated_at AS updatedAt FROM mesh_projects ORDER BY updated_at DESC,id`).all();
}

function prepareScene(input: unknown) {
  const doc = validateScene(input);
  const json = JSON.stringify(doc);
  if (Buffer.byteLength(json) > maxMeshBodyBytes) throw new MeshProjectError("Scene exceeds 8 MiB.", 413);
  return { doc, json, ...countSceneStats(doc) };
}

export function createMeshProject(input: unknown) {
  const { doc, json, triangleCount, objectCount } = prepareScene(input);
  const id = randomUUID();
  storage().prepare("INSERT INTO mesh_projects(id,name,scene,preset,triangles,objects) VALUES(?,?,?,?,?,?)")
    .run(id, doc.name, json, doc.robloxPreset, triangleCount, objectCount);
  return { id, revision: 1 };
}

export function saveMeshProject(
  id: string, expectedRevision: number, input: unknown,
  event?: { actor: string; toolName: string; argsJson: string; summary: string },
) {
  const { doc, json, triangleCount, objectCount } = prepareScene(input);
  const db = storage();
  return db.transaction(() => {
    const result = db.prepare(`UPDATE mesh_projects SET name=?, scene=?, preset=?, triangles=?, objects=?,
      revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?`)
      .run(doc.name, json, doc.robloxPreset, triangleCount, objectCount, id, expectedRevision);
    if (!result.changes) {
      readMeshProject(id);
      throw new MeshProjectError("Another editor changed this scene. Reload or fork your edits.", 409);
    }
    const revision = expectedRevision + 1;
    if (event) db.prepare(`INSERT INTO mesh_events(project_id,actor,tool_name,args_json,result_summary,revision)
      VALUES(?,?,?,?,?,?)`).run(id, event.actor, event.toolName, event.argsJson, event.summary, revision);
    return { revision };
  })();
}

export function syncMeshProject(id: string, sinceRevision: number, sinceEventId: number) {
  const { scene, revision } = readMeshProject(id);
  const events = storage().prepare(`SELECT id,project_id AS projectId,actor, tool_name AS toolName,
    args_json AS argsJson,result_summary AS resultSummary,revision,created_at AS createdAt
    FROM mesh_events WHERE project_id=? AND id>? ORDER BY id LIMIT 80`).all(id, sinceEventId);
  return { revision, events, ...(revision > sinceRevision ? { scene } : {}) };
}
