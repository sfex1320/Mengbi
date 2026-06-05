/**
 * IPC 通道契约。preload 会按这里暴露给渲染进程，主进程按这里实现 handler。
 * 命名规范：api:<domain>:<action>，详见 CLAUDE.md §4。
 */

import type { Result, AppErrorCode, ErrorSeverity } from './error';
import type { ApiPlan, ApiConfig, ApiConfigInput, SettingsBundle, Album, AlbumInput } from './domain';
import type {
  ComfyConnectionConfig,
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

/** preload 暴露给渲染进程的入口 */
export interface ElectronAPI {
  settings: SettingsAPI;
  plan: PlanAPI;
  chat: ChatAPI;
  image: ImageAPI;
  gallery: GalleryAPI;
  prompt: PromptAPI;
  album: AlbumAPI;
  lab: LabAPI;
  theme: ThemeAPI;
  storage: StorageAPI;
  exporter: ExporterAPI;
  window: WindowAPI;
  drag: DragAPI;
  tools: ToolsAPI;
  /** 图像转矢量 v2：VTracer（彩色）/ Potrace（单色）/ OmniSVG（AI）三模式 */
  vec: VecAPI;
  upscale: UpscaleAPI;
  hypir: HypirAPI;
  /** 通用 AI 平台底座（HYPIR + 未来功能共用） */
  aiFeature: AiFeatureAPI;
  aiModel: AiModelAPI;
  config: ConfigIOAPI;
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
  | 'hypir:progress'
  | 'ai-feature:install-progress'
  | 'vec:progress'
  | 'vec:batch-progress'
  | 'ps:file-changed'
  | 'comfyui:status'
  | 'comfyui:run-progress'
  | 'comfyui:run-done'
  | 'comfyui:queue';

/**
 * chat:sources 推送 payload —— 代搜（DDG/Tavily/SearXNG）路径下，
 * 主进程在 stream 启动前把命中结果发出来；前端把这条挂在该轮 assistant 消息的"📎 参考来源"卡片里。
 */
export interface ChatSourcesPayload {
  id: string;
  backend: 'native' | 'ddg' | 'tavily' | 'searxng' | 'off';
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
}

// ──────────────────────────────────────────────────────────
// settings.ts
// ──────────────────────────────────────────────────────────

export interface SettingsAPI {
  get(): Promise<Result<SettingsBundle>>;
  save(input: SaveSettingsInput): Promise<Result<SettingsBundle>>;
  testConnection(input: TestConnectionInput): Promise<Result<TestConnectionResult>>;
}

export interface SaveSettingsInput {
  configs?: ApiConfigInput[];
  /** key/value 偏好项 */
  prefs?: Record<string, string>;
}

export interface TestConnectionInput {
  base_url: string;
  api_key_plain: string;
  type: 'image' | 'text';
  /** 用于测试的模型 ID */
  model_id?: string;
}

export interface TestConnectionResult {
  ok: true;
  /** 上游响应延时毫秒数 */
  latency_ms: number;
  /** 厂商返回的可见模型列表（如能拿到） */
  models?: string[];
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
  }): Promise<Result<{ optimized: string; optimizedBy: string | null }>>;
}

export interface ChatSendInput {
  conversationId: string;
  content: string;
  /** 仅本次发送附带的图片（data URI / https URL），后端拼成多模态消息 */
  attachedImages?: string[];
  /** 本轮强制启用代搜(对应聊天框 🌐 toggle);后端忽略 supports_web_search */
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
  /** 把 dataUri 字节导入图库：落盘 + INSERT INTO images（task_id=NULL） */
  importFromBuffer(
    input: GalleryImportFromBufferInput
  ): Promise<Result<{ id: number; filePath: string }>>;
  /** 批量探测哪些卡片的 file_path 已不在本地(用于"选中无关联文件") */
  probeMissingFiles(input: { ids: number[] }): Promise<Result<{ missing: number[] }>>;
  /** 批量"同时删除本地文件"—— 物理 unlink + 硬删 DB 行 */
  batchDeleteWithFiles(input: { ids: number[] }): Promise<
    Result<{ deletedIds: number[]; fileDeleted: number; fileMissing: number }>
  >;
}

