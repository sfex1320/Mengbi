/**
 * 领域模型（DB 表对应的 TS 类型）。仅类型，不含运行时逻辑。
 */

export interface ApiPlan {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export type ApiConfigType = 'image' | 'text';

/**
 * 对话 / 多模态 API 协议生态：
 *   - 'openai'         OpenAI API 事实标准 — POST /v1/chat/completions
 *   - 'anthropic'      Anthropic Messages — POST /v1/messages（x-api-key + anthropic-version）
 *   - 'gemini'         Google Gemini — 用其 OpenAI 兼容入口 /v1beta/openai/chat/completions
 *   - 'openai-compat'  OpenAI 兼容服务器（vLLM / Ollama / 各类中转）—— 路径同 OpenAI，行为略有差异
 *   - null             "未指定"，按 openai 默认
 *
 * 历史 'kimi' / 'minimax' / 'glm' / 'deepseek' 已合并入 'openai-compat'，旧数据兼容映射在 IPC 层完成。
 */
export type OfficialKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openai-compat'
  | null;

/**
 * 绘画 API 协议变种：
 *   - 'openai'   OpenAI 标准 /v1/images/generations + /v1/images/edits
 *   - 'grsai'    grsai 自有 /v1/draw/completions / /v1/draw/nano-banana
 *   - 'gemini'   Google Gemini 图像 /v1beta/models/<id>:generateContent（响应 inline_data）
 *   - 'openai-compat' OpenAI 兼容（柏拉图AI、各种中转站）
 *   - null       默认按 openai 走
 */
export type ImageKind = 'openai' | 'grsai' | 'gemini' | 'openai-compat' | null;

export interface ApiConfig {
  id: number;
  plan_id: number;
  type: ApiConfigType;
  provider_name: string;
  base_url: string;
  api_key_encrypted: string;
  /**
   * 解密后的明文 Key。仅在主进程 loadBundle 时回填，方便编辑表单预填。
   * 用户需求：本工具属于个人本地用，不需要对自己加密，落库仍走 safeStorage 加密以兼容生产打包。
   */
  api_key_plain: string;
  model_mapping: Record<string, string>;
  is_official: boolean;
  supports_web_search: boolean;
  supports_vision: boolean;
  official_kind: OfficialKind;
  image_kind: ImageKind;
  created_at: string;
}

/** 用户填写表单时使用的 DTO，含明文 Key 与可选 id（编辑时） */
export interface ApiConfigInput {
  id?: number;
  plan_id: number;
  type: ApiConfigType;
  provider_name: string;
  base_url: string;
  /** 仅在保存时由前端提交；落库时立即加密 */
  api_key_plain: string;
  model_mapping: Record<string, string>;
  is_official: boolean;
  supports_web_search: boolean;
  supports_vision: boolean;
  official_kind: OfficialKind;
  image_kind: ImageKind;
}

export interface PromptCategory {
  id: number;
  name: string;
  slug: string;
  is_builtin: boolean;
  sort_order: number;
  created_at: string;
}

export interface SettingsBundle {
  plans: ApiPlan[];
  configs: ApiConfig[];
  categories: PromptCategory[];
  /** 任意 key/value 设置 */
  prefs: Record<string, string>;
}
