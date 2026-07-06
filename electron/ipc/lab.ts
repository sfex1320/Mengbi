import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { register, ok, err, parseModelRef } from './helpers';
import { getDb } from '../services/db';
import { decryptString } from '../services/safeStorage';
import { joinApiUrl, httpStatusHint, isContentModeration, moderationHint } from '../services/apiUrl';
import { applyHeaderOverrides } from './headerOverrides';
import { makeError } from '@shared/error';
import { isMockMode } from './mocks/runtime';
import { logger } from '../services/logger';

/**
 * 实验室：当前实现 reverse / translate（+ history）。
 */

const TranslateSchema = z.object({
  text: z.string().min(1),
  direction: z.enum(['zh-to-en', 'en-to-zh'])
});

const ReverseSchema = z.object({
  imagePaths: z.array(z.string()).min(1).max(5),
  modelId: z.string().min(1),
  resultType: z.enum(['description', 'tags', 'style'])
});

// 通用视觉分析：自定义系统提示词 + 自定义指令，支持多图（切分/对稿节点的「元素检测 / 逐元素检错」用）。
// 返回原始文本（节点侧自行 extractJsonBlock + 解析），不固定 description/tags/style 三档。
const VisionAnalyzeSchema = z.object({
  imagePaths: z.array(z.string()).min(1).max(8),
  modelId: z.string().min(1),
  systemPrompt: z.string().min(1).max(20_000),
  instruction: z.string().max(20_000).optional()
});

export function registerLabHandlers(): void {
  register('api:lab:reverse', ReverseSchema, async (input) => {
    if (isMockMode()) {
      const result = mockReverse(input.resultType);
      logHistory('reverse', input, result);
      return ok({ result });
    }
    try {
      const cfg = findTextConfigByModel(input.modelId);
      if (!cfg) {
        return err(
          makeError(
            'NOT_IMPLEMENTED',
            `没找到模型「${input.modelId}」的对话配置，先在设置页加一个对话模型并把这个模型加到 model_mapping`,
            { severity: 'modal' }
          )
        );
      }
      const result = await runReverseOnce(cfg, input.imagePaths[0], input.resultType);
      logHistory('reverse', input, result);
      return ok({ result });
    } catch (e) {
      logger.error('lab.reverse failed', e);
      return err(
        makeError('API_FAILED', `反推失败：${(e as Error).message}`, { severity: 'modal' })
      );
    }
  });

  register('api:lab:vision-analyze', VisionAnalyzeSchema, async (input) => {
    if (isMockMode()) {
      return ok({ text: mockVisionAnalyze() });
    }
    try {
      const cfg = findTextConfigByModel(input.modelId);
      if (!cfg) {
        return err(
          makeError(
            'NOT_IMPLEMENTED',
            `没找到模型「${input.modelId}」的对话配置，先在设置页加一个多模态(vision)对话模型并把它加到 model_mapping`,
            { severity: 'modal' }
          )
        );
      }
      const text = await runVisionAnalyze(cfg, input.imagePaths, input.systemPrompt, input.instruction);
      return ok({ text });
    } catch (e) {
      logger.error('lab.visionAnalyze failed', e);
      return err(makeError('API_FAILED', `视觉分析失败：${(e as Error).message}`, { severity: 'modal' }));
    }
  });

  register('api:lab:translate', TranslateSchema, async (input) => {
    if (isMockMode()) {
      const result =
        input.direction === 'zh-to-en'
          ? `[mock translation EN] ${input.text.slice(0, 80)}`
          : `[mock 译文] ${input.text.slice(0, 80)}`;
      logHistory('translate', input, { result });
      return ok({ result });
    }
    return err(
      makeError(
        'NOT_IMPLEMENTED',
        '翻译需要先在设置页配置一个对话模型',
        { severity: 'modal' }
      )
    );
  });

  register(
    'api:lab:history',
    z.object({ operation_type: z.string().optional() }).optional(),
    async (input) => {
      const opType = input?.operation_type;
      const rows = opType
        ? getDb()
            .prepare(
              `SELECT * FROM prompt_lab_history WHERE operation_type = ? ORDER BY id DESC LIMIT 100`
            )
            .all(opType)
        : getDb()
            .prepare(`SELECT * FROM prompt_lab_history ORDER BY id DESC LIMIT 100`)
            .all();
      return ok(rows);
    }
  );
}

