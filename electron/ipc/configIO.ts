/**
 * 配置一键导入 / 导出。
 *
 * 范围（按用户决策）：
 * - 模型方案 + 配置（api_plans + api_configs，含 API Key，强制密码加密导出）
 * - 外观（自定义 themes + 与外观相关的 settings 项）
 * - 系统设置（settings 表全量 KV）
 * - 提示词管家（prompts + prompt_categories + albums 元数据）
 *
 * 不导出：conversations / messages / images / generation_tasks / image_versions
 *         / reverse_tasks / prompt_lab_history（机器/路径强相关）
 *
 * 文件格式（JSON envelope）：
 *   {
 *     format: 'mengbi-config-v1',
 *     exportedAt, appVersion, schemaVersion,
 *     encryption: { algo, kdf, salt, iv, tag },
 *     payload: <base64 ciphertext: gzipped JSON of inner bundle>
 *   }
 */

import { z } from 'zod';
import { app, dialog } from 'electron';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import { register, ok, err } from './helpers';
import { getDb } from '../services/db';
import { encryptString, decryptString } from '../services/safeStorage';
import { logger } from '../services/logger';
import { makeError } from '@shared/error';
import { normalizeVideoKind } from '@shared/domain';
import {
  listNodeTemplates,
  importNodeTemplates,
  type StoredTemplate
} from '../services/nodeTemplateStore';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const FORMAT_TAG = 'mengbi-config-v1';
const ENCRYPTION = {
  algo: 'AES-256-GCM',
  kdf: 'scrypt',
  N: 16384,
  r: 8,
  p: 1
};

interface SectionsFlag {
  plans: boolean;
  appearance: boolean;
  prompts: boolean;
  nodeTemplates: boolean;
}

interface InnerBundle {
  plans?: Array<Record<string, unknown>>;
  configs?: Array<Record<string, unknown>>;
  themes?: Array<Record<string, unknown>>;
  settings?: Record<string, string>;
  promptCategories?: Array<Record<string, unknown>>;
  prompts?: Array<Record<string, unknown>>;
  albums?: Array<Record<string, unknown>>;
  nodeTemplates?: StoredTemplate[];
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32, {
    N: ENCRYPTION.N,
    r: ENCRYPTION.r,
    p: ENCRYPTION.p
  });
}

async function buildExportBundle(sections: SectionsFlag): Promise<InnerBundle> {
  const db = getDb();
  const bundle: InnerBundle = {};

  if (sections.plans) {
    bundle.plans = db
      .prepare(`SELECT id, name, created_at, updated_at FROM api_plans ORDER BY id ASC`)
      .all() as Array<Record<string, unknown>>;

    const rawConfigs = db
      .prepare(
        `SELECT id, plan_id, type, provider_name, base_url,
                api_key_encrypted, model_mapping, is_official,
                supports_web_search, supports_vision,
                official_kind, image_kind, video_kind, body_overrides_json,
                header_overrides_json,
                comfyui_workflow_json, local_model_path,
                supports_thinking, thinking_effort,
                icon, proxy_timeout_seconds, created_at
           FROM api_configs ORDER BY id ASC`
      )
      .all() as Array<Record<string, unknown>>;

    bundle.configs = rawConfigs.map((row) => {
      const stored = (row.api_key_encrypted as string) ?? '';
      const apiKeyPlain = decryptString(stored);
      const cleaned = { ...row };
      delete cleaned.api_key_encrypted;
      cleaned.api_key_plain = apiKeyPlain;
      return cleaned;
    });
  }

  if (sections.appearance) {
    bundle.themes = db
      .prepare(
        `SELECT id, name, atmosphere, palette, overrides, is_builtin, created_at
           FROM themes WHERE is_builtin = 0 ORDER BY id ASC`
      )
      .all() as Array<Record<string, unknown>>;
  }

  // settings 表整体导出（含 last_used_atmosphere/palette、image_storage_path、文件名模板、
  // 搜索后端、LoRA 路径等）；schema_version 在导入时会被忽略。
  if (sections.appearance || sections.plans) {
    const settingsRows = db
      .prepare(`SELECT key, value FROM settings`)
      .all() as Array<{ key: string; value: string }>;
    const dict: Record<string, string> = {};
    for (const r of settingsRows) {
      if (r.key === 'schema_version') continue;
      dict[r.key] = r.value ?? '';
    }
    bundle.settings = dict;
  }

  if (sections.prompts) {
    bundle.promptCategories = db
      .prepare(
        `SELECT id, name, slug, is_builtin, sort_order, created_at
           FROM prompt_categories ORDER BY sort_order ASC, id ASC`
      )
      .all() as Array<Record<string, unknown>>;

    bundle.prompts = db
      .prepare(
        `SELECT id, title, text, negative_text, kind, category_id,
                tags, notes, related_image_ids, thumb_data_uri,
                deleted_at, created_at, updated_at
           FROM prompts WHERE deleted_at IS NULL ORDER BY id ASC`
      )
      .all() as Array<Record<string, unknown>>;

    bundle.albums = db
      .prepare(
        `SELECT id, name, type, smart_rules, created_at
           FROM albums ORDER BY id ASC`
      )
      .all() as Array<Record<string, unknown>>;
  }

  // 节点模板：读 userData/node-templates/ 下的 .json（与 DB 无关）
  if (sections.nodeTemplates) {
    bundle.nodeTemplates = await listNodeTemplates();
  }

  return bundle;
}

