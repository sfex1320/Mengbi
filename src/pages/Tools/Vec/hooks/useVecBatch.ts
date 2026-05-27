/**
 * 订阅 'vec:progress' / 'vec:batch-progress' 推送,把数据汇入 vecStore。
 *
 * mount 一次即可(放在 VecPanel 顶层),unmount 自动解绑。
 */
import { useEffect } from 'react';
import { useVecStore } from '@/store/vecStore';
import type { VecTaskProgressPayload, VecBatchProgressPayload } from '@/types/ipc';

export function useVecProgressBridge(): void {
  const applyTaskProgress = useVecStore((s) => s.applyTaskProgress);
  const applyBatchProgress = useVecStore((s) => s.applyBatchProgress);

  useEffect(() => {
    const off1 = window.electronAPI.on('vec:progress', (raw) => {
      applyTaskProgress(raw as VecTaskProgressPayload);
    });
    const off2 = window.electronAPI.on('vec:batch-progress', (raw) => {
      applyBatchProgress(raw as VecBatchProgressPayload);
    });
    return () => {
      off1();
      off2();
    };
  }, [applyTaskProgress, applyBatchProgress]);
}
