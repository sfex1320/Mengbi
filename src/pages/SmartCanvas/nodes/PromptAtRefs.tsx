/**
 * 提示词「@ 引用参考图」UI（2026-07-12）：
 * - useDownstreamRefImages：读取本提示词节点连到的第一个 生图/ComfyUI/视频 节点收到的全部参考图
 *   （顺序 = 图序铁律的提交顺序，即「图N」的 N）。**浅比较订阅**：拖动/平移只改节点坐标、
 *   参考图列表不变时提示词节点不重渲（否则整画布拖动每帧全量重渲提示词节点 = 卡顿元凶）。
 * - AtRefStrip：参考图缩略条（图1..图N），点击往输入框插入 `@图N`。
 * - AtRefPicker：输入 `@` 时弹出的选图浮层（点击补全成 `@图N`）。
 * - AtRefOverlay：镜像测量 textarea 里每个 `@图N` 标记的位置与宽度，用一枚**红框芯片**
 *   （缩略图 + 编号）精确盖在标记自己的行内 footprint 上——插入标记时自带一个全角占位空格
 *   （lib/promptImageRefs.ts），芯片就「像正常文字一样占位」，不遮任何其它文字。
 *   （历史：悬浮在标记上方会遮上一行；跟在文字后面会遮后续文字——2026-07-14 定稿为占位芯片。）
 *   以「textarea 的定位祖先」（.mb-sc-area / .mb-sc-plist-row）为参照绝对定位、按 ta.offset* 偏移——
 *   **不额外包 wrapper**，不动提示词节点原有布局/自适应（历史教训：包一层 host 曾破坏输入框高度与节点自适应）。
 * 标记只在 UI 层带 @；发给模型前由 promptNodeOutputs 统一剥成「图N」（lib/promptImageRefs.ts）。
 */
