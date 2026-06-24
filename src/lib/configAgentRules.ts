/**
 * 模型配置智能体——规则模式分类 + 计划落成配置卡（纯函数）。
 * - classifyModelsDeterministic：无 LLM 时的回退，也作 LLM 计划的基线。对「带 supported_protocols 的中转」
 *   往往比 LLM 更准且免费。
 * - buildConfigsFromPlan：把 ConfigPlan 归并成 ≤3 张 ApiConfigInput（每类一张，丢 skip）。
 */
import type { ApiConfigInput, ImageKind, VideoKind } from '@shared/domain';
import { suggestVideoKind } from '@shared/domain';
import { detectProtocolFromUrl } from '@shared/protocolDetect';
import { protocolToOfficialKind } from '@/lib/relayProtocol';
import { detectModelCapabilities } from '@/lib/modelCapabilities';
import { modelKindOf } from '@/lib/modelKind';
import type { ConfigPlan, ConfigPlanModel } from '@/lib/configAgentPlan';

/** 绘画协议按地址猜（grsai/apimart/gemini/openai/其它兼容）。detectProtocolFromUrl 未覆盖 apimart，这里补上。 */
export function guessImageKind(baseUrl: string): ImageKind {
  if ((baseUrl ?? '').toLowerCase().includes('apimart')) return 'apimart';
  const d = detectProtocolFromUrl(baseUrl);
  return d?.imageKind ?? 'openai-compat';
}

/** 视频协议按地址 + 模型名猜，拿不准退 unified（聚合）。 */
export function guessVideoKind(baseUrl: string, modelId?: string): VideoKind {
  return suggestVideoKind(baseUrl, modelId) ?? 'unified';
}

/**
 * 规则模式分类。
 * 1. 有 supported_protocols 以它为准（protocolToOfficialKind）：messages→对话 anthropic；images→绘画；
 *    responses/原生 gemini（supported=false）→ skip。
 * 2. 无声明 → 按模型名 modelKindOf；对话的 official_kind 看 URL 线索（anthropic 域→anthropic）否则 openai-compat。
 */
export function classifyModelsDeterministic(
  models: string[],
  modelProtocols: Record<string, string[]> | undefined,
  baseUrl: string
): ConfigPlan {
  const urlHint = detectProtocolFromUrl(baseUrl);
  const imageKind = guessImageKind(baseUrl);
  const out: ConfigPlanModel[] = [];

  for (const id of models) {
    const protos = modelProtocols?.[id];
    if (protos && protos.length) {
      const m = protocolToOfficialKind(protos);
      if (m.badge === 'images') {
        out.push({ actualId: id, type: 'image', displayName: id, image_kind: imageKind, reason: '原生 images 协议' });
        continue;
      }
      if (m.supported && m.kind) {
        out.push({
          actualId: id,
          type: 'text',
          displayName: id,
          official_kind: m.kind,
          reason: `原生协议 ${m.badge ?? ''}`.trim()
        });
        continue;
      }
      // 不支持的对话协议（responses / 原生 gemini）
      out.push({ actualId: id, type: 'skip', displayName: id, reason: m.reason ?? '梦笔暂不支持该原生协议' });
      continue;
    }

    // 无协议声明 → 按模型名
    const kind = modelKindOf(id);
    if (kind === 'image') {
      out.push({ actualId: id, type: 'image', displayName: id, image_kind: imageKind, reason: '按模型名判断为绘图' });
    } else if (kind === 'video') {
      out.push({ actualId: id, type: 'video', displayName: id, video_kind: guessVideoKind(baseUrl, id), reason: '按模型名判断为视频' });
    } else if (kind === 'embedding' || kind === 'audio' || kind === 'rerank') {
      out.push({ actualId: id, type: 'skip', displayName: id, reason: `${kind} 模型，非对话/绘画/视频` });
    } else {
      out.push({ actualId: id, type: 'text', displayName: id, official_kind: urlHint?.kind ?? 'openai-compat', reason: '按模型名判断为对话' });
    }
  }

  const usable = out.filter((m) => m.type !== 'skip').length;
  return { summary: `规则模式：识别 ${usable} 个可用模型、跳过 ${out.length - usable} 个`, models: out };
}

export interface BuildConfigsCtx {
  planId: number;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  isOfficial: boolean;
  headerOverridesJson: string | null;
  icon?: string | null;
}

function emptyConfig(ctx: BuildConfigsCtx, type: 'text' | 'image' | 'video'): ApiConfigInput {
  return {
    plan_id: ctx.planId,
    type,
    provider_name: ctx.providerName,
    base_url: ctx.baseUrl,
    api_key_plain: ctx.apiKey,
    model_mapping: {},
    is_official: ctx.isOfficial,
    supports_web_search: false,
    supports_vision: false,
    official_kind: null,
    image_kind: null,
    video_kind: undefined,
    body_overrides_json: null,
    header_overrides_json: ctx.headerOverridesJson,
    comfyui_workflow_json: null,
    local_model_path: null,
    supports_thinking: false,
    thinking_effort: null,
    icon: ctx.icon ?? null
  };
}

function dedupName(mapping: Record<string, string>, name: string): string {
  let dn = name;
  let k = 2;
  while (mapping[dn] !== undefined) dn = `${name} (${k++})`;
  return dn;
}

export interface BuiltConfigs {
  configs: ApiConfigInput[];
  skipped: ConfigPlanModel[];
}

/** 把分类计划落成 ≤3 张 ApiConfigInput（每类一张，丢 skip；对话块能力用 detectModelCapabilities 补齐）。 */
export function buildConfigsFromPlan(plan: ConfigPlan, ctx: BuildConfigsCtx): BuiltConfigs {
  const byType: Record<'text' | 'image' | 'video', ConfigPlanModel[]> = { text: [], image: [], video: [] };
  const skipped: ConfigPlanModel[] = [];
  for (const m of plan.models) {
    if (m.type === 'skip') skipped.push(m);
    else byType[m.type].push(m);
  }

  const configs: ApiConfigInput[] = [];

  if (byType.text.length) {
    const cfg = emptyConfig(ctx, 'text');
    cfg.official_kind = byType.text.find((m) => m.official_kind)?.official_kind ?? null;
    for (const m of byType.text) cfg.model_mapping[dedupName(cfg.model_mapping, m.displayName)] = m.actualId;
    const caps = detectModelCapabilities(byType.text.map((m) => m.actualId));
    cfg.supports_vision = caps.vision;
    cfg.supports_thinking = caps.thinking;
    cfg.supports_web_search = caps.webSearch;
    cfg.thinking_effort = caps.thinking ? caps.thinkingEffort ?? 'high' : null;
    configs.push(cfg);
  }

  if (byType.image.length) {
    const cfg = emptyConfig(ctx, 'image');
    cfg.image_kind = byType.image.find((m) => m.image_kind)?.image_kind ?? guessImageKind(ctx.baseUrl);
    for (const m of byType.image) cfg.model_mapping[dedupName(cfg.model_mapping, m.displayName)] = m.actualId;
    configs.push(cfg);
  }

  if (byType.video.length) {
    const cfg = emptyConfig(ctx, 'video');
    cfg.video_kind = byType.video.find((m) => m.video_kind)?.video_kind ?? guessVideoKind(ctx.baseUrl);
    for (const m of byType.video) cfg.model_mapping[dedupName(cfg.model_mapping, m.displayName)] = m.actualId;
    configs.push(cfg);
  }

  return { configs, skipped };
}
