/**
 * 「Obsidian 库」中心悬浮窗（仿便携资产库 SmartGalleryPanel）：
 * 检索/浏览用户 Obsidian 资产库里的 .md 笔记，选中预览正文，
 * 一键「作为提示词节点插入画布」/「复制内容」/「在 Obsidian 中打开」。
 *
 * 无遮罩、画布保持可交互；portal 到 body（铁律 27）；
 * 外层复用 .mb-sc-glp 尺寸规格（clamp(560px,62vw,1500px) × min(72vh,920px)）。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { VaultNoteHit } from '@shared/ipc';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import type { SmartNodeData } from '@shared/smartCanvas';
import { toast } from '@/store/toastStore';

interface VaultPanelState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const useVaultPanelStore = create<VaultPanelState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}));

export function VaultPanel(): JSX.Element | null {
  const { open, close } = useVaultPanelStore();
  const [q, setQ] = useState('');
  const [notes, setNotes] = useState<VaultNoteHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [hint, setHint] = useState('');
  const [sel, setSel] = useState<VaultNoteHit | null>(null);
  const [body, setBody] = useState('');
  const debounceRef = useRef<number | null>(null);

  async function search(query: string): Promise<void> {
    setLoading(true);
    const r = await window.electronAPI.vault.search({ query, limit: 50 });
    setLoading(false);
    if (r.ok) {
      setNotes(r.data.notes);
      setHint(r.data.notes.length === 0 ? (query ? '库里没有匹配的笔记' : '库里还没有笔记') : '');
    } else {
      setNotes([]);
      setHint(`${r.error.message}${r.error.hint ? `——${r.error.hint}` : ''}`);
    }
  }

  // 打开时列最近笔记；输入 300ms 去抖检索
  useEffect(() => {
    if (!open) return;
    setSel(null);
    setBody('');
    void search(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void search(q), 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function pick(n: VaultNoteHit): Promise<void> {
    setSel(n);
    setBody('');
    const r = await window.electronAPI.vault.read({ path: n.path });
    if (r.ok) setBody(r.data.body);
    else toast.error('读取笔记失败', r.error.message);
  }

  function insertAsPrompt(): void {
    if (!sel || !body.trim()) return;
    const st = useSmartCanvasStore.getState();
    const id = st.addNode('prompt');
    st.updateNodeData(id, { text: body.trim() } as unknown as Partial<SmartNodeData>);
    toast.success('已插入提示词节点', sel.title);
  }

  async function copyBody(): Promise<void> {
    if (!body.trim()) return;
    try {
      await navigator.clipboard.writeText(body.trim());
      toast.success('已复制内容');
    } catch {
      toast.error('复制失败');
    }
  }

  if (!open) return null;
  return createPortal(
    <div className="mb-sc-glp mb-sc-vaultp mb-card" role="dialog" aria-label="Obsidian 库">
      <div className="mb-sc-glp-head">
        <h3>Obsidian 库</h3>
        <span className="mb-sc-glp-count">{loading ? '检索中…' : `${notes.length} 篇`}</span>
        <button className="mb-sc-node-x" onClick={close} title="关闭">
          ✕
        </button>
      </div>
      <div className="mb-sc-glp-bar">
        <input
          className="mb-input mb-sc-glp-search"
          placeholder="搜索笔记（文件名 + 全文）…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void search(q)}>
          刷新
        </button>
      </div>
      {hint ? (
        <p className="mb-sc-vaultp-hint">{hint}</p>
      ) : (
        <div className="mb-sc-vaultp-body">
          <div className="mb-sc-vaultp-list mb-dragscroll">
            {notes.map((n) => (
              <button
                key={n.path}
                className={`mb-sc-vaultp-item ${sel?.path === n.path ? 'is-on' : ''}`}
                onClick={() => void pick(n)}
                title={n.path}
              >
                <strong>{n.title}</strong>
                {n.excerpt && <span>{n.excerpt}</span>}
              </button>
            ))}
          </div>
          <div className="mb-sc-vaultp-preview">
            {sel ? (
              <>
                <div className="mb-sc-vaultp-pvhead">
                  <strong title={sel.path}>{sel.title}</strong>
                  <div className="mb-sc-vaultp-actions">
                    <button className="mb-btn mb-btn-sm mb-btn-primary" disabled={!body.trim()} onClick={insertAsPrompt}>
                      作为提示词节点插入
                    </button>
                    <button className="mb-btn mb-btn-sm mb-btn-ghost" disabled={!body.trim()} onClick={() => void copyBody()}>
                      复制内容
                    </button>
                    <button
                      className="mb-btn mb-btn-sm mb-btn-ghost"
                      onClick={() => void window.electronAPI.vault.openNote({ path: sel.path })}
                    >
                      在 Obsidian 打开
                    </button>
                  </div>
                </div>
                <pre className="mb-sc-vaultp-content">{body || '读取中…'}</pre>
              </>
            ) : (
              <p className="mb-sc-vaultp-hint">左侧选择一篇笔记查看内容</p>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