import { useEffect, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { computeUpstream } from '@/lib/smartCanvasRunner';
import { parseImageRefs } from '@/lib/promptImageRefs';
import { localPathToImageUrl } from '@/lib/imageUrl';

/** 显示用 URL（本地路径 → mengbi-image://）。 */
function thumbUrl(src: string): string {
  return src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:') ? src : localPathToImageUrl(src);
}

const GEN_KINDS = new Set(['work', 'comfy', 'video']);
const NO_IMAGES: string[] = [];

/** 本提示词节点连到的第一个 生图/ComfyUI/视频 节点收到的全部参考图（可 @ 引用的对象）。 */
export function useDownstreamRefImages(promptId: string): string[] {
  return useSmartCanvasStore((s) => {
    const e = s.edges.find((x) => {
      if (x.source !== promptId) return false;
      const t = s.nodes.find((n) => n.id === x.target)?.type ?? '';
      return GEN_KINDS.has(t);
    });
    if (!e) return NO_IMAGES;
    const imgs = computeUpstream(s.nodes, s.edges, e.target).images;
    return imgs.length ? imgs : NO_IMAGES;
  }, shallow);
}

/** 参考图缩略条：图1..图N，点击插入 @ 引用。 */
export function AtRefStrip({ images, onPick }: { images: string[]; onPick: (index: number) => void }): JSX.Element | null {
  if (!images.length) return null;
  return (
    <div className="mb-sc-atref-strip nodrag" title="下游生图节点收到的参考图；点击插入 @图N 引用（也可在输入框里直接输 @）">
      {images.map((src, i) => (
        <button key={`${i}-${src.slice(-24)}`} className="mb-sc-atref-item" onClick={() => onPick(i + 1)} title={`插入 @图${i + 1}`}>
          <img src={thumbUrl(src)} alt={`图${i + 1}`} draggable={false} />
          <span className="mb-sc-atref-no">图{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

/** 输入 @ 时的选图浮层：贴着目标输入框（按 ta.offset* 在定位祖先内绝对定位）；Esc / 点击外部关闭。 */
export function AtRefPicker({
  ta,
  images,
  onPick,
  onClose
}: {
  ta: HTMLTextAreaElement | null;
  images: string[];
  onPick: (index: number) => void;
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement | null)?.closest('.mb-sc-atref-picker')) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);
  return (
    <div
      className="mb-sc-atref-picker nodrag nowheel"
      style={{ left: (ta?.offsetLeft ?? 0) + 6, top: (ta?.offsetTop ?? 0) + 34 }}
    >
      <div className="mb-sc-atref-picker-head">@ 引用哪张参考图？</div>
      <div className="mb-sc-atref-picker-grid">
        {images.map((src, i) => (
          <button key={`${i}-${src.slice(-24)}`} className="mb-sc-atref-item" onClick={() => onPick(i + 1)} title={`引用 图${i + 1}`}>
            <img src={thumbUrl(src)} alt={`图${i + 1}`} draggable={false} />
            <span className="mb-sc-atref-no">图{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

interface Mark {
  left: number;
  top: number;
  width: number;
  index: number;
}

/**
 * @ 标记的占位芯片层：用「镜像 div」复刻 textarea 的排版（同字体/宽度/内边距/换行），
 * 把每个 `@图N　` 包成 span 量出坐标与宽度 → 盖一枚红框芯片（缩略图 + 编号），
 * 芯片宽高严格等于标记自身的行内 footprint（宽 = span 实测宽，高 = 行高）——不遮其它文字。
 * 层覆盖整个定位祖先（inset:0），坐标已含 ta.offset* 偏移；纯展示（pointer-events:none）。
 */
export function AtRefOverlay({
  ta,
  text,
  images
}: {
  ta: HTMLTextAreaElement | null;
  text: string;
  images: string[];
}): JSX.Element | null {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [lineH, setLineH] = useState(20);
  const [scrollTop, setScrollTop] = useState(0);
  const [sizeTick, setSizeTick] = useState(0);

  // 宽度变化（拖节点宽 / 面板重排）→ 换行位置变 → 重测；内滚时跟随
  useEffect(() => {
    if (!ta) return;
    const ro = new ResizeObserver(() => setSizeTick((t) => t + 1));
    ro.observe(ta);
    const onScroll = (): void => setScrollTop(ta.scrollTop);
    ta.addEventListener('scroll', onScroll);
    return () => {
      ro.disconnect();
      ta.removeEventListener('scroll', onScroll);
    };
  }, [ta]);

  useEffect(() => {
    if (!ta || !images.length) {
      setMarks((prev) => (prev.length ? [] : prev));
      return;
    }
    const tokens = parseImageRefs(text);
    if (!tokens.length) {
      setMarks((prev) => (prev.length ? [] : prev));
      return;
    }
    const cs = getComputedStyle(ta);
    const mirror = document.createElement('div');
    Object.assign(mirror.style, {
      position: 'absolute',
      visibility: 'hidden',
      left: '-99999px',
      top: '0',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      wordBreak: cs.wordBreak,
      boxSizing: 'border-box',
      width: `${ta.clientWidth}px`,
      font: cs.font,
      letterSpacing: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      padding: cs.padding,
      border: '0'
    } as Partial<CSSStyleDeclaration>);
    let last = 0;
    for (const t of tokens) {
      mirror.appendChild(document.createTextNode(text.slice(last, t.start)));
      const sp = document.createElement('span');
      sp.textContent = text.slice(t.start, t.end);
      sp.dataset.i = String(t.index);
      mirror.appendChild(sp);
      last = t.end;
    }
    mirror.appendChild(document.createTextNode(text.slice(last)));
    document.body.appendChild(mirror);
    // 行高：芯片的高度基准（"normal" 时按字号 ×1.4 估）
    const lhRaw = parseFloat(cs.lineHeight);
    const lh = Number.isFinite(lhRaw) ? lhRaw : parseFloat(cs.fontSize) * 1.4;
    // 坐标换算进定位祖先坐标系（+ ta.offset*），overlay 层 inset:0 直接用
    const baseX = ta.offsetLeft;
    const baseY = ta.offsetTop;
    const out: Mark[] = [];
    mirror.querySelectorAll('span').forEach((sp) => {
      // left/top = 标记自身占位的左上角，width = 标记实测宽（含占位空格）——芯片盖在这块 footprint 上
      out.push({ left: baseX + sp.offsetLeft, top: baseY + sp.offsetTop, width: sp.offsetWidth, index: Number(sp.dataset.i) });
    });
    document.body.removeChild(mirror);
    setLineH(lh);
    setMarks(out);
  }, [ta, text, images.length, sizeTick]);

  if (!marks.length || !ta) return null;
  const taTop = ta.offsetTop;
  return (
    <div className="mb-sc-atref-layer" aria-hidden>
      {marks.map((m, i) => {
        const top = m.top - scrollTop;
        // 滚出输入框可视区的标记不画（textarea 内滚时）
        if (top - taTop < -4 || top - taTop > ta.clientHeight + 4) return null;
        const src = images[m.index - 1];
        return (
          <span
            key={i}
            className={`mb-sc-atref-chip${src ? '' : ' is-miss'}`}
            style={{ left: m.left, top, width: m.width, height: lineH }}
            title={src ? `引用 图${m.index}` : `没有第 ${m.index} 张参考图`}
          >
            {src ? (
              <img src={thumbUrl(src)} alt={`图${m.index}`} draggable={false} />
            ) : (
              <span className="mb-sc-atref-chip-q">?</span>
            )}
            <span className="mb-sc-atref-chip-no">图{m.index}</span>
          </span>
        );
      })}
    </div>
  );
}
