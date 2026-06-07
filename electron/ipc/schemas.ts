import { z } from 'zod';

/**
 * IPC 入参 zod schemas。所有 handler 必须经过这里 .parse() 校验。
 * 详见 CLAUDE.md §8 与 ARCHITECTURE.md §6（输入校验）。
 */

// 对旧值容错：把已废弃的 kimi/minimax/glm/deepseek 当 openai-compat 处理。
// 'local' 表示本地大模型（llama.cpp/Ollama/LM Studio），主进程会按 local_model_path
// 启动内嵌 llama-cpp 服务（或当 base_url 非空时用外部服务）。
const officialKindSchema = z
  .enum(['openai', 'anthropic', 'gemini', 'openai-compat', 'local', 'kimi', 'minimax', 'glm', 'deepseek'])
  .nullable()
  .transform((v) => {
    if (v === 'kimi' || v === 'minimax' || v === 'glm' || v === 'deepseek') {
      return 'openai-compat' as const;
    }
    return v;
  });

const imageKindSchema = z
  .enum(['openai', 'grsai', 'apimart', 'gemini', 'openai-compat', 'openai-responses', 'comfyui'])
  .nullable();

const videoKindSchema = z.enum(['kling', 'sora', 'unified']).nullable();

const apiConfigInputSchema = z.object({
  id: z.number().int().optional(),
  plan_id: z.number().int().nonnegative(),
  type: z.enum(['image', 'text', 'video']),
  provider_name: z.string().min(1).max(100),
  // base_url 通常是 URL；'local' 类型允许空字符串（用内嵌服务时不需要外部地址）
  base_url: z
    .string()
    .max(2048)
    .refine(
      (v) => v === '' || /^[a-z]+:\/\//i.test(v),
      { message: '需要以 http(s):// 开头，或留空（仅 local 类型可空）' }
    ),
  // 编辑已存在配置时可以为空字符串（表示保留原密文 Key）；新增时由前端校验非空
  api_key_plain: z.string().max(2048),
  model_mapping: z.record(z.string(), z.string()),
  is_official: z.boolean(),
  supports_web_search: z.boolean(),
  supports_vision: z.boolean(),
  official_kind: officialKindSchema,
  image_kind: imageKindSchema,
  // 视频协议变种（仅 type='video' 用）；其它类型传 null / 省略
  video_kind: videoKindSchema.optional(),
  // 高级请求体覆盖：null / 空字符串 = 不覆盖；否则必须是合法 JSON 对象顶层（不能是数组或基本值）。
  body_overrides_json: z
    .string()
    .nullable()
    .refine(
      (v) => {
        if (v == null || v.trim() === '') return true;
        try {
          const parsed = JSON.parse(v);
          return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
        } catch {
          return false;
        }
      },
      { message: '必须是合法 JSON 对象，或留空' }
    ),
  // ComfyUI workflow JSON：仅 image_kind='comfyui' 时使用；空 / null = 未配
  comfyui_workflow_json: z
    .string()
    .nullable()
    .refine(
      (v) => {
        if (v == null || v.trim() === '') return true;
        try {
          const parsed = JSON.parse(v);
          return typeof parsed === 'object' && parsed !== null;
        } catch {
          return false;
        }
      },
      { message: 'ComfyUI workflow 必须是合法 JSON，或留空' }
    )
    .optional(),
  // 本地模型路径：仅 official_kind='local' 时使用
  local_model_path: z.string().max(2048).nullable().optional(),
  // 思考模式（仅 type='text' 用；image 类型也允许传以兼容统一表单，但运行时不读）
  supports_thinking: z.boolean().optional().default(false),
  thinking_effort: z.enum(['low', 'medium', 'high', 'max']).nullable().optional(),
  // 厂商图标：lobehub slug（如 'openai' / 'anthropic'）或 data:image/... 自定义 dataURI；null = 未指定
  icon: z.string().max(2_000_000).nullable().optional(),
  // 边缘代理硬超时秒数：只读、由主进程在 isHardProxyTimeout 命中时自动写。
  // 允许前端透传以便编辑流程不丢字段；主进程 upsertConfig 会无视前端值，以 DB 现存值为准。
  proxy_timeout_seconds: z.number().int().positive().nullable().optional()
});

