/**
 * 本地大模型推理降效（§本地模型运行时的性能处理规范）：
 * 内嵌 llama.cpp 在主进程异步推理不堵事件循环，但 GPU 推理与界面合成**物理上抢同一块显卡**。
 * 推理进行中给 <html> 打 data-busy="true"（CSS 停装饰动画，进度/spinner 豁免，逻辑同 data-idle），
 * 推理结束移除 —— 把 GPU 让给推理，界面交互仍流畅。
 *
 * 引用计数：多路并发推理（聊天 + 画布 LLM 节点）都结束才解除。
 */
import { useSettingsStore } from '@/store/settingsStore';

let depth = 0;

/** 该对话模型显示名是否映射到「本地大模型」配置（official_kind='local'）。 */
export function isLocalChatModel(modelId: string): boolean {
  if (!modelId) return false;
  const { configs } = useSettingsStore.getState();
  for (const c of configs) {
    if (c.type === 'text' && c.official_kind === 'local' && c.model_mapping && modelId in c.model_mapping) {
      return true;
    }
  }
  return false;
}

/**
 * 标记一次本地推理开始；返回「结束」回调（幂等，必须在完成/失败/取消时调用）。
 * 非本地模型返回 no-op —— 调用方无需自行判断。
 */
export function beginLocalLlmBusy(modelId: string): () => void {
  if (!isLocalChatModel(modelId)) return () => undefined;
  depth += 1;
  if (depth === 1) document.documentElement.dataset.busy = 'true';
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0) delete document.documentElement.dataset.busy;
  };
}
