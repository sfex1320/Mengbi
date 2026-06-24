import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeResizer, type NodeProps } from '@xyflow/react';
import { useSmartCanvasStore, useSmartTextStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { computeUpstream, runPromptMallNode, generateMallThumbViaComfy } from '@/lib/smartCanvasRunner';
import { usePromptMallStudioStore } from '../PromptMallStudio';
import { catLabel, PROMPT_MALL_CATEGORIES } from '@/lib/promptMall/cardTypes';
import { PROMPT_MALL_CARDS } from '@/lib/promptMall/cards';
import { useMallUserCardsStore } from '@/lib/promptMall/userCards';
import { useMallThumbsStore } from '../promptMall/mallThumbs';
import type { PromptMallNodeData, SmartNodeData } from '@shared/smartCanvas';
import { NodeShell } from './NodeShell';
import { areaMenu, copyText, makePromptNodeFrom, ToPromptButton, autoGrowNode, estimateTextHeight, getNodeWidth } from '../nodeArea';
import { toast } from '@/store/toastStore';

const STATUS_TEXT: Record<string, string> = { idle: '待运行', running: '运行中…', success: '已完成', error: '失败' };

function useTextModels(): string[] {
  const configs = useSettingsStore((s) => s.configs);
  return useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of configs) {
      if (c.type !== 'text') continue;
      for (const n of Object.keys(c.model_mapping ?? {})) if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }, [configs]);
}

/**
 * 提示词商城节点（精简卡片）：中/英 + 优化开关 + 购物车摘要 + 运行 + 合成结果预览。
 * 卡片墙 / 分类 / 拖拽购物车等在「提示词商城」弹窗。
 * 「开发模式」：连一个 ComfyUI 节点 → 按 genPrompt 批量生成卡片缩略图（按 cardId 落盘到缩略图文件夹）。
 */
