import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { logger } from './logger';

/**
 * 数据库初始化与迁移。
 * - 12 张表（详见 CLAUDE.md §5）
 * - WAL 模式，崩溃恢复见 ARCHITECTURE.md §8
 * - schema_version 在 settings 表里追踪
 */

const CURRENT_SCHEMA_VERSION = 2;

let _db: Database.Database | null = null;

export function initDb(): Database.Database {
  if (_db) return _db;
  const dbPath = path.join(app.getPath('userData'), 'database.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  applySchema(db);
  applyCrashRecovery(db);
  applyBuiltinSeeds(db);

  _db = db;
  logger.info('db.initialized', dbPath);
  return db;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error('db not initialized; call initDb first');
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const ver = readSchemaVersion(db);

  if (ver < 1) {
    db.transaction(() => {
      db.exec(SCHEMA_V1);
      writeSchemaVersion(db, 1);
    })();
    logger.info('db migrated to v1');
  }

  if (ver < 2) {
    db.transaction(() => {
      // 给绘画类 api_configs 加协议变种字段（OpenAI 标准 / grsai / 等）。
      // 用 PRAGMA 检查列是否已存在，避免对全新库重复 ALTER。
      const cols = db
        .prepare(`PRAGMA table_info(api_configs)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'image_kind')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN image_kind TEXT`);
      }
      writeSchemaVersion(db, 2);
    })();
    logger.info('db migrated to v2 (image_kind on api_configs)');
  }

  if (ver > CURRENT_SCHEMA_VERSION) {
    logger.warn('db schema_version > current app, may have compat issues');
  }
}

function readSchemaVersion(db: Database.Database): number {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'schema_version'`)
    .get() as { value: string } | undefined;
  if (!row) return 0;
  const n = parseInt(row.value, 10);
  return Number.isFinite(n) ? n : 0;
}

function writeSchemaVersion(db: Database.Database, v: number): void {
  db.prepare(
    `INSERT INTO settings(key, value) VALUES('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(v));
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS api_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_configs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id              INTEGER NOT NULL REFERENCES api_plans(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL,
  provider_name        TEXT NOT NULL,
  base_url             TEXT NOT NULL,
  api_key_encrypted    TEXT NOT NULL,
  model_mapping        TEXT NOT NULL,
  is_official          INTEGER NOT NULL DEFAULT 0,
  supports_web_search  INTEGER NOT NULL DEFAULT 0,
  supports_vision      INTEGER NOT NULL DEFAULT 0,
  official_kind        TEXT,
  image_kind           TEXT,
  created_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  model_id    TEXT NOT NULL,
  plan_id     INTEGER NOT NULL REFERENCES api_plans(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  timestamp       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   TEXT REFERENCES conversations(id),
  model_id          TEXT NOT NULL,
  positive_prompt   TEXT NOT NULL,
  negative_prompt   TEXT,
  params            TEXT NOT NULL,
  reference_images  TEXT,
  status            TEXT NOT NULL,
  result_paths      TEXT,
  error_message     TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER REFERENCES generation_tasks(id),
  file_path         TEXT NOT NULL,
  thumbnail_path    TEXT,
  prompt_positive   TEXT,
  prompt_negative   TEXT,
  model_used        TEXT,
  params_json       TEXT,
  tags              TEXT,
  rating            INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  album_ids         TEXT,
  deleted_at        TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS albums (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  smart_rules     TEXT,
  cover_image_id  INTEGER REFERENCES images(id),
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  description   TEXT,
  params_full   TEXT NOT NULL,
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  text              TEXT NOT NULL,
  negative_text     TEXT,
  kind              TEXT NOT NULL DEFAULT 'image',
  category_id       INTEGER REFERENCES prompt_categories(id),
  tags              TEXT,
  notes             TEXT,
  related_image_ids TEXT,
  deleted_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reverse_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  image_paths  TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  result_type  TEXT NOT NULL,
  result_text  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_lab_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_type  TEXT NOT NULL,
  input_data      TEXT NOT NULL,
  output_data     TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      TEXT NOT NULL,
  image_id      INTEGER NOT NULL REFERENCES images(id),
  version_no    INTEGER NOT NULL,
  is_current    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_image_versions_group
  ON image_versions(group_id, version_no);

CREATE TABLE IF NOT EXISTS themes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  atmosphere  TEXT NOT NULL,
  palette     TEXT NOT NULL,
  overrides   TEXT,
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
`;

function applyCrashRecovery(db: Database.Database): void {
  // ARCHITECTURE.md §8.1：上次未完成的任务标为 failed
  const upd = db
    .prepare(
      `UPDATE generation_tasks
          SET status = 'failed',
              error_message = COALESCE(error_message, 'app-restart-cleanup')
        WHERE status IN ('pending', 'running')`
    )
    .run();
  if (upd.changes > 0) {
    logger.info(`crash recovery: marked ${upd.changes} stale tasks as failed`);
  }
}

const BUILTIN_CATEGORIES: Array<{ name: string; slug: string; sort_order: number }> = [
  { name: '图片提示词', slug: 'image', sort_order: 1 },
  { name: '视频提示词', slug: 'video', sort_order: 2 },
  { name: '提问方法', slug: 'qa', sort_order: 3 },
  { name: '文档资料', slug: 'doc', sort_order: 4 },
  { name: '我的收藏', slug: 'favorite', sort_order: 5 }
];

const DEFAULT_PREFS: Array<[string, string]> = [
  ['last_used_atmosphere', 'deep-quiet'],
  ['last_used_palette', 'warm-orange'],
  ['usage_tracking_enabled', 'false'],
  ['default_context_strategy', 'truncate-head'],
  ['auto_update_channel', 'stable']
];

function applyBuiltinSeeds(db: Database.Database): void {
  const insertCategory = db.prepare(
    `INSERT OR IGNORE INTO prompt_categories(name, slug, is_builtin, sort_order, created_at)
     VALUES(?, ?, 1, ?, ?)`
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const c of BUILTIN_CATEGORIES) {
      insertCategory.run(c.name, c.slug, c.sort_order, now);
    }
    const ensurePref = db.prepare(
      `INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)`
    );
    for (const [k, v] of DEFAULT_PREFS) ensurePref.run(k, v);
  })();
}
