/**
 * IPC 通道契约。preload 会按这里暴露给渲染进程，主进程按这里实现 handler。
 * 命名规范：api:<domain>:<action>，详见 CLAUDE.md §4。
 */

import type { Result } from './error';
import type { ApiPlan, ApiConfig, ApiConfigInput, SettingsBundle } from './domain';

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
  /** 主进程 → 渲染进程 的事件订阅 */
  on(channel: PushChannel, handler: (payload: unknown) => void): () => void;
}

/** 主进程主动推送的频道（renderer 通过 on 监听） */
export type PushChannel =
  | 'chat:chunk'
  | 'chat:done'
  | 'image:done'
  | 'image:progress'
  | 'update:available'
  | 'update:downloaded';

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
  history(conversationId: string): Promise<Result<Array<{ role: string; content: string; timestamp: string }>>>;
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
}

// ──────────────────────────────────────────────────────────
// image.ts (Phase 3 占位)
// ──────────────────────────────────────────────────────────

export interface ImageAPI {
  generate(input: ImageGenerateInput): Promise<Result<{ taskId: number }>>;
  status(taskId: number): Promise<Result<{ status: string; result_paths?: string[] }>>;
  cancel(taskId: number): Promise<Result<true>>;
  queue(): Promise<Result<unknown[]>>;
  reorder(input: { taskIds: number[] }): Promise<Result<true>>;
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
}

export interface GalleryListInput {
  category_slug?: string;
  tags?: string[];
  search?: string;
  include_deleted?: boolean;
}

export interface PromptAPI {
  list(input?: { category_slug?: string }): Promise<Result<unknown[]>>;
  upsert(input: Record<string, unknown>): Promise<Result<unknown>>;
  delete(id: number): Promise<Result<true>>;
  categoryList(): Promise<Result<unknown[]>>;
}

export interface AlbumAPI {
  list(): Promise<Result<unknown[]>>;
  upsert(input: Record<string, unknown>): Promise<Result<unknown>>;
}

// ──────────────────────────────────────────────────────────
// lab.ts (Phase 5 占位)
// ──────────────────────────────────────────────────────────

export interface LabAPI {
  reverse(input: { imagePaths: string[]; modelId: string; resultType: string }): Promise<Result<unknown>>;
  split(input: { text: string; modelId: string }): Promise<Result<unknown>>;
  compare(input: { text: string; modelIds: string[] }): Promise<Result<unknown>>;
  translate(input: { text: string; direction: 'zh-to-en' | 'en-to-zh' }): Promise<Result<unknown>>;
  fuse(input: { textA: string; textB: string; ratioA: number }): Promise<Result<unknown>>;
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
  showInFolder(filePath: string): Promise<Result<true>>;
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

// ──────────────────────────────────────────────────────────
// 全局声明
// ──────────────────────────────────────────────────────────

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
