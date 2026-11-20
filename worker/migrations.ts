import type Database from "better-sqlite3";
// Additive, transactional and repeatable. Existing prompts, settings and records
// are never replaced by feature migrations.
export function migrateFeatures(db: Database.Database) {
  db.transaction(() => {
    const columns: Record<string, Record<string, string>> = {
      games: {
        stage: "TEXT NOT NULL DEFAULT 'prototype'",
        universe_id: "TEXT DEFAULT ''",
        place_id: "TEXT DEFAULT ''",
        pitch_id: "TEXT",
        updated: "TEXT",
      },
      tasks: {
        priority: "INTEGER NOT NULL DEFAULT 1",
        acceptance: "TEXT NOT NULL DEFAULT ''",
        parent_task_id: "TEXT",
        stop_requested: "TEXT",
        requester: "TEXT NOT NULL DEFAULT 'Lead'",
        execution_turn_id: "TEXT",
        verification_status: "TEXT NOT NULL DEFAULT 'pending'",
        verification_note: "TEXT NOT NULL DEFAULT ''",
        verification_superseded: "INTEGER NOT NULL DEFAULT 0",
      },
      runs: {
        studio_pin_revision: "INTEGER NOT NULL DEFAULT 0",
        request_key: "TEXT",
        plan_status: "TEXT NOT NULL DEFAULT 'automatic'",
        verification_status: "TEXT NOT NULL DEFAULT 'pending'",
      },
      agents: {
        provider_options: "TEXT NOT NULL DEFAULT '{}'",
        parameters: "TEXT NOT NULL DEFAULT '{}'",
        timeout_ms: "INTEGER NOT NULL DEFAULT 180000",
        context_limit: "INTEGER NOT NULL DEFAULT 64000",
        spending_limit: "REAL NOT NULL DEFAULT 0",
      },
      tool_calls: {
        studio_id: "TEXT NOT NULL DEFAULT ''",
        pin_revision: "INTEGER NOT NULL DEFAULT 0",
      },
      usage: { provider: "TEXT NOT NULL DEFAULT 'codex'" },
      approvals: {
        note: "TEXT NOT NULL DEFAULT ''",
        reviewer: "TEXT",
        decided_at: "TEXT",
        provider: "TEXT NOT NULL DEFAULT 'studio'",
        session_id: "TEXT",
        rpc_request_id: "TEXT",
        permission_scope: "TEXT",
      },
    };
    for (const [table, fields] of Object.entries(columns)) {
      const existing = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(
          (c) => c.name,
        ),
      );
      for (const [column, sql] of Object.entries(fields))
        if (!existing.has(column))
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${sql}`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS permission_grants(id TEXT PRIMARY KEY,scope TEXT NOT NULL UNIQUE,game_id TEXT NOT NULL,studio_id TEXT NOT NULL,agent TEXT NOT NULL,tool TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS studio_pin_changes(id TEXT PRIMARY KEY,game_id TEXT NOT NULL,old_studio_id TEXT NOT NULL,new_studio_id TEXT NOT NULL,details TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS studio_revisions(studio_id TEXT PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS studio_inspections(task_id TEXT NOT NULL,studio_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(task_id,studio_id));
      CREATE UNIQUE INDEX IF NOT EXISTS runs_request_key ON runs(request_key) WHERE request_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS attention_requests(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),call_id TEXT NOT NULL,question TEXT NOT NULL,priority INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',reply TEXT NOT NULL DEFAULT '',created TEXT DEFAULT CURRENT_TIMESTAMP,resolved_at TEXT,UNIQUE(task_id,call_id));
      CREATE TABLE IF NOT EXISTS agent_messages(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),actor TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,status TEXT DEFAULT 'complete',created TEXT DEFAULT CURRENT_TIMESTAMP,updated TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,game_id TEXT REFERENCES games(id),task_id TEXT REFERENCES tasks(id),name TEXT NOT NULL,kind TEXT NOT NULL,mime TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',file TEXT NOT NULL DEFAULT '',filename TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',license TEXT NOT NULL DEFAULT '',tags TEXT NOT NULL DEFAULT '[]',dependencies TEXT NOT NULL DEFAULT '[]',compatibility TEXT NOT NULL DEFAULT '',content TEXT NOT NULL DEFAULT '',roblox_id TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'catalogued',revision_of TEXT REFERENCES assets(id),created TEXT DEFAULT CURRENT_TIMESTAMP,updated TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS review_events(id TEXT PRIMARY KEY,target_kind TEXT NOT NULL,target_id TEXT NOT NULL,verdict TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',reviewer TEXT NOT NULL DEFAULT 'User',revision_task_id TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS market_snapshots(id TEXT PRIMARY KEY,source TEXT NOT NULL,fetched_at TEXT NOT NULL,quality TEXT NOT NULL,category TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(source,fetched_at,category));
      CREATE TABLE IF NOT EXISTS telemetry_snapshots(id TEXT PRIMARY KEY,game_id TEXT NOT NULL REFERENCES games(id),source TEXT NOT NULL,fetched_at TEXT NOT NULL,quality TEXT NOT NULL,payload TEXT NOT NULL,UNIQUE(game_id,source,fetched_at));
      CREATE TABLE IF NOT EXISTS pitches(id TEXT PRIMARY KEY,game_id TEXT REFERENCES games(id),title TEXT NOT NULL,hook TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',version INTEGER NOT NULL DEFAULT 1,payload TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP,updated TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS pitch_versions(pitch_id TEXT NOT NULL REFERENCES pitches(id),version INTEGER NOT NULL,payload TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(pitch_id,version));
      CREATE TABLE IF NOT EXISTS codex_sessions(id TEXT PRIMARY KEY,thread_id TEXT UNIQUE,title TEXT NOT NULL,cwd TEXT NOT NULL,model TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'idle',task_id TEXT,archived INTEGER NOT NULL DEFAULT 0,created TEXT DEFAULT CURRENT_TIMESTAMP,updated TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS codex_turns(id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES codex_sessions(id),task_id TEXT,prompt TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'running',result TEXT NOT NULL DEFAULT '',diff TEXT NOT NULL DEFAULT '',error TEXT,usage TEXT NOT NULL DEFAULT '{}',review_status TEXT NOT NULL DEFAULT 'unreviewed',review_note TEXT NOT NULL DEFAULT '',reviewed_at TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP,updated TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS codex_events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES codex_sessions(id),turn_id TEXT,type TEXT NOT NULL,payload TEXT NOT NULL,created TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE INDEX IF NOT EXISTS assets_task ON assets(task_id);
      CREATE INDEX IF NOT EXISTS codex_sessions_task ON codex_sessions(task_id);
      CREATE INDEX IF NOT EXISTS codex_turns_session ON codex_turns(session_id,created);
      CREATE INDEX IF NOT EXISTS codex_events_session ON codex_events(session_id,id);
      CREATE INDEX IF NOT EXISTS agent_messages_task ON agent_messages(task_id,created);
      CREATE INDEX IF NOT EXISTS reviews_target ON review_events(target_kind,target_id);
      CREATE INDEX IF NOT EXISTS telemetry_game ON telemetry_snapshots(game_id,fetched_at);
    `);
  })();
}