export const SaveSettingsSchema = z.object({
  configs: z.array(apiConfigInputSchema).optional(),
  prefs: z.record(z.string(), z.string()).optional()
});

export const TestConnectionSchema = z.object({
  base_url: z.string().url(),
  api_key_plain: z.string().min(1),
  type: z.enum(['image', 'text', 'video']),
  model_id: z.string().optional()
});

export const PlanUpsertSchema = z.object({
  id: z.number().int().optional(),
  name: z.string().min(1).max(100)
});

export const ChatSendSchema = z.object({
  conversationId: z.string().min(1),
  content: z.string().max(50_000),
  /** 用户消息附带的图片（data URI / https URL）；提交时由后端拼成多模态消息 */
  attachedImages: z.array(z.string()).max(16).optional(),
  /**
   * 本轮强制启用代搜(忽略 api_configs.supports_web_search)。
   * UI 上聊天框的 🌐 toggle 勾上时为 true。
   * 与 search_backend 配合: backend ∈ {ddg,tavily,searxng} 时才会真正搜;
   * 若 backend='off' 或 'native' 仍不会发起代搜(避免误导)。
   */
  forceWebSearch: z.boolean().optional()
});

export const ImageGenerateSchema = z.object({
  modelId: z.string().min(1),
  positivePrompt: z.string().min(1).max(20_000),
  negativePrompt: z.string().max(20_000).optional(),
  params: z.record(z.string(), z.unknown()),
  referenceImages: z.array(z.string()).max(16).optional()
});

// AI 视频生成（异步任务）。params 自由透传：mode/duration/resolution/aspect/seed/image/imageTail/size 等
export const VideoGenerateSchema = z.object({
  modelId: z.string().min(1),
  prompt: z.string().max(20_000),
  negativePrompt: z.string().max(20_000).optional(),
  params: z.record(z.string(), z.unknown())
});

export const VideoCancelSchema = z.string().min(1);

export const VideoSaveThumbSchema = z.object({
  imageId: z.number().int(),
  dataUri: z.string().min(10)
});

export const ThemeSaveSchema = z.object({
  name: z.string().min(1).max(50),
  atmosphere: z.string(),
  palette: z.string()
});

// ─────────────────────────────────────────────────────
// 放大引擎（Real-ESRGAN ncnn Vulkan + HYPIR 占位）
// ─────────────────────────────────────────────────────

/** Real-ESRGAN ncnn 二进制内置的模型名（archive 解出来即有） */
const REALESRGAN_BUILTIN_MODELS = z.enum([
  'realesr-animevideov3',
  'realesrgan-x4plus',
  'realesrgan-x4plus-anime',
  'realesrnet-x4plus'
]);

/** 用户实际选用的模型——允许任意字符串以兼容自行扔进 models/ 的额外 .bin/.param 对 */
const REALESRGAN_MODEL_NAME = z.union([
  REALESRGAN_BUILTIN_MODELS,
  z.string().min(1).max(120).regex(/^[A-Za-z0-9._\-]+$/, '模型名只允许字母数字 . _ -')
]);

export const UpscaleEngineInstallSchema = z.object({
  /** 'github' = 官方直链；'mirror' = 国内镜像（多家轮转）；'auto' = 直链失败回退镜像 */
  source: z.enum(['github', 'mirror', 'auto']).default('auto')
});

/** 本地 zip 安装引擎 —— 网络全断的兜底 */
export const UpscaleEngineInstallFromZipSchema = z.object({
  /** 已经下到本地的官方 release zip 的绝对路径 */
  zipPath: z.string().min(1)
});

