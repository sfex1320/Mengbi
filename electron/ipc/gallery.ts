import { z } from 'zod';
import { register, ok, err } from './helpers';
import { getDb } from '../services/db';
import { makeError } from '@shared/error';
import type { PromptCategory } from '@shared/domain';

const PromptUpsertSchema = z.object({
  id: z.number().int().optional(),
  title: z.string().min(1).max(200),
  text: z.string().min(1),
  negative_text: z.string().optional().nullable(),
  kind: z.enum(['image', 'video', 'qa', 'doc', 'favorite']).optional(),
  category_id: z.number().int().optional().nullable(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional().nullable(),
  related_image_ids: z.array(z.number().int()).optional()
});

const GalleryListSchema = z
  .object({
    category_slug: z.string().optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().optional(),
    include_deleted: z.boolean().optional()
  })
  .optional();

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

    const where: string[] = [];
    const params: unknown[] = [];
    if (!includeDeleted) where.push('deleted_at IS NULL');
    if (search) {
      where.push('(prompt_positive LIKE ? OR notes LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = getDb()
      .prepare(`SELECT * FROM images ${whereSql} ORDER BY id DESC LIMIT 500`)
      .all(...params);
    return ok(rows);
  });

  register('api:gallery:detail', z.number().int(), async (id) => {
    const row = getDb().prepare(`SELECT * FROM images WHERE id = ?`).get(id);
    if (!row)
      return err(makeError('FILE_NOT_FOUND', '图片不存在', { severity: 'toast' }));
    return ok(row);
  });

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
      // 给每条 prompt 拼上"第一张关联图"的 file_path 用作缩略图
      const lookup = getDb().prepare(`SELECT file_path FROM images WHERE id = ?`);
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
          const r = lookup.get(id) as { file_path: string } | undefined;
          if (r?.file_path) {
            thumbPath = r.file_path;
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
      const row = getDb().prepare(`SELECT * FROM prompts WHERE id = ?`).get(input.id);
      return ok(row);
    }
    const r = getDb()
      .prepare(
        `INSERT INTO prompts(title, text, negative_text, kind, category_id, tags, notes, related_image_ids, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    const rows = getDb().prepare(`SELECT * FROM albums ORDER BY id DESC`).all();
    return ok(rows);
  });

  register('api:album:upsert', AlbumUpsertSchema, async (input) => {
    const now = new Date().toISOString();
    const rules = input.smart_rules ? JSON.stringify(input.smart_rules) : null;
    if (input.id !== undefined) {
      getDb()
        .prepare(
          `UPDATE albums SET name=?, type=?, smart_rules=?, cover_image_id=? WHERE id=?`
        )
        .run(input.name, input.type, rules, input.cover_image_id ?? null, input.id);
      return ok(getDb().prepare(`SELECT * FROM albums WHERE id=?`).get(input.id));
    }
    const r = getDb()
      .prepare(
        `INSERT INTO albums(name, type, smart_rules, cover_image_id, created_at) VALUES(?, ?, ?, ?, ?)`
      )
      .run(input.name, input.type, rules, input.cover_image_id ?? null, now);
    return ok(getDb().prepare(`SELECT * FROM albums WHERE id=?`).get(r.lastInsertRowid));
  });
}
