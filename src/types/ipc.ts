/**
 * IPC 通道契约。preload 会按这里暴露给渲染进程，主进程按这里实现 handler。
 * 命名规范：api:<domain>:<action>，详见 CLAUDE.md §4。
 */

import type { Result, AppErrorCode, ErrorSeverity } from './error';
import type { ApiPlan, ApiConfig, ApiConfigInput, SettingsBundle, Album, AlbumInput } from './domain';
import type {
  ComfyConnectionConfig,
  ComfyLaunchCandidate,
  ConnectionStatus,
  DetectResult,
  ImportResult,
  WorkflowTemplate,
  WorkflowTemplateSummary,
  RunSingleResult,
  RunBatchResult,
  ComfyRun,
  ComfyRunSummary,
  InputControl,
  OutputControl,
  Binding,
  LoopConfig,
  UiLayout
} from './comfyui';
import type { VideoGenerationRequest, VideoTaskStatusState } from './video';

/** preload 暴露给渲染进程的入口 */
export interface ElectronAPI {
  settings: SettingsAPI;
  plan: PlanAPI;
  chat: ChatAPI;
  image: ImageAPI;
  /** AI 视频生成（异步：提交→轮询→下载 mp4 落盘+入资产库） */
  video: VideoAPI;
  /** 视频插帧（本地 RIFE ncnn Vulkan：拆帧→AI 插帧→合帧） */
  interp: InterpAPI;
  gallery: GalleryAPI;
  prompt: PromptAPI;
  album: AlbumAPI;
  lab: LabAPI;
  theme: ThemeAPI;
  storage: StorageAPI;
  /** 网页预览抓取（外置提示词库封面自动获取，api:web:*） */
  web: WebAPI;
  /** 侧栏外部软件 / 文件夹快捷方式（api:shortcuts:*） */
  shortcuts: ShortcutsAPI;
  exporter: ExporterAPI;
  window: WindowAPI;
  drag: DragAPI;
  tools: ToolsAPI;
  /** 图像转矢量 v2：VTracer（彩色）/ Potrace（单色）/ OmniSVG（AI）三模式 */
  vec: VecAPI;
  upscale: UpscaleAPI;
  config: ConfigIOAPI;
  /** 智能画布节点模板（存 userData/node-templates/，api:template:*） */
  template: NodeTemplateAPI;
  llm: LocalLlmAPI;
  /** 画板 Photoshop 联动桥（api:ps:*） */
  ps: PsAPI;
  /** ComfyUI 通用工作流编排器（api:comfyui:*） */
  comfyui: ComfyuiAPI;
  /** 主进程 → 渲染进程 的事件订阅 */
  on(channel: PushChannel, handler: (payload: unknown) => void): () => void;
}

