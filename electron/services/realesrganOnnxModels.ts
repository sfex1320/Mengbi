/**
 * Real-ESRGAN ONNX 模型注册表(2026-05-29 修订:只列"有公开 .onnx 源的内置")。
 *
 * 注意:本清单只是「软件出厂内置可一键下载的 .onnx 模型」。
 *
 * 用户上传自己的 .onnx(包括从 chaiNNer / spandrel 转的社区模型如 4xHFA2k / 4xLSDIR 系)
 * 都走「自由导入」路径,在 设置 → 工具箱 → ONNX 模型库 选自己的 .onnx + 指定分类。
 * 那一批 Phips / Helaman 的 CC-BY-4.0 模型只有 .pth/.safetensors 公开发布,需用户自转,
 * 故不进入本内置清单 —— 见 src/lib/upscaleModes.ts 的 COMMUNITY_REFERENCE 表(参考用)。
 *
 * 全替代 PyTorch sidecar 路径:
 *   - 无 Python / 无 sidecar / 无端口 / 无冷启动
 *   - onnxruntime-node 直接在 Electron 主进程跑(Windows = DirectML EP)
 *
 * 分类(categoryHint)— 与前端 UpscaleModeId 一一对应:
 *   - 'general-hd'    通用高清(写实照片 / 商品图 / 设计稿)
 *   - 'general-fast'  通用快速(轻量 SRVGGNetCompact / 批量预览)
 *   - 'anime-illust'  动漫插画(二次元 / 漫画 / 线稿)
 *   - 'anime-video'   动漫视频帧
 *   - 'sharpen'       清晰增强(社区强化 / 锐化 / 修压缩)
 */

/** 与前端 src/lib/upscaleModes.ts 的 UpscaleModeId 必须一致 */
export type UpscaleModeId =
  | 'smart'
  | 'general-hd'
  | 'general-fast'
  | 'anime-illust'
  | 'anime-video'
  | 'sharpen'
  | 'custom';

export interface OnnxModelSpec {
  /** 内部稳定 id(对应前端 mode 配置的 onnxIdealId / onnxAlternativeIds) */
  id: string;
  /** UI 友好显示名 */
  displayName: string;
  /** 一句话描述 */
  description: string;
  /** 许可与出处 */
  licenseNote: string;
  /** 该模型契合的分类 — Settings 据此分组渲染 */
  categoryHint: UpscaleModeId;
  /** 落盘文件名(放在 onnxModelsDir() 下) */
  fileName: string;
  /** 期望大小(byte),用于完整性 sanity check */
  expectedBytes: number;
  /** 该模型固定输出倍率(4x / 2x);Real-ESRGAN 主流都是 4x */
  nativeScale: 2 | 3 | 4;
  /** 网络架构标记(诊断用) */
  arch: 'RRDBNet' | 'SRVGGNetCompact';
  /** 下载源链表(顺序 = 重试顺序) */
  sources: Array<{ name: 'hf' | 'hf-mirror' | 'github'; url: string }>;
}

/** HF 镜像优先 + HF 原站备援的双源 builder */
function huggingfaceSources(
  repo: string,
  filePath: string
): Array<{ name: 'hf' | 'hf-mirror'; url: string }> {
  return [
    {
      name: 'hf-mirror',
      url: `https://hf-mirror.com/${repo}/resolve/main/${filePath}?download=true`
    },
    {
      name: 'hf',
      url: `https://huggingface.co/${repo}/resolve/main/${filePath}?download=true`
    }
  ];
}

/**
 * 5 个内置可下载 .onnx(全部 HF public,动态 shape 导出版本)。
 *
 * 数据来源(2026-05-29 调研):
 *   - yuvraj108c/ComfyUI-Upscaler-Onnx:ComfyUI 社区收纳的 4× 上采器
 *   - Kim2091/UltraSharp:UltraSharp 作者本人的 fp32 / fp16 ONNX
 *   - OwlMaster/AllFilesRope:realesr-general-x4v3 4.87 MB 轻量
 */
