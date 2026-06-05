import { z } from 'zod';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { register, ok, err } from './helpers';
import { getDb } from '../services/db';
import { makeError } from '@shared/error';
import type { PromptCategory } from '@shared/domain';
import { enqueueBackfill, thumbPathFor } from '../services/thumbnail';

const PromptUpsertSchema = z.object({
  id: z.number().int().optional(),
  title: z.string().min(1).max(200),
  text: z.string().min(1),
  negative_text: z.string().optional().nullable(),
  kind: z.enum(['image', 'video', 'qa', 'doc', 'favorite']).optional(),
  category_id: z.number().int().optional().nullable(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional().nullable(),
  related_image_ids: z.array(z.number().int()).optional(),
  /** 小尺寸 base64 缩略图，用于反推 / 没有关联图库图的卡片 */
  thumb_data_uri: z.string().max(500_000).optional().nullable()
});

const GalleryListSchema = z
  .object({
    category_slug: z.string().optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().optional(),
    include_deleted: z.boolean().optional(),
    /** 按相册筛选：手动相册按 album_ids 成员，智能相册按 smart_rules 实时匹配 */
    album_id: z.number().int().optional()
  })
  .optional();

/** 智能相册规则（与 src/types/domain.ts 的 SmartAlbumRules 对应） */
interface SmartAlbumRules {
  minRating?: number;
  tags?: string[];
  models?: string[];
  dateFrom?: string;
  dateTo?: string;
}

interface AlbumRow {
  id: number;
  name: string;
  type: 'manual' | 'smart';
  smart_rules: string | null;
  cover_image_id: number | null;
  created_at: string;
}

function safeParseRules(raw: string): SmartAlbumRules | null {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as SmartAlbumRules) : null;
  } catch {
    return null;
  }
}

const GalleryUpdateSchema = z.object({
  id: z.number().int(),
  patch: z.record(z.string(), z.unknown())
});

const AlbumUpsertSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1),
  type: z.enum(['manual', 'smart']),
  smart_rules: z.record(z.string(), z.unknown()).optional().nullable(),
  cover_image_id: z.number().int().optional().nullable()
});