export interface ComfyuiAPI {
  getConfig(): Promise<Result<ComfyConnectionConfig>>;
  setConfig(input: {
    host?: string;
    launchCommand?: string;
    launchCwd?: string;
    authToken?: string | null;
  }): Promise<Result<{ saved: boolean }>>;
  detect(input?: { host?: string } | null): Promise<Result<DetectResult>>;
  scanLaunch(input: { dir: string }): Promise<Result<{ candidates: ComfyLaunchCandidate[] }>>;
  status(): Promise<Result<ConnectionStatus>>;
  start(): Promise<Result<{ pid: number | null }>>;
  stop(): Promise<Result<{ stopped: boolean }>>;
  import(input: { json: string }): Promise<Result<ImportResult>>;
  refreshObjectInfo(): Promise<Result<{ refreshed: boolean; nodeTypes: number }>>;
  templateList(): Promise<Result<WorkflowTemplateSummary[]>>;
  templateGet(input: { workflowId: string }): Promise<Result<WorkflowTemplate>>;
  templateUpsert(input: {
    workflowId?: string;
    name: string;
    typeTags?: string[];
    originalApiWorkflowJson: string;
    inputControls?: InputControl[];
    outputControls?: OutputControl[];
    bindings?: Binding[];
    uiLayout?: UiLayout | null;
  }): Promise<Result<{ workflowId: string }>>;
  templateDelete(input: { workflowId: string }): Promise<Result<{ deleted: boolean }>>;
  runSingle(input: {
    workflowId?: string;
    workflowJson?: string;
    controlValues?: Record<string, unknown>;
    controls?: InputControl[];
    bindings?: Binding[];
    outputNodeIds?: string[];
    /** true=输出图不进资产库（提示词商城缩略图生成用） */
    skipGallery?: boolean;
  }): Promise<Result<RunSingleResult>>;
  runBatch(input: {
    workflowId?: string;
    workflowJson?: string;
    controlValues?: Record<string, unknown>;
    controls?: InputControl[];
    bindings?: Binding[];
    outputNodeIds?: string[];
    loopConfig: LoopConfig;
  }): Promise<Result<RunBatchResult>>;
  freeMemory(input: {
    unloadModels?: boolean;
    freeMemory?: boolean;
  }): Promise<Result<{ requested: boolean }>>;
  cancel(input: { batchId?: string; runId?: string }): Promise<Result<{ cancelled: number }>>;
  skip(input: { runId: string }): Promise<Result<{ skipped: boolean }>>;
  pause(): Promise<Result<{ paused: boolean }>>;
  resume(): Promise<Result<{ paused: boolean }>>;
  runStatus(input: {
    batchId: string;
  }): Promise<Result<{ total: number; pending: number; running: number; done: number; failed: number }>>;
  resultsGet(input: { runId: string }): Promise<Result<ComfyRun>>;
  resultsList(input: {
    templateId?: string;
    batchId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Result<ComfyRunSummary[]>>;
  resultsRestore(input: { runId: string }): Promise<Result<{ controlValues: Record<string, unknown> }>>;
  resultsDelete(input: { runId?: string; batchId?: string }): Promise<Result<{ deleted: number }>>;
  resultsExport(input: { runIds: string[]; outputDir: string }): Promise<Result<{ copied: number }>>;
  resultsToGallery(input: { runIds: string[] }): Promise<Result<{ added: number }>>;
}

// ──────────────────────────────────────────────────────────
// ps.ts —— 画板 Photoshop 联动桥
// ──────────────────────────────────────────────────────────

export interface PsBridgeStatus {
  /** Photoshop 可执行文件路径；空 = 未设置（用系统默认程序打开） */
  photoshopPath: string;
  photoshopPathExists: boolean;
  /** 临时文件目录（空设置时为 userData/ps-bridge） */
  tempDir: string;
  /** 导回后是否保留临时文件 */
  keepTemp: boolean;
  /** 当前正在监听的临时文件路径 */
  watching: string[];
}

export interface PsAPI {
  /** 当前桥状态 */
  status(): Promise<Result<PsBridgeStatus>>;
  /** 更新桥配置（部分字段） */
  setConfig(input: {
    photoshopPath?: string;
    tempDir?: string;
    keepTemp?: boolean;
  }): Promise<Result<true>>;
  /** 把当前画布 PNG dataUri 写临时文件 → 打开 PS → 开始监听；返回临时路径 */
  send(input: {
    dataUri: string;
    suggestedName?: string;
  }): Promise<Result<{ tempPath: string; openedWith: 'photoshop' | 'system' }>>;
  /** 把 PS 保存后的临时文件读回 dataUri（仅限本桥跟踪过的路径） */
  readBack(input: { tempPath: string }): Promise<Result<{ dataUri: string }>>;
  /** 停止监听（tempPath 省略 = 全部）；按设置决定是否删临时文件 */
  stopWatch(input?: { tempPath?: string }): Promise<Result<true>>;
  /** 打开临时目录 */
  openTempDir(): Promise<Result<true>>;
}

/** 'ps:file-changed' push payload —— PS 中 Ctrl+S 后主进程检测到 mtime 前进 */
export interface PsFileChangedPayload {
  tempPath: string;
  mtimeMs: number;
}

export interface LocalLlmStatus {
  running: boolean;
  loading: boolean;
  modelPath: string | null;
  baseUrl: string | null;
}

export interface LocalLlmAPI {
  status(): Promise<Result<LocalLlmStatus>>;
  stop(): Promise<Result<true>>;
}

export interface ConfigIOSections {
  plans: boolean;
  appearance: boolean;
  prompts: boolean;
  /** 智能画布节点模板（userData/node-templates/ 下的 .json） */
  nodeTemplates: boolean;
}

export interface ConfigIOExportResult {
  savedPath: string | null;
  byteSize: number;
  cancelled: boolean;
}

export interface ConfigIOPreview {
  format: string;
  exportedAt: string;
  appVersion: string;
  counts: {
    plans: number;
    configs: number;
    themes: number;
    promptCategories: number;
    prompts: number;
    albums: number;
    settings: number;
    nodeTemplates: number;
  };
}

export interface ConfigIOImportStats {
  plansImported: number;
  configsImported: number;
  themesImported: number;
  promptCategoriesImported: number;
  promptsImported: number;
  albumsImported: number;
  settingsImported: number;
  nodeTemplatesImported: number;
}

export interface ConfigIOAPI {
  /** 加密导出 — 弹保存对话框；用户取消时 cancelled = true */
  export(input: {
    password: string;
    sections: ConfigIOSections;
  }): Promise<Result<ConfigIOExportResult>>;
  /** 仅校验密码 + 解密 + 报告条目数量；不写库 */
  preview(input: {
    filePath: string;
    password: string;
  }): Promise<Result<ConfigIOPreview>>;
  /** 真正导入并写入数据库 */
  import(input: {
    filePath: string;
    password: string;
    mergeStrategy: 'merge' | 'overwrite';
    sections: ConfigIOSections;
  }): Promise<Result<{ stats: ConfigIOImportStats }>>;
  /** 弹文件选择对话框 */
  pickImportFile(): Promise<Result<{ filePath: string | null }>>;
  /** 导出资产库图片到文件夹（复制图片 + 写 mengbi-images.json 清单） */
  exportImages(input: { dir: string }): Promise<Result<{ copied: number; missing: number; dir: string }>>;
  /** 扫描待导入文件夹（读清单报数量，不写库） */
  scanImageDir(input: { dir: string }): Promise<Result<{ count: number; exportedAt: string }>>;
  /** 从文件夹导入图片（恒追加 + 去重） */
  importImages(input: { dir: string }): Promise<Result<{ imported: number; skipped: number }>>;
}

// ──────────────────────────────────────────────────────────
// nodeTemplates.ts —— 智能画布节点模板（文件存储）
// ──────────────────────────────────────────────────────────

export interface NodeTemplateDTO {
  id: string;
  name: string;
  notes?: string;
  createdAt: string;
  count: number;
  nodes: unknown[];
  edges: unknown[];
}

export interface NodeTemplateAPI {
  list(): Promise<Result<{ templates: NodeTemplateDTO[] }>>;
  save(input: NodeTemplateDTO): Promise<Result<{ saved: true }>>;
  remove(input: { id: string }): Promise<Result<{ removed: true }>>;
  rename(input: { id: string; name: string }): Promise<Result<{ renamed: true }>>;
}

/** 主进程主动推送的频道（renderer 通过 on 监听） */
export type PushChannel =
  | 'chat:chunk'
  | 'chat:reasoning-chunk'
  | 'chat:done'
  | 'chat:sources'
  | 'image:done'
  | 'image:progress'
  | 'notification:append'
  | 'upscale:progress'
  | 'upscale:done'
  | 'upscale:install-progress'
  | 'upscale:onnx-download-progress'
  | 'vec:progress'
  | 'vec:batch-progress'
  | 'ps:file-changed'
  | 'comfyui:status'
  | 'comfyui:run-progress'
  | 'comfyui:run-done'
  | 'comfyui:queue'
  | 'video:progress'
  | 'video:done'
  | 'interp:progress'
  | 'interp:install-progress'
  | 'gallery:changed';

/**
 * chat:sources 推送 payload —— 代搜（DDG/Tavily/SearXNG）路径下，
 * 主进程在 stream 启动前把命中结果发出来；前端把这条挂在该轮 assistant 消息的"📎 参考来源"卡片里。
 */
export interface ChatSourcesPayload {
  id: string;
  backend: 'native' | 'ddg' | 'tavily' | 'searxng' | 'bocha' | 'zhipu' | 'jina' | 'serper' | 'off';
  hits: Array<{ title: string; url: string; snippet: string; hostname: string }>;
  /** 用户强制 🌐 联网但出问题时填上,前端弹 toast 让用户知道 */
  error?: string;
}

/**
 * 通知中心追加事件——由主进程统一在 helpers.ts 的 register() 包装层、
 * 以及 chat:done / image:done 的旁路推出。前端 notificationStore 订阅。
 * 仅"写动作"类操作会触发；读类（list/get/history/...）不会发。
 */
export interface NotificationAppendPayload {
  /** uuid，前端用来去重 / key */
  id: string;
  /** Date.now() */
  ts: number;
  /** IPC 通道名（如 api:image:generate）或推送通道名（如 image:done） */
  channel: string;
  /** 当前结果种类 */
  kind: 'success' | 'failure' | 'info';
  /** AppError.code（仅 kind=failure 时） */
  errorCode?: AppErrorCode;
  /** AppError.severity（仅 kind=failure 时） */
  severity?: ErrorSeverity;
  /** 用户可读消息：成功时通常省略，失败时为 AppError.message 或异步任务的 error 字段 */
  message?: string;
  /** AppError.hint（仅 kind=failure 时） */
  hint?: string;
  /** 仅异步任务（image:done / chat:done）携带，便于把"提交"和"完成"两条记录关联 */
  taskId?: number;
  /** 仅 chat:done 携带，链接 messageId */
  refId?: string;
  /** 失败可一键修复时携带：前端通知中心据此显示「一键修复」按钮（如给某绘画模型加 {"stream":false}） */
  remedy?: NotificationRemedy;
}

/**
 * 一键修复建议：把某绘画模型配置的「请求体覆盖 / 请求头覆盖」合并补一段，绕过中转站的字段/协议差异。
 * 由主进程在任务失败时按错误模式生成，前端通知中心一键应用（api:settings:apply-overrides）。
 */
export interface NotificationRemedy {
  /** 按钮文案（如「改用非流式返回」） */
  label: string;
  /** 一句话说明这条修复做什么（按钮 title / 说明） */
  detail?: string;
  /** 目标绘画模型显示名/复合标识（中转站 / 名） */
  modelId: string;
  /** 合并进 body_overrides_json 的片段（值为 null 表示删除该字段） */
  bodyMerge?: Record<string, unknown>;
  /** 合并进 header_overrides_json 的片段 */
  headerMerge?: Record<string, unknown>;
}

export interface ApplyOverridesInput {
  modelId: string;
  bodyMerge?: Record<string, unknown>;
  headerMerge?: Record<string, unknown>;
}

export interface ApplyOverridesResult {
  /** 被改动的配置 id */
  configId: number;
  /** 中转站名（提示用） */
  providerName: string;
  /** 合并后的 body 覆盖 JSON（回显） */
  bodyOverrides: string | null;
}

// ──────────────────────────────────────────────────────────
// settings.ts
// ──────────────────────────────────────────────────────────

export interface SettingsAPI {
  get(): Promise<Result<SettingsBundle>>;
  save(input: SaveSettingsInput): Promise<Result<SettingsBundle>>;
  testConnection(input: TestConnectionInput): Promise<Result<TestConnectionResult>>;
  /** 真实发一次最小调用，验证「地址 + Key + 协议 + 请求体/请求头」整套是否能跑（捕获 response_format 等字段被拒）。 */
  testProtocol(input: TestProtocolInput): Promise<Result<TestProtocolResult>>;
  /** 一键修复：把某绘画模型配置的请求体/请求头覆盖合并补一段（通知中心「一键修复」按钮调用）。 */
  applyOverrides(input: ApplyOverridesInput): Promise<Result<ApplyOverridesResult>>;
}

export interface SaveSettingsInput {
  configs?: ApiConfigInput[];
  /** key/value 偏好项 */
  prefs?: Record<string, string>;
}

export interface TestConnectionInput {
  base_url: string;
  api_key_plain: string;
  type: 'image' | 'text' | 'video';
  /** 用于测试的模型 ID */
  model_id?: string;
  /** 自定义请求头/鉴权覆盖（非 Bearer 鉴权的中转站，拉取模型列表也要带对头才能读到） */
  header_overrides_json?: string | null;
}

export interface TestConnectionResult {
  ok: true;
  /** 上游响应延时毫秒数 */
  latency_ms: number;
  /** 厂商返回的可见模型列表（如能拿到） */
  models?: string[];
  /**
   * 「按模型原生协议路由」的中转（如 openmodel.ai）在 /models 里给每个模型标 supported_protocols。
   * 这里是「实际模型 ID → 协议数组」映射（仅含声明了协议的模型），用于指派时自动判定对话协议。
   */
  model_protocols?: Record<string, string[]>;
}

export interface TestProtocolInput {
  base_url: string;
  api_key_plain: string;
  type: 'image' | 'text' | 'video';
  /** 实际模型 ID（模型映射的值） */
  model_id: string;
  official_kind?: string | null;
  image_kind?: string | null;
  body_overrides_json?: string | null;
  header_overrides_json?: string | null;
}

export interface TestProtocolResult {
  /** 协议是否跑通（真实调用 2xx） */
  ok: boolean;
  /** 因费用/协议差异未做真实调用 */
  skipped?: boolean;
  status?: number;
  /** 「做什么 + 怎么办」中文结论 */
  message: string;
  /** 上游原始响应片段（失败时） */
  detail?: string;
}

// ──────────────────────────────────────────────────────────
// plan.ts
// ──────────────────────────────────────────────────────────

export interface PlanAPI {
  list(): Promise<Result<ApiPlan[]>>;
  upsert(input: { id?: number; name: string }): Promise<Result<ApiPlan>>;
  delete(id: number): Promise<Result<true>>;
  /** 列出某方案下所有 ApiConfig */
  configs(planId: number): Promise<Result<ApiConfig[]>>;
  /** 删除单条模型配置 */
  configDelete(id: number): Promise<Result<true>>;
}

// ──────────────────────────────────────────────────────────
// chat.ts (Phase 2 占位)
// ──────────────────────────────────────────────────────────

export interface ChatAPI {
  send(input: ChatSendInput): Promise<Result<{ messageId: string }>>;
  /**
   * 无状态聊天（智能画布 LLM 节点专用）：不落库、不进生图页对话列表，
   * 每次都带当前 modelId + 完整消息序列，模型永远跟随节点当前选择。
   * 走与 send 相同的 chat:chunk / chat:done 推送。
   */
  sendEphemeral(input: ChatSendEphemeralInput): Promise<Result<{ messageId: string }>>;
  cancel(messageId: string): Promise<Result<true>>;
  create(input: { title: string; planId: number; modelId: string }): Promise<Result<{ id: string }>>;
  list(): Promise<Result<Array<{ id: string; title: string; updated_at: string }>>>;
  history(
    conversationId: string
  ): Promise<
    Result<
      Array<{
        role: string;
        content: string;
        /** 仅当该轮 assistant 消息生成时方案启用了思考模式才有；其余 null */
        reasoning_content: string | null;
        timestamp: string;
      }>
    >
  >;
  rename(input: { id: string; title: string }): Promise<Result<true>>;
  delete(id: string): Promise<Result<true>>;
  /** 一键清空所有会话（含消息） */
  clearAll(): Promise<Result<{ removed: number }>>;
  optimizePrompt(input: {
    planId: number;
    modelId: string;
    userInput: string;
    /** 可选：覆盖默认 system prompt，使用 optimizePresets.ts 里的分类提示 */
    systemPrompt?: string;
    /** 返回值 reason：失败回退原文时附带的失败原因（HTTP 错误 / 超时等，便于前端 toast 展示） */
  }): Promise<Result<{ optimized: string; optimizedBy: string | null; reason?: string }>>;
}

export interface ChatSendInput {
  conversationId: string;
  content: string;
  /** 仅本次发送附带的图片（data URI / https URL），后端拼成多模态消息 */
  attachedImages?: string[];
  /** 本轮强制启用代搜(对应聊天框 🌐 toggle);后端忽略 supports_web_search */
  forceWebSearch?: boolean;
}

export interface ChatSendEphemeralInput {
  planId: number;
  modelId: string;
  /** 完整消息序列（含本轮新 user 消息，末条应为 user） */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  attachedImages?: string[];
  forceWebSearch?: boolean;
}

// ──────────────────────────────────────────────────────────
// image.ts (Phase 3 占位)
// ──────────────────────────────────────────────────────────

export interface ImageAPI {
  generate(input: ImageGenerateInput): Promise<Result<{ taskId: number }>>;
  status(taskId: number): Promise<Result<{ status: string; result_paths?: string[] }>>;
  cancel(taskId: number): Promise<Result<true>>;
  queue(): Promise<Result<unknown[]>>;
}

/** AI 视频生成入参（异步任务）。params 见运行端：mode/duration/resolution/aspect/seed/image/imageTail/size 等。 */
export interface VideoGenerateInput {
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  params: Record<string, unknown>;
  /**
   * 统一视频生成请求（adapter 路径，如 seedance/custom）。
   * 提供时且该模型的 video_kind 走 adapter → 用它；否则回退到 legacy 引擎读 params。
   */
  request?: VideoGenerationRequest;
}

/** 视频素材上传入参（本地文件 → 供应商 uploadEndpoint → 公网 URL）。 */
export interface VideoUploadAssetInput {
  modelId: string;
  filePath?: string;
  dataUri?: string;
  filename?: string;
  kind: 'image' | 'video' | 'audio';
}

export interface VideoAPI {
  /** 提交视频任务，立即返回 taskId；进度走 video:progress、完成走 video:done 推送。 */
  generate(input: VideoGenerateInput): Promise<Result<{ taskId: string }>>;
  /** 取消进行中的视频任务（停止轮询 + abort 提交）。 */
  cancel(taskId: string): Promise<Result<true>>;
  /** 写视频封面缩略图（渲染端抓首帧 webp dataURI → 落 .thumbs + 更新 images.thumbnail_path）。 */
  saveThumbnail(input: { imageId: number; dataUri: string }): Promise<Result<{ thumbnail: string }>>;
  /** 上传本地素材到供应商 uploadEndpoint，返回公网 URL（无端点时报错引导用公网 URL）。 */
  uploadAsset(input: VideoUploadAssetInput): Promise<Result<{ url: string }>>;
  /** 缩放视频（主进程 ffmpeg 重编码）→ 返回缩放后本地 mp4 路径（已自动入资产库，imageId 供补封面）。 */
  scale(input: VideoScaleInput): Promise<Result<{ path: string; imageId?: number }>>;
  /** 视频编辑（主进程 ffmpeg）：裁切 / 基础调色 / 声音处理 / 合并 → 输出本地 mp4（自动入资产库）。 */
  edit(input: VideoEditInput): Promise<Result<{ path: string; imageId?: number }>>;
}

/** 视频剪辑片段（op='clip'，每个 input 对应一个，同序）。 */
export interface VideoEditClipSegment {
  src: string;
  trimStart: number;
  trimEnd: number;
  speed: number;
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  transition: 'none' | 'fade' | 'fadeblack' | 'dissolve' | 'wipeleft' | 'slideright';
  transitionDur: number;
}
export interface VideoEditClipText {
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
}

/** 视频编辑入参：op 决定用哪些字段；inputs = 本地路径 / http(s) URL（merge/clip 多段，其余取首个）。 */
export interface VideoEditInput {
  op: 'trim' | 'color' | 'audio' | 'merge' | 'clip';
  inputs: string[];
  clientTag?: string;
  /** trim：起止秒（end 为空 = 到结尾） */
  start?: number | null;
  end?: number | null;
  /** color / clip 整体调色：ffmpeg eq + hue（默认值=不变） */
  brightness?: number | null;
  contrast?: number | null;
  saturation?: number | null;
  gamma?: number | null;
  hue?: number | null;
  /** audio：保留 / 静音 / 音量倍数 / 淡入淡出秒 */
  audioMode?: 'keep' | 'mute' | 'volume' | 'fade' | null;
  volume?: number | null;
  fadeIn?: number | null;
  fadeOut?: number | null;
  /** clip（时间轴剪辑）：与 inputs 同序的片段 + 文字叠加 + 成片帧率 */
  segments?: VideoEditClipSegment[];
  texts?: VideoEditClipText[];
  fps?: number | null;
}

/** 视频缩放/补帧入参（任一宽/高为空 = 按比例自适应，ffmpeg -2 保证偶数边；fps = minterpolate 补帧目标帧率）。 */
export interface VideoScaleInput {
  inputPath: string;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
}

// ── 视频插帧（本地 RIFE ncnn Vulkan）──

export interface InterpEngineStatus {
  installed: boolean;
  version: string;
  execPath: string | null;
  enginePath: string;
  models: string[];
  defaultModel: string | null;
  platform: 'windows' | 'macos' | 'linux' | 'unsupported';
}

export interface InterpRunInput {
  inputPath: string;
  targetFps: number;
  model?: string;
  outputDir?: string;
  /** 渲染端生成的 uuid，interp:progress 原样回带用于定位节点 */
  clientTag?: string;
}

export interface InterpRunResult {
  taskId: string;
  outputPath: string;
  srcFps?: number;
  srcFrames?: number;
  outFrames?: number;
  targetFps: number;
  elapsedMs?: number;
  /** 产物已自动入资产库时的 images.id（渲染端抓帧补封面用） */
  imageId?: number;
}

/** interp:install-progress 推送 payload（与 upscale:install-progress 同形） */
export interface InterpInstallProgressPayload {
  component: string;
  received: number;
  total: number;
}

/** interp:progress 推送 payload */
export interface InterpProgressPayload {
  taskId: string;
  clientTag?: string;
  stage: 'probe' | 'extract' | 'interp' | 'encode';
  percent: number;
  framesDone: number;
  framesTotal: number;
  srcFps?: number;
  phase: string;
}

export interface InterpAPI {
  /** 引擎装没装、模型清单、默认模型（rife-v4.6）、平台 */
  status(): Promise<Result<InterpEngineStatus>>;
  /** 下载 zip 解压到 userData/engines/rife/；进度推 interp:install-progress */
  installEngine(input?: { source?: 'auto' | 'github' | 'mirror' }): Promise<
    Result<{ enginePath: string; usedUrl: string; models: string[] }>
  >;
  removeEngine(): Promise<Result<true>>;
  /** 同步等完成（拆帧→AI 插帧→合帧，分钟级）；进度推 interp:progress */
  run(input: InterpRunInput): Promise<Result<InterpRunResult>>;
  /** 按 taskId 取消（空 = 取消所有在跑插帧任务） */
  cancel(input?: { taskId?: string }): Promise<Result<{ cancelledTaskIds: string[] }>>;
}

/** video:progress 推送 payload */
export interface VideoProgressPayload {
  taskId: string;
  percent?: number;
  /** 阶段中文：提交中 / 排队中 / 生成中 / 下载中 */
  phase?: string;
  /** 细分任务状态（adapter 路径）：validating/submitted/polling/processing… */
  state?: VideoTaskStatusState;
}

/** video:done 推送 payload */
export interface VideoDonePayload {
  taskId: string;
  ok: boolean;
  /** 成功时的本地 mp4 绝对路径（渲染端用 localPathToImageUrl 转可播放 URL） */
  filePath?: string;
  /** 入资产库后的 images.id（若入库成功） */
  imageId?: number;
  durationMs?: number;
  error?: string;
  /** return_last_frame 连续视频用：最后一帧 URL（供下一段作首帧） */
  lastFrameUrl?: string;
  /** 远端原始视频 URL（落盘前的下载地址，备查） */
  remoteUrl?: string;
}

export interface ImageGenerateInput {
  modelId: string;
  positivePrompt: string;
  negativePrompt?: string;
  params: Record<string, unknown>;
  referenceImages?: string[];
}

// ──────────────────────────────────────────────────────────
// gallery / prompt / album (Phase 4 占位)
// ──────────────────────────────────────────────────────────

export interface GalleryAPI {
  list(input?: GalleryListInput): Promise<Result<unknown[]>>;
  detail(id: number): Promise<Result<unknown>>;
  update(input: { id: number; patch: Record<string, unknown> }): Promise<Result<true>>;
  /** 把 dataUri 字节导入资产库：落盘 + INSERT INTO images（task_id=NULL） */
  importFromBuffer(
    input: GalleryImportFromBufferInput
  ): Promise<Result<{ id: number; filePath: string }>>;
  /** 多类型文件收录：图片/视频/SVG/PSD/PDF/Office 按本地路径批量导入资产库（复制进存储根 + INSERT） */
  importFiles(input: { paths: string[] }): Promise<
    Result<{
      imported: Array<{ id: number; filePath: string; kind: string }>;
      skipped: Array<{ path: string; reason: string }>;
    }>
  >;
  /** 批量探测哪些卡片的 file_path 已不在本地(用于"选中无关联文件") */
  probeMissingFiles(input: { ids: number[] }): Promise<Result<{ missing: number[] }>>;
  /** 批量"同时删除本地文件"—— 物理 unlink + 硬删 DB 行 */
  batchDeleteWithFiles(input: { ids: number[] }): Promise<
    Result<{ deletedIds: number[]; fileDeleted: number; fileMissing: number }>
  >;
  /** 列出所有分组（文件夹）+ 计数 + 封面（首页文件夹卡用） */
  listGroups(): Promise<Result<Array<{ name: string; count: number; cover: string | null }>>>;
  /** 把若干图片归入分组 group（null=移出回首页）；物理同步移动源文件到 groups/<名>/ */
  setGroup(input: { imageIds: number[]; group: string | null }): Promise<Result<{ moved: number; failed: number }>>;
}

export interface GalleryListInput {
  category_slug?: string;
  tags?: string[];
  search?: string;
  include_deleted?: boolean;
  /** 按相册筛选（手动=成员匹配；智能=规则实时匹配） */
  album_id?: number;
  /** 分组（文件夹）筛选：'__home__'=仅未分组散图 / '__all__'或缺省=不限 / 具名=该分组 */
  group?: string;
  /** 无限滚动分页：每页条数（默认 100） */
  limit?: number;
  /** 无限滚动分页：偏移量（默认 0） */
  offset?: number;
  /** 键集分页游标：只取 id 小于此值的行（抗删行/插行错位，资产库无限滚动用） */
  before_id?: number;
}

export interface PromptAPI {
  list(input?: { category_slug?: string }): Promise<Result<unknown[]>>;
  upsert(input: Record<string, unknown>): Promise<Result<unknown>>;
  delete(id: number): Promise<Result<true>>;
  categoryList(): Promise<Result<unknown[]>>;
}

export interface AlbumAPI {
  list(): Promise<Result<Album[]>>;
  upsert(input: AlbumInput): Promise<Result<Album>>;
  delete(id: number): Promise<Result<true>>;
}

// ──────────────────────────────────────────────────────────
// lab.ts —— 实验室「页面」已下线；reverse/translate 后端保留为共享服务
// （智能画布 LLM 节点「图片反推」复用 reverse）
// ──────────────────────────────────────────────────────────

export interface LabAPI {
  reverse(input: { imagePaths: string[]; modelId: string; resultType: string }): Promise<Result<unknown>>;
  translate(input: { text: string; direction: 'zh-to-en' | 'en-to-zh' }): Promise<Result<unknown>>;
  history(input?: { operation_type?: string }): Promise<Result<unknown[]>>;
}

// ──────────────────────────────────────────────────────────
// theme.ts
// ──────────────────────────────────────────────────────────

export interface ThemeAPI {
  list(): Promise<Result<unknown[]>>;
  save(input: { name: string; atmosphere: string; palette: string }): Promise<Result<unknown>>;
}

// ──────────────────────────────────────────────────────────
// storage / exporter
// ──────────────────────────────────────────────────────────

export interface ShortcutsAPI {
  /** 启动外部软件（侧栏快捷方式点击）；路径不存在 / 启动失败时返回 toast 级错误 */
  launchExe(input: { exePath: string }): Promise<Result<true>>;
  /** 取某 exe 的系统图标 → dataURI（失败返回 {dataUri:null}，前端回退首字母图标） */
  getFileIcon(input: { filePath: string }): Promise<Result<{ dataUri: string | null }>>;
  /** 用指定软件打开一个文件（拖图/文字到软件快捷方式 → 软件里编辑；.lnk 自动解析目标） */
  openWith(input: { appPath: string; filePath: string }): Promise<Result<true>>;
}

export interface StorageAPI {
  selectFolder(): Promise<Result<{ path: string } | null>>;
  pickImages(): Promise<Result<{ files: Array<{ path: string; dataUri: string }> }>>;
  /** 通用单文件选择器（GGUF / 任意类型） */
  pickFile(input?: {
    filters?: Array<{ name: string; extensions: string[] }>;
    title?: string;
  }): Promise<Result<{ filePath: string | null }>>;
  /** 通用多文件选择器（同 pickFile 入参，返回数组；用户取消时数组为空） */
  pickFiles(input?: {
    filters?: Array<{ name: string; extensions: string[] }>;
    title?: string;
  }): Promise<Result<{ filePaths: string[] }>>;
  showInFolder(filePath: string): Promise<Result<true>>;
  /** 直接打开目录或文件；ensureDir=true 时如目录不存在会先 mkdir -p 再打开 */
  openPath(input: { targetPath: string; ensureDir?: boolean }): Promise<Result<true>>;
  /** 把 dataUri 写到 userData/temp-refs/，返回真实磁盘路径。用于画板导出送参考图。 */
  saveTempImage(input: {
    dataUri: string;
    suggestedName?: string;
  }): Promise<Result<{ filePath: string }>>;
  /** 把纯文本写到 userData/temp-refs/，返回真实磁盘路径（文字 → 用软件打开 / 放入文件夹） */
  saveTempText(input: { text: string; suggestedName?: string }): Promise<Result<{ filePath: string }>>;
  /** 批量探测路径是否存在 / 是否目录（侧栏拖文件夹自动添加快捷方式用） */
  pathInfo(input: {
    paths: string[];
  }): Promise<Result<{ items: Array<{ path: string; exists: boolean; isDir: boolean }> }>>;
  /** 弹「另存为」对话框 + 写盘。用户取消返回 ok(null)。工具箱右键菜单用。 */
  saveAs(input: {
    dataUri: string;
    defaultName: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<Result<{ filePath: string } | null>>;
  /** 把智能画布图片节点的大 base64 落盘到 userData/canvas-assets（sha1 去重），返回磁盘路径，
   *  用于持久化前外置 base64、避免撑爆 localStorage 配额。 */
  saveCanvasAsset(input: { dataUri: string }): Promise<Result<{ filePath: string }>>;
  /** 列出文件夹中的图片/视频文件（folder-input 节点扫描；只回元数据不回字节；kinds 缺省=仅图片） */
  listImages(input: {
    dir: string;
    kinds?: Array<'image' | 'video'>;
  }): Promise<
    Result<{ files: Array<{ path: string; name: string; size: number; mtime: number; kind?: 'image' | 'video' }> }>
  >;
  /** 批量把图片复制/写入到目标文件夹（folder-output 节点落盘；src=本地路径或 dataUri，重名自动 -2/-3） */
  copyInto(input: {
    targetDir: string;
    items: Array<{ src: string; destName: string }>;
    /** true=同名直接覆盖（缩略图重生成用）；缺省 false=重名自动 -2/-3 */
    overwrite?: boolean;
  }): Promise<Result<{ saved: Array<{ src: string; dest: string }>; failed: Array<{ src: string; error: string }> }>>;
  /** 在系统默认浏览器中打开 URL（参考来源 / 模型下载页 / 帮助文档 用） */
  openUrl(url: string): Promise<Result<true>>;
  /** 扫描 lora_folder_path 目录列出 .safetensors / .pt / .ckpt 文件 */
  scanLoras(): Promise<Result<Array<{ name: string; path: string; sizeBytes: number }>>>;
  /** 打开软件配置文件夹（userData，含数据库 / 节点模板 / 临时文件），返回其绝对路径 */
  openConfigFolder(): Promise<Result<{ path: string }>>;
}

// ──────────────────────────────────────────────────────────
// web —— 网页预览抓取（外置提示词库封面自动获取）
// ──────────────────────────────────────────────────────────

export interface WebAPI {
  /** 抓取网页的 og:image 封面 + og:title 标题（主进程抓取避开 CORS；封面压成 512 webp dataURI）。 */
  pagePreview(input: { url: string }): Promise<Result<{ title?: string; cover?: string }>>;
}

// ──────────────────────────────────────────────────────────
// tools.ts —— 工具箱（高清放大 + 图像矢量化）
// ──────────────────────────────────────────────────────────

export interface ToolsAPI {
  /** 把工具产出（dataUri）保存到 tools_storage_path（或回退到 image_storage_path） */
  saveOutput(input: {
    dataUri: string;
    kind: 'upscale' | 'vectorize';
    suggestedName?: string;
  }): Promise<Result<{ filePath: string }>>;
}

// ──────────────────────────────────────────────────────────
// 放大引擎 —— Real-ESRGAN ncnn Vulkan（保真放大模式）
// ──────────────────────────────────────────────────────────

export type UpscaleSource = 'github' | 'mirror' | 'auto';
export type UpscaleFormat = 'png' | 'jpg' | 'webp';

export interface UpscaleEngineStatus {
  installed: boolean;
  version: string;
  execPath: string | null;
  enginePath: string;
  modelsPath: string;
  modelsDirExists: boolean;
  hasAnyModel: boolean;
  models: Array<{ name: string; sizeBytes: number }>;
  engineRootListing: Array<{ name: string; sizeBytes: number; isDir: boolean }>;
  vulkanProbe: 'ok' | 'unknown' | 'unsupported';
  platform: 'windows' | 'macos' | 'linux' | 'unsupported';
}

export interface UpscaleCommonParams {
  modelName: string;
  scale: 2 | 3 | 4;
  format: UpscaleFormat;
  tile: number;
  gpuId: number | 'auto';
  tta: boolean;
  /**
   * 跑哪个后端 — 默认 'ncnn'。
   * - 'ncnn' :modelName 是 ncnn short-id(如 realesrgan-x4plus)。spawn 二进制
   * - 'onnx' :modelName 是 OnnxModelSpec.id(如 realesrgan-x4plus、4x-ultrasharp)。
   *           走 onnxruntime-node 主进程内推理(DirectML/CoreML/CUDA + CPU 回退)
   */
  backend?: 'ncnn' | 'onnx';
  /** 保留 alpha 通道(仅 PNG/WebP 输出有效) */
  keepAlpha?: boolean;
}

/** 与 src/lib/upscaleModes.ts 的 UpscaleModeId 保持一致(用于 ONNX 模型分类提示) */
export type UpscaleModeCategory =
  | 'smart'
  | 'general-hd'
  | 'general-fast'
  | 'anime-illust'
  | 'anime-video'
  | 'sharpen'
  | 'custom';

/** ONNX 模型清单条目(api:upscale:onnx-list 返回) */
export interface OnnxModelView {
  id: string;
  displayName: string;
  description: string;
  licenseNote: string;
  /** 该模型契合的模式分类;Settings 据此分组渲染 */
  categoryHint: UpscaleModeCategory;
  fileName: string;
  absPath: string;
  expectedBytes: number;
  actualBytes: number;
  installed: boolean;
  nativeScale: 2 | 3 | 4;
  /** sources 为空 = 无公开 .onnx,UI 应显示「上传到此槽位」 */
  sources: Array<{ name: string; url: string }>;
}

export interface OnnxCustomEntry {
  fileName: string;
  absPath: string;
  sizeBytes: number;
  /** 用户上传时指定的分类(默认 'custom') */
  modeHint: UpscaleModeCategory;
}

export interface UpscaleRunSingleInput extends UpscaleCommonParams {
  inputDataUri?: string;
  inputPath?: string;
  outputDir?: string;
  outputFileName?: string;
}

export interface UpscaleRunBatchInput extends UpscaleCommonParams {
  inputPaths: string[];
  outputDir?: string;
}

export interface UpscaleSingleResult {
  taskId: string;
  outputPath: string;
  outputDataUri: string | null;
  inputW: number;
  inputH: number;
  outputW: number;
  outputH: number;
  elapsedMs: number;
}

export interface UpscaleBatchResult {
  taskId: string;
  cancelled: boolean;
  results: Array<{
    inputPath: string;
    outputPath: string;
    inputW: number;
    inputH: number;
    outputW: number;
    outputH: number;
    elapsedMs: number;
  }>;
}

export interface UpscaleAPI {
  status(): Promise<Result<UpscaleEngineStatus>>;
  installEngine(input: { source: UpscaleSource }): Promise<
    Result<{ enginePath: string; usedUrl: string; modelsInstalled: string[] }>
  >;
  /** 用本地已下好的官方 release zip 装引擎 —— 网络全断时的兜底 */
  installEngineFromZip(input: { zipPath: string }): Promise<
    Result<{ enginePath: string; modelsInstalled: string[] }>
  >;
  /** 直接从本地导入若干 .bin / .param 模型文件（同名成对才有效） */
  importLocalModelFiles(input: { filePaths: string[] }): Promise<
    Result<{ imported: string[]; modelsAfter: string[] }>
  >;
  removeEngine(): Promise<Result<true>>;
  installModel(input: { modelName: string; source: UpscaleSource }): Promise<
    Result<{ bin: string; param: string; usedUrl: string }>
  >;
  removeModel(input: { modelName: string }): Promise<Result<true>>;
  runSingle(input: UpscaleRunSingleInput): Promise<Result<UpscaleSingleResult>>;
  runBatch(input: UpscaleRunBatchInput): Promise<Result<UpscaleBatchResult>>;
  cancel(input?: { taskId?: string }): Promise<Result<{ cancelledTaskIds: string[] }>>;

  /** ONNX 模型管理(2026-05-28 替代 PyTorch sidecar) */
  onnxList(): Promise<
    Result<{
      modelsDir: string;
      builtins: OnnxModelView[];
      custom: OnnxCustomEntry[];
    }>
  >;
  /** 下载内置 onnx 模型(HF mirror 优先) */
  onnxDownload(input: { modelId: string }): Promise<
    Result<{ modelId: string; usedUrl: string; destPath: string }>
  >;
  /** 删除某 .onnx 文件 */
  onnxRemove(input: { fileName: string }): Promise<Result<true>>;
  /** 导入本地 .onnx 文件到 onnx 模型目录(保留原文件名,带 modeHint 写入 custom_meta.json) */
  onnxImportFiles(input: { filePaths: string[]; modeHint?: UpscaleModeCategory }): Promise<
    Result<{ imported: string[]; skipped: Array<{ src: string; reason: string }> }>
  >;
  /** 释放 ORT session(清显存) */
  onnxUnload(): Promise<Result<true>>;
  /** 后台预热 ONNX 模型 session(首次推理跳过冷加载 5-15s) */
  onnxPrewarm(input: { modelId: string }): Promise<Result<{ warmed: boolean }>>;
}

/** 'upscale:onnx-download-progress' push payload */
export interface UpscaleOnnxDownloadProgressPayload {
  modelId: string;
  component: string;
  received: number;
  total: number;
}

/** 'upscale:progress' push payload */
export interface UpscaleProgressPayload {
  taskId: string;
  itemIndex: number;
  itemCount: number;
  percent: number;
  phase: string;
  currentInput?: string;
}

/** 'upscale:done' push payload */
export interface UpscaleDonePayload {
  taskId: string;
  ok: boolean;
  results: UpscaleBatchResult['results'];
  error?: string;
  cancelled?: boolean;
}

/** 'upscale:install-progress' push payload */
export interface UpscaleInstallProgressPayload {
  component: string;
  received: number;
  total: number;
}

// HYPIR（AI 修复放大）/ SUPIR Portable / 通用 AI 平台底座 类型
// 已整体砍除（SUPIR 2026-05-29、HYPIR + ai-platform 2026-06-18）

// ──────────────────────────────────────────────────────────
// 图像转矢量（api:vec:*） 最终 2 模式 (2026-05-28)
//   - vtracer: Fast 彩色(本身就是兜底,失败不回退)
//   - potrace: Crisp 黑白线稿(失败 → vtracer)
//
// 砍除历史:
//   - autotrace (Pro):上游 NSIS 打包 bug,跑不起来
//   - starvector (AI):VLM 实测效果差
//   - experimental (Lab):投入产出比低
//
// 所有引擎输出统一过 svg postprocess 流水线;potrace 失败自动回退 vtracer
// (UI 必须显示"用户选择 vs 实际引擎")。
// 每次任务在 userData/vec-debug/<ts>/ 下落 30+ 字段 report.json + 12 个调试文件。
// ──────────────────────────────────────────────────────────

export type VecMode = 'vtracer' | 'potrace';
export type VecTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type VecBatchStatus = 'idle' | 'running' | 'paused' | 'completed' | 'aborted';
export type VecQualityTier = 'excellent' | 'good' | 'fair' | 'poor' | 'invalid';
export type ImageTypeTag =
  | 'bw-lineart'
  | 'mono-logo'
  | 'color-logo'
  | 'flat-illustration'
  | 'icon'
  | 'complex-photo'
  | 'gradient-photo'
  | 'text-image'
  | 'transparent-bg';

export interface VTracerParams {
  colorMode?: 'color' | 'binary';
  hierarchical?: 'stacked' | 'cutout';
  filterSpeckle?: number;
  colorPrecision?: number;
  layerDifference?: number;
  cornerThreshold?: number;
  lengthThreshold?: number;
  maxIterations?: number;
  spliceThreshold?: number;
  pathPrecision?: number;
  maxPaths?: number;
  colorMergeDelta?: number;
  /** 路径拟合模式: 'spline'(默认/最平滑) | 'polygon'(硬边) | 'none'(不简化) */
  pathMode?: 'none' | 'polygon' | 'spline';
}

export interface PotraceParams {
  threshold?: number;
  blackOnWhite?: boolean;
  turdSize?: number;
  alphaMax?: number;
  optCurve?: boolean;
  optTolerance?: number;
  /** 描线填充色: 'auto'(默认) 或 '#rrggbb' */
  color?: string;
  /** 背景色: 'transparent'(默认) 或 '#rrggbb' */
  background?: string;
}

export type VecParams = VTracerParams | PotraceParams;

export interface VecBatchOptions {
  outputDir: string;
  naming: 'original' | 'suffix';
  onConflict: 'overwrite' | 'skip' | 'rename';
}

export interface VecBatchProgressPayload {
  batchId: string;
  /** 用户选的模式 */
  requestedMode: VecMode;
  status: VecBatchStatus;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** 该批中触发过回退的任务数(UI 用于显示"X 个已回退"提示) */
  fellBackCount: number;
  etaSeconds: number | null;
  avgPerTaskMs: number | null;
}

export interface VecTaskProgressPayload {
  batchId: string;
  taskId: string;
  /** 用户选的模式(永远不变) */
  requestedMode: VecMode;
  /** 实际跑成功的引擎(成功时 != requestedMode 表示回退发生);running 时为 null */
  actualEngine: VecMode | null;
  fellBack: boolean;
  fallbackReason: string | null;
  status: VecTaskStatus;
  progress: number;
  message: string;
  outputPath: string | null;
  durationMs: number | null;
  qualityScore: number | null;
  errorCode: AppErrorCode | null;
  errorMessageZh: string | null;
  errorHint: string | null;
  /** 引擎细分错误标签 */
  errorTag: string | null;
  /** debug/<ts>/ 目录绝对路径(供 UI "查看调试" 链接) */
  reportDir: string | null;
}

export interface VecHistoryRow {
  id: number;
  createdAt: string;
  batchId: string | null;
  /** 等价于 actualEngine,旧 UI 复用 */
  mode: VecMode;
  requestedMode: VecMode | null;
  actualEngine: VecMode | null;
  fellBack: boolean;
  fallbackReason: string | null;
  qualityScore: number | null;
  reportPath: string | null;
  inputPath: string;
  outputPath: string;
  durationMs: number;
  status: 'succeeded' | 'failed' | 'cancelled';
  error: string | null;
  paramsJson: string | null;
}

export interface VecBatchRecord {
  batchId: string;
  requestedMode: VecMode;
  status: VecBatchStatus;
  options: VecBatchOptions;
  taskIds: string[];
  createdAt: number;
}

export interface ImageTypeDetection {
  tag: ImageTypeTag;
  confidence: number;
  recommendedModes: VecMode[];
  reasonZh: string;
  features: {
    width: number;
    height: number;
    distinctColors: number;
    hasAlpha: boolean;
    edgeDensity: number;
    saturationMean: number;
    saturationStd: number;
    isMostlyBW: boolean;
  };
}

/** 30+ 字段任务报告(对应 userData/vec-debug/<ts>/report.json) */
export interface VecReport {
  taskId: string;
  batchId: string | null;
  timestamp: string;
  inputPath: string;
  inputSizeBytes: number;
  inputWidth: number | null;
  inputHeight: number | null;
  inputMode: string | null;
  preprocessedPath: string | null;
  preprocessedSize: [number, number] | null;
  requestedMode: VecMode;
  actualEngine: VecMode;
  fellBack: boolean;
  fallbackReason: string | null;
  engineModelName: string | null;
  engineModelPath: string | null;
  durationMs: number;
  engineRawOutputChars: number;
  svgPathCount: number;
  svgRectCount: number;
  svgCircleCount: number;
  svgEllipseCount: number;
  svgPolygonCount: number;
  svgPolylineCount: number;
  svgLineCount: number;
  svgTextCount: number;
  svgColorCount: number;
  svgNodeCount: number;
  svgFileSizeBytes: number;
  hasSvgTag: boolean;
  hasCloseTag: boolean;
  xmlValid: boolean;
  hasViewBox: boolean;
  previewRenderable: boolean;
  duplicateCoordRatio: number;
  duplicatePathRatio: number;
  qualityScore: number;
  qualityTier: VecQualityTier;
  engineErrorCode: AppErrorCode | null;
  engineErrorMessageZh: string | null;
  engineErrorHint: string | null;
  engineErrorTag: string | null;
  userSuggestion: string | null;
  engineMeta: Record<string, unknown> | null;
}

export interface VecAPI {
  // 单图便捷接口(包成 1 张的 batch,走完整流水线)
  runVtracer(input: {
    inputPath: string;
    outputDir: string;
    naming?: 'original' | 'suffix';
    onConflict?: 'overwrite' | 'skip' | 'rename';
    params?: VTracerParams;
  }): Promise<Result<{ batchId: string; taskId: string }>>;
  runPotrace(input: {
    inputPath: string;
    outputDir: string;
    naming?: 'original' | 'suffix';
    onConflict?: 'overwrite' | 'skip' | 'rename';
    params?: PotraceParams;
  }): Promise<Result<{ batchId: string; taskId: string }>>;
  // 批量(异步,进度走 'vec:progress' / 'vec:batch-progress')
  runBatch(input: {
    mode: VecMode;
    inputs: string[];
    options: VecBatchOptions;
    params?: VecParams;
  }): Promise<Result<{ batchId: string; taskIds: string[]; skippedExistingFiles: number }>>;
  pauseBatch(input: { batchId: string }): Promise<Result<{ ok: boolean }>>;
  resumeBatch(input: { batchId: string }): Promise<Result<{ ok: boolean }>>;
  cancelBatch(input: { batchId: string }): Promise<Result<{ ok: boolean }>>;
  cancelTask(input: { taskId: string }): Promise<Result<{ ok: boolean }>>;
  listBatches(): Promise<Result<VecBatchRecord[]>>;
  historyList(input: {
    filter?: {
      batchId?: string;
      mode?: VecMode;
      requestedMode?: VecMode;
      status?: 'succeeded' | 'failed' | 'cancelled';
      fellBackOnly?: boolean;
      limit?: number;
      offset?: number;
    };
  }): Promise<Result<VecHistoryRow[]>>;
  historyClear(input: { olderThanDays?: number }): Promise<Result<{ deleted: number }>>;
  /** 图片类型检测(拖入即调) */
  detectType(input: { inputPath: string }): Promise<Result<ImageTypeDetection>>;
  /** 拉取某次任务的 report.json */
  reportGet(input: { reportDir: string }): Promise<Result<VecReport>>;
  /** 打开 debug 目录;reportDir 为空 = 打开 userData/vec-debug 根 */
  debugOpen(input: { reportDir?: string }): Promise<Result<{ ok: boolean }>>;
}

// 通用 AI 平台底座（api:ai-feature:* + api:ai-model:*）类型
// 已随 HYPIR 整体砍除（2026-06-18）

// VectorizeConfig 已随矢量化功能整体移除。

/** 工具箱资产库导入入口（虽然定义在 gallery 命名下，但只工具箱用） */
export interface GalleryImportFromBufferInput {
  dataUri: string;
  kind: 'upscale' | 'vectorize' | 'imported';
  sourceModel?: string;
  params?: Record<string, unknown>;
  notes?: string;
}

export interface ExporterAPI {
  card(input: { imageId: number; outputPath?: string }): Promise<Result<{ outputPath: string }>>;
}

export interface WindowAPI {
  minimize(): Promise<Result<true>>;
  maximizeToggle(): Promise<Result<{ maximized: boolean }>>;
  close(): Promise<Result<true>>;
  state(): Promise<Result<{ maximized: boolean }>>;
  /** 任务完成时让任务栏图标闪烁/标黄提醒（仅窗口未聚焦时生效，聚焦即自动清除） */
  flash(): Promise<Result<true>>;
  /** 整窗界面缩放（renderer 本地 webFrame，同步）。1=100%；setZoom 返回 clamp 后实际系数。 */
  getZoom(): number;
  setZoom(factor: number): number;
}

/**
 * OS 级文件拖拽：把渲染进程的图片（dataUri 或本地路径）拖到外部文件夹 / 应用。
 * 必须从 dragstart 内立即调用；preload 这一层用 ipcRenderer.send（fire-and-forget），
 * 主进程 startDrag 是 webContents.startDrag（参见 main 端实现）。
 */
export interface DragAPI {
  /** 用 dataUri 启动 OS 拖拽——主进程会先把 dataUri 解码到 OS 临时文件 */
  startFromDataUri(dataUri: string, suggestedName?: string): void;
  /** 用现成的文件路径启动 OS 拖拽 */
  startFromPath(filePath: string): void;
}

// ──────────────────────────────────────────────────────────
// 全局声明
// ──────────────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
