/**
 * ComfyUI 节点 class_type → 中文名、端口名 → 中文 的速查表。
 * 用于节点图把英文节点/连线显示成中文，方便核对。未命中则回退原英文。
 */

const NODE_ZH: Record<string, string> = {
  KSampler: '采样器',
  KSamplerAdvanced: '采样器(高级)',
  SamplerCustom: '自定义采样',
  SamplerCustomAdvanced: '自定义采样(高级)',
  CheckpointLoaderSimple: '模型加载',
  CheckpointLoader: '模型加载',
  UNETLoader: 'UNet 加载',
  CLIPLoader: 'CLIP 加载',
  DualCLIPLoader: '双 CLIP 加载',
  CLIPTextEncode: '提示词编码',
  CLIPTextEncodeSDXL: '提示词编码(SDXL)',
  CLIPSetLastLayer: 'CLIP 跳层',
  EmptyLatentImage: '空白潜空间',
  EmptySD3LatentImage: '空白潜空间(SD3)',
  LatentUpscale: '潜空间放大',
  LatentUpscaleBy: '潜空间放大(倍数)',
  VAEDecode: 'VAE 解码',
  VAEEncode: 'VAE 编码',
  VAEEncodeForInpaint: 'VAE 编码(重绘)',
  VAELoader: 'VAE 加载',
  SaveImage: '保存图片',
  PreviewImage: '预览图片',
  LoadImage: '加载图片',
  LoadImageMask: '加载遮罩',
  ImageScale: '缩放图片',
  ImageScaleBy: '缩放图片(倍数)',
  ImageUpscaleWithModel: '模型放大',
  UpscaleModelLoader: '放大模型加载',
  LoraLoader: 'LoRA 加载',
  LoraLoaderModelOnly: 'LoRA 加载(仅模型)',
  ControlNetLoader: 'ControlNet 加载',
  ControlNetApply: '应用 ControlNet',
  ControlNetApplyAdvanced: '应用 ControlNet(高级)',
  ConditioningCombine: '条件合并',
  ConditioningConcat: '条件拼接',
  ConditioningSetArea: '条件区域',
  ConditioningZeroOut: '条件清零',
  InpaintModelConditioning: '重绘条件',
  FluxGuidance: 'Flux 引导',
  ModelSamplingFlux: 'Flux 采样设置',
  ModelSamplingSD3: 'SD3 采样设置',
  VHS_VideoCombine: '合成视频',
  SaveVideo: '保存视频',
  PrimitiveNode: '输入节点',
  Note: '便签',
  Reroute: '中转'
};

const PORT_ZH: Record<string, string> = {
  model: '模型',
  clip: 'CLIP',
  vae: 'VAE',
  positive: '正向条件',
  negative: '负向条件',
  conditioning: '条件',
  latent: '潜空间',
  latent_image: '潜空间',
  samples: '潜空间',
  image: '图像',
  images: '图像',
  pixels: '像素',
  mask: '遮罩',
  control_net: 'ControlNet',
  clip_vision: 'CLIP 视觉',
  upscale_model: '放大模型',
  filename_prefix: '文件名',
  guider: '引导器',
  sampler: '采样器',
  sigmas: '噪声表'
};

/** class_type → 中文（未命中回退原文）。 */
export function nodeNameZh(classType: string): string {
  return NODE_ZH[classType] ?? classType;
}

/** 连线（按目标输入端口名）→ 中文功能描述，例如 KSampler.model → "模型"。 */
export function portNameZh(inputName: string): string {
  return PORT_ZH[inputName] ?? inputName;
}