/** 本地 .bin/.param 文件导入 —— zip 没带模型时手动补 */
export const UpscaleImportLocalModelFilesSchema = z.object({
  /** 用户挑选的 .bin / .param 绝对路径，可一次传多个 */
  filePaths: z.array(z.string().min(1)).min(1).max(20)
});

// ─────────────────────────────────────────────────────
// HYPIR Portable
// ─────────────────────────────────────────────────────

export const HypirSetPortablePathSchema = z.object({
  /** 留空 = 清回默认（userData/engines/HYPIR_Portable） */
  path: z.string().max(1024)
});

export const HypirSubmitTaskSchema = z.object({
  /** 绝对路径或相对 portable/input 路径 */
  inputPath: z.string().min(1),
  outputPath: z.string().max(512).optional(),
  scale: z.number().int().min(2).max(10).default(4), // 2026-05-29: max(8) → max(10),放开 6/8/10
  prompt: z.string().max(2000).optional(),
  negativePrompt: z.string().max(2000).optional(),
  seed: z.number().int().optional(),
  tileSize: z.number().int().min(128).max(2048).optional(),
  device: z.enum(['cuda', 'cpu']).optional(),
  intensity: z.enum(['conservative', 'standard', 'strong']).default('conservative'),
  highlightProtection: z.boolean().optional(),
  disablePostsharpen: z.boolean().optional(),
  /** HYPIR 修复深度（控制 model_t = coeff_t）；50–400，默认 200。
   *  改值会触发服务端 ~30s 重加载模型，UI 应有提示。 */
  restorationDepth: z.number().int().min(50).max(400).optional()
});

export const HypirTaskIdSchema = z.object({
  taskId: z.string().min(1)
});

// SUPIR schemas 已于 2026-05-29 砍除(显存需求过大,常见配置带不动)

export const UpscaleModelInstallSchema = z.object({
  modelName: z.string().min(1).max(120).regex(/^[A-Za-z0-9._\-]+$/),
  source: z.enum(['github', 'mirror', 'auto']).default('auto')
});

const UpscaleCommonOptions = z.object({
  modelName: REALESRGAN_MODEL_NAME,
  scale: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  format: z.enum(['png', 'jpg', 'webp']),
  /** 0 = auto（ncnn 让其自动按显存推断;onnx 用默认 256） */
  tile: z.number().int().min(0).max(4096).default(0),
  /** ncnn-only:'auto' 或 GPU 索引 */
  gpuId: z.union([z.literal('auto'), z.number().int().min(0).max(7)]).default('auto'),
  /** ncnn-only:TTA(test-time augmentation)— 8 倍耗时,约 +0.1dB;默认关 */
  tta: z.boolean().default(false),
  /** 跑哪个后端;默认 ncnn。'onnx' 走 onnxruntime-node 主进程(DirectML/CoreML/CUDA + CPU 回退) */
  backend: z.enum(['ncnn', 'onnx']).default('ncnn'),
  /** 保留 alpha 通道(PNG/WebP 才有效;ncnn 自动保留,onnx 用 sharp 处理) */
  keepAlpha: z.boolean().default(true)
});

export const UpscaleRunSingleSchema = z
  .object({
    /** 二选一：直接给 dataUri 或给现有文件路径 */
    inputDataUri: z.string().optional(),
    inputPath: z.string().optional(),
    /** 可选：指定输出目录与文件名，未给则落到 tools_storage_path 的 upscale 子目录 */
    outputDir: z.string().optional(),
    outputFileName: z.string().max(180).optional()
  })
  .merge(UpscaleCommonOptions)
  .refine(
    (v) => !!(v.inputDataUri && v.inputDataUri.length > 0) !== !!(v.inputPath && v.inputPath.length > 0),
    { message: 'inputDataUri 或 inputPath 必须二选一' }
  );

