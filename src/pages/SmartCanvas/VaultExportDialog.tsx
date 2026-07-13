/**
 * 「存入 Obsidian 库」导出弹窗（智能画布节点右键唤起，命令式 store）。
 *
 * 提交走 api:vault:export：主进程全库同名查重——已有同名笔记追加「补充」小节，
 * 否则在所选分类文件夹新建（frontmatter：tags/description/创建日期）。
 * portal 到 body：躲开画布/路由的 transform 祖先（铁律 27）。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { Node } from '@xyflow/react';
import { Modal } from '@/components/Modal';
import { toast } from '@/store/toastStore';
import { CATALOG } from '@/lib/agentCatalog';
import type { SmartNodeKind } from '@shared/smartCanvas';

interface VaultExportPayload {
  title: string;
  content: string;
}

interface VaultExportState {
  open: boolean;
  payload: VaultExportPayload | null;
  openWith: (p: VaultExportPayload) => void;
  close: () => void;
}

export const useVaultExportStore = create<VaultExportState>((set) => ({
  open: false,
  payload: null,
  openWith: (payload) => set({ open: true, payload }),
  close: () => set({ open: false })
}));

/** 按节点给个像样的笔记标题建议（用户可改） */
export function suggestedVaultTitle(node: Node): string {
  const d = node.data as { name?: string; label?: string };
  const custom = (d.name ?? d.label ?? '').trim();
  if (custom) return custom;
  const kindLabel = CATALOG[node.type as SmartNodeKind]?.label ?? '节点';
  return `${kindLabel}输出`;
}

export function VaultExportDialog(): JSX.Element | null {
  const { open, payload, close } = useVaultExportStore();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [folder, setFolder] = useState('');
  const [tags, setTags] = useState('');
  const [desc, setDesc] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [vaultHint, setVaultHint] = useState('');
  const [busy, setBusy] = useState(false);

  // 打开时回填内容 + 拉库内文件夹列表（失败＝库未配置，给指路提示但不拦编辑）
  useEffect(() => {
    if (!open || !payload) return;
    setTitle(payload.title);
    setContent(payload.content);
    setTags('');
    setDesc('');
    setVaultHint('');
    window.electronAPI.vault
      .folders()
      .then((r) => {
        if (r.ok) {
          setFolders(r.data.folders);
          setFolder((prev) => (r.data.folders.includes(prev) ? prev : ''));
        } else {
          setFolders([]);
          setVaultHint(`${r.error.message}${r.error.hint ? `——${r.error.hint}` : ''}`);
        }
      })
      .catch(() => setVaultHint('读取库文件夹失败'));
  }, [open, payload]);

  async function submit(): Promise<void> {
    const t = title.trim();
    const c = content.trim();
    if (!t || !c) {
      toast.error('标题和内容不能为空');
      return;
    }
    setBusy(true);
    const tagsArr = tags
      .split(/[,，;；\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await window.electronAPI.vault.exportNote({
      title: t,
      content: c,
      folder: folder || undefined,
      tags: tagsArr.length ? tagsArr : undefined,
      description: desc.trim() || undefined
    });
    setBusy(false);
    if (r.ok) {
      toast.success(r.data.action === 'created' ? '已存入 Obsidian 库' : '已追加到同名笔记', r.data.path);
      close();
    } else {
      toast.error('存入失败', `${r.error.message}${r.error.hint ? `——${r.error.hint}` : ''}`);
    }
  }

  if (!open || !payload) return null;
  return createPortal(
    <Modal
      open={open}
      onClose={close}
      title="存入 Obsidian 库"
      width={560}
      footer={
        <>
          <button className="mb-btn mb-btn-ghost" onClick={close} disabled={busy}>
            取消
          </button>
          <button className="mb-btn mb-btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? '存入中…' : '存入'}
          </button>
        </>
      }
    >
      <div className="mb-sc-vex-form">
        {vaultHint && <p className="mb-sc-vex-hint">{vaultHint}</p>}
        <label className="mb-sc-vex-field">
          <span>笔记标题（同名笔记会追加，不覆盖）</span>
          <input className="mb-input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="mb-sc-vex-field">
          <span>分类文件夹</span>
          <select className="mb-select" value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">（库根目录）</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div className="mb-sc-vex-row">
          <label className="mb-sc-vex-field">
            <span>标签（逗号分隔，可空）</span>
            <input className="mb-input" value={tags} placeholder="角色设定, 剧本" onChange={(e) => setTags(e.target.value)} />
          </label>
          <label className="mb-sc-vex-field">
            <span>一句话描述（可空）</span>
            <input className="mb-input" value={desc} maxLength={200} onChange={(e) => setDesc(e.target.value)} />
          </label>
        </div>
        <label className="mb-sc-vex-field">
          <span>内容（可再编辑）</span>
          <textarea className="mb-textarea mb-sc-vex-content" value={content} onChange={(e) => setContent(e.target.value)} />
        </label>
      </div>
    </Modal>,
    document.body
  );
}
