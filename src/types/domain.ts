/**
 * 领域模型（DB 表对应的 TS 类型）。仅类型，不含运行时逻辑。
 */

export interface ApiPlan {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export type ApiConfigType = 'image' | 'text' | 'video';

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
  | 'local'
  | null;

/**
 * 绘画 API 协议变种：
 *   - 'openai'   OpenAI 标准 /v1/images/generations + /v1/images/edits
 *   - 'grsai'    grsai 自有异步协议（v2：POST /v1/api/generate → GET /v1/api/result?id=xxx）
 *   - 'apimart'  apimart 异步协议（POST /v1/images/generations 返 task_id → GET /v1/tasks/{id}）
 *   - 'gemini'   Google Gemini 图像 /v1beta/models/<id>:generateContent（响应 inline_data）
 *   - 'openai-compat' OpenAI 兼容（柏拉图AI、各种中转站）
 *   - 'openai-responses' OpenAI Responses API（POST /v1/responses + tools.image_generation
 *                      SSE 流式 + partial_images 心跳，用于穿透中转 60s 边缘代理超时）
 *   - 'comfyui'  ComfyUI BYOW（用户粘贴 workflow JSON，梦笔做占位符替换 + POST /prompt + /history 轮询 + /view 拉图）
 *   - null       默认按 openai 走
 */
export type ImageKind =
  | 'openai'
  | 'grsai'
  | 'apimart'
  | 'gemini'
  | 'openai-compat'
  | 'openai-responses'
  | 'comfyui'
  | null;

/**
 * 视频生成 API 协议变种（几乎全异步：提交任务 → 轮询状态 → 取有时效的 mp4 URL → 下载落盘）：
 *   - 'kling'   可灵代理型（国内中转站最主流）：POST {base}/kling/v1/videos/{text2video|image2video}
 *               → 轮询 GET .../{task_id} → data.task_result.videos[0].url。字段 model_name/prompt/
 *               negative_prompt/cfg_scale/mode(std|pro)/aspect_ratio/duration/image/image_tail。
 *   - 'sora'    OpenAI Sora 原生：POST {base}/v1/videos（model/prompt/size/seconds/input_reference）
 *               → 轮询 GET /v1/videos/{id}（status queued/in_progress/completed）→ GET /v1/videos/{id}/content。
 *   - 'unified' 聚合站统一端点：POST {base}/video/generations（model 区分各家）→ 轮询 → video.url / data[0].url。
 *   - 'seedance' APIMart Seedance 2.0 等富能力 adapter：统一请求 → adapter 映射 7 模式（详见 @shared/videoProviders + electron/services/video）。
 *   - 'custom'  自定义中转站（基础预留，走通用解析）。
 *   - null      默认按 'kling'。
 * kling/sora/unified 走 electron/ipc/video.ts 内置简易引擎；seedance/custom 走 VideoProviderAdapter。
 * 各站字段差异用 body_overrides_json 顶层合并兜底（与 image 思路一致）。
 */
export type VideoKind = 'kling' | 'sora' | 'unified' | 'seedance' | 'veo' | 'runway' | 'fal' | 'custom' | null;

/** 合法 video_kind 白名单（单一真相，避免各处归一逻辑漂移）。 */
export const VIDEO_KINDS_LIST = ['kling', 'sora', 'unified', 'seedance', 'veo', 'runway', 'fal', 'custom'] as const;

/** 归一任意值为合法 VideoKind；非法 → null（运行时按默认 'kling' 兜底）。 */
export function normalizeVideoKind(v: unknown): VideoKind {
  return (VIDEO_KINDS_LIST as readonly string[]).includes(v as string) ? (v as VideoKind) : null;
}

/** 走 VideoProviderAdapter 的协议（其余 kling/sora/unified 走 legacy 简易引擎）。 */
export const ADAPTER_VIDEO_KINDS = ['seedance', 'veo', 'runway', 'fal', 'custom'] as const;

/**
 * 按 地址 / 真实模型 ID 推断更合适的视频协议（与生图 family 自动嗅探同哲学——别让用户背协议）。
 * 推断不出返回 null（尊重现配置）。
 */
export function suggestVideoKind(baseUrl: string, actualModelId?: string): VideoKind {
  const u = (baseUrl ?? '').toLowerCase();
  const m = (actualModelId ?? '').toLowerCase();
  // APIMart 全系视频走它自家 /v1/videos/generations（即 seedance 协议），与具体模型无关
  if (u.includes('apimart')) return 'seedance';
  // Seedance / 豆包视频模型只讲 seedance 协议（发到 kling/sora 端点必错）
  if (/seedance|doubao/.test(m)) return 'seedance';
  if (u.includes('runway')) return 'runway';
  if (/fal\.run|fal\.ai/.test(u)) return 'fal';
  return null;
}

/**
 * 运行时自动纠偏：用户显式选了 adapter 协议（seedance/veo/runway/fal/custom）则尊重；
 * 配置还停在 legacy（kling/sora/unified/空——多为旧默认值）但 地址/模型 明显是别家 → 自动切对的协议，
 * 免去「协议选错 → 提交进错端点 → 烧钱且取不回视频」。
 */
export function autoCorrectVideoKind(kind: VideoKind, baseUrl: string, actualModelId?: string): VideoKind {
  if (kind && (ADAPTER_VIDEO_KINDS as readonly string[]).includes(kind)) return kind;
  return suggestVideoKind(baseUrl, actualModelId) ?? kind;
}

/**
 * 思考模式（reasoning / thinking）强度：
 *   - 'low' / 'medium' / 'high' / 'max' —— 大致映射到各家的强度档位
 *   - null —— 不发字段，使用上游默认（如 Deepseek V4 默认 high）
 *
 * 各家映射（在 chat.ts 注入侧实现）：
 *   - openai-compat (Deepseek V4 / Kimi K1.5 / GLM-Z1)：发 thinking.reasoning_effort = effort
 *   - openai (o1/o3/o4)：发 reasoning_effort = effort
 *   - anthropic：把 effort 映射到 thinking.budget_tokens（low→1024 / medium→2048 / high→4096 / max→8192）
 *   - gemini：把 effort 映射到 thinkingConfig.thinkingBudget（同上数值范围）
 */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max' | null;

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
  /** 视频协议变种（仅 type='video' 用）；详见 [[VideoKind]]。null/缺省 = 'kling'。 */
  video_kind?: VideoKind;
  /**
   * 高级：每方案可保存一段 JSON 对象文本，会与默认请求体顶层合并发出。
   * `null` 值表示删除该字段；字符串值若为 `${var}` 整串占位则替换为变量真实类型。
   * 详细语义参见计划文件 1k-2k-validated-wreath.md，逻辑实现在 generate.ts:applyBodyOverrides。
   */
  body_overrides_json: string | null;
  /**
   * 高级：自定义请求头 JSON（header 名 → 值），在默认请求头之上合并发出。
   * 值支持 `${key}` / `${model}` 内嵌替换；值为 `null` 删除该 header（如换掉默认 Authorization）。
   * 用于官方卡密会员 / 特殊中转站需要非标准鉴权头的接入。对 对话/绘画/视频 各请求点都生效。
   * 逻辑见 electron/ipc/headerOverrides.ts:applyHeaderOverrides。null = 不覆盖。
   */
  header_overrides_json: string | null;
  /**
   * 仅 image_kind='comfyui' 用：用户从 ComfyUI 里"保存（API Format）"导出的 workflow JSON 字符串。
   * 运行时按占位符替换后 POST /prompt。详见 generate.ts:runComfyUIImage。
   */
  comfyui_workflow_json: string | null;
  /**
   * 仅 official_kind='local' 用：用户在文件选择器选定的 .gguf 模型文件本地路径。
   * 主进程 chat 流程发现这条非空 → 启动内嵌 llama-cpp 服务并指向该模型；
   * 若用户填了 base_url（已自行启动外部服务），优先 base_url。
   */
  local_model_path: string | null;
  /**
   * 思考模式开关：用户在方案配置勾选「启用思考模式」时为 true。
   * 主进程按 official_kind 决定发什么字段（详见 [[ThinkingEffort]] 注释和 chat.ts 注入逻辑）。
   * 上游不支持该字段时多数会忽略；少数会 400，由错误路径透出让用户取消勾选。
   */
  supports_thinking: boolean;
  /**
   * 思考强度档位；只有 supports_thinking=true 时才生效。null 时让上游用默认。
   */
  thinking_effort: ThinkingEffort;
  /**
   * 厂商图标：lobehub slug（'openai' / 'anthropic' / ...）或 data:image/... 自定义 dataURI；
   * null = 未指定 → UI 按 provider_name / base_url 自动猜一个回退。详见 src/lib/providerIcons.tsx。
   */
  icon: string | null;
  /**
   * 上次该中转「边缘代理硬超时」是多少秒（典型值 60 / 120 / 180）。
   * 由 generate.ts 在 isHardProxyTimeout 命中时自动写入；UI 用它做 pre-flight 估算提示。
   * null = 从未触发硬超时 → 不做任何额外提示，行为与旧版一致。
   */
  proxy_timeout_seconds: number | null;
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
  /** 视频协议变种（仅 type='video' 用）；null/缺省 = 'kling' */
  video_kind?: VideoKind;
  body_overrides_json: string | null;
  /** 高级：自定义请求头 JSON（header 名 → 值），合并进默认请求头；详见 ApiConfig.header_overrides_json */
  header_overrides_json: string | null;
  /** 仅 image_kind='comfyui' 用 —— ComfyUI workflow JSON 文本 */
  comfyui_workflow_json: string | null;
  /** 仅 official_kind='local' 用 —— 用户选的 .gguf 文件路径 */
  local_model_path: string | null;
  /** 是否启用思考模式（在方案配置里勾选） */
  supports_thinking: boolean;
  /** 思考强度（不勾启用思考时此字段不参与请求构造） */
  thinking_effort: ThinkingEffort;
  /** 厂商图标（lobehub slug 或 data:image dataURI）；null = 未指定 */
  icon: string | null;
  /** 上次边缘代理硬超时秒数；只读字段，UI 一般不让用户填，由主进程自动维护 */
  proxy_timeout_seconds?: number | null;
}

