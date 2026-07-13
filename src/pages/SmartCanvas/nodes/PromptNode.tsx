import { useEffect, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import type { PromptNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { areaMenu, copyText, autoGrowNode, savePromptToLibrary } from '../nodeArea';
import { usePromptPickerStore } from '../PromptPickerDialog';
import { usePromptListStudioStore } from '../PromptListStudio';
import { TranslateBox } from '../TranslateBox';
import { useDownstreamRefImages, AtRefStrip, AtRefPicker, AtRefOverlay } from './PromptAtRefs';
import type { ContextMenuEntry } from '@/components/ContextMenu';

/** 输入框高度直接贴合自身内容（真实 DOM 测量，非字符数估算）：
 *  先归零再读 scrollHeight —— 这是唯一能拿到「换行后的精确内容高」的方式，
 *  对中英混排/任意字号都准；同步执行不触发中间绘制，无闪烁。 */
function fitTextarea(ta: HTMLTextAreaElement | null, min: number, max: number): void {
  if (!ta) return;
  ta.style.height = '0px';
  const need = ta.scrollHeight + 4;
  ta.style.height = `${Math.max(min, Math.min(max, need))}px`;
}

// 单条输入框高度范围（超过上限输入框内部滚动）；列表每条范围；节点整体封顶（超出列表区内部滚动）
const SINGLE_MIN = 150;
const SINGLE_MAX = 620;
const ITEM_MIN = 56;
const ITEM_MAX = 320;
const NODE_MAX = 1400;
// NodeShell 标题栏 + 上下内边距（内容包裹层之外的固定高度）
const CHROME = 56;

/**
 * 提示词节点（2026-07-11 重做）：高度全部按「真实内容测量」自适应，杜绝估算导致的乱窜。
 * - 单条：输入框贴合文字高度（150~620px，超出内部滚动），节点跟随内容高。
 * - 列表：每条各自贴合自己的文字（56~320px），不再共享一个固定条高——长条不溢出、短条不占地。
 * - 手动 > 自适应（铁律 26）：用户拖过节点尺寸后自适应全部让位，内容区内部滚动。
 */
export function PromptNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const beginEdit = useSmartCanvasStore((s) => s.beginEdit);
  const commitEdit = useSmartCanvasStore((s) => s.commitEdit);
  const openPicker = usePromptPickerStore((s) => s.open);
  const openStudio = usePromptListStudioStore((s) => s.open);
  const d = data as unknown as PromptNodeData;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const itemRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const fitRef = useRef<HTMLDivElement>(null);
  const [showTr, setShowTr] = useState(false);
  const items = d.items ?? [];

  // ── @ 引用参考图（2026-07-12）：下游生图节点收到的参考图可在提示词里 @图N 引用 ──
  const refImages = useDownstreamRefImages(id);
  /** @ 选图浮层：null=关；-1=单条输入框；>=0=列表第 N 条 */
  const [atOpen, setAtOpen] = useState<number | null>(null);
  /** 最近聚焦的输入框（缩略条点击插入的目标）：-1=单条；>=0=列表条目 */
  const focusItemRef = useRef(-1);

  /** 目标输入框 + 当前文本（item<0 = 单条）。 */
  const atTarget = (item: number): { ta: HTMLTextAreaElement | null; cur: string } =>
    item < 0 ? { ta: taRef.current, cur: d.text ?? '' } : { ta: itemRefs.current[item] ?? null, cur: items[item] ?? '' };

  /** 在 caret 处插入 @图N（caret 前一个字符恰是刚输入的 @ 时只补「图N」）。 */
  function insertAtRef(item: number, index: number): void {
    const { ta, cur } = atTarget(item);
    const caret = ta ? ta.selectionStart ?? cur.length : cur.length;
    const hasAt = caret > 0 && cur[caret - 1] === '@';
    const ins = hasAt ? `图${index}` : `@图${index}`;
    const next = cur.slice(0, caret) + ins + cur.slice(caret);
    if (item < 0) update(id, { text: next });
    else setItem(item, next);
    setAtOpen(null);
    requestAnimationFrame(() => {
      const t = atTarget(item).ta;
      if (!t) return;
      t.focus();
      const p = caret + ins.length;
      t.setSelectionRange(p, p);
    });
  }

  /** 输入变化时检测「刚输入了 @」→ 弹选图浮层（有可引用的参考图才弹）。 */
  function maybeOpenAt(item: number, e: React.ChangeEvent<HTMLTextAreaElement>): void {
    if (!refImages.length) return;
    const caret = e.target.selectionStart ?? 0;
    if (caret > 0 && e.target.value[caret - 1] === '@') setAtOpen(item);
  }

  // 每次渲染后：先把所有输入框贴合各自内容，再把节点高度贴合内容包裹层实测高度。
  // autoGrowNode 自带「差值 >6px 才写」护栏与 manualSize 跳过 → 收敛不振荡、手动优先。
  useEffect(() => {
    if (d.listMode) {
      itemRefs.current.forEach((ta) => fitTextarea(ta, ITEM_MIN, ITEM_MAX));
    } else {
      fitTextarea(taRef.current, SINGLE_MIN, SINGLE_MAX);
    }
    const wrap = fitRef.current;
    if (wrap) autoGrowNode(id, wrap.scrollHeight + CHROME, NODE_MAX);
  });

  // 节点被横向拉宽/收窄 → 换行位置变 → 内容高变：监听包裹层宽度变化重新贴合
  useEffect(() => {
    const wrap = fitRef.current;
    if (!wrap) return;
    let lastW = wrap.offsetWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(wrap.offsetWidth - lastW) <= 2) return;
      lastW = wrap.offsetWidth;
      if (useSmartCanvasStore.getState().nodes.find((n) => n.id === id)?.data) {
        itemRefs.current.forEach((ta) => fitTextarea(ta, ITEM_MIN, ITEM_MAX));
        fitTextarea(taRef.current, SINGLE_MIN, SINGLE_MAX);
        autoGrowNode(id, wrap.scrollHeight + CHROME, NODE_MAX);
      }
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [id]);

  const setItem = (i: number, v: string): void => {
    const next = items.slice();
    next[i] = v;
    update(id, { items: next });
  };
  const addItem = (): void => update(id, { items: [...items, ''] });
  const removeItem = (i: number): void => update(id, { items: items.filter((_, j) => j !== i) });

  const toggle = (
    <button
      className="mb-sc-mini-toggle nodrag"
      title={d.listMode ? '切回单条' : '切到列表（多条提示词，逐条喂下游生图）'}
      onClick={() => update(id, { listMode: !d.listMode })}
    >
      {d.listMode ? '单条' : '列表'}
    </button>
  );

  return (
    <>
      <NodeResizer isVisible minWidth={180} minHeight={120} />
      <NodeShell title="提示词" accent="is-prompt" outputs fill onDelete={() => remove(id)} headRight={toggle} label={d.label} labelColor={d.labelColor}>
        {/* 内容包裹层：自然高度（flex:0 0 auto），是节点自适应的唯一测量对象；
            手动缩小节点时 max-height:100% + overflow 让内容区内部滚动而不是被裁 */}
        <div className="mb-sc-prompt-fit nowheel" ref={fitRef}>
          {!d.listMode ? (
            <div className="mb-sc-area">
              {/* 下游生图节点的参考图缩略条：点击插入 @图N 引用（输入框里直接输 @ 也会弹选图） */}
              <AtRefStrip images={refImages} onPick={(n) => insertAtRef(-1, n)} />
              <textarea
                ref={taRef}
                className="mb-sc-input mb-sc-textarea mb-sc-prompt-ta nodrag nowheel"
                value={d.text ?? ''}
                onFocus={() => {
                  focusItemRef.current = -1;
                  beginEdit();
                }}
                onBlur={commitEdit}
                onChange={(e) => {
                  update(id, { text: e.target.value });
                  maybeOpenAt(-1, e);
                }}
                placeholder={refImages.length ? '输入提示词… 输 @ 可引用参考图（@图1）' : '输入提示词…'}
                onContextMenu={(e) => {
                  const ta = taRef.current;
                  const sel = ta && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '';
                  const menu: ContextMenuEntry[] = [
                    { label: '复制', onClick: () => copyText(d.text ?? '') },
                    {
                      label: '粘贴',
                      onClick: () => void navigator.clipboard.readText().then((t) => update(id, { text: (d.text ?? '') + t }))
                    },
                    { separator: true },
                    { label: '从提示词库选择…', onClick: () => openPicker(id) },
                    { label: '打开提示词工作台…', onClick: () => openStudio(id) }
                  ];
                  if (sel.trim()) menu.push({ label: `选中入库（${sel.trim().length} 字）`, onClick: () => void savePromptToLibrary(sel) });
                  menu.push({ label: '整段入库', onClick: () => void savePromptToLibrary(d.text ?? '') });
                  menu.push({ separator: true });
                  menu.push({ label: '清空', variant: 'danger', onClick: () => update(id, { text: '' }) });
                  areaMenu(e, menu);
                }}
              />
              {/* @ 标记上方的悬浮小图（视觉连接：@图N ↔ 第 N 张参考图）；以 .mb-sc-area 为定位参照，不包 wrapper 不动原布局 */}
              <AtRefOverlay ta={taRef.current} text={d.text ?? ''} images={refImages} />
              {atOpen === -1 && (
                <AtRefPicker ta={taRef.current} images={refImages} onPick={(n) => insertAtRef(-1, n)} onClose={() => setAtOpen(null)} />
              )}
              {/* 工具行在文档流里（输入框下方），不悬浮在输入框内——不遮文字（2026-07-14） */}
              <div className="mb-sc-prompt-toolrow nodrag">
                <button className="mb-sc-prompt-lib nodrag" title="从提示词库选择并插入" onClick={() => openPicker(id)}>
                  📚 提示词库
                </button>
                <button
                  className={`mb-sc-prompt-lib nodrag ${showTr ? 'is-on' : ''}`}
                  title="翻译并对比（可临时查看或替换原文）"
                  onClick={() => setShowTr((v) => !v)}
                >
                  🌐 翻译
                </button>
                <button
                  className="mb-sc-plstudio-open nodrag"
                  title="打开提示词工作台（大窗完整编辑，可批量导入 / 拆成多条列表）"
                  onClick={() => openStudio(id)}
                >
                  🗖 工作台
                </button>
                <button className="mb-sc-prompt-lib nodrag" title="复制全文" onClick={() => copyText(d.text ?? '')}>
                  ⧉ 复制
                </button>
              </div>
              {showTr && (
                <TranslateBox
                  text={d.text ?? ''}
                  onReplace={(t) => {
                    update(id, { text: t });
                    setShowTr(false);
                  }}
                />
              )}
            </div>
          ) : (
            <div className="mb-sc-plist nodrag">
              <div className="mb-sc-plist-head">
                <span>提示词列表 · {items.length} 条</span>
                <span className="mb-sc-plist-headright">
                  <span className="mb-sc-plist-hint">每条独立喂下游（逐条生图）</span>
                  <button
                    className="mb-sc-plstudio-open nodrag"
                    title="打开提示词工作台（大窗完整编辑长提示词 / 批量导入 / 排序）"
                    onClick={() => openStudio(id)}
                  >
                    🗖 工作台
                  </button>
                </span>
              </div>
              {/* 参考图缩略条：点击往「最近聚焦的那条」插入 @图N 引用 */}
              {items.length > 0 && (
                <AtRefStrip
                  images={refImages}
                  onPick={(n) => insertAtRef(Math.min(Math.max(focusItemRef.current, 0), items.length - 1), n)}
                />
              )}
              {/* 统一提示词 / 前置提示词：拼进每一条，免在每个框重复输入 */}
              <div className="mb-sc-plist-unified">
                <textarea
                  className="mb-sc-input mb-sc-textarea nowheel"
                  rows={2}
                  value={d.unifiedPrompt ?? ''}
                  onChange={(e) => update(id, { unifiedPrompt: e.target.value })}
                  placeholder="统一提示词（夹进每条的前/后，形成规范，免重复输入）"
                />
                <div className="mb-sc-plist-unipos">
                  {(['prefix', 'suffix', 'both'] as const).map((p) => (
                    <button
                      key={p}
                      className={`mb-sc-plist-uposbtn ${(d.unifiedPos ?? 'prefix') === p ? 'is-on' : ''}`}
                      title={p === 'prefix' ? '放每条前面' : p === 'suffix' ? '放每条后面' : '每条前后都放'}
                      onClick={() => update(id, { unifiedPos: p })}
                    >
                      {p === 'prefix' ? '放前' : p === 'suffix' ? '放后' : '前后'}
                    </button>
                  ))}
                </div>
              </div>
              {items.map((t, i) => (
                <div key={i} className="mb-sc-plist-row">
                  <span className="mb-sc-plist-idx">{i + 1}</span>
                  <textarea
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    className="mb-sc-input mb-sc-textarea mb-sc-prompt-ta nowheel"
                    value={t}
                    onFocus={() => {
                      focusItemRef.current = i;
                      beginEdit();
                    }}
                    onBlur={commitEdit}
                    onChange={(e) => {
                      setItem(i, e.target.value);
                      maybeOpenAt(i, e);
                    }}
                    placeholder={`第 ${i + 1} 条提示词…`}
                    onContextMenu={(e) =>
                      areaMenu(e, [
                        { label: '从提示词库选择…', onClick: () => openPicker(id, i) },
                        { label: '打开提示词工作台…', onClick: () => openStudio(id) },
                        { label: '入库', onClick: () => void savePromptToLibrary(t) },
                        { label: '删除此条', variant: 'danger', onClick: () => removeItem(i) }
                      ])
                    }
                  />
                  {/* 以 .mb-sc-plist-row（relative）为定位参照，不包 wrapper 不动行布局 */}
                  <AtRefOverlay ta={itemRefs.current[i]} text={t} images={refImages} />
                  {atOpen === i && (
                    <AtRefPicker ta={itemRefs.current[i]} images={refImages} onPick={(n) => insertAtRef(i, n)} onClose={() => setAtOpen(null)} />
                  )}
                  <button className="mb-sc-plist-x" title="删除此条" onClick={() => removeItem(i)}>
                    ✕
                  </button>
                </div>
              ))}
              <div className="mb-sc-plist-actions">
                <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={addItem}>
                  ＋ 添加一条
                </button>
                <button className="mb-btn mb-btn-sm mb-btn-ghost" title="从提示词库追加一条" onClick={() => openPicker(id, items.length)}>
                  📚 从库添加
                </button>
              </div>
            </div>
          )}
        </div>
      </NodeShell>
    </>
  );
}