export const UpscaleRunBatchSchema = z
  .object({
    inputPaths: z.array(z.string().min(1)).min(1).max(200),
    outputDir: z.string().optional()
  })
  .merge(UpscaleCommonOptions);

export const UpscaleCancelSchema = z.object({
  taskId: z.string().min(1).optional()
});

export const UpscaleRemoveModelSchema = z.object({
  modelName: z.string().min(1).max(120).regex(/^[A-Za-z0-9._\-]+$/)
});

// ───────────────────────── ComfyUI 通用工作流编排器 ─────────────────────────

export const ComfyuiSetConfigSchema = z.object({
  host: z.string().max(256).optional(),
  launchCommand: z.string().max(2000).optional(),
  launchCwd: z.string().max(2000).optional(),
  authToken: z.string().max(2000).nullable().optional()
});

export const ComfyuiDetectSchema = z
  .object({ host: z.string().max(256).optional() })
  .nullable()
  .optional();

export const ComfyuiScanLaunchSchema = z.object({
  dir: z.string().min(1).max(4000)
});

export const ComfyuiImportSchema = z.object({
  json: z.string().min(1).max(20_000_000)
});

export const ComfyuiTemplateUpsertSchema = z.object({
  workflowId: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  typeTags: z.array(z.string().max(40)).max(20).optional(),
  originalApiWorkflowJson: z.string().min(1).max(20_000_000),
  objectInfoSnapshot: z.string().nullable().optional(),
  inputControls: z.array(z.unknown()).optional(),
  outputControls: z.array(z.unknown()).optional(),
  bindings: z.array(z.unknown()).optional(),
  loopConfig: z.unknown().optional(),
  uiLayout: z.unknown().optional()
});

export const ComfyuiWorkflowIdSchema = z.object({ workflowId: z.string().min(1) });

export const ComfyuiRunSingleSchema = z
  .object({
    workflowId: z.string().min(1).optional(),
    workflowJson: z.string().min(1).max(20_000_000).optional(),
    controlValues: z.record(z.string(), z.unknown()).optional(),
    controls: z.array(z.unknown()).optional(),
    bindings: z.array(z.unknown()).optional(),
    outputNodeIds: z.array(z.string().min(1)).max(500).optional()
  })
  .refine((v) => !!v.workflowId || !!v.workflowJson, {
    message: '需要 workflowId 或 workflowJson'
  });

export const ComfyuiRunBatchSchema = z.object({
  workflowId: z.string().min(1).optional(),
  workflowJson: z.string().min(1).max(20_000_000).optional(),
  controlValues: z.record(z.string(), z.unknown()).optional(),
  controls: z.array(z.unknown()).optional(),
  bindings: z.array(z.unknown()).optional(),
  outputNodeIds: z.array(z.string().min(1)).max(500).optional(),
  loopConfig: z.unknown()
});

export const ComfyuiFreeMemorySchema = z.object({
  unloadModels: z.boolean().optional(),
  freeMemory: z.boolean().optional()
});

export const ComfyuiCancelSchema = z.object({
  batchId: z.string().optional(),
  runId: z.string().optional()
});

export const ComfyuiResultsListSchema = z.object({
  templateId: z.string().optional(),
  batchId: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional()
});

export const ComfyuiResultsDeleteSchema = z.object({
  runId: z.string().optional(),
  batchId: z.string().optional()
});

export const ComfyuiResultsExportSchema = z.object({
  runIds: z.array(z.string().min(1)).min(1).max(2000),
  outputDir: z.string().min(1)
});

export const ComfyuiResultsToGallerySchema = z.object({
  runIds: z.array(z.string().min(1)).min(1).max(2000)
});

export const ComfyuiBatchIdSchema = z.object({ batchId: z.string().min(1) });
export const ComfyuiRunIdSchema = z.object({ runId: z.string().min(1) });
