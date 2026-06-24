// 视频节点参数记忆：每次成功提交视频任务时记下本次参数，新建视频节点直接继承，
// 免得每个新节点都从头选 模型/模式/时长/画幅/分辨率（用户反馈「视频生成不够便捷」）。
// 独立小模块：smartCanvasRunner（写）与 smartCanvasStore（读）都依赖它，避免互相 import 成环。

const KEY = 'mengbi.sc.videoDefaults.v1';

export interface VideoNodeDefaults {
  modelId?: string;
  mode?: string;
  duration?: string;
  aspect?: string;
  resolution?: string;
  generateAudio?: boolean;
}

export function saveVideoNodeDefaults(d: VideoNodeDefaults): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // localStorage 配额满/不可用时静默放弃（只是便捷项，不影响生成）
  }
}

export function loadVideoNodeDefaults(): VideoNodeDefaults | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as unknown;
    return j && typeof j === 'object' ? (j as VideoNodeDefaults) : null;
  } catch {
    return null;
  }
}