function logHistory(opType: string, input: unknown, output: unknown): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO prompt_lab_history(operation_type, input_data, output_data, created_at)
         VALUES(?, ?, ?, ?)`
      )
      .run(opType, JSON.stringify(input), JSON.stringify(output), new Date().toISOString());
  } catch (e) {
    logger.warn('lab history log failed', e);
  }
}

// ─────────────────────────────────────────────────────
// 真实反推：用 OpenAI 兼容多模态 + 系统提示直接出结果
// ─────────────────────────────────────────────────────

interface TextCfg {
  base_url: string;
  api_key_encrypted: string;
  actualModelId: string;
  header_overrides_json: string | null;
}

function findTextConfigByModel(modelDisplayId: string): TextCfg | null {
  const rows = getDb()
    .prepare(`SELECT * FROM api_configs WHERE type = 'text' ORDER BY id`)
    .all() as Array<{
    provider_name: string | null;
    base_url: string;
    api_key_encrypted: string;
    model_mapping: string;
    header_overrides_json: string | null;
  }>;
  type Row = (typeof rows)[number];
  // 模型标识可能是复合「中转站 / 名」或旧裸名
  const { provider, name } = parseModelRef(modelDisplayId);
  const mapOf = (r: Row): Record<string, string> => {
    try {
      return JSON.parse(r.model_mapping || '{}');
    } catch {
      return {};
    }
  };
  const build = (r: Row, actual: string): TextCfg => ({
    base_url: r.base_url,
    api_key_encrypted: r.api_key_encrypted,
    actualModelId: actual,
    header_overrides_json: r.header_overrides_json ?? null
  });
  if (provider) {
    for (const r of rows) {
      if ((r.provider_name ?? '').trim() !== provider) continue;
      const v = mapOf(r)[name];
      if (v) return build(r, v);
    }
  }
  for (const r of rows) {
    const v = mapOf(r)[name];
    if (v) return build(r, v);
  }
  return null;
}

const REVERSE_SYSTEM: Record<'description' | 'tags' | 'style', string> = {
  description:
    '你是图像描述助手。给定一张图片，用中文输出一段流畅、信息丰富的图像描述提示词，包含：主体、动作、姿态、服装/材质、场景、光线、镜头、色调、氛围。直接输出文本，不要 Markdown，不要列表。',
  tags:
    '你是图像反推助手。给定一张图片，输出 8-15 个中文逗号分隔的标签，覆盖主体、风格、构图、光线、色调、材质等关键视觉要素。仅输出标签本身，用中文逗号分隔。',
  style:
    '你是图像风格分析师。给定一张图片，简洁说明它的视觉风格 / 拍摄手法 / 配色 / 镜头 / 光线 / 后期。中文输出，控制在 200 字以内。'
};

const IMG_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

async function imagePathToDataUri(p: string): Promise<string> {
  if (p.startsWith('data:') || /^https?:\/\//i.test(p)) return p;
  const buf = await fs.readFile(p);
  const mime = IMG_MIME[path.extname(p).toLowerCase()] ?? 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function runReverseOnce(
  cfg: TextCfg,
  imagePath: string,
  resultType: 'description' | 'tags' | 'style'
): Promise<unknown> {
  const url = joinApiUrl(cfg.base_url, 'chat/completions');
  const apiKey = decryptString(cfg.api_key_encrypted);
  const dataUri = await imagePathToDataUri(imagePath);
  const sysPrompt = REVERSE_SYSTEM[resultType];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: applyHeaderOverrides(
        { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        cfg.header_overrides_json,
        { key: apiKey, model: cfg.actualModelId }
      ),
      body: JSON.stringify({
        model: cfg.actualModelId,
        stream: false,
        messages: [
          { role: 'system', content: sysPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请按要求分析这张图。' },
              { type: 'image_url', image_url: { url: dataUri } }
            ]
          }
        ]
      }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 内容审核（图片/文本被判敏感，如 MiniMax 1026）≠ 配置问题：给准确提示而非「检查 base_url」
      const hint = isContentModeration(text) ? moderationHint(res.status) : httpStatusHint(res.status);
      throw new Error(`HTTP ${res.status}（${hint}）：${text.slice(0, 200)}`);
    }
    const text = await res.text();
    let json: { choices?: Array<{ message?: { content?: string } }> } | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      // SSE 兜底：抽 delta.content
      let assembled = '';
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
          };
          assembled +=
            j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
        } catch {
          /* ignore */
        }
      }
      json = { choices: [{ message: { content: assembled } }] };
    }
    const out = json?.choices?.[0]?.message?.content?.trim() ?? '';
    if (!out) throw new Error('上游没返回内容');

    if (resultType === 'tags') {
      const tags = out
        .split(/[,，;；\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return { tags };
    }
    return { text: out };
  } finally {
    clearTimeout(timer);
  }
}

/** 从「可能是 JSON、也可能是 SSE 流」的响应文本里抽出 assistant 正文。 */
function chatContentFromResponseText(text: string): string {
  let json: { choices?: Array<{ message?: { content?: string } }> } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    let assembled = '';
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
        };
        assembled += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? '';
      } catch {
        /* ignore */
      }
    }
    json = { choices: [{ message: { content: assembled } }] };
  }
  return json?.choices?.[0]?.message?.content?.trim() ?? '';
}

/** 通用视觉分析：自定义 system + instruction，支持多图，返回原始文本。 */
async function runVisionAnalyze(
  cfg: TextCfg,
  imagePaths: string[],
  systemPrompt: string,
  instruction?: string
): Promise<string> {
  const url = joinApiUrl(cfg.base_url, 'chat/completions');
  const apiKey = decryptString(cfg.api_key_encrypted);
  const dataUris = await Promise.all(imagePaths.map(imagePathToDataUri));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: applyHeaderOverrides(
        { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        cfg.header_overrides_json,
        { key: apiKey, model: cfg.actualModelId }
      ),
      body: JSON.stringify({
        model: cfg.actualModelId,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction || '请按要求分析这张图，只输出 JSON。' },
              ...dataUris.map((u) => ({ type: 'image_url', image_url: { url: u } }))
            ]
          }
        ]
      }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const hint = isContentModeration(text) ? moderationHint(res.status) : httpStatusHint(res.status);
      throw new Error(`HTTP ${res.status}（${hint}）：${text.slice(0, 200)}`);
    }
    const out = chatContentFromResponseText(await res.text());
    if (!out) throw new Error('上游没返回内容');
    return out;
  } finally {
    clearTimeout(timer);
  }
}

function mockVisionAnalyze(): string {
  return JSON.stringify([
    { label: '主体', box: [0.1, 0.1, 0.5, 0.6], prompt: '画面主体', ok: true, issue_types: [], severity: 'ok' },
    {
      label: '左手',
      box: [0.55, 0.4, 0.15, 0.2],
      prompt: '一只手',
      ok: false,
      issue_types: ['shape'],
      severity: 'high',
      description: '手部只有 4 根手指',
      suggestion: '重绘为 5 指正常手部'
    }
  ]);
}

function mockReverse(type: 'description' | 'tags' | 'style'): unknown {
  switch (type) {
    case 'description':
      return {
        text: '一位身穿白色 T 恤的女子站在树林中，柔和的午后光线穿过树叶在她身上洒下斑驳光影，景深虚化背景突出人物，画面整体呈现温暖怀旧的胶片质感。'
      };
    case 'tags':
      return { tags: ['人像', '户外', '树林', '白T', '胶片质感', '柔光', '景深', '暖色调'] };
    case 'style':
      return { text: '胶片摄影风格，色彩偏暖橘，构图为三分法竖构图，光线属于黄金时刻自然光' };
  }
}
