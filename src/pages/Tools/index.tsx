import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useToolsStore, type ToolsTab } from '@/store/toolsStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useToolsEngineStore } from '@/store/toolsEngineStore';
import { ToolboxIcon, ZapIcon, FolderIcon, PencilIcon } from '@/components/Icon';
import { RealESRGANPanel } from './RealESRGANPanel';
import { VecPanel } from './VecPanel';
import './Tools.css';

const TABS: Array<{ key: ToolsTab; label: string; desc: string; icon: typeof ToolboxIcon }> = [
  {
    key: 'upscale',
    label: '保真放大',
    desc: '保真放大：速度快，适合日常图片高清化，尽量保持原图真实（Real-ESRGAN ncnn Vulkan）',
    icon: ZapIcon
  },
  {
    key: 'vectorize',
    label: '图像转矢量',
    desc: '图像转矢量:Fast(VTracer 彩色,适合 logo / 文化墙美陈)、Crisp(Potrace 单色,适合线稿)',
    icon: PencilIcon
  }
];

export default function ToolsPage(): JSX.Element {
  const activeTab = useToolsStore((s) => s.activeTab);
  const setActiveTab = useToolsStore((s) => s.setActiveTab);
  const consumePending = useToolsStore((s) => s.consumePendingImport);
  const { prefs } = useSettingsStore();

  // 启动时预热引擎状态（异步，不阻塞渲染）
  const refreshUpscaleStatus = useToolsEngineStore((s) => s.refreshUpscaleStatus);
  useEffect(() => {
    void refreshUpscaleStatus(false);
  }, [refreshUpscaleStatus]);

  useEffect(() => {
    consumePending();
  }, [consumePending]);

  const outputPath = prefs.tools_storage_path || prefs.image_storage_path || '应用数据目录 / images / upscale /';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="mb-tools-root"
    >
      <section className="mb-card mb-tools-shell">
        {/* ── 紧凑头部：标题 + 一键清理 + 输出目录 + Tab 栏 ───── */}
        <header className="mb-tools-header-row">
          <div className="mb-tools-header-title">
            <ToolboxIcon size={18} />
            <span>工具箱</span>
            <span className="mb-tools-header-tagline">本地处理，零数据上传</span>
          </div>
          <div
            className="mb-tools-output-pill"
            title="工具箱所有产出（单图 / 批量都一样）都落到这里。改设置 → 工具箱 → 工具箱保存路径"
            onClick={() =>
              void window.electronAPI.storage.openPath({
                targetPath: outputPath,
                ensureDir: true
              })
            }
          >
            <FolderIcon size={12} />
            <span className="mb-tools-output-pill-label">输出</span>
            <code className="mb-tools-output-pill-path">{outputPath}</code>
          </div>
        </header>

        <nav className="mb-tools-tabbar" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = t.key === activeTab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                className={`mb-tools-tabpill ${active ? 'is-active' : ''}`}
                onClick={() => setActiveTab(t.key)}
                title={t.desc}
              >
                <Icon size={14} />
                <span className="mb-tools-tabpill-label">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ── 面板全部 mount，靠 hidden 控制可见 ──────────── */}
        <div className="mb-tools-body-multi">
          <div className="mb-tools-body-slot" hidden={activeTab !== 'upscale'}>
            <RealESRGANPanel />
          </div>
          <div className="mb-tools-body-slot" hidden={activeTab !== 'vectorize'}>
            <VecPanel />
          </div>
        </div>
      </section>
    </motion.div>
  );
}
