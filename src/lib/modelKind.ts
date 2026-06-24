/**
 * 按模型 ID 粗分类（纯启发式正则）。从 Settings 的 describeUpstreamModel 思路抽出为独立纯函数，
 * 便于「模型配置智能体」在无 supported_protocols 时按名分类，以及单测复用。
 */
export type ModelKind = 'image' | 'video' | 'embedding' | 'audio' | 'rerank' | 'chat';

/** 单个模型 id → 粗分类。顺序敏感：先判绘图（含 sora-image/gpt-image），再 embedding/rerank/audio/video，其余归对话。 */
export function modelKindOf(modelId: string): ModelKind {
  const id = (modelId ?? '').toLowerCase();
  if (/(image|dall|sdxl|flux|nano-banana|midjourney|sora-image|gpt-image)/.test(id)) return 'image';
  if (/(embedding|embed)/.test(id)) return 'embedding';
  if (/(rerank)/.test(id)) return 'rerank';
  if (/(audio|tts|whisper|voice|speech)/.test(id)) return 'audio';
  if (/(video|kling|seedance|veo|runway|hailuo|wan)/.test(id)) return 'video';
  return 'chat'; // vision / coder / 通用 都归对话
}

const KIND_LABEL: Record<ModelKind, string> = {
  image: '看起来是绘图模型',
  video: '看起来是视频模型',
  embedding: 'Embedding 模型',
  audio: '语音模型',
  rerank: '重排序模型',
  chat: '对话 / 多模态模型'
};

/** 一句话描述（展示用）。 */
export function describeModelKind(modelId: string): string {
  return KIND_LABEL[modelKindOf(modelId)];
}
