import type { OfficialKind } from '@shared/domain';

/**
 * 「按模型原生协议路由」的中转站（如 openmodel.ai）在 /models 里给每个模型标 supported_protocols。
 * 这里把上游协议映射成梦笔「对话 API 协议」(official_kind)，用于指派模型时自动回填/提示。
 *
 * 当前梦笔对话只实现两条路径（见 electron/ipc/chat.ts）：
 *   - official_kind==='anthropic' → POST /v1/messages（Anthropic Messages）
 *   - 其余（openai/openai-compat/gemini/local/null）→ POST /v1/chat/completions（OpenAI 兼容）
 * 因此 messages 类可直接用（anthropic）；gemini 原生 / OpenAI Responses 暂无对话适配，明确标注不支持。
 */
export interface ProtocolMatch {
  /** 建议的对话 API 协议；无合适项时为 null */
  kind: OfficialKind | null;
  /** 梦笔对话是否支持驱动该协议 */
  supported: boolean;
  /** 不支持 / 需注意时的中文原因 */
  reason?: string;
  /** 给 chip 的简短协议徽章文案 */
  badge?: string;
}

/** 归一化协议名（小写、去空白、连字符/下划线统一）。 */
function norm(p: string): string {
  return p.trim().toLowerCase().replace(/[\s_-]+/g, '-');
}

/**
 * 由模型的 supported_protocols 推断对话协议。空数组/未知 → 当作普通 OpenAI 兼容。
 * 优先级：messages > responses(不支持) > gemini(不支持) > images(非对话) > openai 兼容。
 */
export function protocolToOfficialKind(protocols: string[] | undefined): ProtocolMatch {
  const set = new Set((protocols ?? []).map(norm));

  if (set.has('messages') || set.has('anthropic')) {
    return { kind: 'anthropic', supported: true, badge: 'messages' };
  }
  if (set.has('responses')) {
    return {
      kind: null,
      supported: false,
      reason: '该模型走 OpenAI Responses 协议，梦笔对话暂不支持（无法在对话里使用）',
      badge: 'responses'
    };
  }
  if (set.has('gemini')) {
    return {
      kind: 'gemini',
      supported: false,
      reason: '该模型为原生 Gemini 协议；梦笔的 Gemini 走 OpenAI 兼容入口，本站不提供该入口时无法在对话里使用',
      badge: 'gemini'
    };
  }
  if (set.has('images') || set.has('image')) {
    return {
      kind: null,
      supported: false,
      reason: '这是绘图模型（images 协议），不是对话模型',
      badge: 'images'
    };
  }
  // 含 chat / chat_completions / completions，或没有任何声明 → 普通 OpenAI 兼容
  return {
    kind: 'openai-compat',
    supported: true,
    badge: set.size ? [...set][0] : undefined
  };
}
