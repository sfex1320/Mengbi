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
export type OfficialKind =
  | 'kimi'
  | 'minimax'
  | 'glm'
  | 'deepseek'
  | 'anthropic'
  | null;
/**
 * 绘画 API 协议变种：
 *   - null      → OpenAI 标准 `/v1/images/generations`
 *   - 'grsai'   → grsai 自有 `/v1/draw/completions`
 * 后续要接更多自有协议（火山方舟、即梦等）就在此扩展。
 */
export type ImageKind = 'grsai' | null;

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
