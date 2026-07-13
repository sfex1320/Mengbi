import { useState } from 'react';
import { explainNodeError } from '@/lib/smartCanvasRunner';

/**
 * 「🤖 AI 解释」：生图 / ComfyUI / 视频节点失败时，紧挨错误文案的小按钮。
 * 为什么独立成组件：三类节点共用同一交互（请求中转圈 + 防重复点击），而诊断上下文的
 * 组装与调用放在 smartCanvasRunner.explainNodeError（模块级，切页/切档不受组件卸载影响）
 * ——组件只管按钮态，不做业务。样式全部复用现有 mb-btn 体系，不新增 class。
 */
export function ExplainErrorButton({ nodeId }: { nodeId: string }): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="mb-btn mb-btn-sm mb-btn-ghost nodrag"
      disabled={busy}
      title="让 AI 用大白话解释这次失败：可能原因 + 怎么办（一次文本调用，不产生生图费用）"
      onClick={(e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        // 失败原因在 explainNodeError 内部 toast；这里只兜底复位按钮态（catch 防未处理 rejection）
        explainNodeError(nodeId)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      {busy ? '诊断中…' : '🤖 AI 解释'}
    </button>
  );
}