export interface GalleryListInput {
  category_slug?: string;
  tags?: string[];
  search?: string;
  include_deleted?: boolean;
  /** 按相册筛选（手动=成员匹配；智能=规则实时匹配） */
  album_id?: number;
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
  /** 弹「另存为」对话框 + 写盘。用户取消返回 ok(null)。工具箱右键菜单用。 */
  saveAs(input: {
    dataUri: string;
    defaultName: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<Result<{ filePath: string } | null>>;
  /** 在系统默认浏览器中打开 URL（参考来源 / 模型下载页 / 帮助文档 用） */
  openUrl(url: string): Promise<Result<true>>;
  /** 扫描 lora_folder_path 目录列出 .safetensors / .pt / .ckpt 文件 */
  scanLoras(): Promise<Result<Array<{ name: string; path: string; sizeBytes: number }>>>;
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

// ──────────────────────────────────────────────────────────
// HYPIR（AI 高质量修复放大模式）—— 启动前依赖检查
// ──────────────────────────────────────────────────────────

export interface HypirDependencyCheck {
  ready: boolean;
  python: {
    found: boolean;
    path: string | null;
    version: string | null;
    versionOk: boolean;
  };
  cuda: {
    nvidiaSmi: boolean;
    driverVersion: string | null;
    cudaVersion: string | null;
  };
  torch: {
    installed: boolean;
    version: string | null;
    cudaAvailable: boolean;
  };
  hypirRepo: { importable: boolean };
  weights: {
    hypirPath: string | null;
    hypirExists: boolean;
    sd21Path: string | null;
    sd21Exists: boolean;
  };
  guides: {
    hypirRepo: string;
    sd21: string;
    pytorchInstall: string;
    cuda: string;
  };
}

export interface HypirAPI {
  /** [兼容] 旧的"系统级"依赖探测；UI 在没装 portable 时降级用 */
  check(input?: {
    pythonPath?: string;
    hypirWeightsPath?: string;
    sd21Path?: string;
  }): Promise<Result<HypirDependencyCheck>>;
  /** 探测便携包结构（bat / python / 源码 / 权重 / SD21 是否齐全） */
  probe(): Promise<Result<HypirPortableProbe>>;
  /** 改 portable 包路径；空字符串清回默认 */
  setPortablePath(input: { path: string }): Promise<Result<true>>;
  /** 把内置脚手架（bat + hypir_server + config + README）展开到 portablePath */
  bootstrap(): Promise<Result<{ root: string; copied: number; skipped: number }>>;
  /** spawn start_hypir.bat */
  startServer(): Promise<Result<{ alreadyRunning: boolean; pid: number | null; port: number }>>;
  /** graceful shutdown + 兜底强杀 */
  stopServer(): Promise<Result<{ stopped: boolean }>>;
  /** ping http://127.0.0.1:port/api/status */
  serverStatus(): Promise<Result<HypirServerStatus>>;
  /** 提交放大任务；进度走 'hypir:progress' 推送 */
  submitTask(input: {
    inputPath: string;
    outputPath?: string;
    scale: number;
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    tileSize?: number;
    device?: 'cuda' | 'cpu';
    intensity?: 'conservative' | 'standard' | 'strong';
    highlightProtection?: boolean;
    disablePostsharpen?: boolean;
    /** 修复深度 50–400；改值会触发约 30s 的模型重加载 */
    restorationDepth?: number;
  }): Promise<Result<{ taskId: string; status: string }>>;
  taskStatus(input: { taskId: string }): Promise<Result<HypirTaskStatusRaw>>;
  cancelTask(input: { taskId: string }): Promise<Result<true>>;
  /** 从显存释放模型；server 进程继续运行，下次任务再按需加载 */
  unloadModel(): Promise<Result<{ unloaded: boolean; modelLoaded: boolean; vramUsedMb: number | null }>>;
}

/** 推理结果元数据(HYPIR 用,SUPIR 已砍) */
export interface UpscaleResultInfo {
  output_path?: string;
  duration_seconds?: number;
  width?: number;
  height?: number;
  input_width?: number;
  input_height?: number;
  intensity?: string;
  blend_alpha?: number;
  highlight_protection?: boolean;
  num_steps?: number;
  cfg_scale?: number;
  restoration_scale?: number;
  color_fix?: string;
  model_t?: number;       // HYPIR only
  coeff_t?: number;       // HYPIR only
}

export interface HypirPortableProbe {
  configured: boolean;
  portablePath: string;
  exists: boolean;
  python: { exists: boolean; path: string };
  hypirSource: { exists: boolean; path: string };
  hypirWeights: { exists: boolean; path: string; sizeBytes: number };
  sd21Base: { exists: boolean; path: string };
  bats: {
    startExists: boolean;
    stopExists: boolean;
    testExists: boolean;
    installExists: boolean;
  };
  configPort: number;
  serverScaffoldExists: boolean;
  scaffoldSource: string;
}

export interface HypirServerStatus {
  reachable: boolean;
  port: number;
  raw?: {
    server?: string;
    model_loaded?: boolean;
    queue_size?: number;
    active_tasks?: number;
    probe?: {
      hypir_source: boolean;
      hypir_weights: boolean;
      sd21_base: boolean;
      torch_installed: boolean;
      cuda_available: boolean;
      gpu_name: string | null;
      vram_total_mb: number | null;
      vram_used_mb?: number | null;
      loaded_model_t?: number | null;
      loaded_coeff_t?: number | null;
    };
    version?: string;
  };
  error?: string;
}

export interface HypirTaskStatusRaw {
  task_id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  output_path: string;
  error_code: string | null;
  error_message_zh: string | null;
  error_hint: string | null;
  error_detail: string | null;
  duration_seconds?: number | null;
  result_info?: UpscaleResultInfo;
}

export interface HypirProgressPayload {
  taskId: string;
  percent: number;
  message: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  outputPath?: string;
  errorCode?: AppErrorCode | null;
  rawErrorCode?: string | null;
  errorMessageZh?: string | null;
  errorHint?: string | null;
  durationSeconds?: number | null;
  resultInfo?: UpscaleResultInfo | null;
}

// SUPIR Portable 类型已整体砍除(2026-05-29 — 显存需求 25-30 GB 过大)

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
}

export interface PotraceParams {
  threshold?: number;
  blackOnWhite?: boolean;
  turdSize?: number;
  alphaMax?: number;
  optCurve?: boolean;
  optTolerance?: boolean | number;
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

// ──────────────────────────────────────────────────────────
// 通用 AI 平台底座（api:ai-feature:* + api:ai-model:*）
// ──────────────────────────────────────────────────────────

export type AiFeatureCategory =
  | 'image-restore'
  | 'image-to-svg'
  | 'image-gen'
  | 'image-segment'
  | 'image-caption'
  | 'other';

export interface AiModelSpec {
  id: string;
  displayName: string;
  licenseNote: string;
  relPath: string;
  isDirectory: boolean;
  expectedBytes: number;
  sources: Array<{ name: string; url: string; mirror?: boolean }>;
  usedBy: string[];
}

export interface AiModelProbe {
  id: string;
  exists: boolean;
  path: string;
  sizeBytes: number;
  sizeMismatch?: boolean;
}

export interface AiFeatureSpec {
  id: string;
  displayName: string;
  description: string;
  category: AiFeatureCategory;
  port: number;
  startBat: string;
  stopBat: string;
  installBats: string[];
  serverScaffoldRelPath: string;
  requiredModelIds: string[];
  experimental?: boolean;
}

export interface AiFeatureProbe {
  id: string;
  portablePath: string;
  portableExists: boolean;
  pythonExists: boolean;
  pythonPath: string;
  startBatExists: boolean;
  stopBatExists: boolean;
  installBatsExist: Record<string, boolean>;
  serverScaffoldExists: boolean;
  port: number;
  models: Record<string, AiModelProbe>;
  scaffoldSource: string;
}

export interface AiFeatureStatus {
  id: string;
  displayName: string;
  category: AiFeatureCategory;
  experimental: boolean;
  installed: boolean;
  serverRunning: boolean;
  missingModelIds: string[];
  missingSystem: string[];
  summary: string;
  probe: AiFeatureProbe;
}

export interface AiFeatureInstallProgress {
  jobId: string;
  featureId: string;
  stage: string;
  message: string;
  percent?: number;
}

export interface AiFeatureAPI {
  list(): Promise<Result<AiFeatureStatus[]>>;
  status(input: { featureId: string }): Promise<Result<AiFeatureStatus>>;
  probe(input: { featureId: string }): Promise<Result<AiFeatureProbe>>;
  start(input: { featureId: string }): Promise<Result<{ alreadyRunning: boolean; pid: number | null; port: number }>>;
  stop(input: { featureId: string }): Promise<Result<{ stopped: boolean }>>;
  serverStatus(input: { featureId: string }): Promise<Result<{ reachable: boolean; port: number; raw?: Record<string, unknown>; error?: string }>>;
  unloadModel(input: { featureId: string }): Promise<Result<Record<string, unknown>>>;
  bootstrap(): Promise<Result<{ root: string; copied: number; skipped: number }>>;
  setPortablePath(input: { path: string }): Promise<Result<{ saved: boolean }>>;
  install(input: { featureId: string; jobId: string }): Promise<Result<{ featureId: string; steps: number }>>;
  cancelInstall(input: { featureId: string }): Promise<Result<{ cancelled: boolean }>>;
  /** 一键清理:所有 sidecar 走 /api/cleanup;unloadModels=true 时同时卸载模型 */
  cleanupAll(input: { unloadModels: boolean }): Promise<Result<AiCleanupResult>>;
}

export interface AiCleanupResult {
  results: Array<{
    featureId: string;
    reachable: boolean;
    vramBeforeMb: number | null;
    vramAfterMb: number | null;
    vramFreedMb: number | null;
    modelLoaded: boolean;
    unloaded: boolean;
  }>;
  totalFreedMb: number;
  unloadedCount: number;
  reachableCount: number;
}

export interface AiModelAPI {
  list(): Promise<Result<Array<{ spec: AiModelSpec; probe: AiModelProbe }>>>;
  get(input: { modelId: string }): Promise<Result<{ spec: AiModelSpec; probe: AiModelProbe }>>;
  listForFeature(input: { featureId: string }): Promise<Result<Array<{ spec: AiModelSpec; probe: AiModelProbe }>>>;
}

// VectorizeConfig 已随矢量化功能整体移除。

/** 工具箱图库导入入口（虽然定义在 gallery 命名下，但只工具箱用） */
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
