/**
 * 工具箱顶部"一键清理"栏 —— 显存 + GPU 缓存 + Python heap。
 *
 * 设计:
 *   - 唯一按钮"清理显存与缓存",所有 AI sidecar(HYPIR / SUPIR / 未来的)
 *     都走 api:ai-feature:cleanup-all 一把梭
 *   - 复选框"同时卸载内存中的模型"
 *     不勾 = 模型继续在显存,只清临时张量 / fragment / IPC 句柄(快,~100ms)
 *     勾上 = 把模型也从显存卸下(彻底,下次推理要重新加载 30-60s)
 *   - 完成后用 toast 报"释放了 X MB"
 *
 * 这个栏取代了:
 *   - HypirPanel 里的 "卸载模型" 按钮(2 处)
 *   - SupirPanel 里的 "卸载模型" 按钮(2 处)
 *   一处统一入口,逻辑更清晰
 */
import { useState } from 'react';
import { toast } from '@/store/toastStore';
import { TrashIcon } from '@/components/Icon';

export function CleanupBar(): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [alsoUnload, setAlsoUnload] = useState(false);

  async function doCleanup(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.aiFeature.cleanupAll({ unloadModels: alsoUnload });
      if (!r.ok) {
        toast.error('清理失败', r.error.message);
        return;
      }
      const { results, totalFreedMb, unloadedCount, reachableCount } = r.data;
      if (reachableCount === 0) {
        toast.info('无可清理项', '没有 AI 服务在跑');
        return;
      }
      const lines: string[] = [];
      lines.push(`共扫到 ${reachableCount} 个运行中的 AI sidecar`);
      if (totalFreedMb > 0) {
        lines.push(`释放显存 ${totalFreedMb} MB`);
      }
      if (alsoUnload && unloadedCount > 0) {
        const unloadedIds = results.filter((x) => x.unloaded).map((x) => x.featureId).join('、');
        lines.push(`卸载模型: ${unloadedIds}`);
      }
      // 每个 feature 细分
      const details = results
        .filter((x) => x.reachable)
        .map((x) => {
          const freed = x.vramFreedMb !== null ? `释放 ${x.vramFreedMb} MB` : '';
          const after = x.vramAfterMb !== null ? `当前 ${x.vramAfterMb} MB` : '';
          const model = x.modelLoaded ? '模型仍在' : '模型已卸';
          return `${x.featureId}: ${[freed, after, model].filter(Boolean).join(' · ')}`;
        })
        .join('\n');
      toast.success('清理完成', `${lines.join(';  ')}\n\n${details}`);
    } catch (e) {
      toast.error('清理异常', String(e));
    } finally {
      setBusy(false);
    }
  }

  const btnTitle = alsoUnload
    ? '彻底清理:GPU 缓存 + Python heap + 卸载模型(下次推理要重新加载 30-60s)'
    : '快速清理:GPU 缓存 + Python heap(模型继续在显存,下次推理无延迟)';

  return (
    <div className="mb-tools-cleanup-bar">
      <button
        type="button"
        className="mb-btn mb-btn-ghost mb-btn-sm mb-tools-cleanup-btn"
        onClick={() => void doCleanup()}
        disabled={busy}
        title={btnTitle}
      >
        <TrashIcon size={13} />
        {busy ? '清理中…' : '清理显存与缓存'}
      </button>
      <label
        className="mb-tools-cleanup-checkbox"
        title="勾上后同时把已加载的模型从显存中移除。彻底但下次推理要重新加载 30-60s"
      >
        <input
          type="checkbox"
          checked={alsoUnload}
          onChange={(e) => setAlsoUnload(e.target.checked)}
          disabled={busy}
        />
        <span>卸载模型</span>
      </label>
    </div>
  );
}
