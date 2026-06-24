/**
 * 图像转矢量共享类型 —— Node 侧 (electron/) 内部用,跨进程的版本在 src/types/ipc.ts。
 *
 * v3 重构 + AI 清理(2026-05-28):
 *   - 3 模式架构(vtracer / potrace / autotrace),AI(StarVector)+ Lab(实验精修)已砍
 *   - EngineRunner 统一接口
 *   - 所有引擎输出过 svg 后处理流水线
 *   - report.json + quality_score + 回退机制保留(产品化收益)
 */
import type { AppErrorCode } from '@shared/error';

/**
 * 2 个矢量化模式(2026-05-28 AI + Pro 全砍后,只保留最稳的基础态)。
 *   - vtracer: Fast · 快速彩色,本身兜底
 *   - potrace: Crisp · 黑白线稿,失败回退 vtracer
 *
 * 砍掉的:
 *   - autotrace(Pro · 高级描摹):上游 NSIS 安装包打包 bug(混搭 32/64 位 + 缺 libssp),
 *     0.31.10 win-setup 无法跑;不再维护。
 *   - starvector(AI · 精准):VLM 生成 SVG 实测失败,同 OmniSVG 同质化
 *   - experimental(Lab · 实验精修):投入产出不成正比
 */
export type VecMode = 'vtracer' | 'potrace';

/** 所有引擎对外暴露的统一标签 */
export const VEC_MODE_LABELS: Record<VecMode, string> = {
  vtracer: 'Fast · 快速彩色',
  potrace: 'Crisp · 黑白线稿'
};

export type VecTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type VecBatchStatus = 'idle' | 'running' | 'paused' | 'completed' | 'aborted';

export type VecQualityTier = 'excellent' | 'good' | 'fair' | 'poor' | 'invalid';

// ── 引擎参数 ──────────────────────────────────────────────────────

export interface VTracerParams {
  /** 颜色模式: 'color' = 彩色; 'binary' = 二值 */
  colorMode?: 'color' | 'binary';
  /** 渐变区域簇方法 */
  hierarchical?: 'stacked' | 'cutout';
  /** 路径过滤精度 (0-20),越大越粗 */
  filterSpeckle?: number;
  /** 色彩量化等级 (1-10) */
  colorPrecision?: number;
  /** 渐变阈值 (0-128) */
  layerDifference?: number;
  /** 角度阈值 (deg) */
  cornerThreshold?: number;
  /** 分段长度 */
  lengthThreshold?: number;
  /** 平滑迭代次数 */
  maxIterations?: number;
  /** 拼接误差 */
  spliceThreshold?: number;
  /** 路径精度小数位 */
  pathPrecision?: number;
  /** 最大 path 数限制(后处理裁剪) */
  maxPaths?: number;
  /** 合并相近颜色阈值(后处理) */
  colorMergeDelta?: number;
  /** 路径拟合模式: 'spline'=曲线(默认,最平滑) | 'polygon'=多边形(硬边/像素风) | 'none'=不简化(忠实但 path 多)。缺省 'spline' = 历史行为 */
  pathMode?: 'none' | 'polygon' | 'spline';
}

export interface PotraceParams {
  /** 二值化阈值 0-255 */
  threshold?: number;
  /** 反相 */
  blackOnWhite?: boolean;
  /** 路径绘制最大斑点像素 */
  turdSize?: number;
  /** 平滑曲线张力 0-1.34 */
  alphaMax?: number;
  /** 输出曲线优化 */
  optCurve?: boolean;
  /** 优化容忍度 */
  optTolerance?: number;
  /** 描线填充色: 'auto'(默认,按图自动) 或 '#rrggbb' */
  color?: string;
  /** 背景色: 'transparent'(默认) 或 '#rrggbb' */
  background?: string;
}

export type VecParams = VTracerParams | PotraceParams;

// ── 引擎统一接口 ──────────────────────────────────────────────────

/** 引擎调用入参(已经预处理过的图,引擎不再做预处理) */
export interface EngineRunInput {
  /** 原图绝对路径(用于 debug + report) */
  originalInputPath: string;
  /** 实际喂给引擎的预处理图绝对路径(可能 == originalInputPath) */
  preprocessedPath: string;
  /** 引擎特定参数 */
  params: VecParams;
}

