/**
 * 工具箱 · 图像转矢量主面板(v3 重设计,2026-05-27)。
 *
 * 新布局:
 *   ┌─ Header: ModeSelector + 全局动作(历史/输出/调试) ─────────────┐
 *   ├─ Main: 左 InputCard + 右 OutputCard(空/队列/详情 三态切换) ──┤
 *   └─ HistoryDrawer 抽屉 ──────────────────────────────────────────┘
 *
 * 与旧版相比:
 *   - 模式选择紧凑到单行
 *   - 输入卡集中所有"提交前"控件,设置默认折叠
 *   - 输出卡按状态自动切换,不再左右各占一半空着
 *   - 主操作"开始矢量化"内嵌在输入卡底部,跟文件列表贴近
 */
import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from '@/store/toastStore';
import { useVecStore } from '@/store/vecStore';
import { useSettingsStore } from '@/store/settingsStore';
import { VecModeSelector } from './Vec/ModeSelector';
import { InputCard } from './Vec/InputCard';
import { OutputCard } from './Vec/OutputCard';
import { VecHistoryDrawer } from './Vec/HistoryDrawer';
import { useVecProgressBridge } from './Vec/hooks/useVecBatch';
import { FolderIcon, WrenchIcon, BellIcon } from '@/components/Icon';
import type { VecParams } from '@/types/ipc';
import './Vec/VecPanel.css';

export function VecPanel(): JSX.Element {
  useVecProgressBridge();
  const { prefs } = useSettingsStore();
  const selectedMode = useVecStore((s) => s.selectedMode);
  const pendingInputs = useVecStore((s) => s.pendingInputs);
  const outputDir = useVecStore((s) => s.outputDir);
  const naming = useVecStore((s) => s.naming);
  const onConflict = useVecStore((s) => s.onConflict);
  const registerBatch = useVecStore((s) => s.registerBatch);
  const clearPending = useVecStore((s) => s.clearPendingInputs);
  const setShowExperimental = useVecStore((s) => s.setShowExperimental);
  const setModeAvailability = useVecStore((s) => s.setModeAvailability);

  const [submitting, setSubmitting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    setShowExperimental(prefs.vec_show_experimental === 'true');
  }, [prefs.vec_show_experimental, setShowExperimental]);

  // 探测每个模式的本地可用性
  useEffect(() => {
    // Fast / Crisp 永远可用
    setModeAvailability('vtracer', true);
    setModeAvailability('potrace', true);
    // Pro: 探测 autotrace.exe
    void window.electronAPI.vec.autotraceProbe().then((r) => {
      if (r.ok) setModeAvailability('autotrace', r.data.available);
    });
    // AI: 模型路径存在即激活按钮(具体是否能跑由 sidecar 状态在 InputCard 提示)
    void window.electronAPI.vec.starvectorProbe().then((r) => {
      if (r.ok) setModeAvailability('starvector', r.data.modelPathExists);
    });
    // Lab: Phase 4 时补
  }, [setModeAvailability]);

  const effectiveOutputDir = outputDir.trim() || resolveDefaultOutputDir(prefs);

  const handleSubmit = useCallback(
    async (params: VecParams) => {
      if (pendingInputs.length === 0) {
        toast.info('无输入', '拖入图片或点击选择文件');
        return;
      }
      setSubmitting(true);
      try {
        const r = await window.electronAPI.vec.runBatch({
          mode: selectedMode,
          inputs: pendingInputs,
          options: {
            outputDir: effectiveOutputDir,
            naming,
            onConflict
          },
          params
        });
        if (!r.ok) {
          toast.error('提交失败', r.error.message);
          return;
        }
        registerBatch(r.data.batchId, selectedMode, r.data.taskIds, r.data.taskIds.length);
        if (r.data.skippedExistingFiles > 0) {
          toast.info('跳过部分文件', `${r.data.skippedExistingFiles} 个文件不存在,已忽略`);
        }
        clearPending();
      } finally {
        setSubmitting(false);
      }
    },
    [pendingInputs, selectedMode, effectiveOutputDir, naming, onConflict, registerBatch, clearPending]
  );

  async function openDebugRoot(): Promise<void> {
    // 主进程内部解析 userData/vec-debug
    await window.electronAPI.vec.debugOpen({});
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="mb-vec-panel"
    >
      {/* ── 顶部条:模式 + 全局动作 ── */}
      <header className="mb-vec-header">
        <VecModeSelector />
        <div className="mb-vec-header-actions">
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => setHistoryOpen(true)}
            title="查看历史记录"
          >
            <BellIcon size={12} /> 历史
          </button>
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() =>
              void window.electronAPI.storage.openPath({
                targetPath: effectiveOutputDir,
                ensureDir: true
              })
            }
            title="打开输出目录"
          >
            <FolderIcon size={12} /> 输出
          </button>
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => void openDebugRoot()}
            title="打开调试目录(每次任务的 12 文件 + report.json)"
          >
            <WrenchIcon size={12} /> 调试
          </button>
        </div>
      </header>

      {/* ── 主体:左输入卡 + 右输出卡 ── */}
      <div className="mb-vec-main">
        <section className="mb-vec-main-left">
          <InputCard onSubmit={handleSubmit} submitting={submitting} />
        </section>
        <section className="mb-vec-main-right">
          <OutputCard />
        </section>
      </div>

      <VecHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </motion.div>
  );
}

function resolveDefaultOutputDir(prefs: { tools_storage_path?: string; image_storage_path?: string }): string {
  const base = prefs.tools_storage_path || prefs.image_storage_path || '';
  if (!base) return '';
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}vec` : `${base}${sep}vec`;
}
