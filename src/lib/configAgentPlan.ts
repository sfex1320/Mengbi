/**
 * 模型配置智能体——LLM 输出的「配置计划」类型与解析（纯函数）。
 * 解析容错：去 markdown 围栏、截首个平衡 JSON 块、校验枚举（非法→null/skip），永不抛。
 * LLM 计划与规则回退（configAgentRules）产出同一 ConfigPlan，下游统一消费。
 */
import { extractJsonBlock } from '@/lib/jsonPrompt';
import type { OfficialKind, ImageKind, VideoKind } from '@shared/domain';

export type ConfigModelType = 'text' | 'image' | 'video' | 'skip';

export interface ConfigPlanModel {
  actualId: string;
  type: ConfigModelType;
  displayName: string;
  official_kind?: OfficialKind; // type=text
  image_kind?: ImageKind; // type=image
  video_kind?: VideoKind; // type=video
  reason?: string;
}

export interface ConfigPlan {
  summary: string;
  models: ConfigPlanModel[];
}

// 合法枚举（comfyui 不在自动配置范围——需手填 workflow，故 image_kind 不收 comfyui）
const OFFICIAL_KINDS = new Set(['openai', 'anthropic', 'gemini', 'openai-compat', 'local']);
const IMAGE_KINDS = new Set(['openai', 'grsai', 'apimart', 'gemini', 'openai-compat', 'openai-responses']);
const VIDEO_KINDS = new Set(['kling', 'sora', 'unified', 'seedance', 'veo', 'runway', 'fal', 'custom']);

function coerceOfficial(v: unknown): OfficialKind {
  return typeof v === 'string' && OFFICIAL_KINDS.has(v) ? (v as OfficialKind) : null;
}
function coerceImage(v: unknown): ImageKind {
  return typeof v === 'string' && IMAGE_KINDS.has(v) ? (v as ImageKind) : null;
}
function coerceVideo(v: unknown): VideoKind {
  return typeof v === 'string' && VIDEO_KINDS.has(v) ? (v as VideoKind) : null;
}

export interface ParsedConfigPlan {
  ok: boolean;
  plan?: ConfigPlan;
  reason?: string;
}

/** 解析 LLM 输出的配置计划 JSON。永不抛；失败给 reason。 */
export function parseConfigPlan(text: string): ParsedConfigPlan {
  const block = extractJsonBlock(text ?? '');
  if (!block) return { ok: false, reason: '空输出' };
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch {
    return { ok: false, reason: '无法解析为 JSON' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'JSON 顶层不是对象' };
  const o = raw as Record<string, unknown>;
  const modelsRaw = Array.isArray(o.models) ? (o.models as unknown[]) : null;
  if (!modelsRaw) return { ok: false, reason: '缺少 models 数组' };

  const models: ConfigPlanModel[] = [];
  for (const m of modelsRaw) {
    if (!m || typeof m !== 'object') continue;
    const mm = m as Record<string, unknown>;
    const actualId = typeof mm.actualId === 'string' ? mm.actualId.trim() : '';
    if (!actualId) continue;
    let type: ConfigModelType = typeof mm.type === 'string' ? (mm.type as ConfigModelType) : 'skip';
    if (type !== 'text' && type !== 'image' && type !== 'video') type = 'skip';
    models.push({
      actualId,
      type,
      displayName:
        typeof mm.displayName === 'string' && mm.displayName.trim() ? mm.displayName.trim() : actualId,
      official_kind: type === 'text' ? coerceOfficial(mm.official_kind) : undefined,
      image_kind: type === 'image' ? coerceImage(mm.image_kind) : undefined,
      video_kind: type === 'video' ? coerceVideo(mm.video_kind) : undefined,
      reason: typeof mm.reason === 'string' ? mm.reason : undefined
    });
  }
  if (models.length === 0) return { ok: false, reason: 'models 为空' };
  return { ok: true, plan: { summary: typeof o.summary === 'string' ? o.summary : '', models } };
}