interface ImportStats {
  plansImported: number;
  configsImported: number;
  themesImported: number;
  promptCategoriesImported: number;
  promptsImported: number;
  albumsImported: number;
  settingsImported: number;
  nodeTemplatesImported: number;
}

function applyImport(
  bundle: InnerBundle,
  mergeStrategy: 'merge' | 'overwrite',
  sections: SectionsFlag
): ImportStats {
  const db = getDb();
  const stats: ImportStats = {
    plansImported: 0,
    configsImported: 0,
    themesImported: 0,
    promptCategoriesImported: 0,
    promptsImported: 0,
    albumsImported: 0,
    settingsImported: 0,
    nodeTemplatesImported: 0
  };

  db.transaction(() => {
    const now = new Date().toISOString();

    // —— 模型方案 + 配置 ——
    if (sections.plans && bundle.plans) {
      if (mergeStrategy === 'overwrite') {
        // 配置先删（外键），再删方案
        db.prepare(`DELETE FROM api_configs`).run();
        db.prepare(`DELETE FROM api_plans`).run();
      }

      // plan_id 在导入时会变化：建一个 oldId → newId 映射
      const planIdMap = new Map<number, number>();
      const insertPlan = db.prepare(
        `INSERT INTO api_plans(name, created_at, updated_at) VALUES(?, ?, ?)`
      );
      const findPlan = db.prepare(`SELECT id FROM api_plans WHERE name = ?`);
      for (const p of bundle.plans) {
        const oldId = Number(p.id);
        const name = String(p.name);
        let existing: { id: number } | undefined;
        if (mergeStrategy === 'merge') {
          existing = findPlan.get(name) as { id: number } | undefined;
        }
        if (existing) {
          planIdMap.set(oldId, existing.id);
        } else {
          const r = insertPlan.run(
            name,
            (p.created_at as string) ?? now,
            (p.updated_at as string) ?? now
          );
          planIdMap.set(oldId, Number(r.lastInsertRowid));
          stats.plansImported++;
        }
      }

      if (bundle.configs) {
        const insertConfig = db.prepare(
          `INSERT INTO api_configs(
             plan_id, type, provider_name, base_url, api_key_encrypted,
             model_mapping, is_official, supports_web_search, supports_vision,
             official_kind, image_kind, video_kind, body_overrides_json, header_overrides_json, comfyui_workflow_json,
             local_model_path, supports_thinking, thinking_effort,
             icon, proxy_timeout_seconds, created_at
           ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const findConfig = db.prepare(
          `SELECT id FROM api_configs
            WHERE plan_id = ? AND type = ? AND provider_name = ? AND base_url = ?`
        );
        for (const c of bundle.configs) {
          const oldPlanId = Number(c.plan_id);
          const newPlanId = planIdMap.get(oldPlanId);
          if (newPlanId == null) continue;
          if (mergeStrategy === 'merge') {
            const dup = findConfig.get(
              newPlanId,
              c.type as string,
              c.provider_name as string,
              c.base_url as string
            ) as { id: number } | undefined;
            if (dup) continue;
          }
          insertConfig.run(
            newPlanId,
            c.type as string,
            c.provider_name as string,
            c.base_url as string,
            encryptString((c.api_key_plain as string) ?? ''),
            (c.model_mapping as string) ?? '{}',
            Number(c.is_official ?? 0),
            Number(c.supports_web_search ?? 0),
            Number(c.supports_vision ?? 0),
            (c.official_kind as string) ?? null,
            (c.image_kind as string) ?? null,
            normalizeVideoKind(c.video_kind),
            (c.body_overrides_json as string) ?? null,
            (c.header_overrides_json as string) ?? null,
            (c.comfyui_workflow_json as string) ?? null,
            (c.local_model_path as string) ?? null,
            Number(c.supports_thinking ?? 0),
            (c.thinking_effort as string) ?? null,
            (c.icon as string) ?? null,
            c.proxy_timeout_seconds != null ? Number(c.proxy_timeout_seconds) : null,
            (c.created_at as string) ?? now
          );
          stats.configsImported++;
        }
      }
    }

    // —— 外观（themes 表） ——
    if (sections.appearance && bundle.themes) {
      if (mergeStrategy === 'overwrite') {
        db.prepare(`DELETE FROM themes WHERE is_builtin = 0`).run();
      }
      const insertTheme = db.prepare(
        `INSERT INTO themes(name, atmosphere, palette, overrides, is_builtin, created_at)
           VALUES(?, ?, ?, ?, 0, ?)`
      );
      const findTheme = db.prepare(
        `SELECT id FROM themes WHERE name = ? AND is_builtin = 0`
      );
      for (const t of bundle.themes) {
        if (Number(t.is_builtin) === 1) continue;
        if (mergeStrategy === 'merge') {
          const dup = findTheme.get(t.name as string) as
            | { id: number }
            | undefined;
          if (dup) continue;
        }
        insertTheme.run(
          t.name as string,
          t.atmosphere as string,
          t.palette as string,
          (t.overrides as string) ?? null,
          (t.created_at as string) ?? now
        );
        stats.themesImported++;
      }
    }

    // —— settings 表 ——（appearance 与 plans 任一勾选都同步导入）
    if ((sections.appearance || sections.plans) && bundle.settings) {
      const upsertSetting = db.prepare(
        `INSERT INTO settings(key, value) VALUES(?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      );
      for (const [k, v] of Object.entries(bundle.settings)) {
        if (k === 'schema_version') continue;
        upsertSetting.run(k, v);
        stats.settingsImported++;
      }
    }

    // —— 提示词分类 ——
    if (sections.prompts && bundle.promptCategories) {
      const insertCat = db.prepare(
        `INSERT OR IGNORE INTO prompt_categories(name, slug, is_builtin, sort_order, created_at)
           VALUES(?, ?, ?, ?, ?)`
      );
      for (const c of bundle.promptCategories) {
        const r = insertCat.run(
          c.name as string,
          c.slug as string,
          Number(c.is_builtin ?? 0),
          Number(c.sort_order ?? 0),
          (c.created_at as string) ?? now
        );
        if (r.changes > 0) stats.promptCategoriesImported++;
      }
    }

    // —— 提示词卡片 ——
    if (sections.prompts && bundle.prompts) {
      // category_id 在导入时按 slug 重映射
      const slugById = new Map<number, string>();
      if (bundle.promptCategories) {
        for (const c of bundle.promptCategories) {
          slugById.set(Number(c.id), c.slug as string);
        }
      }
      const findCatBySlug = db.prepare(
        `SELECT id FROM prompt_categories WHERE slug = ?`
      );
      const insertPrompt = db.prepare(
        `INSERT INTO prompts(
           title, text, negative_text, kind, category_id,
           tags, notes, related_image_ids, thumb_data_uri,
           deleted_at, created_at, updated_at
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      );
      for (const p of bundle.prompts) {
        // related_image_ids 跨机器无意义，清空
        let mappedCatId: number | null = null;
        const oldCatId = p.category_id != null ? Number(p.category_id) : null;
        if (oldCatId != null) {
          const slug = slugById.get(oldCatId);
          if (slug) {
            const row = findCatBySlug.get(slug) as { id: number } | undefined;
            if (row) mappedCatId = row.id;
          }
        }
        insertPrompt.run(
          p.title as string,
          p.text as string,
          (p.negative_text as string) ?? null,
          (p.kind as string) ?? 'image',
          mappedCatId,
          (p.tags as string) ?? null,
          (p.notes as string) ?? null,
          null,
          (p.thumb_data_uri as string) ?? null,
          (p.created_at as string) ?? now,
          (p.updated_at as string) ?? now
        );
        stats.promptsImported++;
      }
    }

    // —— 相册元数据 —— (cover_image_id 跨机器无意义，丢弃)
    if (sections.prompts && bundle.albums) {
      if (mergeStrategy === 'overwrite') {
        db.prepare(`DELETE FROM albums`).run();
      }
      const findAlbum = db.prepare(`SELECT id FROM albums WHERE name = ?`);
      const insertAlbum = db.prepare(
        `INSERT INTO albums(name, type, smart_rules, cover_image_id, created_at)
           VALUES(?, ?, ?, NULL, ?)`
      );
      for (const a of bundle.albums) {
        if (mergeStrategy === 'merge') {
          const dup = findAlbum.get(a.name as string) as
            | { id: number }
            | undefined;
          if (dup) continue;
        }
        insertAlbum.run(
          a.name as string,
          (a.type as string) ?? 'manual',
          (a.smart_rules as string) ?? null,
          (a.created_at as string) ?? now
        );
        stats.albumsImported++;
      }
    }
  })();

  return stats;
}

export function registerConfigIOHandlers(): void {
  // 导出
  register(
    'api:config:export',
    z.object({
      password: z.string().min(8, '密码至少 8 位'),
      sections: z.object({
        plans: z.boolean(),
        appearance: z.boolean(),
        prompts: z.boolean(),
        nodeTemplates: z.boolean()
      })
    }),
    async (input) => {
      try {
        const bundle = await buildExportBundle(input.sections);
        const json = JSON.stringify(bundle);
        const compressed = await gzip(Buffer.from(json, 'utf-8'));

        const salt = crypto.randomBytes(16);
        const iv = crypto.randomBytes(12);
        const key = deriveKey(input.password, salt);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
        const tag = cipher.getAuthTag();

        const envelope = {
          format: FORMAT_TAG,
          exportedAt: new Date().toISOString(),
          appVersion: app.getVersion(),
          schemaVersion: 6,
          encryption: {
            algo: ENCRYPTION.algo,
            kdf: ENCRYPTION.kdf,
            N: ENCRYPTION.N,
            r: ENCRYPTION.r,
            p: ENCRYPTION.p,
            salt: salt.toString('base64'),
            iv: iv.toString('base64'),
            tag: tag.toString('base64')
          },
          payload: ciphertext.toString('base64')
        };

        const defaultName = `mengbi-config-${new Date()
          .toISOString()
          .slice(0, 10)}.mengbi-config`;
        const result = await dialog.showSaveDialog({
          title: '保存配置文件',
          defaultPath: defaultName,
          filters: [
            { name: '梦笔配置文件', extensions: ['mengbi-config'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        });
        if (result.canceled || !result.filePath) {
          const out: { savedPath: string | null; byteSize: number; cancelled: boolean } =
            { savedPath: null, byteSize: 0, cancelled: true };
          return ok(out);
        }
        const finalJson = JSON.stringify(envelope, null, 2);
        await fs.writeFile(result.filePath, finalJson, 'utf-8');
        const out: { savedPath: string | null; byteSize: number; cancelled: boolean } =
          {
            savedPath: result.filePath,
            byteSize: Buffer.byteLength(finalJson, 'utf-8'),
            cancelled: false
          };
        return ok(out);
      } catch (e) {
        logger.error('config export failed', e);
        return err(
          makeError('UNKNOWN', `导出失败：${(e as Error).message}`, {
            severity: 'modal'
          })
        );
      }
    }
  );

  // 选文件 + 校验密码 + 预览（不写库）
  register(
    'api:config:preview',
    z.object({
      filePath: z.string().min(1),
      password: z.string().min(1)
    }),
    async (input) => {
      try {
        const raw = await fs.readFile(input.filePath, 'utf-8');
        const env = JSON.parse(raw) as Record<string, unknown>;
        if (env.format !== FORMAT_TAG) {
          return err(
            makeError(
              'VALIDATION_FAILED',
              `不是合法的梦笔配置文件（format=${env.format}）`,
              { severity: 'modal' }
            )
          );
        }
        const enc = env.encryption as Record<string, string>;
        const salt = Buffer.from(enc.salt, 'base64');
        const iv = Buffer.from(enc.iv, 'base64');
        const tag = Buffer.from(enc.tag, 'base64');
        const ciphertext = Buffer.from(env.payload as string, 'base64');
        const key = deriveKey(input.password, salt);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let compressed: Buffer;
        try {
          compressed = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
          ]);
        } catch {
          return err(
            makeError('VALIDATION_FAILED', '密码错误或文件已损坏', {
              severity: 'modal'
            })
          );
        }
        const decompressed = await gunzip(compressed);
        const bundle = JSON.parse(decompressed.toString('utf-8')) as InnerBundle;

        return ok({
          format: env.format,
          exportedAt: env.exportedAt,
          appVersion: env.appVersion,
          counts: {
            plans: bundle.plans?.length ?? 0,
            configs: bundle.configs?.length ?? 0,
            themes: bundle.themes?.length ?? 0,
            promptCategories: bundle.promptCategories?.length ?? 0,
            prompts: bundle.prompts?.length ?? 0,
            albums: bundle.albums?.length ?? 0,
            settings: bundle.settings ? Object.keys(bundle.settings).length : 0,
            nodeTemplates: bundle.nodeTemplates?.length ?? 0
          }
        });
      } catch (e) {
        logger.error('config preview failed', e);
        return err(
          makeError('UNKNOWN', `读取失败：${(e as Error).message}`, {
            severity: 'modal'
          })
        );
      }
    }
  );

  // 真正执行导入（需要再传一次 password 重新解密；不缓存解密结果）
  register(
    'api:config:import',
    z.object({
      filePath: z.string().min(1),
      password: z.string().min(1),
      mergeStrategy: z.enum(['merge', 'overwrite']),
      sections: z.object({
        plans: z.boolean(),
        appearance: z.boolean(),
        prompts: z.boolean(),
        nodeTemplates: z.boolean()
      })
    }),
    async (input) => {
      try {
        const raw = await fs.readFile(input.filePath, 'utf-8');
        const env = JSON.parse(raw) as Record<string, unknown>;
        if (env.format !== FORMAT_TAG) {
          return err(
            makeError(
              'VALIDATION_FAILED',
              `不是合法的梦笔配置文件（format=${env.format}）`,
              { severity: 'modal' }
            )
          );
        }
        const enc = env.encryption as Record<string, string>;
        const salt = Buffer.from(enc.salt, 'base64');
        const iv = Buffer.from(enc.iv, 'base64');
        const tag = Buffer.from(enc.tag, 'base64');
        const ciphertext = Buffer.from(env.payload as string, 'base64');
        const key = deriveKey(input.password, salt);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        let compressed: Buffer;
        try {
          compressed = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
          ]);
        } catch {
          return err(
            makeError('VALIDATION_FAILED', '密码错误或文件已损坏', {
              severity: 'modal'
            })
          );
        }
        const decompressed = await gunzip(compressed);
        const bundle = JSON.parse(decompressed.toString('utf-8')) as InnerBundle;

        const stats = applyImport(bundle, input.mergeStrategy, input.sections);

        // 节点模板写文件（在 DB 事务之外，因为是异步 fs 写）
        if (input.sections.nodeTemplates && bundle.nodeTemplates?.length) {
          try {
            stats.nodeTemplatesImported = await importNodeTemplates(
              bundle.nodeTemplates,
              input.mergeStrategy
            );
          } catch (e) {
            logger.warn(`[configIO] node template import failed: ${(e as Error).message}`);
          }
        }
        return ok({ stats });
      } catch (e) {
        logger.error('config import failed', e);
        return err(
          makeError('UNKNOWN', `导入失败：${(e as Error).message}`, {
            severity: 'modal'
          })
        );
      }
    }
  );

  // 选择待导入文件
  register('api:config:pick-import-file', null, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择梦笔配置文件',
      properties: ['openFile'],
      filters: [
        { name: '梦笔配置文件', extensions: ['mengbi-config'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    const out: { filePath: string | null } =
      result.canceled || result.filePaths.length === 0
        ? { filePath: null }
        : { filePath: result.filePaths[0] };
    return ok(out);
  });
}