/** 引擎成功返回 */
export interface EngineRunSuccess {
  ok: true;
  /** 引擎原始 SVG 输出(尚未过 postprocess) */
  svg: string;
  /** 引擎完整原始文本输出(AI 模式才有,可能含 markdown / 解释文字) */
  rawOutput?: string;
  /** 该次推理耗时(ms) */
  durationMs: number;
  /** 引擎专属元数据(模型名、被截断、tokens 等) */
  meta?: Record<string, unknown>;
}

/** 引擎失败返回 */
export interface EngineRunError {
  ok: false;
  errorCode: AppErrorCode;
  /** 该引擎的细分错误标签(如 'STARVECTOR_TRUNCATED' / 'AUTOTRACE_EXE_MISSING'),用于 report */
  errorTag: string;
  errorMessageZh: string;
  errorHint: string;
  rawError: string;
  durationMs: number;
}

export type EngineResult = EngineRunSuccess | EngineRunError;

/** 引擎可用性探测结果 */
export interface EngineAvailability {
  available: boolean;
  /** 不可用原因(模型缺失 / exe 缺失 / sidecar 未启动等) */
  reason?: string;
}

/** 引擎统一接口 —— 5 个引擎都实现此 */
export interface EngineRunner {
  readonly id: VecMode;
  /** 引擎是否可用(模型在 / exe 存在 / sidecar reachable);UI 用于灰按钮 */
  isAvailable(): Promise<EngineAvailability>;
  /** 跑一次推理。signal 允许取消(目前只对 spawn/HTTP 引擎有效)。 */
  run(input: EngineRunInput, signal?: AbortSignal): Promise<EngineResult>;
}

// ── SVG 后处理 ───────────────────────────────────────────────────

export interface SvgStats {
  hasSvgTag: boolean;
  hasCloseTag: boolean;
  xmlValid: boolean;
  hasViewBox: boolean;
  pathCount: number;
  rectCount: number;
  circleCount: number;
  ellipseCount: number;
  polygonCount: number;
  polylineCount: number;
  lineCount: number;
  textCount: number;
  /** path 总数 + 其他可见元素总数 */
  visibleElementCount: number;
  colorCount: number;
  /** 所有 path 的 d 命令字符数之和(近似节点数) */
  nodeCount: number;
  fileSizeBytes: number;
  /** 末尾 400 字符里 30-char 子串 ≥ 4 次出现的比例 */
  duplicateCoordRatio: number;
  /** 完全相同 path d 的比例 */
  duplicatePathRatio: number;
}

export interface PostprocessOptions {
  /** 限制 path 总数(超出按面积排序删尾部) */
  maxPaths?: number;
  /** 同色合并 delta(0-255 RGB Euclidean) */
  colorMergeDelta?: number;
  /** 删除面积小于该比例的 path(0-1) */
  minAreaRatio?: number;
}

export interface PostprocessResult {
  /** Cleaner 后的字符串(剥 markdown / 提取 <svg>) */
  cleaned: string;
  /** Repair 后的字符串(补 viewBox / 闭合) */
  repaired: string;
  /** 最终 SVG(已 simplify) */
  final: string;
  /** 统计 */
  stats: SvgStats;
  /** 0-100 评分 */
  score: number;
  /** 评分档位 */
  tier: VecQualityTier;
  /** Cleaner 是否动了原文 */
  cleanerActed: boolean;
  /** Repair 是否动了原文 */
  repairActed: boolean;
  /** Simplifier 是否动了原文 */
  simplifierActed: boolean;
  /** 评分维度详情(供 debug + UI 解释) */
  scoreBreakdown: Record<string, number>;
}

// ── 报告 / 任务 ──────────────────────────────────────────────────

