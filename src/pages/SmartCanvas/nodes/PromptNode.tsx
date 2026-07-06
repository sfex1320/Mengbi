import { useEffect, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import type { PromptNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { CopyButton, areaMenu, copyText, fitNodeHeight, estimateTextHeight, autoGrowNode, getNodeWidth, savePromptToLibrary } from '../nodeArea';
import { usePromptPickerStore } from '../PromptPickerDialog';
import { TranslateBox } from '../TranslateBox';
import type { ContextMenuEntry } from '@/components/ContextMenu';

export function PromptNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const beginEdit = useSmartCanvasStore((s) => s.beginEdit);
  const commitEdit = useSmartCanvasStore((s) => s.commitEdit);
  const openPicker = usePromptPickerStore((s) => s.open);
  const d = data as unknown as PromptNodeData;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [showTr, setShowTr] = useState(false);
  const items = d.items ?? [];

  // 列表每条输入框统一高度（默认 ≈3× 普通输入框；改一个 = 全部一起变）
  const ITEM_H = Math.max(60, d.listItemHeight ?? 132);
  const listRef = useRef<HTMLDivElement>(null);

  // 自适应：单条 ≈2.5× 高（输入框适中）；列表按 listItemHeight + 条数估高（含统一提示词行），保证输入框/按钮完整可见。
  useEffect(() => {
    const w = getNodeWidth(id);
    const h = d.listMode
      ? 130 + items.length * (ITEM_H + 16) + 64
      : Math.max(340, 90 + estimateTextHeight(d.text ?? '', w)) + (showTr ? 300 : 0);
    autoGrowNode(id, h, 2200);
  }, [id, d.text, d.listMode, items, showTr, ITEM_H]);

  /** 列表「适配高度」：把所有输入框统一调到能装下最长那条文字（右键 / 按钮触发）。 */
  function fitListHeight(): void {
    const root = listRef.current;
    if (!root) return;
    let max = 60;
    root.querySelectorAll('textarea').forEach((ta) => {
      max = Math.max(max, (ta as HTMLTextAreaElement).scrollHeight + 6);
    });
    update(id, { listItemHeight: Math.min(600, Math.ceil(max)) });
  }

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
        {!d.listMode ? (
          <div className="mb-sc-area">
            <CopyButton onClick={() => copyText(d.text ?? '')} />
            <textarea
              ref={taRef}
              className="mb-sc-input mb-sc-textarea nodrag nowheel"
              value={d.text ?? ''}
              onFocus={beginEdit}
              onBlur={commitEdit}
              onChange={(e) => update(id, { text: e.target.value })}
              placeholder="输入提示词…"
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
                  { label: '从提示词库选择…', onClick: () => openPicker(id) }
                ];
                if (sel.trim()) menu.push({ label: `选中入库（${sel.trim().length} 字）`, onClick: () => void savePromptToLibrary(sel) });
                menu.push({ label: '整段入库', onClick: () => void savePromptToLibrary(d.text ?? '') });
                menu.push({ separator: true });
                menu.push({ label: '适配高度', onClick: () => fitNodeHeight(id, taRef.current) });
                menu.push({ label: '清空', variant: 'danger', onClick: () => update(id, { text: '' }) });
                areaMenu(e, menu);
              }}
            />
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
          <div className="mb-sc-plist nodrag" ref={listRef}>
            <div className="mb-sc-plist-head">
              <span>提示词列表 · {items.length} 条</span>
              <span className="mb-sc-plist-hint">每条独立喂下游（逐条生图）</span>
            </div>
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
                  className="mb-sc-input mb-sc-textarea nowheel"
                  style={{ height: ITEM_H, resize: 'vertical' }}
                  value={t}
                  onChange={(e) => setItem(i, e.target.value)}
                  // 拖底边调一个框 → 所有框统一变高（listItemHeight 共享）
                  onMouseUp={(e) => {
                    const h = e.currentTarget.offsetHeight;
                    if (Math.abs(h - ITEM_H) > 4) update(id, { listItemHeight: h });
                  }}
                  placeholder={`第 ${i + 1} 条提示词…`}
                  onContextMenu={(e) =>
                    areaMenu(e, [
                      { label: '从提示词库选择…', onClick: () => openPicker(id, i) },
                      { label: '入库', onClick: () => void savePromptToLibrary(t) },
                      { label: '所有输入框适配文字高度', onClick: fitListHeight },
                      { label: '删除此条', variant: 'danger', onClick: () => removeItem(i) }
                    ])
                  }
                />
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
              <button className="mb-btn mb-btn-sm mb-btn-ghost" title="所有输入框高度适配文字（一键统一）" onClick={fitListHeight}>
                适配高度
              </button>
            </div>
          </div>
        )}
      </NodeShell>
    </>
  );
}