export const ONNX_MODELS: OnnxModelSpec[] = [
  {
    id: 'realesrgan-x4plus',
    displayName: 'Real-ESRGAN x4+ (官方通用)',
    description: '通用真实风,适合照片 / 商品图 / 设计稿。',
    licenseNote: 'Apache 2.0 · xinntao 官方',
    categoryHint: 'general-hd',
    fileName: 'RealESRGAN_x4.onnx',
    expectedBytes: 71_600_000,
    nativeScale: 4,
    arch: 'RRDBNet',
    sources: huggingfaceSources('yuvraj108c/ComfyUI-Upscaler-Onnx', 'RealESRGAN_x4.onnx')
  },
  {
    id: 'realesr-general-x4v3',
    displayName: 'realesr-general-x4v3 (官方轻量)',
    description: '4.87 MB 小模型,SRVGGNetCompact 架构,速度优先,CPU 也能跑。',
    licenseNote: 'Apache 2.0 · xinntao 官方',
    categoryHint: 'general-fast',
    fileName: 'realesr-general-x4v3.onnx',
    expectedBytes: 4_870_000,
    nativeScale: 4,
    arch: 'SRVGGNetCompact',
    sources: huggingfaceSources('OwlMaster/AllFilesRope', 'realesr-general-x4v3.onnx')
  },
  {
    id: '4x-ultrasharp',
    displayName: '4x-UltraSharp (社区强化)',
    description: 'UltraSharp 锐化向社区模型,适合纹理 / 老图。可能产生假细节,慎用于人像。',
    licenseNote: 'CC BY-NC-SA 4.0 · 个人 / 非商用',
    categoryHint: 'sharpen',
    fileName: '4x-UltraSharp-fp32-opset17.onnx',
    expectedBytes: 67_000_000,
    nativeScale: 4,
    arch: 'RRDBNet',
    sources: huggingfaceSources('Kim2091/UltraSharp', 'ONNX/4x-UltraSharp-fp32-opset17.onnx')
  },
  {
    id: '4x-remacri',
    displayName: '4x-Remacri (社区写实强化)',
    description: 'Remacri 细节向社区模型,适合模糊图 / 纹理增强。',
    licenseNote: 'CC BY-NC-SA · 非商用',
    categoryHint: 'sharpen',
    fileName: '4x_foolhardy_Remacri.onnx',
    expectedBytes: 71_600_000,
    nativeScale: 4,
    arch: 'RRDBNet',
    sources: huggingfaceSources('yuvraj108c/ComfyUI-Upscaler-Onnx', '4x_foolhardy_Remacri.onnx')
  },
  {
    id: '4x-nmkd-siax',
    displayName: '4x_NMKD-Siax_200k (社区通用锐化)',
    description: 'NMKD Siax 200k 步训练,通用锐化型放大,适合纹理 / 中等模糊。',
    licenseNote: 'WTFPL-ish · 自由再分发 · NMKD 原作',
    categoryHint: 'sharpen',
    fileName: '4x_NMKD-Siax_200k.onnx',
    expectedBytes: 71_600_000,
    nativeScale: 4,
    arch: 'RRDBNet',
    sources: huggingfaceSources(
      'yuvraj108c/ComfyUI-Upscaler-Onnx',
      '4x_NMKD-Siax_200k.onnx'
    )
  }
];

export function findOnnxSpec(id: string): OnnxModelSpec | undefined {
  return ONNX_MODELS.find((m) => m.id === id);
}

export function findOnnxSpecByFile(fileName: string): OnnxModelSpec | undefined {
  return ONNX_MODELS.find((m) => m.fileName.toLowerCase() === fileName.toLowerCase());
}

/** 同分类下的所有内置模型(用于 Settings 分组渲染) */
export function modelsForCategory(category: UpscaleModeId): OnnxModelSpec[] {
  return ONNX_MODELS.filter((m) => m.categoryHint === category);
}