export interface PromptCategory {
  id: number;
  name: string;
  slug: string;
  is_builtin: boolean;
  sort_order: number;
  created_at: string;
}

/** 智能相册的匹配规则（全部可选，AND 关系；tags 要求全部命中）。 */
export interface SmartAlbumRules {
  /** 评分 ≥ 此值（0~5） */
  minRating?: number;
  /** 图片 tags 必须全部包含这些标签 */
  tags?: string[];
  /** model_used ∈ 此列表 */
  models?: string[];
  /** created_at ≥ 此 ISO 时间 */
  dateFrom?: string;
  /** created_at ≤ 此 ISO 时间 */
  dateTo?: string;
}

export interface Album {
  id: number;
  name: string;
  type: 'manual' | 'smart';
  /** 仅 type='smart' 有意义；api:album:list 出口已解析成对象 */
  smart_rules: SmartAlbumRules | null;
  cover_image_id: number | null;
  created_at: string;
}

export interface AlbumInput {
  id?: number;
  name: string;
  type: 'manual' | 'smart';
  smart_rules?: SmartAlbumRules | null;
  cover_image_id?: number | null;
}

export interface SettingsBundle {
  plans: ApiPlan[];
  configs: ApiConfig[];
  categories: PromptCategory[];
  /** 任意 key/value 设置 */
  prefs: Record<string, string>;
}
