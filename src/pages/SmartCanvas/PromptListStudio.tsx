import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import type { PromptNodeData } from '@shared/smartCanvas';
import { useBackdropClose } from './nodeArea';
import { usePromptPickerStore } from './PromptPickerDialog';
import { TranslateBox } from './TranslateBox';
import { confirmDialog } from '@/components/ConfirmDialog';
import { toast } from '@/store/toastStore';
import { useDragScroll } from '@/lib/useDragScroll';

/** 提示词工作台开关：哪个提示词节点在编辑（null = 不显示）。仿 usePromptMallStudioStore 单例模式。 */
interface PromptListStudioState {
  nodeId: string | null;
  open: (nodeId: string) => void;
  close: () => void;
}
export const usePromptListStudioStore = create<PromptListStudioState>((set) => ({
  nodeId: null,
  open: (nodeId) => set({ nodeId }),
  close: () => set({ nodeId: null })
}));

/** 输入框高度贴合内容（复制自 PromptNode.tsx 的 fitTextarea，注明来源）。
 *  区别：工作台里**不设上限**——痛点就是节点卡上长提示词显示不全，
 *  这里每条完整展开，滚动交给左列容器自己。 */
function fitTa(ta: HTMLTextAreaElement | null, min: number): void {
  if (!ta) return;
  ta.style.height = '0px';
  ta.style.height = `${Math.max(min, ta.scrollHeight + 4)}px`;
}

/** 翻译面板锚点：'single' = 单条模式那一框；数字 = 列表第 i 条；null = 收起 */
type TrKey = number | 'single' | null;

/**
 * 提示词列表工作台（2026-07-11）：大弹窗完整编辑提示词节点的全部内容（弹窗 = 节点的另一张视图，
 * 所有修改实时写回节点 data，零新字段）。解决「多条长提示词在节点卡上显示不全、编辑不便」。
 * 左列 = 每条一张编辑卡（自动贴高无上限 + 排序/删除/翻译）；右列 = 统一提示词 + 批量操作。
 * 铁律 21/27：portal 到 body + 弹窗双类 `.mb-sc-plstudio.mb-card`（经 .mb-modal/.mb-sc-studio 骨架）。
 */
