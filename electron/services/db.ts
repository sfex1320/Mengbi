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

const CURRENT_SCHEMA_VERSION = 15;

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

  if (ver < 3) {
    db.transaction(() => {
      // prompts 增加 thumb_data_uri：对于反推 / 用户手填这类没有"已存图库的关联图"的卡片，
      // 直接存一个小 data URI 作为缩略图。比走 related_image_ids 更轻。
      const cols = db
        .prepare(`PRAGMA table_info(prompts)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'thumb_data_uri')) {
        db.exec(`ALTER TABLE prompts ADD COLUMN thumb_data_uri TEXT`);
      }
      writeSchemaVersion(db, 3);
    })();
    logger.info('db migrated to v3 (thumb_data_uri on prompts)');
  }

  if (ver < 4) {
    db.transaction(() => {
      // generation_tasks 加 finished_at：用户在最新生图任务卡片上看「总耗时 = finished_at - created_at」。
      // 旧任务无该字段值，UI 端会跳过展示，无需回填。
      const cols = db
        .prepare(`PRAGMA table_info(generation_tasks)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'finished_at')) {
        db.exec(`ALTER TABLE generation_tasks ADD COLUMN finished_at TEXT`);
      }
      writeSchemaVersion(db, 4);
    })();
    logger.info('db migrated to v4 (finished_at on generation_tasks)');
  }

  if (ver < 5) {
    db.transaction(() => {
      // api_configs 加 body_overrides_json：让用户给某个方案配 JSON 模板覆盖默认请求体，
      // 解决中转站字段习惯差异（详见计划文件 1k-2k-validated-wreath.md）。NULL = 不覆盖。
      const cols = db
        .prepare(`PRAGMA table_info(api_configs)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'body_overrides_json')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN body_overrides_json TEXT`);
      }
      writeSchemaVersion(db, 5);
    })();
    logger.info('db migrated to v5 (body_overrides_json on api_configs)');
  }

  if (ver < 6) {
    db.transaction(() => {
      // api_configs 加 comfyui_workflow_json：image_kind='comfyui' 时存用户从 ComfyUI 导出的
      // API Format JSON 字符串。运行时按 {{prompt}} / {{seed}} 等占位符替换后 POST /prompt。
      const cols = db
        .prepare(`PRAGMA table_info(api_configs)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'comfyui_workflow_json')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN comfyui_workflow_json TEXT`);
      }
      writeSchemaVersion(db, 6);
    })();
    logger.info('db migrated to v6 (comfyui_workflow_json on api_configs)');
  }

  if (ver < 7) {
    db.transaction(() => {
      // generation_tasks 加 image_kind：把生图任务"出身"记下来
      // （'comfyui' / 'openai' / 'grsai' / 'gemini' / 'openai-compat' / NULL）
      // 让 Create 页和 LocalModel 页的"最近输出"能各看各的，不再混在一起。
      const cols = db
        .prepare(`PRAGMA table_info(generation_tasks)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'image_kind')) {
        db.exec(`ALTER TABLE generation_tasks ADD COLUMN image_kind TEXT`);
      }
      writeSchemaVersion(db, 7);
    })();
    logger.info('db migrated to v7 (image_kind on generation_tasks)');
  }

  if (ver < 8) {
    db.transaction(() => {
      // api_configs 加 local_model_path：official_kind='local' 时指向用户选的 .gguf 文件
      const cols = db
        .prepare(`PRAGMA table_info(api_configs)`)
        .all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'local_model_path')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN local_model_path TEXT`);
      }
      writeSchemaVersion(db, 8);
    })();
    logger.info('db migrated to v8 (local_model_path on api_configs)');
  }

  if (ver < 9) {
    db.transaction(() => {
      // 思考模式（reasoning / thinking）支持：
      //  - api_configs.supports_thinking：方案上的"启用思考模式"开关
      //  - api_configs.thinking_effort：'low' / 'medium' / 'high' / 'max'；NULL = 上游默认
      //  - messages.reasoning_content：助手消息附带的思考过程文本；NULL = 该消息无思考内容
      // 协议侧按 official_kind 分流，详见 chat.ts 注入与解析两段。
      const cfgCols = db.prepare(`PRAGMA table_info(api_configs)`).all() as Array<{ name: string }>;
      if (!cfgCols.some((c) => c.name === 'supports_thinking')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN supports_thinking INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cfgCols.some((c) => c.name === 'thinking_effort')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN thinking_effort TEXT`);
      }
      const msgCols = db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name: string }>;
      if (!msgCols.some((c) => c.name === 'reasoning_content')) {
        db.exec(`ALTER TABLE messages ADD COLUMN reasoning_content TEXT`);
      }
      writeSchemaVersion(db, 9);
    })();
    logger.info('db migrated to v9 (thinking mode on api_configs + messages)');
  }

  if (ver < 10) {
    db.transaction(() => {
      // api_configs 加 icon：保存 lobehub slug（如 'openai' / 'anthropic'）或 data:image/... 自定义 dataURI。
      // NULL = 没指定 → ProviderIcon 会按 provider_name / base_url 猜一个回退；UI 永远不会显示空白。
      const cols = db.prepare(`PRAGMA table_info(api_configs)`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'icon')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN icon TEXT`);
      }
      writeSchemaVersion(db, 10);
    })();
    logger.info('db migrated to v10 (icon on api_configs)');
  }

  if (ver < 11) {
    db.transaction(() => {
      // api_configs 加 proxy_timeout_seconds：记下该中转上一次「边缘代理硬超时」是多少秒。
      // 由 generate.ts 在 isHardProxyTimeout 命中时自动 UPDATE；前端在提交前用这个值做 pre-flight 提示。
      // NULL = 从未触发硬超时 → 不显示任何额外提示，行为与旧版完全一致。
      const cols = db.prepare(`PRAGMA table_info(api_configs)`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'proxy_timeout_seconds')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN proxy_timeout_seconds INTEGER`);
      }
      writeSchemaVersion(db, 11);
    })();
    logger.info('db migrated to v11 (proxy_timeout_seconds on api_configs)');
  }

  if (ver < 12) {
    db.transaction(() => {
      // 图像转矢量历史:每个完成的 vec 任务(VTracer / Potrace / OmniSVG)落一条。
      // 与 generation_tasks / images 表分开,因为 SVG 文件不进图库,UI 也是 Tools 页独立的 HistoryDrawer。
      db.exec(`
        CREATE TABLE IF NOT EXISTS vectorize_history (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at   TEXT NOT NULL,
          batch_id     TEXT,
          mode         TEXT NOT NULL CHECK(mode IN ('vtracer','potrace','omnisvg')),
          input_path   TEXT NOT NULL,
          output_path  TEXT NOT NULL,
          duration_ms  INTEGER NOT NULL,
          status       TEXT NOT NULL CHECK(status IN ('succeeded','failed','cancelled')),
          error        TEXT,
          params_json  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_vec_history_batch_id ON vectorize_history(batch_id);
        CREATE INDEX IF NOT EXISTS idx_vec_history_created_at ON vectorize_history(created_at);
      `);
      writeSchemaVersion(db, 12);
    })();
    logger.info('db migrated to v12 (vectorize_history)');
  }

  if (ver < 13) {
    db.transaction(() => {
      // v3 重构(2026-05-27):vectorize_history 扩 6 列。
      // 旧的 mode CHECK 还允许 'omnisvg' 死字段;不重建表(数据保留),
      // 由 types.ts + insertVecHistory 收口,业务层只允许 5 种合法值写入。
      const cols = db
        .prepare(`PRAGMA table_info(vectorize_history)`)
        .all() as Array<{ name: string }>;
      const ensureCol = (name: string, ddl: string) => {
        if (!cols.some((c) => c.name === name)) {
          db.exec(`ALTER TABLE vectorize_history ADD COLUMN ${ddl}`);
        }
      };
      ensureCol('requested_mode', 'requested_mode TEXT');
      ensureCol('actual_engine', 'actual_engine TEXT');
      ensureCol('fell_back', 'fell_back INTEGER NOT NULL DEFAULT 0');
      ensureCol('fallback_reason', 'fallback_reason TEXT');
      ensureCol('quality_score', 'quality_score INTEGER');
      ensureCol('report_path', 'report_path TEXT');
      writeSchemaVersion(db, 13);
    })();
    logger.info('db migrated to v13 (vectorize_history v3 refactor cols)');
  }

  if (ver < 14) {
    // ComfyUI 通用工作流编排器：工作流模板 + 运行记录。
    // 连接配置（host / 启动命令 / 目录 / token）复用 settings k/v 表，不单建表。
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS comfyui_workflow_templates (
          workflow_id                TEXT PRIMARY KEY,
          name                       TEXT NOT NULL,
          type_tags                  TEXT,
          original_api_workflow_json TEXT NOT NULL,
          object_info_snapshot       TEXT,
          input_controls             TEXT NOT NULL DEFAULT '[]',
          output_controls            TEXT NOT NULL DEFAULT '[]',
          bindings                   TEXT NOT NULL DEFAULT '[]',
          loop_config                TEXT,
          ui_layout                  TEXT,
          created_at                 TEXT NOT NULL,
          updated_at                 TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comfyui_tpl_updated
          ON comfyui_workflow_templates(updated_at);

        CREATE TABLE IF NOT EXISTS comfyui_runs (
          run_id             TEXT PRIMARY KEY,
          template_id        TEXT REFERENCES comfyui_workflow_templates(workflow_id) ON DELETE SET NULL,
          batch_id           TEXT,
          iteration_index    INTEGER NOT NULL DEFAULT 0,
          prompt_id          TEXT,
          status             TEXT NOT NULL CHECK(status IN ('pending','running','done','failed','cancelled')),
          input_snapshot     TEXT,
          parameter_snapshot TEXT,
          uploaded_files     TEXT,
          output_files       TEXT,
          error_message      TEXT,
          started_at         TEXT,
          finished_at        TEXT,
          duration_ms        INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_comfyui_runs_batch ON comfyui_runs(batch_id);
        CREATE INDEX IF NOT EXISTS idx_comfyui_runs_tpl ON comfyui_runs(template_id);
        CREATE INDEX IF NOT EXISTS idx_comfyui_runs_started ON comfyui_runs(started_at);
      `);
      writeSchemaVersion(db, 14);
    })();
    logger.info('db migrated to v14 (comfyui orchestrator: templates + runs)');
  }

  if (ver < 15) {
    db.transaction(() => {
      // api_configs 加 video_kind：type='video' 的配置记其调用协议（kling / sora / unified）。
      // NULL = 未配 → 运行时按默认 'kling' 处理。其它 type 的行该列恒为 NULL。
      const cols = db.prepare(`PRAGMA table_info(api_configs)`).all() as Array<{ name: string }>;
      if (!cols.some((c) => c.name === 'video_kind')) {
        db.exec(`ALTER TABLE api_configs ADD COLUMN video_kind TEXT`);
      }
      writeSchemaVersion(db, 15);
    })();
    logger.info('db migrated to v15 (video_kind on api_configs)');
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
  body_overrides_json  TEXT,
  comfyui_workflow_json TEXT,
  local_model_path     TEXT,
  supports_thinking    INTEGER NOT NULL DEFAULT 0,
  thinking_effort      TEXT,
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
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  content           TEXT NOT NULL,
  reasoning_content TEXT,
  timestamp         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   TEXT REFERENCES conversations(id),
  model_id          TEXT NOT NULL,
  image_kind        TEXT,
  positive_prompt   TEXT NOT NULL,
  negative_prompt   TEXT,
  params            TEXT NOT NULL,
  reference_images  TEXT,
  status            TEXT NOT NULL,
  result_paths      TEXT,
  error_message     TEXT,
  created_at        TEXT NOT NULL,
  finished_at       TEXT
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
  thumb_data_uri    TEXT,
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
  ['auto_update_channel', 'stable'],
  // AI sidecar UNet 编译加速:'off' / 'reduce-overhead' / 'max-autotune'
  // 2026-05-29 默认从 'off' 改 'reduce-overhead'。 5090+ / 现代 NVIDIA 卡上首次 trace 多 30-60s,
  // 后续每张图 +15-30% 速度。triton-windows 缺失时 compile_helper 会 silently 跳过,无副作用。
  ['ai_torch_compile_mode', 'reduce-overhead'],
  // 图像转矢量输出目录;'' 时回退到 tools_storage_path / vec / 或 image_storage_path / vec /
  ['vec_output_path', ''],
  // userData/vec-debug/ 目录保留天数,过期由 sweepStaleDebugDirs 清理
  ['vec_debug_retain_days', '7']
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
