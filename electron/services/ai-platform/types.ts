/**
 * AI Platform 共享类型 —— 通用底座的所有契约定义在这里。
 *
 * 设计原则：
 *   - FeatureSpec 描述"一个 AI 功能需要什么"（bat / 端口 / 模型 / 安装步骤）
 *   - ModelSpec  描述"一个权重文件长什么样、从哪儿下、几个 feature 用"
 *   - SidecarManager / ModelRegistry / FeatureRegistry 只认这两种 spec，
 *     不写死任何 HYPIR/SUPIR 的具体名字 —— 加新功能 = 写一个 FeatureSpec + 一组 ModelSpec
 */

/** AI 功能分类（UI 上分组用） */
export type FeatureCategory =
  | 'image-restore'    // HYPIR / SUPIR 这种"修复 / 放大"
  | 'image-to-svg'     // 图像转矢量重做后归此类
  | 'image-gen'        // 局部重绘 / ControlNet / IP-Adapter 等
  | 'image-segment'    // SAM / BiRefNet 抠图等
  | 'image-caption'    // BLIP / Florence 字幕
  | 'other';

/** 单个 AI 功能的完整描述 —— 注册到 FeatureRegistry 就能用 */
export interface FeatureSpec {
  /** 稳定标识符（kebab-case），影响 IPC 路径 + 调试目录名 */
  id: string;
  displayName: string;
  description: string;
  category: FeatureCategory;
  /** 本地 sidecar HTTP 端口（不同 feature 必须不同） */
  port: number;
  /** 相对便携包根的 server 入口（spawn 用 cmd /c <startBat>） */
  startBat: string;
  /** 相对便携包根的停服脚本 */
  stopBat: string;
  /** 安装 / 修复脚本链（按顺序跑）；空数组 = 这个 feature 不需要单独装依赖 */
  installBats: string[];
  /** sentinel 文件：服务端 Python 入口存在才认为脚手架已展开 */
  serverScaffoldRelPath: string;
  /** 这个功能依赖的 ModelSpec.id 列表 */
  requiredModelIds: string[];
  /** UI 上是否标"实验" */
  experimental?: boolean;
  /** 提交任务时的请求体构造器 + 错误码到 AppErrorCode 的映射，由 feature 自己提供 */
  errorCodeMap?: Record<string, import('@shared/error').AppErrorCode>;
}

/** 单个模型权重描述（per file or per directory） */
export interface ModelSpec {
  /** 稳定标识符 */
  id: string;
  displayName: string;
  /** 用于 UI license 区域 */
  licenseNote: string;
  /** 相对便携包根的路径 */
  relPath: string;
  /** 是否目录（diffusers 模型是目录，单文件 ckpt 是文件） */
  isDirectory: boolean;
  /** 预期大小（字节）—— probe 时校验完整性 */
  expectedBytes: number;
  /** 下载源（HF / ModelScope / 镜像）—— 后续 ai-model:download 用 */
  sources: Array<{ name: string; url: string; mirror?: boolean }>;
  /** 用到这个模型的 feature.id 列表 —— UI 表格按"哪个 feature 用"分组 */
  usedBy: string[];
}

/** 单次 sidecar 启动结果 */
export interface SidecarStartResult {
  alreadyRunning: boolean;
  pid: number | null;
  port: number;
}

/** sidecar /api/status 返回 */
export interface SidecarStatusResult {
  reachable: boolean;
  port: number;
  raw?: Record<string, unknown>;
  error?: string;
}

/** 通用 task 状态（所有 sidecar 都返这种 shape；feature-specific 字段进 result_info） */
export interface TaskStatusRaw {
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
  result_info?: Record<string, unknown>;
}

/** 一个 ModelSpec 在本机的存在 / 大小 */
export interface ModelProbe {
  id: string;
  exists: boolean;
  path: string;
  sizeBytes: number;
  /** 期望 vs 实际差距是否过大（< 95% expected） */
  sizeMismatch?: boolean;
}

/** Feature 完整体检结果 */
export interface FeatureProbe {
  id: string;
  /** 便携根路径 + 是否存在 */
  portablePath: string;
  portableExists: boolean;
  /** Python embed */
  pythonExists: boolean;
  pythonPath: string;
  /** start / stop bat 是否在 */
  startBatExists: boolean;
  stopBatExists: boolean;
  installBatsExist: Record<string, boolean>;
  /** Server 脚手架（app/<feature>_server/server.py） */
  serverScaffoldExists: boolean;
  /** 解析到的端口（spec.port + 配置覆盖） */
  port: number;
  /** 每个所需模型的存在状态 */
  models: Record<string, ModelProbe>;
  /** 内置脚手架来源（debug 用） */
  scaffoldSource: string;
}

/** Feature 一键化状态 —— UI 渲染"功能列表"表格用 */
export interface FeatureStatus {
  id: string;
  displayName: string;
  category: FeatureCategory;
  experimental: boolean;
  /** 整体是否可用（Python + scaffold + 所有模型都齐） */
  installed: boolean;
  /** 服务是否在跑 */
  serverRunning: boolean;
  /** 缺哪些模型（ModelSpec.id 列表） */
  missingModelIds: string[];
  /** 缺 Python / 缺脚手架 / 缺 bat 等系统级问题清单 */
  missingSystem: string[];
  /** 简短人话描述（首行用于 UI 副标题） */
  summary: string;
  probe: FeatureProbe;
}

/** 安装进度事件 */
export interface InstallProgressEvent {
  /** 当前在跑哪个 bat */
  stage: string;
  /** 该 bat 当前最新一行输出 */
  message: string;
  /** 0-100；脚本不解析就一直保持上次值 */
  percent?: number;
}

export interface InstallResult {
  success: boolean;
  exitCode: number;
  /** 末尾 50 行 stdout/stderr，失败时给用户看 */
  logTail: string[];
}
