import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { useSettingsStore } from '@/store/settingsStore';
import { listMappedModels } from '@/lib/modelMapping';
import { buildConfigAgentSystemPrompt } from '@/lib/configAgentSystemPrompt';
import { parseConfigPlan, type ConfigPlan, type ConfigPlanModel, type ParsedConfigPlan } from '@/lib/configAgentPlan';
import { classifyModelsDeterministic, buildConfigsFromPlan } from '@/lib/configAgentRules';
import {
  buildChatSystemPrompt,
  parseConfigChatTurn,
  extractConfigFromText,
  mergeFields,
  isReady,
  deriveNameFromUrl,
  templatedReply,
  type ConfigFields
} from '@/lib/configChatTurn';
import { toast } from '@/store/toastStore';
import type { ApiConfigInput } from '@shared/domain';
import './ConfigAgentPanel.css';

const WIN_KEY = 'mengbi.cfgagent.win.v1';
const MODEL_KEY = 'mengbi.cfgagent.model.v1';

interface WinGeom {
  x: number;
  y: number;
  w: number;
  h: number;
}
function clampWin(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}

interface ConfigAgentState {
  open: boolean;
  toggle: () => void;
  close: () => void;
}
export const useConfigAgentStore = create<ConfigAgentState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}));

type Phase = 'chat' | 'working' | 'proposed' | 'saving';
type CfgType = 'text' | 'image' | 'video';
interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}
interface ProtoResult {
  testing?: boolean;
  ok?: boolean;
  skipped?: boolean;
  message?: string;
  fixed?: boolean;
}
interface Proposal {
  name: string;
  configs: ApiConfigInput[];
  skipped: ConfigPlanModel[];
}

const TYPE_LABEL: Record<CfgType, string> = { text: '对话', image: '绘画', video: '视频' };
const GREETING =
  '你好，我是模型配置助手。把中转站的「地址 + API Key（名称可选）」直接发给我，可以一次性发，也可以分几次——我会自动识别、缺什么就问你，凑齐后帮你拉模型、选协议、测试并建好卡片。';

function normUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').toLowerCase();
}
function protocolOf(cfg: ApiConfigInput): string {
  if (cfg.type === 'text') return `${cfg.official_kind ?? '默认'}`;
  if (cfg.type === 'image') return `${cfg.image_kind ?? '默认'}`;
  return `${cfg.video_kind ?? 'kling'}`;
}

/**
 * 模型配置智能体（对话式）：右下角 🤖 FAB → 浮动对话框。用户用自然语言给信息（可分多次、格式不限），
 * LLM 抽取 名称/地址/Key，缺啥追问；齐了就走确定性管线 拉模型→分类选协议→建卡→对话自动测，最后确认保存。
 * 无可用对话模型时退化为「正则抽取 + 模板追问 + 规则分类」，照样能用。复用 testConnection / optimizePrompt /
 * testProtocol / save，零新 IPC。
 */
