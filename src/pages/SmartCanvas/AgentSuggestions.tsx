/**
 * AI 优化建议清单浮层：展示 agentOptimize 对「选中的一段流程」的诊断结果，逐条 / 全部应用。
 * portal 到 body（铁律 27：浮层脱离 transform 祖先）+ 双类 .mb-sc-agsug.mb-card 提特异性。
 * 入口 ×2：CanvasViewport 多选右键「AI 优化这段流程」/ AgentPanel「优化选中」分区 —— 都走 runOptimizeSelection。
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { SmartNodeData } from '@shared/smartCanvas';
import { useSmartCanvasStore } from '@/store/smartCanvasStore';
import { useSettingsStore } from '@/store/settingsStore';
import { listMappedModels } from '@/lib/modelMapping';
import { CATALOG, isNodeKind } from '@/lib/agentCatalog';
import { optimizeSelection, applySuggestion, type AgentSuggestion } from '@/lib/agentOptimize';
import { toast } from '@/store/toastStore';

// ───────────────────────── 状态 ─────────────────────────

interface AgentSuggestionsState {
  open: boolean;
  items: AgentSuggestion[];
  /** 建议 id → 已应用（置灰「已应用」） */
  applied: Record<string, boolean>;
  openWith: (items: AgentSuggestion[]) => void;
  close: () => void;
  markApplied: (id: string) => void;
}

export const useAgentSuggestionsStore = create<AgentSuggestionsState>((set) => ({
  open: false,
  items: [],
  applied: {},
  openWith: (items) => set({ open: true, items, applied: {} }),
  close: () => set({ open: false }),
  markApplied: (id) => set((s) => ({ applied: { ...s.applied, [id]: true } }))
}));

// ───────────────────────── 编排（两个入口共用）─────────────────────────

/** 防重入：诊断是网络往返（数秒级），重复点击只提示不重复发请求。 */
let inFlight = false;

/**
 * 「AI 优化这段流程」主入口：读选区 → 解析文本模型（沿用智能体设置：prefs.agent_text_model，
 * 不可用退回首个可用文本模型）→ 调 optimizeSelection → 弹建议清单浮层。
 * 免费路径（复用 api:chat:optimize-prompt 一发一收），不触发任何生成。
 */
export async function runOptimizeSelection(): Promise<void> {
  if (inFlight) {
    toast.info('AI 正在审查中…', '稍等片刻，结果会弹出建议清单');
    return;
  }
  const sc = useSmartCanvasStore.getState();
  // 分组容器本身没有可优化参数，剔除；子节点/普通节点都参与
  const selected = sc.nodes.filter((n) => n.selected && n.type !== 'group');
  if (!selected.length) {
    toast.error('先选中要优化的节点', '框选或点选一段流程后再试');
    return;
  }
  const sset = useSettingsStore.getState();
  const planId = sset.activePlanId;
  if (planId == null) {
    toast.error('没有激活的方案', '去设置页选择 / 新建一个方案');
    return;
  }
  const usableText = listMappedModels(sset.configs, planId, 'text').filter((m) => m.usable);
  const pref = (sset.prefs.agent_text_model || '').trim();
  const model = pref && usableText.some((m) => m.name === pref) ? pref : usableText[0]?.name ?? '';
  if (!model) {
    toast.error('没有可用的文本模型', '去 设置 → 系统与体验 → 智能体模型 配置一个对话模型');
    return;
  }

  inFlight = true;
  toast.info(`AI 正在审查选中的 ${selected.length} 个节点…`, '免费，只分析不生成');
  try {
    const res = await optimizeSelection({
      planId,
      textModel: model,
      nodes: sc.nodes,
      edges: sc.edges,
      selectedIds: selected.map((n) => n.id)
    });
    if (!res.ok) {
      toast.error('优化建议获取失败', res.reason ?? '请重试或换个文本模型');
      return;
    }
    if (!res.suggestions.length) {
      toast.success('AI 认为这段流程没有明显问题', '没有需要调整的建议');
      return;
    }
    useAgentSuggestionsStore.getState().openWith(res.suggestions);
    if (res.warnings.length) toast.info(`有 ${res.warnings.length} 条建议被丢弃`, res.warnings[0]);
  } catch (e) {
    toast.error('优化建议获取失败', e instanceof Error ? e.message : String(e));
  } finally {
    inFlight = false;
  }
}