export function registerGalleryHandlers(): void {
  register('api:gallery:list', GalleryListSchema, async (input) => {
    const includeDeleted = input?.include_deleted ?? false;
    const search = input?.search?.trim();
    const albumId = input?.album_id;

    // 若按相册筛选，先取相册；相册不存在（已删）→ 直接空列表，避免退化成"全部图"
    let album: AlbumRow | null = null;
    if (albumId !== undefined) {
      album =
        (getDb().prepare(`SELECT * FROM albums WHERE id = ?`).get(albumId) as
          | AlbumRow
          | undefined) ?? null;
      if (!album) return ok([]);
    }

    const where: string[] = [];
    const params: unknown[] = [];
    if (!includeDeleted) where.push('deleted_at IS NULL');
    if (search) {
      where.push('(prompt_positive LIKE ? OR notes LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (album?.type === 'manual') {
      // 手动相册：album_ids JSON 数组里精确含此 id（json_each 避免 "1" 误配 "10"）
      where.push(
        `album_ids IS NOT NULL AND json_valid(album_ids) AND EXISTS (SELECT 1 FROM json_each(images.album_ids) WHERE json_each.value = ?)`
      );
      params.push(albumId);
    } else if (album?.type === 'smart') {
      // 智能相册：smart_rules 实时匹配（标量进 SQL，tags 用 json_each 逐个 AND）
      let rules: SmartAlbumRules = {};
      if (album.smart_rules) {
        try {
          rules = JSON.parse(album.smart_rules) as SmartAlbumRules;
        } catch {
          rules = {};
        }
      }
      if (typeof rules.minRating === 'number') {
        where.push('rating >= ?');
        params.push(rules.minRating);
      }
      if (Array.isArray(rules.models) && rules.models.length > 0) {
        where.push(`model_used IN (${rules.models.map(() => '?').join(', ')})`);
        params.push(...rules.models);
      }
      if (rules.dateFrom) {
        where.push('created_at >= ?');
        params.push(rules.dateFrom);
      }
      if (rules.dateTo) {
        where.push('created_at <= ?');
        params.push(rules.dateTo);
      }
      if (Array.isArray(rules.tags)) {
        for (const tag of rules.tags) {
          where.push(
            `tags IS NOT NULL AND json_valid(tags) AND EXISTS (SELECT 1 FROM json_each(images.tags) WHERE json_each.value = ?)`
          );
          params.push(tag);
        }
      }
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = getDb()
      .prepare(`SELECT * FROM images ${whereSql} ORDER BY id DESC LIMIT 500`)
      .all(...params) as Array<Record<string, unknown> & {
      id: number;
      file_path: string;
      thumbnail_path: string | null;
    }>;

    // Lazy backfill：扫一遍当前 500 张，没缩略图（DB 字段空，或字段在但文件被删）
    // 的入后台队列；本次响应不等它跑完，前端先用原图渲染，下次刷新就有缩略图了。
    const db = getDb();
    for (const row of rows) {
      const expected = thumbPathFor(row.file_path);
      const dbHas = !!row.thumbnail_path;
      const fileHas = existsSync(expected);

      if (fileHas && !dbHas) {
        // 缩略图文件在，但 DB 没记 —— 直接回填字段
        db.prepare(`UPDATE images SET thumbnail_path = ? WHERE id = ?`).run(expected, row.id);
        row.thumbnail_path = expected;
        continue;
      }
      if (!fileHas && existsSync(row.file_path)) {
        // 缩略图缺、原图在 —— 排队补
        const id = row.id;
        enqueueBackfill({
          imageId: id,
          originalPath: row.file_path,
          onDone: (thumbPath) => {
            if (!thumbPath) return;
            try {
              db.prepare(`UPDATE images SET thumbnail_path = ? WHERE id = ?`).run(thumbPath, id);
            } catch {
              /* ignore */
            }
          }
        });
      }
    }

    return ok(rows);
  });

  register('api:gallery:detail', z.number().int(), async (id) => {
    // 软删除是默认：已软删的图不应再能按 id 直查出来（与列表查询一致）
    const row = getDb()
      .prepare(`SELECT * FROM images WHERE id = ? AND deleted_at IS NULL`)
      .get(id);
    if (!row)
      return err(makeError('FILE_NOT_FOUND', '图片不存在', { severity: 'toast' }));
    return ok(row);
  });

  /**
   * 批量探测一组 image id 的本地文件是否仍在(支持「批量选择无关联卡片」)。
   * 返回数据库里 file_path 字段指向的文件**不存在**的 id 清单。
   */
  register(
    'api:gallery:probe-missing-files',
    z.object({ ids: z.array(z.number().int()).min(1).max(5000) }),
    async (input) => {
      const ph = input.ids.map(() => '?').join(',');
      const rows = getDb()
        .prepare(`SELECT id, file_path FROM images WHERE id IN (${ph})`)
        .all(...input.ids) as Array<{ id: number; file_path: string | null }>;
      const missing: number[] = [];
      for (const r of rows) {
        if (!r.file_path || !existsSync(r.file_path)) missing.push(r.id);
      }
      return ok({ missing });
    }
  );

  /**
   * 「同时删除本地文件」批量删除 —— 直接物理 unlink + 从 images 表硬删除该行。
   * 不存在的文件 silent skip。返回 { deletedIds, fileDeleted, fileMissing }。
   */
  register(
    'api:gallery:batch-delete-with-files',
    z.object({ ids: z.array(z.number().int()).min(1).max(5000) }),
    async (input) => {
      const ph = input.ids.map(() => '?').join(',');
      const rows = getDb()
        .prepare(
          `SELECT id, file_path, thumbnail_path FROM images WHERE id IN (${ph})`
        )
        .all(...input.ids) as Array<{
        id: number;
        file_path: string | null;
        thumbnail_path: string | null;
      }>;
      // 先在事务里清外键引用 + 物理删 DB 行：foreign_keys=ON，images 被
      //   albums.cover_image_id（可空）与 image_versions.image_id（NOT NULL）引用，
      //   不先解开会触发 FK 约束报错。先删 DB 再删文件——这样 DB 失败时整体回滚、
      //   文件原样保留，绝不出现"文件没了但 DB 行还在"的反向丢失。
      const db = getDb();
      const delTx = db.transaction((ids: number[]) => {
        const p = ids.map(() => '?').join(',');
        db.prepare(`UPDATE albums SET cover_image_id = NULL WHERE cover_image_id IN (${p})`).run(
          ...ids
        );
        db.prepare(`DELETE FROM image_versions WHERE image_id IN (${p})`).run(...ids);
        db.prepare(`DELETE FROM images WHERE id IN (${p})`).run(...ids);
      });
      delTx(input.ids);

      // DB 已提交，再删本地文件（文件删失败只会留下无主文件，不影响一致性）
      let fileDeleted = 0;
      let fileMissing = 0;
      for (const r of rows) {
        for (const p of [r.file_path, r.thumbnail_path]) {
          if (!p) continue;
          if (existsSync(p)) {
            try {
              await unlink(p);
              fileDeleted++;
            } catch {
              /* ignore */
            }
          } else {
            fileMissing++;
          }
        }
      }
      return ok({
        deletedIds: rows.map((r) => r.id),
        fileDeleted,
        fileMissing
      });
    }
  );

  register('api:gallery:update', GalleryUpdateSchema, async (input) => {
    const allowed = ['rating', 'notes', 'tags', 'album_ids', 'deleted_at'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(input.patch)) {
      if (!allowed.includes(k)) continue;
      sets.push(`${k} = ?`);
      vals.push(typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
    }
    if (sets.length === 0) return ok(true as const);
    vals.push(input.id);
    getDb().prepare(`UPDATE images SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return ok(true as const);
  });

  // ─── prompts ───
  register(
    'api:prompt:list',
    z.object({ category_slug: z.string().optional() }).optional(),
    async (input) => {
      const slug = input?.category_slug;
      let rows: Array<Record<string, unknown>>;
      if (slug && slug !== 'all') {
        rows = getDb()
          .prepare(
            `SELECT p.* FROM prompts p
             LEFT JOIN prompt_categories c ON p.category_id = c.id
             WHERE p.deleted_at IS NULL AND c.slug = ?
             ORDER BY p.id DESC`
          )
          .all(slug) as Array<Record<string, unknown>>;
      } else {
        rows = getDb()
          .prepare(`SELECT * FROM prompts WHERE deleted_at IS NULL ORDER BY id DESC`)
          .all() as Array<Record<string, unknown>>;
      }
      // 给每条 prompt 拼上"第一张关联图"的缩略图（没有就回退原图）
      // 过滤软删除：关联图被删后不应再显示它的缩略图
      const lookup = getDb().prepare(
        `SELECT file_path, thumbnail_path FROM images WHERE id = ? AND deleted_at IS NULL`
      );
      for (const row of rows) {
        const ridsRaw = (row.related_image_ids as string | null) ?? '[]';
        let ids: number[] = [];
        try {
          ids = JSON.parse(ridsRaw) as number[];
        } catch {
          /* ignore */
        }
        let thumbPath: string | null = null;
        for (const id of ids) {
          const r = lookup.get(id) as
            | { file_path: string; thumbnail_path: string | null }
            | undefined;
          if (r?.file_path) {
            // 优先缩略图，否则回退原图；缩略图文件实际存在性由前端 onError 兜底
            thumbPath = r.thumbnail_path || r.file_path;
            break;
          }
        }
        row.thumb_file_path = thumbPath;
      }
      return ok(rows);
    }
  );

  register('api:prompt:upsert', PromptUpsertSchema, async (input) => {
    const now = new Date().toISOString();
    const tags = JSON.stringify(input.tags ?? []);
    const related = JSON.stringify(input.related_image_ids ?? []);

    if (input.id !== undefined) {
      // 编辑：thumb_data_uri 没显式传时不动它（保留原来的）
      if (input.thumb_data_uri !== undefined) {
        getDb()
          .prepare(
            `UPDATE prompts SET title=?, text=?, negative_text=?, kind=?, category_id=?, tags=?, notes=?, related_image_ids=?, thumb_data_uri=?, updated_at=?
              WHERE id = ?`
          )
          .run(
            input.title,
            input.text,
            input.negative_text ?? null,
            input.kind ?? 'image',
            input.category_id ?? null,
            tags,
            input.notes ?? null,
            related,
            input.thumb_data_uri,
            now,
            input.id
          );
      } else {
        getDb()
          .prepare(
            `UPDATE prompts SET title=?, text=?, negative_text=?, kind=?, category_id=?, tags=?, notes=?, related_image_ids=?, updated_at=?
              WHERE id = ?`
          )
          .run(
            input.title,
            input.text,
            input.negative_text ?? null,
            input.kind ?? 'image',
            input.category_id ?? null,
            tags,
            input.notes ?? null,
            related,
            now,
            input.id
          );
      }
      const row = getDb().prepare(`SELECT * FROM prompts WHERE id = ?`).get(input.id);
      return ok(row);
    }
    const r = getDb()
      .prepare(
        `INSERT INTO prompts(title, text, negative_text, kind, category_id, tags, notes, related_image_ids, thumb_data_uri, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.title,
        input.text,
        input.negative_text ?? null,
        input.kind ?? 'image',
        input.category_id ?? null,
        tags,
        input.notes ?? null,
        related,
        input.thumb_data_uri ?? null,
        now,
        now
      );
    const row = getDb().prepare(`SELECT * FROM prompts WHERE id = ?`).get(r.lastInsertRowid);
    return ok(row);
  });

  register('api:prompt:delete', z.number().int(), async (id) => {
    // 软删除
    getDb()
      .prepare(`UPDATE prompts SET deleted_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
    return ok(true as const);
  });

  register('api:prompt:category:list', null, async () => {
    const rows = getDb()
      .prepare(`SELECT * FROM prompt_categories ORDER BY sort_order, id`)
      .all() as PromptCategory[];
    return ok(rows);
  });

  // ─── albums ───
  register('api:album:list', null, async () => {
    const rows = getDb().prepare(`SELECT * FROM albums ORDER BY id DESC`).all() as AlbumRow[];
    // smart_rules 在 DB 里是 JSON 字符串，出口处解析成对象，前端直接用
    return ok(
      rows.map((r) => ({
        ...r,
        smart_rules: r.smart_rules ? safeParseRules(r.smart_rules) : null
      }))
    );
  });

  register('api:album:delete', z.number().int(), async (id) => {
    getDb().prepare(`DELETE FROM albums WHERE id = ?`).run(id);
    return ok(true as const);
  });

  register('api:album:upsert', AlbumUpsertSchema, async (input) => {
    const now = new Date().toISOString();
    const rules = input.smart_rules ? JSON.stringify(input.smart_rules) : null;
    // 出口与 album:list 保持一致：smart_rules 解析成对象再返回（契约是 SmartAlbumRules，不是 JSON 串）
    const fetchParsed = (id: number | bigint): unknown => {
      const a = getDb().prepare(`SELECT * FROM albums WHERE id=?`).get(id) as AlbumRow | undefined;
      return a ? { ...a, smart_rules: a.smart_rules ? safeParseRules(a.smart_rules) : null } : a;
    };
    if (input.id !== undefined) {
      getDb()
        .prepare(
          `UPDATE albums SET name=?, type=?, smart_rules=?, cover_image_id=? WHERE id=?`
        )
        .run(input.name, input.type, rules, input.cover_image_id ?? null, input.id);
      return ok(fetchParsed(input.id));
    }
    const r = getDb()
      .prepare(
        `INSERT INTO albums(name, type, smart_rules, cover_image_id, created_at) VALUES(?, ?, ?, ?, ?)`
      )
      .run(input.name, input.type, rules, input.cover_image_id ?? null, now);
    return ok(fetchParsed(r.lastInsertRowid));
  });
}
