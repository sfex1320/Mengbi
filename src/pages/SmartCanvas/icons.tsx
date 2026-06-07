/**
 * 智能画布专用内联图标（24×24 currentColor stroke，风格同 components/Icon.tsx）。
 * 节点类型图标 + 工具栏/控件动作图标，避免纯文字按钮。
 */
import type { SVGProps } from 'react';
import type { SmartNodeKind } from '@shared/smartCanvas';

type P = SVGProps<SVGSVGElement> & { size?: number };

function I({ size = 16, children, ...rest }: P & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ImageNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="M21 16l-5-5-7 7" />
  </I>
);
export const PromptNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 9h8M8 13h8M8 17h5" />
  </I>
);
export const LlmNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M4 5h16v10H10l-4 3v-3H4z" />
    <path d="M14 7.5l.7 1.6 1.8.7-1.8.7L14 12l-.7-1.5-1.8-.7 1.8-.7z" />
  </I>
);
export const WorkNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M5 19l9-9" />
    <path d="M14 6l4 4" />
    <path d="M17 3l.6 1.4L19 5l-1.4.6L17 7l-.6-1.4L15 5l1.4-.6z" />
  </I>
);
export const ComfyNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="3" y="9" width="6" height="6" rx="1" />
    <rect x="15" y="4" width="6" height="6" rx="1" />
    <rect x="15" y="14" width="6" height="6" rx="1" />
    <path d="M9 12h3V7h3M12 12v5h3" />
  </I>
);
export const ResultNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="7" y="3" width="14" height="12" rx="2" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12" />
    <path d="M7 12l3-2 4 3" />
  </I>
);
export const GroupNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="3" y="5" width="18" height="15" rx="2" strokeDasharray="3 3" />
  </I>
);
export const AngleNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M4 18h16" />
    <path d="M4 18l7-9" />
    <path d="M4 18a13 13 0 0 1 9-4" />
    <circle cx="17" cy="8" r="2.4" />
  </I>
);

export const ScaleNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M4 9V4h5M20 15v5h-5" />
    <path d="M4 4l6 6M20 20l-6-6" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </I>
);
export const RatioNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="3" y="6" width="18" height="12" rx="1.5" />
    <path d="M3 6l18 12" strokeDasharray="2 2" />
  </I>
);

export const TextNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M5 5h14" />
    <path d="M12 5v14" />
    <path d="M9 19h6" />
  </I>
);

export const LightNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
  </I>
);

export const CompareNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M12 5v14" />
    <path d="M7 10l-2 2 2 2M17 10l2 2-2 2" />
  </I>
);

export const VideoNodeIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="2" y="5" width="14" height="14" rx="2" />
    <path d="M16 9l6-3v12l-6-3" />
    <path d="M7 9.5l3 2.5-3 2.5z" fill="currentColor" stroke="none" />
  </I>
);

export const NODE_ICONS: Record<SmartNodeKind, (p: P) => JSX.Element> = {
  image: ImageNodeIcon,
  prompt: PromptNodeIcon,
  llm: LlmNodeIcon,
  work: WorkNodeIcon,
  comfy: ComfyNodeIcon,
  result: ResultNodeIcon,
  group: GroupNodeIcon,
  'angle-prompt': AngleNodeIcon,
  scale: ScaleNodeIcon,
  ratio: RatioNodeIcon,
  text: TextNodeIcon,
  light: LightNodeIcon,
  compare: CompareNodeIcon,
  video: VideoNodeIcon
};

// ── 动作图标 ──
export const OpenIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" />
    <path d="M3 9l2 9a1 1 0 0 0 1 1h12l2-7" />
  </I>
);
export const SaveIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M12 4v10" />
    <path d="M8 11l4 4 4-4" />
    <path d="M5 19h14" />
  </I>
);
export const FitViewIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
  </I>
);
export const TrashIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M4 7h16" />
    <path d="M9 7V5h6v2" />
    <path d="M6 7l1 13h10l1-13" />
  </I>
);
export const LayoutIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </I>
);
export const CopyIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </I>
);
export const KeyboardIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M7.5 13h9" />
  </I>
);
export const PlusIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);
export const RefreshIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2" />
    <path d="M18 4v4h-4M6 20v-4h4" />
  </I>
);
export const EditIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M4 20h4l10-10-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </I>
);
export const BackIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M15 6l-6 6 6 6" />
  </I>
);
export const RunAllIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M6 4l12 8-12 8z" />
  </I>
);
export const StopIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </I>
);
export const RowsIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="4" y="4" width="16" height="4.5" rx="1" />
    <rect x="4" y="10" width="16" height="4.5" rx="1" />
    <rect x="4" y="16" width="16" height="4" rx="1" />
  </I>
);
export const DistributeHIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="3" y="7" width="4" height="10" rx="1" />
    <rect x="10" y="7" width="4" height="10" rx="1" />
    <rect x="17" y="7" width="4" height="10" rx="1" />
  </I>
);
export const DistributeVIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="7" y="3" width="10" height="4" rx="1" />
    <rect x="7" y="10" width="10" height="4" rx="1" />
    <rect x="7" y="17" width="10" height="4" rx="1" />
  </I>
);
export const SlidersIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M18 18h2" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="15" cy="18" r="2" />
  </I>
);
export const TemplateIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1" />
    <rect x="13" y="3" width="8" height="5" rx="1" />
    <rect x="13" y="11" width="8" height="10" rx="1" />
    <rect x="3" y="14" width="8" height="7" rx="1" />
  </I>
);
export const LogIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </I>
);
/** 选择 / 移动（工具坞默认态）。 */
export const CursorIcon = (p: P): JSX.Element => (
  <I {...p}>
    <path d="M5 4l6.5 15 2-6 6-2z" />
  </I>
);
export const ZoomInIcon = (p: P): JSX.Element => (
  <I {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4M11 8v6M8 11h6" />
  </I>
);
export const ZoomOutIcon = (p: P): JSX.Element => (
  <I {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4M8 11h6" />
  </I>
);
export const SearchIcon = (p: P): JSX.Element => (
  <I {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4-4" />
  </I>
);
/** 空图片节点的「添加图片」大图标（图框 + 加号）。 */
export const ImagePlusIcon = (p: P): JSX.Element => (
  <I {...p}>
    <rect x="3" y="4" width="14" height="14" rx="2" />
    <circle cx="8" cy="9" r="1.4" />
    <path d="M3 15l4-4 4 3.5" />
    <path d="M19 5v6M16 8h6" />
  </I>
);