/** 应用一条建议：store 动作经依赖注入交给 lib（applySuggestion 内部会重新校验 + family 钳制）。 */
function applyOne(s: AgentSuggestion): boolean {
  const st = useAgentSuggestionsStore.getState();
  if (st.applied[s.id]) return true;
  const sc = useSmartCanvasStore.getState();
  const sset = useSettingsStore.getState();
  const imageModels = listMappedModels(sset.configs, sset.activePlanId, 'image').map((m) => ({
    name: m.name,
    actualId: m.actualId
  }));
  const r = applySuggestion(s, {
    nodes: sc.nodes,
    updateNodeData: (id, patch) => sc.updateNodeData(id, patch as Partial<SmartNodeData>),
    imageModels
  });
  if (r.ok) st.markApplied(s.id);
  else toast.error('无法应用该建议', r.reason);
  return r.ok;
}

// ───────────────────────── 组件 ─────────────────────────

const KIND_BADGE: Record<AgentSuggestion['kind'], string> = {
  'prompt-rewrite': '提示词',
  param: '参数',
  structure: '结构'
};

export function AgentSuggestions(): JSX.Element | null {
  const open = useAgentSuggestionsStore((s) => s.open);
  const items = useAgentSuggestionsStore((s) => s.items);
  const applied = useAgentSuggestionsStore((s) => s.applied);
  const close = useAgentSuggestionsStore((s) => s.close);
  const nodes = useSmartCanvasStore((s) => s.nodes);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // 卸载（切文档 / 离开智能画布）时收起，避免残留浮层跨页阻断交互（弹窗复位惯例）
  useEffect(() => () => useAgentSuggestionsStore.getState().close(), []);

  if (!open) return null;

  /** 目标节点的可读标签：类型中文名 + 短 id（帮用户对上是哪个节点）。 */
  function targetLabel(s: AgentSuggestion): string | null {
    if (!s.nodeId) return null;
    const n = nodes.find((x) => x.id === s.nodeId);
    if (!n) return `${s.nodeId.slice(0, 6)}（已删除）`;
    const label = isNodeKind(n.type) ? CATALOG[n.type].label : n.type ?? '节点';
    return `${label} · ${n.id.slice(0, 6)}`;
  }

  function locate(s: AgentSuggestion): void {
    if (!s.nodeId) return;
    const sc = useSmartCanvasStore.getState();
    if (sc.nodes.some((n) => n.id === s.nodeId)) sc.selectOnly(s.nodeId);
    else toast.error('目标节点不存在', '可能已被删除');
  }

  const pending = items.filter((it) => it.applicable && !applied[it.id]);
  function applyAll(): void {
    let ok = 0;
    for (const it of pending) if (applyOne(it)) ok++;
    if (ok) toast.success(`已应用 ${ok} 条建议`);
  }

  return createPortal(
    <div className="mb-sc-agsug mb-card" role="dialog" aria-label="AI 优化建议">
      <div className="mb-sc-agsug-head">
        <h3>🤖 AI 优化建议（{items.length} 条）</h3>
        {pending.length > 0 && (
          <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={applyAll}>
            全部应用（{pending.length}）
          </button>
        )}
        <button className="mb-sc-node-x" onClick={close} title="关闭（Esc）">
          ✕
        </button>
      </div>
      <div className="mb-sc-agsug-list">
        {items.map((it) => {
          const done = !!applied[it.id];
          const target = targetLabel(it);
          return (
            <div key={it.id} className={`mb-sc-agsug-item ${done ? 'is-applied' : ''}`}>
              <div className="mb-sc-agsug-titlerow">
                <span className={`mb-sc-agsug-kind is-${it.kind}`}>{KIND_BADGE[it.kind]}</span>
                <span className="mb-sc-agsug-title">{it.title}</span>
              </div>
              {target && (
                <button className="mb-sc-agsug-target" onClick={() => locate(it)} title="在画布上选中该节点">
                  节点：{target}
                </button>
              )}
              {it.reason && <div className="mb-sc-agsug-reason">{it.reason}</div>}
              {it.kind === 'prompt-rewrite' && typeof it.newValue === 'string' && (
                <pre className="mb-sc-agsug-preview">{it.newValue}</pre>
              )}
              {it.kind === 'param' && it.patch && (
                <div className="mb-sc-agsug-patch">
                  {it.patch.field} → {String(it.patch.value)}
                </div>
              )}
              <div className="mb-sc-agsug-ops">
                {done ? (
                  <span className="mb-sc-agsug-done">✓ 已应用</span>
                ) : it.applicable ? (
                  <button className="mb-btn mb-btn-sm mb-btn-primary" onClick={() => applyOne(it)}>
                    应用
                  </button>
                ) : (
                  <span className="mb-sc-agsug-note">{it.applyNote ?? '仅提醒，不自动修改'}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
