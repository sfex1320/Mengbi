/**
 * 智能体规划层（impure，走 IPC）：把用户一句话 + 上下文 → 调文本模型 → 解析成蓝图。
 * 复用 api:chat:optimize-prompt 的「一发一收」非流式路径（systemPrompt 覆盖），零新 IPC。
 */
import { buildAgentSystemPrompt, type AgentPlanContextInfo } from '@/lib/agentCatalog';
import { parseBlueprint, type AgentBlueprint } from '@/lib/agentBlueprint';

export interface AgentPlanInput extends AgentPlanContextInfo {
  planId: number;
  /** 规划用的文本模型显示名（默认 = 当前方案首个可用文本模型，可被对话框覆盖） */
  textModel: string;
  userInput: string;
}

export interface AgentPlanResult {
  ok: boolean;
  spec?: AgentBlueprint;
  warnings: string[];
  reason?: string;
}

/**
 * 通用「一发一收」文本模型调用（agentOptimize 选区诊断复用同一条免费通道，零新 IPC）。
 * 之前是本文件私有的 callPlanner，为复用改为导出。
 */
export async function callAgentTextModel(
  planId: number,
  modelId: string,
  userInput: string,
  systemPrompt: string
): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const r = await window.electronAPI.chat.optimizePrompt({ planId, modelId, userInput, systemPrompt });
  if (!r.ok) return { ok: false, reason: [r.error.message, r.error.hint].filter(Boolean).join(' · ') };
  // optimizedBy=null 表示后端回退了原文（上游超时/报错/空响应/模型不支持）→ 不是有效规划
  if (r.data.optimizedBy === null) {
    return { ok: false, reason: r.data.reason ? `上游报错：${r.data.reason}` : '模型未返回规划结果（可能超时或不支持该模型）' };
  }
  return { ok: true, text: r.data.optimized };
}

/** 规划一张节点图：一次 LLM 调用；解析失败再做一次「只输出 JSON」严格重试。 */
export async function planGraph(input: AgentPlanInput): Promise<AgentPlanResult> {
  const sys = buildAgentSystemPrompt(input);
  const a = await callAgentTextModel(input.planId, input.textModel, input.userInput, sys);
  if (!a.ok) return { ok: false, warnings: [], reason: a.reason };

  let parsed = parseBlueprint(a.text ?? '');
  if (!parsed.ok) {
    const b = await callAgentTextModel(
      input.planId,
      input.textModel,
      `${input.userInput}\n\n（上次输出无法解析为 JSON）请严格只输出符合规范的 JSON，不要任何解释、不要 markdown 围栏。`,
      sys
    );
    if (!b.ok) return { ok: false, warnings: [], reason: b.reason };
    parsed = parseBlueprint(b.text ?? '');
  }
  if (!parsed.ok) return { ok: false, warnings: parsed.warnings, reason: parsed.reason ?? '无法解析规划结果' };

  return { ok: true, spec: parsed.spec, warnings: parsed.warnings };
}

export type { AgentBlueprint };