/** 每次任务的完整报告,落 debug/<ts>/report.json 也回填 vectorize_history.report_json_path */
export interface VecReport {
  taskId: string;
  batchId: string | null;
  timestamp: string; // ISO 8601
  // 输入
  inputPath: string;
  inputSizeBytes: number;
  inputWidth: number | null;
  inputHeight: number | null;
  inputMode: string | null; // PIL mode 风格:RGB / RGBA / L
  preprocessedPath: string | null;
  preprocessedSize: [number, number] | null;
  // 模式 / 引擎
  requestedMode: VecMode;
  actualEngine: VecMode;
  fellBack: boolean;
  fallbackReason: string | null;
  engineModelName: string | null;
  engineModelPath: string | null;
  // 性能
  durationMs: number;
  engineRawOutputChars: number;
  // SVG 统计(stats 字段平铺)
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
  // 评分
  qualityScore: number;
  qualityTier: VecQualityTier;
  // 错误
  engineErrorCode: AppErrorCode | null;
  engineErrorMessageZh: string | null;
  engineErrorHint: string | null;
  engineErrorTag: string | null;
  userSuggestion: string | null;
  // 引擎专属(原始 meta)
  engineMeta: Record<string, unknown> | null;
}

// ── 任务 / 批次 ──────────────────────────────────────────────────

export interface VecBatchOptions {
  outputDir: string;
  naming: 'original' | 'suffix';
  onConflict: 'overwrite' | 'skip' | 'rename';
}

export interface VecTaskRecord {
  taskId: string;
  batchId: string;
  /** 用户选择的模式(永远是这个,不会被回退改) */
  requestedMode: VecMode;
  /** 实际跑成功的引擎(失败回退时 != requestedMode) */
  actualEngine: VecMode | null;
  /** 是否发生回退 */
  fellBack: boolean;
  fallbackReason: string | null;
  inputPath: string;
  outputPath: string;
  status: VecTaskStatus;
  progress: number;
  message: string;
  errorCode: AppErrorCode | null;
  errorMessageZh: string | null;
  errorHint: string | null;
  /** 引擎报的细分错误标签(用于 report.engine_error_tag) */
  errorTag: string | null;
  durationMs: number | null;
  /** 0-100 质量评分(任务完成后填) */
  qualityScore: number | null;
  /** debug/<ts>/ 目录绝对路径(供 UI "查看调试" 链接) */
  reportDir: string | null;
  params: VecParams;
  submittedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface VecBatchRecord {
  batchId: string;
  /** 用户提交时选的模式 */
  requestedMode: VecMode;
  status: VecBatchStatus;
  options: VecBatchOptions;
  taskIds: string[];
  createdAt: number;
}

export interface VecBatchProgressEvent {
  batchId: string;
  requestedMode: VecMode;
  status: VecBatchStatus;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  fellBackCount: number;
  etaSeconds: number | null;
  avgPerTaskMs: number | null;
}

export interface VecTaskProgressEvent {
  batchId: string;
  taskId: string;
  requestedMode: VecMode;
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
  errorTag: string | null;
  reportDir: string | null;
}

export interface VecHistoryRow {
  id: number;
  createdAt: string;
  batchId: string | null;
  /** 沿用旧列名 mode,实际存 actualEngine */
  mode: VecMode;
  /** v13 新加 */
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

// ── 图片类型检测 ──────────────────────────────────────────────────

export type ImageTypeTag =
  | 'bw-lineart'         // 黑白线稿
  | 'mono-logo'          // 单色 logo
  | 'color-logo'         // 彩色 logo
  | 'flat-illustration'  // 扁平插画
  | 'icon'               // 图标
  | 'complex-photo'      // 复杂照片
  | 'gradient-photo'     // 渐变光影
  | 'text-image'         // 文字图
  | 'transparent-bg';    // 透明背景

export interface ImageTypeDetection {
  tag: ImageTypeTag;
  /** 置信度 0-1 */
  confidence: number;
  /** 推荐模式排序(第一个最优) */
  recommendedModes: VecMode[];
  /** 人话解释 */
  reasonZh: string;
  /** 提取出的图像特征(供 debug) */
  features: {
    width: number;
    height: number;
    distinctColors: number;
    hasAlpha: boolean;
    edgeDensity: number;        // 0-1 拉普拉斯响应密度
    saturationMean: number;     // 0-255
    saturationStd: number;
    isMostlyBW: boolean;
  };
}