export function PromptMallNode({ id, data }: NodeProps): JSX.Element {
  const update = useSmartCanvasStore((s) => s.updateNodeData);
  const remove = useSmartCanvasStore((s) => s.removeNode);
  const nodes = useSmartCanvasStore((s) => s.nodes);
  const edges = useSmartCanvasStore((s) => s.edges);
  const openText = useSmartTextStore((s) => s.open);
  const openStudio = usePromptMallStudioStore((s) => s.open);
  const userCards = useMallUserCardsStore((s) => s.cards);
  const thumbMap = useMallThumbsStore((s) => s.map);
  const thumbDir = useMallThumbsStore((s) => s.dir);
  const loadThumbs = useMallThumbsStore((s) => s.load);
  const d = data as unknown as PromptMallNodeData;
  const lang = d.lang === 'en' ? 'en' : 'zh';
  const textModels = useTextModels();
  const setF = (p: Partial<PromptMallNodeData>): void => update(id, p as Partial<SmartNodeData>);
  const up = useMemo(() => computeUpstream(nodes, edges, id), [nodes, edges, id]);
  const running = d.status === 'running';
  const cart = d.cart ?? [];
  const upPrompts = up.prompts.length;

  // 开发模式：找直接下游的 ComfyUI 节点 + 生成状态
  const comfyNodeId = useMemo(
    () => edges.find((e) => e.source === id && nodes.find((n) => n.id === e.target)?.type === 'comfy')?.target,
    [edges, nodes, id]
  );
  const [devCat, setDevCat] = useState('character');
  const [gen, setGen] = useState<{ running: boolean; done: number; total: number }>({ running: false, done: 0, total: 0 });
  const [overwrite, setOverwrite] = useState(false);
  const stopGen = useRef(false);

  useEffect(() => {
    const w = getNodeWidth(id);
    let need = d.devMode ? 360 : 286;
    if (!d.devMode && d.assembled?.trim()) need += Math.min(150, estimateTextHeight(d.assembled, w - 40)) + 28;
    autoGrowNode(id, need, 900);
  }, [id, d.assembled, d.devMode]);

  async function devGenerate(): Promise<void> {
    if (!comfyNodeId) {
      toast.error('请先把本节点连到一个 ComfyUI 节点', '商城节点输出口 → ComfyUI 节点（工作流用 z-image 等）');
      return;
    }
    if (!thumbDir) {
      toast.error('先选择缩略图文件夹', '生成的缩略图按 cardId 落到该文件夹 → 自动与卡片一一对应');
      return;
    }
    const all = [...PROMPT_MALL_CARDS, ...userCards];
    const pool = all.filter((c) => devCat === 'all' || c.cat === devCat);
    const targets = overwrite ? pool : pool.filter((c) => !thumbMap[c.id]);
    if (!targets.length) {
      toast.info(overwrite ? '该范围没有卡片' : '该范围缩略图已齐全', '换个分类，或勾「覆盖已有」重生成');
      return;
    }
    stopGen.current = false;
    setGen({ running: true, done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      if (stopGen.current) break;
      const c = targets[i];
      const r = await generateMallThumbViaComfy(c, comfyNodeId, thumbDir, overwrite);
      if (!r.ok) {
        toast.error(`「${c.zh}」缩略图生成失败`, r.error);
        break;
      }
      setGen({ running: true, done: i + 1, total: targets.length });
      await loadThumbs();
    }
    setGen((g) => ({ ...g, running: false }));
  }

  return (
    <>
      <NodeResizer isVisible minWidth={260} minHeight={220} />
      <NodeShell
        title="提示词商城"
        accent="is-prompt-mall"
        inputs
        outputs
        fill
        onDelete={() => remove(id)}
        headRight={
          <span className={`mb-sc-status is-${d.status}`}>
            {running && <span className="mb-sc-spinner" aria-hidden />}
            {STATUS_TEXT[d.status] ?? d.status}
          </span>
        }
      >
        <div className="mb-sc-revctl nodrag">
          {/* 中/英输出 + 优化开关 + 开发模式 */}
          <div className="mb-sc-mall-row">
            <div className="mb-sc-mall-langtoggle" role="group" aria-label="输出语言">
              <button className={`mb-sc-mall-langbtn ${lang === 'zh' ? 'is-on' : ''}`} onClick={() => setF({ lang: 'zh' })}>中</button>
              <button className={`mb-sc-mall-langbtn ${lang === 'en' ? 'is-on' : ''}`} onClick={() => setF({ lang: 'en' })}>EN</button>
            </div>
            <label className="mb-sc-mall-opt" title="勾选=交给对话模型合并去重成更连贯的一条；不勾=纯拼接（零 API）">
              <input type="checkbox" checked={!!d.optimize} onChange={(e) => setF({ optimize: e.target.checked })} />
              优化
            </label>
            <button
              className={`mb-btn mb-btn-xs ${d.devMode ? 'mb-btn-primary' : 'mb-btn-ghost'}`}
              title="开发模式：连 ComfyUI 节点按 genPrompt 批量生成卡片缩略图"
              onClick={() => setF({ devMode: !d.devMode })}
            >
              🛠 开发
            </button>
          </div>

          {d.devMode ? (
            /* ── 开发模式：ComfyUI 批量生成缩略图 ── */
            <div className="mb-sc-mall-dev">
              <div className={`mb-sc-mall-devstat ${comfyNodeId ? 'is-ok' : ''}`}>
                {comfyNodeId ? '✓ 已连接 ComfyUI 节点（用 genPrompt 生图）' : '⚠ 把本节点输出口连到一个 ComfyUI 节点'}
              </div>
              <div className="mb-sc-mall-devrow">
                <span className="mb-sc-mall-thumbdir" title={thumbDir || '未设置'}>
                  缩略图夹：{thumbDir ? thumbDir.split(/[\\/]/).pop() : '未设置'}
                </span>
                <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => void window.electronAPI.storage.selectFolder().then((r) => { if (r.ok && r.data) void useMallThumbsStore.getState().setDir(r.data.path); })}>选夹</button>
                <button className="mb-btn mb-btn-xs mb-btn-ghost" onClick={() => void loadThumbs()}>刷新</button>
                <label className="mb-sc-mall-opt" title="勾选=连已有缩略图也重新生成并覆盖（改了提示词后整套刷新用）">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  覆盖
                </label>
              </div>
              <div className="mb-sc-mall-devrow">
                <select className="mb-select" value={devCat} onChange={(e) => setDevCat(e.target.value)}>
                  <option value="all">全部分类</option>
                  {PROMPT_MALL_CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>{c.zh}</option>
                  ))}
                </select>
                {gen.running ? (
                  <button className="mb-btn mb-btn-sm is-stop" onClick={() => (stopGen.current = true)}>停止 {gen.done}/{gen.total}</button>
                ) : (
                  <button className="mb-btn mb-btn-sm" disabled={!comfyNodeId || !thumbDir} onClick={() => void devGenerate()}>生成缺失缩略图</button>
                )}
              </div>
              <div className="mb-sc-note">逐张经 ComfyUI 生成 → 按「分类/cardId.png」分子文件夹落盘 → 自动与卡片一一对应。可随时停止。</div>
            </div>
          ) : (
            <>
              {/* 优化时需要对话模型 */}
              {d.optimize && (
                <select className="mb-select" value={d.modelId} title="合并优化用的对话模型" onChange={(e) => setF({ modelId: e.target.value })}>
                  <option value="">（选对话模型 · 合并优化）</option>
                  {textModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}

              <div className="mb-sc-note" style={{ cursor: 'pointer' }} title="打开商城编辑购物车" onClick={() => openStudio(id)}>
                🛒 购物车 {cart.length} 个片段{upPrompts ? ` · 上游 ${upPrompts} 条` : ''}
              </div>
              {cart.length > 0 && (
                <div className="mb-sc-mall-cartmini">
                  {cart.slice(0, 8).map((it, i) => (
                    <span key={it.cardId + i} className="mb-sc-mall-chip" title={catLabel(it.cat, lang)}>
                      {(lang === 'zh' ? it.zh : it.en) || it.en || it.zh}
                    </span>
                  ))}
                  {cart.length > 8 && <span className="mb-sc-mall-chip is-more">+{cart.length - 8}</span>}
                </div>
              )}

              <button className="mb-btn mb-btn-sm mb-btn-primary mb-sc-studio-openbtn" title="左分类 / 中缩略图卡片墙 / 右购物车 · 拖卡进车合成一条提示词" onClick={() => openStudio(id)}>
                🛒 打开提示词商城
              </button>
            </>
          )}
        </div>

        {!d.devMode && (
          <div className="mb-sc-sb-runrow nodrag">
            <button className="mb-btn mb-btn-sm" disabled={running} onClick={() => void runPromptMallNode(id)}>
              {running ? '运行中…' : d.assembled ? '重新合成' : '组装并优化'}
            </button>
          </div>
        )}

        {d.error && <div className="mb-sc-result-err nodrag">{d.error}</div>}

        {!d.devMode && d.assembled?.trim() && (
          <>
            <div
              className="mb-sc-sb-story nodrag"
              title="合成提示词 · 点击放大 · 右键更多"
              onClick={() => openText(d.assembled ?? '', '提示词商城 · 合成结果')}
              onContextMenu={(e) =>
                areaMenu(e, [
                  { label: '复制提示词', onClick: () => copyText(d.assembled ?? '') },
                  { label: '→ 提示词节点', onClick: () => makePromptNodeFrom(id, d.assembled ?? '') },
                  { label: '在商城中编辑', onClick: () => openStudio(id) }
                ])
              }
            >
              <b>提示词：</b>
              {d.assembled}
            </div>
            <ToPromptButton onClick={() => makePromptNodeFrom(id, d.assembled ?? '')} title="把合成提示词导入下游提示词节点" />
          </>
        )}
      </NodeShell>
    </>
  );
}
