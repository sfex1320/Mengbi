/**
 * 设置页专用 SVG 线条图标集 —— 与 src/pages/SmartCanvas/optionIcons.tsx 同风格：
 * viewBox 0 0 24 24 · fill:none · stroke:currentColor · stroke-width:1.7 · 圆角端点。
 * 仅用于设置页侧栏导航 / 分区卡片标题 / 搜索框，纯展示无逻辑。
 */

interface SiProps {
  size?: number;
}

function S({ size = 16, children }: SiProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** 模型方案：层叠方块 */
export function SiPlans({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <rect x="8" y="3.5" width="12.5" height="12.5" rx="2.5" />
      <path d="M16.5 20.5h-9a4 4 0 0 1-4-4v-9" />
    </S>
  );
}

/** 智能化方案：闪光四角星 */
export function SiSpark({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <path d="M11 3l1.7 5.3L18 10l-5.3 1.7L11 17l-1.7-5.3L4 10l5.3-1.7L11 3z" />
      <path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </S>
  );
}

/** 外观：调色盘 */
export function SiPalette({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2.3-.9 2.3-2.1 0-.7-.4-1.2-.4-1.9 0-1.1.9-2 2-2h1.9A3.2 3.2 0 0 0 21 11.8C21 6.9 17 3 12 3z" />
      <circle cx="7.6" cy="11.2" r="0.9" />
      <circle cx="10.2" cy="7.4" r="0.9" />
      <circle cx="14.8" cy="7.2" r="0.9" />
    </S>
  );
}

/** 存储与系统：数据库圆柱 */
export function SiDatabase({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.7" />
      <path d="M4.5 5.5v13c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7v-13" />
      <path d="M4.5 12c0 1.5 3.4 2.7 7.5 2.7s7.5-1.2 7.5-2.7" />
    </S>
  );
}

/** 工具箱：扳手 */
export function SiWrench({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </S>
  );
}

/** 关于：info 圆 */
export function SiInfo({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </S>
  );
}

/** 搜索：放大镜 */
export function SiSearch({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.8-3.8" />
    </S>
  );
}

/** 显示与缩放：显示器 */
export function SiMonitor({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M9 21h6M12 17v4" />
    </S>
  );
}

/** 性能模式：仪表盘 */
export function SiGauge({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <path d="M4.6 19a9 9 0 1 1 14.8 0" />
      <path d="M12 13.5L16 9" />
      <circle cx="12" cy="14" r="1" />
    </S>
  );
}

/** 智能画布与光标：光标箭头 */
export function SiCursorGlow({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <path d="M5.5 3.5l7.2 17 2.1-7 7-2.1-16.3-7.9z" />
    </S>
  );
}

/** 文件夹（存储位置 / 输出目录） */
export function SiFolderLine({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11z" />
    </S>
  );
}

/** 资产库：图片 */
export function SiImages({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4.5 17l4.5-4.5 3 3 3.5-3.5 4 4" />
    </S>
  );
}

/** 配置备份：归档箱 */
export function SiArchive({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <rect x="3.5" y="4" width="17" height="5" rx="1.5" />
      <path d="M5.5 9v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </S>
  );
}

/** 联网搜索：地球 */
export function SiGlobe({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18 13.5 13.5 0 0 1 0-18z" />
    </S>
  );
}

/** 系统与体验：芯片 */
export function SiChip({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9 3.5V7M15 3.5V7M9 17v3.5M15 17v3.5M3.5 9H7M3.5 15H7M17 9h3.5M17 15h3.5" />
    </S>
  );
}

/** 智能体：机器人 */
export function SiRobot({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <rect x="5" y="8.5" width="14" height="9.5" rx="2.5" />
      <circle cx="9.5" cy="13" r="1" />
      <circle cx="14.5" cy="13" r="1" />
      <path d="M12 8.5V5.5" />
      <circle cx="12" cy="4.3" r="1.1" />
    </S>
  );
}

/** 放大引擎：扩展箭头 + 方块 */
export function SiUpscale({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <rect x="12.5" y="3.5" width="8" height="8" rx="1.5" />
      <path d="M4 20v-5M4 20h5M4 20l6.5-6.5" />
    </S>
  );
}

/** ONNX 模型：立方体 */
export function SiBox({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </S>
  );
}

/** 中转站与模型：钥匙 */
export function SiKey({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <circle cx="8" cy="15.5" r="4" />
      <path d="M10.9 12.6L20 3.5" />
      <path d="M15 8.5l3 3" />
    </S>
  );
}

/** 视频供应商：摄像机 */
export function SiVideo({ size }: SiProps): JSX.Element {
  return (
    <S size={size}>
      <rect x="3" y="6.5" width="13" height="11" rx="2" />
      <path d="M16 10.5l5-3v9l-5-3" />
    </S>
  );
}
