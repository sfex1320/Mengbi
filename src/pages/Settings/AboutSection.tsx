/**
 * 关于 / 第三方许可证 —— Settings 页里的一个独立 section。
 *
 * 集中登记本软件使用的第三方组件与模型的来源 + 许可证。
 * 用户合规需要：商用 / 二次分发前应自行确认每个许可证条款。
 */
import { useState } from 'react';
import { CheckIcon, FolderIcon } from '@/components/Icon';

interface LicenseEntry {
  name: string;
  kind: 'library' | 'model' | 'runtime';
  license: string;
  source: string;
  description: string;
  experimental?: boolean;
  /** 是否需要单独下载（模型）*/
  separateDownload?: boolean;
}

const ENTRIES: LicenseEntry[] = [
  // ── 矢量化相关条目（VTracer / @neplex/vectorizer / StarVector / OmniSVG）已随
  //    图像转矢量功能整体移除，待重做后重新登记
  {
    name: 'sharp (libvips)',
    kind: 'library',
    license: 'Apache-2.0',
    source: 'https://github.com/lovell/sharp',
    description: 'libvips 的 Node 绑定，用于缩略图 / 预处理 / 栅格化。'
  },

  // ── 放大引擎 ──
  {
    name: 'Real-ESRGAN ncnn Vulkan',
    kind: 'library',
    license: 'BSD-3-Clause',
    source: 'https://github.com/xinntao/Real-ESRGAN',
    description: '保真放大默认引擎；ncnn + Vulkan 离线推理。'
  },
  // SUPIR 已于 2026-05-29、HYPIR 已于 2026-06-18 整体砍除，不再登记
  // AI 矢量化条目（StarVector / OmniSVG）已随图像转矢量功能整体移除，待重做后重新登记

  // ── 运行时 ──
  {
    name: 'Electron',
    kind: 'runtime',
    license: 'MIT',
    source: 'https://www.electronjs.org/',
    description: '桌面壳。'
  },
  {
    name: 'React + Vite + Zustand + Framer Motion',
    kind: 'runtime',
    license: 'MIT',
    source: 'https://react.dev/',
    description: '前端栈。'
  },
  {
    name: 'better-sqlite3',
    kind: 'runtime',
    license: 'MIT',
    source: 'https://github.com/WiseLibs/better-sqlite3',
    description: '本地数据库（同步 API）。'
  }
];

export function AboutSection(): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'library' | 'model' | 'runtime'>('all');
  const filtered = filter === 'all' ? ENTRIES : ENTRIES.filter((e) => e.kind === filter);
  const appVersion = '0.0.10'; // 写死，避免引 package.json（与 package.json/electron-builder 版本保持一致）
  // 构建标识（构建期注入）：用户据此确认「正在运行的包就是最新源码构建的」，
  // 排查「打包后新功能没进去」时先看这里——若哈希/时间是旧的，说明 out/ 没重新构建就打了包。
  const gitHash = typeof __GIT_HASH__ === 'string' ? __GIT_HASH__ : 'dev';
  const buildTime = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
  const buildTimeLocal = buildTime ? new Date(buildTime).toLocaleString() : '开发模式';

  return (
    <div className="mb-settings-section">
      <h3 className="mb-settings-section-title">关于 / 第三方许可证</h3>

      {/* App 概览 */}
      <div className="mb-about-app-card">
        <div className="mb-about-app-name">
          梦笔（mengbi）<span className="mb-about-app-ver">v{appVersion}</span>
        </div>
        <div className="mb-about-app-tagline">梦中之笔，绘未来之画 —— 一个不断进化的 AI 绘画工具箱</div>
        <div className="mb-about-app-build" title="构建标识：排查「打包后新功能没进去」时，先核对此处哈希/时间是否为最新源码构建">
          构建 {gitHash} · {buildTimeLocal}
        </div>
      </div>

      {/* 总体合规提示 */}
      <div className="mb-about-disclaimer">
        <strong>合规提示</strong>：以下第三方组件 / 模型按各自许可证条款使用。
        商用、二次分发或集成到产品前，请自行确认每条许可证的具体要求。
        模型权重均不随安装包分发，需用户单独下载或导入。
        <strong>实验性模型</strong>许可证不确定，请慎用。
      </div>

      {/* 分类过滤 */}
      <div className="mb-about-filter-row">
        {(['all', 'library', 'model', 'runtime'] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`mb-about-filter ${filter === k ? 'is-active' : ''}`}
            onClick={() => setFilter(k)}
          >
            {k === 'all' ? '全部' : k === 'library' ? '库' : k === 'model' ? '模型' : '运行时'}
          </button>
        ))}
      </div>

      {/* 条目卡片网格（自适应：窗口越宽一行越多卡片） */}
      <ul className="mb-about-license-list mb-about-license-grid">
        {filtered.map((e) => (
          <li key={e.name} className={`mb-about-license-item ${e.experimental ? 'is-experimental' : ''}`}>
            <div className="mb-about-license-head">
              <span className="mb-about-license-name">{e.name}</span>
              <span className={`mb-about-license-kind kind-${e.kind}`}>
                {e.kind === 'library' ? '库' : e.kind === 'model' ? '模型' : '运行时'}
              </span>
              {e.experimental && <span className="mb-about-license-exp">实验</span>}
              {e.separateDownload && (
                <span className="mb-about-license-dl">需单独下载</span>
              )}
              <span className="mb-about-license-license">{e.license}</span>
            </div>
            <div className="mb-about-license-desc">{e.description}</div>
            <button
              type="button"
              className="mb-about-license-source"
              onClick={() => void window.electronAPI.storage.openUrl(e.source)}
              title="在浏览器打开来源"
            >
              <FolderIcon size={11} /> {e.source}
            </button>
          </li>
        ))}
      </ul>

      <div className="mb-about-footer-note">
        共 <strong>{ENTRIES.length}</strong> 项第三方组件 / 模型在册。
        <CheckIcon size={11} /> 配置文件 / 数据库 / 模型权重 100% 本地存储；除非用户主动联网下载模型，否则不与任何外部服务器通信。
      </div>
    </div>
  );
}