export function PromptListStudio(): JSX.Element | null {
  const nodeId = usePromptListStudioStore((s) => s.nodeId);
  const close = usePromptListStudioStore((s) => s.close);
  const backdrop = useBackdropClose(close);
  // 只订阅目标节点：其它节点变化时 find 返回同一对象引用 → 不触发重渲染
  const node = useSmartCanvasStore((s) => (nodeId ? s.nodes.find((n) => n.id === nodeId) : undefined));
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const beginEdit = useSmartCanvasStore((s) => s.beginEdit);
  const commitEdit = useSmartCanvasStore((s) => s.commitEdit);
  const openPicker = usePromptPickerStore((s) => s.open);
  const d = node?.data as unknown as PromptNodeData | undefined;

  const itemRefs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const singleRef = useRef<HTMLTextAreaElement>(null);
  const uniRef = useRef<HTMLTextAreaElement>(null);
  // 左列滚动容器：铁律 24 长按拖动滚动 + 供 ResizeObserver 在列宽变化时重新贴高
  const mainRef = useDragScroll<HTMLDivElement>();
  const [trKey, setTrKey] = useState<TrKey>(null);
  const [bulk, setBulk] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const items = d?.items ?? [];
  const listMode = !!d?.listMode;

  // Esc 关闭；但提示词库弹窗叠在上层（z 更高）时放行——先让用户处理上层弹窗，别把底下的工作台一并关掉
  useEffect(() => {
    if (!nodeId) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (usePromptPickerStore.getState().targetNodeId) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodeId, close]);

  // 节点被删（或切画布后不存在）→ 自动关闭，避免编辑幽灵节点
  useEffect(() => {
    if (nodeId && !d) close();
  }, [nodeId, d, close]);

  // 每次渲染后把所有输入框贴合各自内容（同 PromptNode：真实 DOM 测量，非估算）
  useEffect(() => {
    itemRefs.current.forEach((ta) => fitTa(ta, 64));
    fitTa(singleRef.current, 150);
    fitTa(uniRef.current, 56);
  });

  // 左列宽度变化（拖窗口/分辨率变）→ 换行位置变 → 重新贴高
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      itemRefs.current.forEach((ta) => fitTa(ta, 64));
      fitTa(singleRef.current, 150);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mainRef, nodeId]);

  if (!nodeId || !d) return null;

  // ── 条目操作（全部直接写回节点 data，工作台自身零持久化状态）──
  const setItemAt = (i: number, v: string): void => {
    const next = items.slice();
    next[i] = v;
    update(nodeId, { items: next });
  };
  const addItem = (): void => update(nodeId, { items: [...items, ''] });
  const removeItem = (i: number): void => {
    setTrKey(null); // 翻译面板按下标锚定，条目增删后下标失效 → 收起防错位
    update(nodeId, { items: items.filter((_, j) => j !== i) });
  };
  const moveItem = (from: number, to: number): void => {
    if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return;
    const next = items.slice();
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setTrKey(null);
    update(nodeId, { items: next });
  };

  // ── 批量操作 ──
  /** 批量粘贴导入：blank=按空行拆（段落成条）/ line=按换行拆（每行成条）；追加到列表并自动切列表模式 */
  const importBulk = (mode: 'blank' | 'line'): void => {
    const parts = (mode === 'blank' ? bulk.split(/\n\s*\n+/) : bulk.split(/\r?\n/)).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) {
      toast.info('没有可导入的内容', '先在上方粘贴多条提示词文本');
      return;
    }
    update(nodeId, { listMode: true, items: [...items, ...parts] });
    setBulk('');
    toast.success(`已追加 ${parts.length} 条提示词`);
  };
  /** 合并为单条：移动语义——清空 items，避免切回列表时看到过期旧条目 */
  const mergeToSingle = (): void => {
    const merged = items.map((s) => s.trim()).filter(Boolean).join('\n');
    update(nodeId, { text: merged, listMode: false, items: [] });
    setTrKey(null);
    toast.success('已合并为单条');
  };
  /** 单条拆列表：text 按行拆进 items（追加不覆盖已有条目），拆完清空 text（与合并对称的移动语义） */
  const splitToList = (): void => {
    const parts = (d.text ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) {
      toast.info('单条内容为空，没有可拆分的行');
      return;
    }
    update(nodeId, { items: [...items, ...parts], listMode: true, text: '' });
    setTrKey(null);
  };
  const clearAll = (): void => {
    confirmDialog({
      title: '全部清空',
      message: listMode ? `清空全部 ${items.length} 条提示词？` : '清空单条提示词内容？',
      danger: true
    })
      .then((ok) => {
        if (!ok) return;
        setTrKey(null);
        update(nodeId, listMode ? { items: [] } : { text: '' });
      })
      .catch(() => undefined);
  };

  const count = listMode ? items.length : 1;

  return createPortal(
    // 背板 z-index 比默认低一档（799 < 800）：从工作台里打开的提示词库弹窗（inline 渲染、z=800）要能盖住本工作台
    <div className="mb-modal-backdrop mb-sc-plstudio-bd" {...backdrop}>
      <div className="mb-modal mb-sc-studio mb-sc-plstudio mb-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-sc-studio-head">
          <h3>提示词工作台 · {count} 条</h3>
          <div className="mb-sc-plstudio-mode">
            <button className={!listMode ? 'is-on' : ''} title="单条模式：一整段提示词" onClick={() => update(nodeId, { listMode: false })}>
              单条
            </button>
            <button className={listMode ? 'is-on' : ''} title="列表模式：多条提示词逐条喂下游" onClick={() => update(nodeId, { listMode: true })}>
              列表
            </button>
          </div>
          <span className="mb-sc-studio-hint">大窗完整编辑 · 修改实时写回节点 · Esc 关闭</span>
          <button className="mb-sc-node-x" title="关闭（Esc）" onClick={close}>
            ✕
          </button>
        </div>

        <div className="mb-sc-plstudio-body">
          {/* 左：条目编辑卡列表（每条自动贴高、无上限，长提示词完整显示） */}
          <div className="mb-sc-plstudio-main mb-dragscroll" ref={mainRef}>
            {listMode ? (
              <>
                {items.length === 0 && (
                  <div className="mb-sc-plstudio-empty">还没有条目——点下方「＋ 添加一条」，或用右侧「批量粘贴导入」一次贴入多条。</div>
                )}
                {items.map((t, i) => (
                  <div
                    key={i}
                    className={`mb-sc-plstudio-card ${overIdx === i && dragIdx !== null && dragIdx !== i ? 'is-dragover' : ''}`}
                    onDragOver={(e) => {
                      if (dragIdx === null) return;
                      e.preventDefault();
                      setOverIdx(i);
                    }}
                    onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
                    onDrop={(e) => {
                      if (dragIdx === null) return;
                      e.preventDefault();
                      moveItem(dragIdx, i);
                      setDragIdx(null);
                      setOverIdx(null);
                    }}
                  >
                    <div className="mb-sc-plstudio-cardhead">
                      <span
                        className="mb-sc-plstudio-idx"
                        draggable
                        title="拖动排序（也可用 ↑↓ 按钮）"
                        onDragStart={(e) => {
                          setDragIdx(i);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(i));
                        }}
                        onDragEnd={() => {
                          setDragIdx(null);
                          setOverIdx(null);
                        }}
                      >
                        ⠿ {i + 1}
                      </span>
                      <span className="mb-sc-plstudio-count">{t.length} 字</span>
                      <button className="mb-sc-plstudio-iconbtn" title="上移" disabled={i === 0} onClick={() => moveItem(i, i - 1)}>
                        ↑
                      </button>
                      <button className="mb-sc-plstudio-iconbtn" title="下移" disabled={i === items.length - 1} onClick={() => moveItem(i, i + 1)}>
                        ↓
                      </button>
                      <button
                        className={`mb-sc-plstudio-iconbtn ${trKey === i ? 'is-on' : ''}`}
                        title="翻译此条（可对比后替换）"
                        onClick={() => setTrKey((k) => (k === i ? null : i))}
                      >
                        🌐
                      </button>
                      <button className="mb-sc-plstudio-iconbtn is-danger" title="删除此条" onClick={() => removeItem(i)}>
                        ✕
                      </button>
                    </div>
                    <textarea
                      ref={(el) => {
                        itemRefs.current[i] = el;
                      }}
                      className="mb-sc-input mb-sc-textarea mb-sc-plstudio-ta"
                      value={t}
                      onFocus={beginEdit}
                      onBlur={commitEdit}
                      onChange={(e) => setItemAt(i, e.target.value)}
                      placeholder={`第 ${i + 1} 条提示词…`}
                    />
                    {trKey === i && (
                      <TranslateBox
                        text={t}
                        onReplace={(x) => {
                          setItemAt(i, x);
                          setTrKey(null);
                        }}
                      />
                    )}
                  </div>
                ))}
                <div className="mb-sc-plstudio-actions">
                  <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={addItem}>
                    ＋ 添加一条
                  </button>
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" title="从提示词库追加一条到列表末尾" onClick={() => openPicker(nodeId, items.length)}>
                    📚 从库添加
                  </button>
                </div>
              </>
            ) : (
              <div className="mb-sc-plstudio-card">
                <div className="mb-sc-plstudio-cardhead">
                  <span className="mb-sc-plstudio-idx">单条</span>
                  <span className="mb-sc-plstudio-count">{(d.text ?? '').length} 字</span>
                  <button
                    className={`mb-sc-plstudio-iconbtn ${trKey === 'single' ? 'is-on' : ''}`}
                    title="翻译（可对比后替换）"
                    onClick={() => setTrKey((k) => (k === 'single' ? null : 'single'))}
                  >
                    🌐
                  </button>
                </div>
                <textarea
                  ref={singleRef}
                  className="mb-sc-input mb-sc-textarea mb-sc-plstudio-ta"
                  value={d.text ?? ''}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) => update(nodeId, { text: e.target.value })}
                  placeholder="输入提示词…"
                />
                {trKey === 'single' && (
                  <TranslateBox
                    text={d.text ?? ''}
                    onReplace={(x) => {
                      update(nodeId, { text: x });
                      setTrKey(null);
                    }}
                  />
                )}
                <div className="mb-sc-plstudio-actions">
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" title="从提示词库选择并插入" onClick={() => openPicker(nodeId)}>
                    📚 从库插入
                  </button>
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" title="把单条内容按行拆成多条列表" onClick={splitToList}>
                    ⇊ 按行拆成列表
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 右：统一提示词 + 批量操作 */}
          <div className="mb-sc-plstudio-side">
            {listMode && (
              <div className="mb-sc-plstudio-block">
                <div className="mb-sc-plstudio-btitle">统一提示词（拼进每一条）</div>
                <textarea
                  ref={uniRef}
                  className="mb-sc-input mb-sc-textarea mb-sc-plstudio-ta"
                  value={d.unifiedPrompt ?? ''}
                  onFocus={beginEdit}
                  onBlur={commitEdit}
                  onChange={(e) => update(nodeId, { unifiedPrompt: e.target.value })}
                  placeholder="统一提示词（夹进每条的前/后，形成规范，免重复输入）"
                />
                <div className="mb-sc-plist-unipos">
                  {(['prefix', 'suffix', 'both'] as const).map((p) => (
                    <button
                      key={p}
                      className={`mb-sc-plist-uposbtn ${(d.unifiedPos ?? 'prefix') === p ? 'is-on' : ''}`}
                      title={p === 'prefix' ? '放每条前面' : p === 'suffix' ? '放每条后面' : '每条前后都放'}
                      onClick={() => update(nodeId, { unifiedPos: p })}
                    >
                      {p === 'prefix' ? '放前' : p === 'suffix' ? '放后' : '前后'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-sc-plstudio-block">
              <div className="mb-sc-plstudio-btitle">批量粘贴导入</div>
              <textarea
                className="mb-sc-input mb-sc-textarea"
                rows={7}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={'粘贴多条提示词文本…\n\n可整段粘贴，再选下方一种拆法追加进列表'}
              />
              <div className="mb-sc-plstudio-actions">
                <button className="mb-btn mb-btn-sm mb-btn-primary" title="空行分隔的段落各成一条" onClick={() => importBulk('blank')}>
                  按空行拆条追加
                </button>
                <button className="mb-btn mb-btn-sm mb-btn-ghost" title="每一行各成一条" onClick={() => importBulk('line')}>
                  按换行拆条追加
                </button>
              </div>
              <span className="mb-sc-plist-hint">空行拆＝段落成条 · 换行拆＝每行成条；导入自动切到列表模式</span>
            </div>

            <div className="mb-sc-plstudio-block">
              <div className="mb-sc-plstudio-btitle">整理</div>
              <div className="mb-sc-plstudio-actions">
                {listMode ? (
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" title="全部条目用换行合成一段并切回单条" onClick={mergeToSingle}>
                    ⇈ 合并为单条
                  </button>
                ) : (
                  <button className="mb-btn mb-btn-sm mb-btn-ghost" title="单条内容按行拆进列表" onClick={splitToList}>
                    ⇊ 单条拆列表
                  </button>
                )}
                <button className="mb-sc-plist-clear" title="清空当前模式下的全部提示词内容" onClick={clearAll}>
                  🗑 全部清空
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
