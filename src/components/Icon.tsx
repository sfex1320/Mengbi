/**
 * 极简内联 SVG 图标集。不引入额外依赖。
 * 全部 24×24 currentColor stroke 1.6px。
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 22, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

// 生图：画笔 + 闪光（更直观表达"作画 / 创作"）
export const SparkleIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M14.5 4.5l5 5L8.5 20.5l-5 0 0-5L14.5 4.5z" />
    <path d="M13 6l5 5" />
    <path d="M19 3l.6 1.4L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6z" />
  </Base>
);

// 提示词管家：堆叠的卡片（突出"卡片库 / 收藏夹"）
export const GalleryIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="6" y="3" width="14" height="14" rx="2.5" />
    <path d="M16 17v2.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 19.5v-9A1.5 1.5 0 0 1 5.5 9H8" />
  </Base>
);

// 实验室：烧瓶 + 内部气泡，更直观
export const FlaskIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 3h6" />
    <path d="M10 3v6L4.8 17.4A2 2 0 0 0 6.5 20.5h11A2 2 0 0 0 19.2 17.4L14 9V3" />
    <circle cx="11" cy="15" r="0.7" fill="currentColor" />
    <circle cx="13.5" cy="13" r="0.5" fill="currentColor" />
    <circle cx="14" cy="16.5" r="0.6" fill="currentColor" />
  </Base>
);

// 设置：完整 8 齿齿轮（外 8 齿 + 中心圆）
export const SettingsIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Base>
);

export const EyeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const EyeOffIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 4.06-5.19" />
    <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c6.5 0 10 7 10 7a18.39 18.39 0 0 1-2.16 3.19" />
    <path d="M9.5 9.5a3 3 0 0 0 4 4" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </Base>
);

export const PlusIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const SendIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M22 2L11 13" />
    <path d="M22 2l-7 20-4-9-9-4z" />
  </Base>
);

export const SearchIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Base>
);

export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Base>
);

export const XIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Base>
);

export const FolderIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Base>
);

export const KeyIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="7" cy="14" r="4" />
    <path d="M11 14h10v3M16 14v3" />
  </Base>
);

export const TrashIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </Base>
);

export const PaletteIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 2a10 10 0 1 0 0 20c1.4 0 2-.8 2-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-.9.7-1.7 1.6-1.7H17a5 5 0 0 0 5-5c0-5-4.5-9-10-9z" />
    <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" />
    <circle cx="12" cy="7" r="1.2" fill="currentColor" />
    <circle cx="16.5" cy="10.5" r="1.2" fill="currentColor" />
  </Base>
);

export const ZapIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M13 2L3 14h7l-1 8 10-12h-7z" />
  </Base>
);

export const ImageIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.6" />
    <path d="M21 15l-5-5L5 21" />
  </Base>
);

export const CopyIconShape = (p: IconProps) => (
  <Base {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Base>
);

/**
 * AI 生图图标：调色板 + 数颗闪光，一眼能看出"AI 创作类绘图"
 * —— 用于 Sidebar 左上"生图"入口；旧的 SparkleIcon 仅画笔，不够"AI"。
 */
export const AiBrushIcon = (p: IconProps) => (
  <Base {...p}>
    {/* 画笔笔身 */}
    <path d="M14.5 4.5l5 5L9 20H4v-5z" />
    {/* 笔头分隔 */}
    <path d="M13 6l5 5" />
    {/* 三颗散落的星芒：左上 / 右上 / 中下 */}
    <path d="M5 4l.5 1.4L7 6l-1.5.6L5 8l-.5-1.4L3 6l1.5-.6z" />
    <path d="M19.5 14l.4 1.1L21 15.5l-1.1.4L19.5 17l-.4-1.1L18 15.5l1.1-.4z" />
    <path d="M9.5 9.5l.4 1.1L11 11l-1.1.4L9.5 12.5l-.4-1.1L8 11l1.1-.4z" />
  </Base>
);