export function ConfigAgentPanel(): JSX.Element {
  const open = useConfigAgentStore((s) => s.open);
  const toggle = useConfigAgentStore((s) => s.toggle);
  const close = useConfigAgentStore((s) => s.close);

  const configs = useSettingsStore((s) => s.configs);
  const planId = useSettingsStore((s) => s.activePlanId);
  const usableText = useMemo(() => listMappedModels(configs, planId, 'text').filter((m) => m.usable), [configs, planId]);

  const [planningModel, setPlanningModel] = useState('');
  useEffect(() => {
    const saved = (localStorage.getItem(MODEL_KEY) || '').trim();
    if (saved && usableText.some((m) => m.name === saved)) setPlanningModel(saved);
    else setPlanningModel(usableText[0]?.name ?? '');
  }, [usableText]);

  const [messages, setMessages] = useState<ChatMsg[]>([{ id: 0, role: 'assistant', text: GREETING }]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>('chat');
  const [fields, setFields] = useState<ConfigFields>({});
  const fieldsRef = useRef<ConfigFields>({});
  fieldsRef.current = fields;
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const proposalRef = useRef<Proposal | null>(null);
  proposalRef.current = proposal;
  const [protoResults, setProtoResults] = useState<Record<string, ProtoResult>>({});
  const [awaitingModels, setAwaitingModels] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const idRef = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sending = phase === 'working';

  function addMsg(role: 'user' | 'assistant', text: string): void {
    setMessages((m) => [...m, { id: idRef.current++, role, text }]);
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, proposal, protoResults]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // ── 悬浮窗几何（铁律 20）──
  const [win, setWin] = useState<WinGeom | null>(null);
  const winRef = useRef<WinGeom | null>(null);
  winRef.current = win;
  function persistWin(v: WinGeom): void {
    try {
      localStorage.setItem(WIN_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    if (!open || win) return;
    let saved: WinGeom | null = null;
    try {
      const s = localStorage.getItem(WIN_KEY);
      if (s) saved = JSON.parse(s) as WinGeom;
    } catch {
      /* ignore */
    }
    const W = saved?.w && Number.isFinite(saved.w) ? saved.w : 420;
    const H = saved?.h && Number.isFinite(saved.h) ? saved.h : Math.min(640, window.innerHeight - 110);
    const x = saved && Number.isFinite(saved.x) ? clampWin(saved.x, 0, window.innerWidth - 120) : Math.max(12, window.innerWidth - W - 28);
    const y = saved && Number.isFinite(saved.y) ? clampWin(saved.y, 0, window.innerHeight - 60) : 72;
    setWin({ x, y, w: W, h: H });
  }, [open, win]);

  function startDrag(e: React.PointerEvent): void {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const base = winRef.current;
    if (!base) return;
    const onMove = (ev: PointerEvent): void => {
      setWin((p) => (p ? { ...p, x: clampWin(base.x + (ev.clientX - sx), 0, window.innerWidth - 120), y: clampWin(base.y + (ev.clientY - sy), 0, window.innerHeight - 48) } : p));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (winRef.current) persistWin(winRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function startResize(e: React.PointerEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const base = winRef.current;
    if (!base) return;
    const onMove = (ev: PointerEvent): void => {
      setWin((p) => (p ? { ...p, w: clampWin(base.w + (ev.clientX - sx), 360, window.innerWidth - base.x - 8), h: clampWin(base.h + (ev.clientY - sy), 300, window.innerHeight - base.y - 8) } : p));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (winRef.current) persistWin(winRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function resetWin(): void {
    const W = 420;
    const H = Math.min(640, window.innerHeight - 110);
    const v = { x: Math.max(12, window.innerWidth - W - 28), y: 72, w: W, h: H };
    setWin(v);
    persistWin(v);
  }

  function restart(): void {
    setMessages([{ id: idRef.current++, role: 'assistant', text: '好的，重新来。把新的 地址 + Key 发我吧。' }]);
    setFields({});
    fieldsRef.current = {};
    setProposal(null);
    proposalRef.current = null;
    setProtoResults({});
    setAwaitingModels(false);
    setShowSkipped(false);
    setPhase('chat');
  }

  // ── LLM 分类（有可用对话模型时）→ 否则规则分类 ──
  async function classifyAndPropose(f: ConfigFields, models: string[], modelProtocols: Record<string, string[]> | undefined): Promise<void> {
    if (planId == null) return;
    addMsg('assistant', `拉到 ${models.length} 个模型，正在分类、选协议…`);
    const url = (f.baseUrl ?? '').trim();
    let plan: ConfigPlan;
    if (planningModel) {
      const sys = buildConfigAgentSystemPrompt({ providerName: f.name?.trim() || deriveNameFromUrl(url), baseUrl: url, models, modelProtocols });
      const a = await window.electronAPI.chat.optimizePrompt({ planId, modelId: planningModel, userInput: '请对以上模型逐个分类并只输出 JSON。', systemPrompt: sys });
      let parsed: ParsedConfigPlan = a.ok && a.data.optimizedBy !== null ? parseConfigPlan(a.data.optimized) : { ok: false };
      if (!parsed.ok && a.ok && a.data.optimizedBy !== null) {
        const b = await window.electronAPI.chat.optimizePrompt({
          planId,
          modelId: planningModel,
          userInput: '上次输出无法解析为 JSON，请严格只输出符合规范的 JSON，不要任何解释、不要 markdown 围栏。',
          systemPrompt: sys
        });
        parsed = b.ok && b.data.optimizedBy !== null ? parseConfigPlan(b.data.optimized) : { ok: false };
      }
      plan = parsed.ok && parsed.plan ? parsed.plan : classifyModelsDeterministic(models, modelProtocols, url);
    } else {
      plan = classifyModelsDeterministic(models, modelProtocols, url);
    }

    const headerJson = f.headerOverrides?.trim() ? f.headerOverrides.trim() : null;
    const name = f.name?.trim() || deriveNameFromUrl(url);
    const built = buildConfigsFromPlan(plan, { planId, providerName: name, baseUrl: url, apiKey: (f.apiKey ?? '').trim(), isOfficial: false, headerOverridesJson: headerJson, icon: null });
    const prop: Proposal = { name, configs: built.configs, skipped: built.skipped };
    setProposal(prop);
    proposalRef.current = prop;

    const parts = built.configs.map((c) => `${TYPE_LABEL[c.type]} ${Object.keys(c.model_mapping).length} 个（${protocolOf(c)}）`);
    const dup = configs.some((c) => normUrl(c.base_url) === normUrl(url));
    const skipNote = built.skipped.length ? `；跳过 ${built.skipped.length} 个（梦笔暂不支持 / 非对话绘画视频）` : '';
    const dupNote = dup ? '\n⚠ 这个地址你已经配过了，保存会再新建一组（可稍后在编辑器里合并/删除）。' : '';
    if (built.configs.length === 0) {
      addMsg('assistant', `这些模型没有可直接配置的对话/绘画/视频项${skipNote}。可以换个中转站再试。`);
    } else {
      addMsg('assistant', `给「${name}」配好方案：${parts.join('、')}${skipNote}。${dupNote}\n下面可以「测试绘画」（会真实出图）或直接「保存」。`);
    }
    setPhase('proposed');
    if (built.configs.some((c) => c.type === 'text')) void testCard('text');
  }

  // ── 拉模型 + 提议 ──
  async function runPipeline(f: ConfigFields): Promise<void> {
    if (planId == null) {
      toast.error('没有激活的方案', '去模型方案左侧选择 / 新建一个方案');
      return;
    }
    setPhase('working');
    addMsg('assistant', '信息齐了，正在用这套 地址 / Key 拉取模型…');
    const headerJson = f.headerOverrides?.trim() ? f.headerOverrides.trim() : null;
    const conn = await window.electronAPI.settings.testConnection({ base_url: (f.baseUrl ?? '').trim(), api_key_plain: (f.apiKey ?? '').trim(), type: 'text', header_overrides_json: headerJson });
    if (!conn.ok) {
      addMsg('assistant', `拉取失败：${[conn.error.message, conn.error.hint].filter(Boolean).join(' · ')}\n检查下 地址/Key，改好后直接发我新的。`);
      setPhase('chat');
      return;
    }
    const models = conn.data.models ?? [];
    if (models.length === 0) {
      addMsg('assistant', '连上了，但这个站不返回模型清单。把模型 ID 发我（每行一个）我照样配。');
      setAwaitingModels(true);
      setPhase('chat');
      return;
    }
    await classifyAndPropose(f, models, conn.data.model_protocols);
  }

  async function handleSend(): Promise<void> {
    const text = input.trim();
    if (!text || phase === 'working' || phase === 'saving') return;
    setInput('');
    addMsg('user', text);

    // 等待手动粘贴模型 ID 的分支
    if (awaitingModels) {
      const ids = text.split('\n').map((s) => s.trim()).filter(Boolean);
      setAwaitingModels(false);
      if (ids.length === 0) {
        addMsg('assistant', '没解析到模型 ID，每行填一个再发我。');
        return;
      }
      setPhase('working');
      await classifyAndPropose(fieldsRef.current, ids, undefined);
      return;
    }

    // 抽取字段（LLM 优先，失败/无模型 → 正则回退）
    let updated = fieldsRef.current;
    let reply = '';
    if (planningModel && planId != null) {
      const sys = buildChatSystemPrompt(fieldsRef.current);
      const convo = [...messages, { id: -1, role: 'user' as const, text }].map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.text}`).join('\n');
      const r = await window.electronAPI.chat.optimizePrompt({ planId, modelId: planningModel, userInput: `${convo}\n\n请根据最新对话更新抽取，并只输出 JSON。`, systemPrompt: sys });
      if (r.ok && r.data.optimizedBy !== null) {
        const parsed = parseConfigChatTurn(r.data.optimized);
        if (parsed.ok && parsed.turn) {
          updated = mergeFields(fieldsRef.current, parsed.turn.fields);
          reply = parsed.turn.reply;
        }
      }
    }
    if (!reply) {
      // 正则回退（无 LLM / LLM 失败）
      updated = mergeFields(fieldsRef.current, extractConfigFromText(text));
      reply = templatedReply(updated).reply;
    }
    setFields(updated);
    fieldsRef.current = updated;
    if (reply) addMsg('assistant', reply);

    if (isReady(updated)) await runPipeline(updated);
  }

  async function testCard(type: CfgType): Promise<void> {
    const cfg = proposalRef.current?.configs.find((c) => c.type === type);
    if (!cfg) return;
    const firstModel = Object.values(cfg.model_mapping)[0];
    if (!firstModel) {
      setProtoResults((p) => ({ ...p, [type]: { ok: false, message: '该卡没有模型' } }));
      return;
    }
    setProtoResults((p) => ({ ...p, [type]: { testing: true } }));
    const baseInput = {
      base_url: (fieldsRef.current.baseUrl ?? '').trim(),
      api_key_plain: (fieldsRef.current.apiKey ?? '').trim(),
      type,
      model_id: firstModel,
      official_kind: type === 'text' ? cfg.official_kind : null,
      image_kind: type === 'image' ? cfg.image_kind : null,
      header_overrides_json: cfg.header_overrides_json
    };
    let r = await window.electronAPI.settings.testProtocol({ ...baseInput, body_overrides_json: cfg.body_overrides_json });
    let fixed = false;
    if (r.ok && !r.data.ok && !r.data.skipped && /response_format/i.test(`${r.data.message} ${r.data.detail ?? ''}`)) {
      const ov = JSON.stringify({ response_format: null });
      setProposal((p) => {
        if (!p) return p;
        const next = { ...p, configs: p.configs.map((c) => (c.type === type ? { ...c, body_overrides_json: ov } : c)) };
        proposalRef.current = next;
        return next;
      });
      r = await window.electronAPI.settings.testProtocol({ ...baseInput, body_overrides_json: ov });
      fixed = true;
    }
    if (r.ok) setProtoResults((p) => ({ ...p, [type]: { ok: r.data.ok, skipped: r.data.skipped, message: r.data.message, fixed } }));
    else setProtoResults((p) => ({ ...p, [type]: { ok: false, message: r.error.message, fixed } }));
  }

  async function handleSave(): Promise<void> {
    const prop = proposalRef.current;
    if (!prop || prop.configs.length === 0) {
      toast.error('没有可保存的配置');
      return;
    }
    setPhase('saving');
    const r = await window.electronAPI.settings.save({ configs: prop.configs });
    if (r.ok) {
      await useSettingsStore.getState().load();
      addMsg('assistant', `✅ 已保存「${prop.name}」的 ${prop.configs.length} 张卡片到当前方案。要再配一个就把新的地址 + Key 发我。`);
      toast.success('已创建配置', `${prop.configs.length} 张卡片已加入当前方案`);
      setProposal(null);
      proposalRef.current = null;
      setFields({});
      fieldsRef.current = {};
      setProtoResults({});
      setPhase('chat');
    } else {
      setPhase('proposed');
      toast.error('保存失败', r.error.message);
    }
  }

  return createPortal(
    <>
      {open && win && (
        <div className="mb-cfgagent-window mb-card" role="dialog" aria-label="模型配置智能体" style={{ left: win.x, top: win.y, width: win.w, height: win.h }}>
          <div className="mb-cfgagent-titlebar" onPointerDown={startDrag} title="拖动标题栏移动窗口">
            <h3>🤖 模型配置助手</h3>
            <button className="mb-cfgagent-x" onClick={restart} title="重新开始">
              ↺
            </button>
            <button className="mb-cfgagent-x" onClick={resetWin} title="复位窗口">
              ⤢
            </button>
            <button className="mb-cfgagent-x" onClick={close} title="收起（Esc）">
              ✕
            </button>
          </div>

          <div className="mb-cfgagent-scroll" ref={scrollRef}>
            {messages.map((m) => (
              <div key={m.id} className={`mb-cfgagent-bubble is-${m.role}`}>
                {m.text}
              </div>
            ))}
            {sending && <div className="mb-cfgagent-bubble is-assistant is-typing">…</div>}

            {proposal && (phase === 'proposed' || phase === 'saving') && (
              <div className="mb-cfgagent-proposal">
                {proposal.configs.length === 0 ? (
                  <div className="mb-cfgagent-empty">没有可创建的对话/绘画/视频模型。</div>
                ) : (
                  proposal.configs.map((cfg) => {
                    const res = protoResults[cfg.type];
                    const count = Object.keys(cfg.model_mapping).length;
                    return (
                      <div key={cfg.type} className="mb-cfgagent-card">
                        <div className="mb-cfgagent-card-head">
                          <b>{TYPE_LABEL[cfg.type]}模型</b>
                          <span className="mb-cfgagent-card-sub">协议 {protocolOf(cfg)} · {count} 个</span>
                        </div>
                        {cfg.type === 'text' && (cfg.supports_vision || cfg.supports_thinking || cfg.supports_web_search) && (
                          <div className="mb-cfgagent-caps">
                            {cfg.supports_vision && <span>多模态</span>}
                            {cfg.supports_thinking && <span>思考</span>}
                            {cfg.supports_web_search && <span>联网</span>}
                          </div>
                        )}
                        <div className="mb-cfgagent-models">{Object.values(cfg.model_mapping).join('、')}</div>
                        {cfg.type === 'video' ? (
                          <div className="mb-cfgagent-test-note">视频按量计费，保存后到视频节点验证。</div>
                        ) : (
                          <div className="mb-cfgagent-testrow">
                            <button className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => void testCard(cfg.type)} disabled={res?.testing}>
                              {res?.testing ? '测试中…' : cfg.type === 'image' ? '🧪 测试绘画（会出图·少量费用）' : '🧪 重测对话'}
                            </button>
                            {res && !res.testing && (
                              <span className={`mb-cfgagent-teststatus ${res.ok ? 'is-ok' : res.skipped ? '' : 'is-bad'}`}>
                                {res.ok ? '✓ 通过' : res.skipped ? 'ℹ 跳过' : '✗ 失败'}
                                {res.fixed && res.ok ? '（已自动修字段）' : ''}
                              </span>
                            )}
                          </div>
                        )}
                        {res && !res.ok && !res.skipped && !res.testing && res.message && <div className="mb-cfgagent-testmsg">{res.message}</div>}
                      </div>
                    );
                  })
                )}

                {proposal.skipped.length > 0 && (
                  <div className="mb-cfgagent-skipped">
                    <button className="mb-cfgagent-skiptoggle" onClick={() => setShowSkipped((v) => !v)}>
                      {showSkipped ? '▾' : '▸'} 跳过 {proposal.skipped.length} 个模型
                    </button>
                    {showSkipped && (
                      <ul>
                        {proposal.skipped.map((m) => (
                          <li key={m.actualId}>
                            <code>{m.actualId}</code> — {m.reason ?? '已跳过'}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {proposal.configs.length > 0 && (
                  <div className="mb-cfgagent-actions">
                    <button className="mb-btn mb-btn-primary" onClick={() => void handleSave()} disabled={phase === 'saving'}>
                      {phase === 'saving' ? '保存中…' : `保存（${proposal.configs.length} 张卡片）`}
                    </button>
                    <button className="mb-btn mb-btn-ghost" onClick={restart}>
                      重新开始
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mb-cfgagent-foot">
            <div className="mb-cfgagent-modelrow">
              {usableText.length > 0 ? (
                <>
                  <span>🧠</span>
                  <select
                    className="mb-select"
                    value={planningModel}
                    onChange={(e) => {
                      setPlanningModel(e.target.value);
                      try {
                        localStorage.setItem(MODEL_KEY, e.target.value);
                      } catch {
                        /* ignore */
                      }
                    }}
                    title="用于理解你输入 / 分类模型的对话模型"
                  >
                    {usableText.map((m) => (
                      <option key={m.ref} value={m.name}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <span className="mb-cfgagent-rulehint">无可用对话模型 → 规则模式（仍可用）</span>
              )}
            </div>
            <div className="mb-cfgagent-inputrow">
              <textarea
                className="mb-textarea mb-cfgagent-input"
                placeholder="把 地址 + API Key 发给我（可一起发、也可分多次）…  Enter 发送，Shift+Enter 换行"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                rows={2}
                disabled={phase === 'working' || phase === 'saving'}
              />
              <button className="mb-btn mb-btn-primary mb-cfgagent-send" onClick={() => void handleSend()} disabled={!input.trim() || phase === 'working' || phase === 'saving'}>
                发送
              </button>
            </div>
          </div>
          <div className="mb-cfgagent-resize" onPointerDown={startResize} title="拖右下角缩放窗口" />
        </div>
      )}

      <button className={`mb-cfgagent-fab ${open ? 'is-open' : ''}`} onClick={toggle} title="模型配置助手：对话式自动配置" aria-label="模型配置助手">
        🤖
      </button>
    </>,
    document.body
  );
}
