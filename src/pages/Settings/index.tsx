import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUIStore, type SettingsTab } from '@/store/uiStore';
import { toast } from '@/store/toastStore';
import { Modal } from '@/components/Modal';
import { confirmDialog } from '@/components/ConfirmDialog';
import {
  PlusIcon,
  TrashIcon,
  KeyIcon,
  CheckIcon,
  FolderIcon,
  ImageIcon,
  ZapIcon,
  EyeIcon,
  EyeOffIcon
} from '@/components/Icon';
import {
  ATMOSPHERES,
  ATMOSPHERE_LABELS,
  PALETTES,
  PALETTE_LABELS,
  type Atmosphere,
  type Palette
} from '@shared/theme';
import type { ApiConfig, ApiConfigInput, ImageKind, OfficialKind } from '@shared/domain';
import { detectProtocolFromUrl } from '@shared/protocolDetect';
import {
  FILENAME_TOKENS,
  DATETIME_FORMATS,
  parseFilenameTemplate,
  applyFilenameTemplate,
  stringifyFilenameTemplate,
  DEFAULT_FILENAME_TEMPLATE,
  type FilenameTokenKey,
  type FilenameTemplate,
  type FilenamePartConfig,
  type DatetimeFormat
} from '@shared/filenameTemplate';
import './Settings.css';

const OFFICIAL_KINDS: Array<{ value: OfficialKind; label: string; hint: string }> = [
  { value: null, label: '未指定（按 OpenAI 默认）', hint: '基本等同 openai-compat。' },
  {
    value: 'openai',
    label: 'OpenAI API（事实标准）',
    hint: 'POST /v1/chat/completions · Authorization: Bearer ...'
  },
  {
    value: 'anthropic',
    label: 'Anthropic API（Claude messages）',
    hint: 'POST /v1/messages · x-api-key + anthropic-version: 2023-06-01'
  },
  {
    value: 'gemini',
    label: 'Google Gemini API',
    hint: '走 /v1beta/openai/chat/completions 的 OpenAI 兼容入口（key 直接当 Bearer）'
  },
  {
    value: 'openai-compat',
    label: 'OpenAI 兼容（vLLM / Ollama / 中转站）',
    hint: '路径同 OpenAI 标准；Kimi / DeepSeek / 智谱 / MiniMax 都归到这一类'
  }
];

const IMAGE_KINDS: Array<{ value: ImageKind; label: string; hint: string }> = [
  {
    value: null,
    label: '未指定（按 OpenAI 默认）',
    hint: '与 openai 等价。'
  },
  {
    value: 'openai',
    label: 'OpenAI API（标准 /v1/images）',
    hint: 'POST /v1/images/generations；带参考图自动改走 /v1/images/edits（需模型支持图入）'
  },
  {
    value: 'grsai',
    label: 'GRSAI 自有协议',
    hint:
      'host：api.grsai.com / api.grsai.cn / grsai.dakka.com.cn。' +
      '模型 ID 含 "nano-banana" 走 /v1/draw/nano-banana，其它走 /v1/draw/completions。'
  },
  {
    value: 'gemini',
    label: 'Google Gemini Image',
    hint: '/v1beta/models/<id>:generateContent —— 响应里 inline_data 是图（部分中转用 OpenAI 兼容入口直接走 openai-compat 即可）'
  },
  {
    value: 'openai-compat',
    label: 'OpenAI 兼容（柏拉图AI / 各类中转）',
    hint: '路径同 OpenAI 标准；上游模型不同会有差异。'
  }
];

const PALETTE_PREVIEW: Record<Palette, string> = {
  emerald: 'linear-gradient(135deg, #6ee7b7, #047857)',
  purple: 'linear-gradient(135deg, #c4b5fd, #7e22ce)',
  rose: 'linear-gradient(135deg, #fda4af, #be123c)',
  ocean: 'linear-gradient(135deg, #93c5fd, #1d4ed8)',
  'warm-orange': 'linear-gradient(135deg, #fdba74, #ea580c)',
  slate: 'linear-gradient(135deg, #cbd5e1, #475569)',
  sunset: 'linear-gradient(135deg, #fcd34d, #b45309)',
  wheat: 'linear-gradient(135deg, #fde68a, #a16207)',
  coffee: 'linear-gradient(135deg, #d6b48a, #6f4e37)',
  cyan: 'linear-gradient(135deg, #67e8f9, #0e7490)'
};

export default function SettingsPage(): JSX.Element {
  const ui = useUIStore();
  const tab = ui.settingsTab;
  const setTab = (t: SettingsTab): void => ui.setSettingsTab(t);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="mb-settings-root"
    >
      <aside className="mb-settings-sidebar mb-card mb-marquee-glow">
        <h2 className="mb-settings-title">设置</h2>
        <SidebarItem label="模型方案" active={tab === 'plans'} onClick={() => setTab('plans')} />
        <SidebarItem
          label="外观"
          active={tab === 'appearance'}
          onClick={() => setTab('appearance')}
        />
        <SidebarItem
          label="存储与系统"
          active={tab === 'storage'}
          onClick={() => setTab('storage')}
        />
      </aside>

      <section className="mb-settings-content mb-card mb-marquee-glow">
        {tab === 'plans' && <PlansTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'storage' && <StorageTab />}
      </section>
    </motion.div>
  );
}

function SidebarItem({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`mb-settings-side-item ${active ? 'is-active' : ''}`}
    >
      <span>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Plans Tab
// ─────────────────────────────────────────────────────

function PlansTab(): JSX.Element {
  const { plans, configs, activePlanId, setActivePlanId, load } = useSettingsStore();
  const [planNameDraft, setPlanNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingDraft, setEditingDraft] = useState<ApiConfigInput | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);

  const activeConfigs = configs.filter((c) => c.plan_id === activePlanId);

  function openEdit(cfg: ApiConfig): void {
    setEditingExisting(true);
    setEditingDraft({
      id: cfg.id,
      plan_id: cfg.plan_id,
      type: cfg.type,
      provider_name: cfg.provider_name,
      base_url: cfg.base_url,
      api_key_plain: cfg.api_key_plain ?? '', // 解密后的明文 Key 预填
      model_mapping: cfg.model_mapping ?? {},
      is_official: cfg.is_official,
      supports_web_search: cfg.supports_web_search,
      supports_vision: cfg.supports_vision,
      official_kind: cfg.official_kind,
      image_kind: cfg.image_kind ?? null
    });
  }

  function openNew(type: 'image' | 'text'): void {
    if (activePlanId === null) return;
    setEditingExisting(false);
    setEditingDraft({
      plan_id: activePlanId,
      type,
      provider_name: '',
      base_url: '',
      api_key_plain: '',
      model_mapping: {},
      is_official: false,
      supports_web_search: false,
      supports_vision: false,
      official_kind: null,
      image_kind: null
    });
  }

  async function deleteConfig(cfg: ApiConfig): Promise<void> {
    const ok = await confirmDialog({
      title: '删除模型配置',
      message: `确认删除模型配置「${cfg.provider_name}」？`,
      detail: '该配置下的所有模型映射都会一并失效。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.plan.configDelete(cfg.id);
    if (r.ok) {
      await load();
      toast.success('已删除', cfg.provider_name);
    } else {
      toast.error('删除失败', r.error.message);
    }
  }

  async function createPlan(): Promise<void> {
    const name = planNameDraft.trim();
    if (!name) {
      toast.error('请输入方案名称');
      return;
    }
    setBusy(true);
    const r = await window.electronAPI.plan.upsert({ name });
    setBusy(false);
    if (r.ok) {
      setPlanNameDraft('');
      await load();
      setActivePlanId(r.data.id);
      toast.success('方案已创建', name);
    } else {
      toast.error('创建失败', r.error.message);
    }
  }

  async function deletePlan(id: number): Promise<void> {
    const target = plans.find((p) => p.id === id);
    const ok = await confirmDialog({
      title: '删除方案',
      message: `确认删除方案「${target?.name ?? ''}」？`,
      detail: '该方案下的所有模型配置都会一并删除。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.plan.delete(id);
    if (r.ok) {
      await load();
      toast.success('已删除', target?.name);
    } else {
      toast.error('删除失败', r.error.message);
    }
  }

  return (
    <div className="mb-settings-pane">
      <header className="mb-settings-pane-header">
        <div>
          <h3>模型方案</h3>
          <p className="mb-settings-pane-desc">
            一个方案是一组对话与绘画模型的集合。可创建多个，按场景切换。
          </p>
        </div>
      </header>

      <div className="mb-settings-create-row">
        <input
          className="mb-input"
          placeholder="新方案名称（如：工作 / 个人 / 试验组）"
          value={planNameDraft}
          onChange={(e) => setPlanNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createPlan();
          }}
        />
        <button className="mb-btn mb-btn-primary" disabled={busy} onClick={createPlan}>
          <PlusIcon size={16} /> 创建方案
        </button>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={<ZapIcon size={28} />}
          title="还没有任何方案"
          desc="先创建一个方案，再往里面添加对话或绘画模型。"
        />
      ) : (
        <>
          <div className="mb-settings-plan-list">
            {plans.map((p, idx) => (
              <motion.button
                key={p.id}
                onClick={() => setActivePlanId(p.id)}
                className={`mb-plan-pill ${activePlanId === p.id ? 'is-active' : ''}`}
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.04, type: 'spring', stiffness: 380 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
              >
                {p.name}
              </motion.button>
            ))}
          </div>

          {activePlanId !== null && (
            <ConfigList
              planId={activePlanId}
              configs={activeConfigs}
              onAdd={openNew}
              onEdit={openEdit}
              onDeleteConfig={deleteConfig}
              onDeletePlan={() => deletePlan(activePlanId)}
            />
          )}
        </>
      )}

      <Modal
        open={editingDraft !== null}
        onClose={() => setEditingDraft(null)}
        title={
          editingExisting
            ? `编辑${editingDraft?.type === 'text' ? '对话' : '绘画'}模型配置`
            : `新增${editingDraft?.type === 'text' ? '对话' : '绘画'}模型配置`
        }
        width={580}
      >
        {editingDraft && (
          <ConfigForm
            initial={editingDraft}
            isEditing={editingExisting}
            onSaved={async () => {
              setEditingDraft(null);
              await load();
            }}
            onCancel={() => setEditingDraft(null)}
          />
        )}
      </Modal>
    </div>
  );
}

function ConfigList({
  planId: _planId,
  configs,
  onAdd,
  onEdit,
  onDeleteConfig,
  onDeletePlan
}: {
  planId: number;
  configs: ApiConfig[];
  onAdd: (type: 'image' | 'text') => void;
  onEdit: (cfg: ApiConfig) => void;
  onDeleteConfig: (cfg: ApiConfig) => void;
  onDeletePlan: () => void;
}): JSX.Element {
  const textConfigs = configs.filter((c) => c.type === 'text');
  const imageConfigs = configs.filter((c) => c.type === 'image');

  return (
    <div className="mb-settings-config-list">
      <div className="mb-settings-config-bar">
        <h4>该方案下的模型配置</h4>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={() => onAdd('text')}>
            <PlusIcon size={14} /> 对话模型
          </button>
          <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={() => onAdd('image')}>
            <PlusIcon size={14} /> 绘画模型
          </button>
          <button className="mb-btn mb-btn-danger mb-btn-sm" onClick={onDeletePlan}>
            <TrashIcon size={14} /> 删除方案
          </button>
        </div>
      </div>

      {configs.length === 0 ? (
        <EmptyState
          icon={<KeyIcon size={26} />}
          title="该方案下还没有任何模型配置"
          desc="点击上方按钮添加。所有 Key 会自动加密落库。"
          inline
        />
      ) : (
        <>
          <ConfigGroup
            label="对话 / 多模态"
            configs={textConfigs}
            onEdit={onEdit}
            onDelete={onDeleteConfig}
          />
          <ConfigGroup
            label="绘画"
            configs={imageConfigs}
            onEdit={onEdit}
            onDelete={onDeleteConfig}
          />
        </>
      )}
    </div>
  );
}

function ConfigGroup({
  label,
  configs,
  onEdit,
  onDelete
}: {
  label: string;
  configs: ApiConfig[];
  onEdit: (cfg: ApiConfig) => void;
  onDelete: (cfg: ApiConfig) => void;
}): JSX.Element | null {
  if (configs.length === 0) return null;
  return (
    <div className="mb-config-group">
      <div className="mb-config-group-label">{label}</div>
      <div className="mb-config-group-items">
        {configs.map((c, idx) => (
          <motion.div
            key={c.id}
            className="mb-config-row mb-card mb-glow-on-hover mb-marquee-glow"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04 }}
            onClick={() => onEdit(c)}
            style={{ cursor: 'pointer' }}
          >
            <div className="mb-config-row-main">
              <div className="mb-config-row-name">
                {c.provider_name || '(未命名)'}
                {c.supports_vision && <span className="mb-tag">vision</span>}
                {c.supports_web_search && <span className="mb-tag">联网</span>}
                {c.official_kind && <span className="mb-tag">{c.official_kind}</span>}
              </div>
              <div className="mb-config-row-url">{c.base_url}</div>
            </div>
            <div className="mb-config-row-actions">
              <span className="mb-config-row-meta">
                <KeyIcon size={13} /> {Object.keys(c.model_mapping ?? {}).length} 个模型
              </span>
              <button
                className="mb-config-row-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(c);
                }}
                title="编辑"
              >
                编辑
              </button>
              <button
                className="mb-config-row-btn mb-config-row-btn-danger"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(c);
                }}
                title="删除"
              >
                <TrashIcon size={13} />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ConfigForm({
  initial,
  isEditing,
  onCancel,
  onSaved
}: {
  initial: ApiConfigInput;
  isEditing: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<ApiConfigInput>(initial);
  const [mappingDraftKey, setMappingDraftKey] = useState('');
  const [mappingDraftVal, setMappingDraftVal] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Key 默认显示——用户偏好"明文常驻"，不要每次开都得点眼睛
  const [showKey, setShowKey] = useState(true);

  function update<K extends keyof ApiConfigInput>(key: K, value: ApiConfigInput[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
    setTestResult(null);
  }

  /** 用户敲完 base_url 失焦后猜协议。只在用户没显式设过 kind 时改。 */
  function onBaseUrlBlur(): void {
    const detect = detectProtocolFromUrl(draft.base_url);
    if (!detect) return;
    setDraft((d) => {
      const next = { ...d };
      // 只在协议为空（null）时填上猜测；用户改过的不动
      if (d.type === 'text' && d.official_kind == null) {
        next.official_kind = detect.kind;
        toast.info('猜了下对话协议', detect.label);
      }
      if (d.type === 'image' && d.image_kind == null) {
        next.image_kind = detect.imageKind;
        if (detect.imageKind) toast.info('猜了下绘画协议', detect.label);
      }
      return next;
    });
  }

  function addMapping(): void {
    if (!mappingDraftKey.trim() || !mappingDraftVal.trim()) {
      toast.error('显示名和实际模型 ID 都不能为空');
      return;
    }
    update('model_mapping', {
      ...draft.model_mapping,
      [mappingDraftKey.trim()]: mappingDraftVal.trim()
    });
    setMappingDraftKey('');
    setMappingDraftVal('');
  }

  function removeMapping(k: string): void {
    const next = { ...draft.model_mapping };
    delete next[k];
    update('model_mapping', next);
  }

  async function test(): Promise<void> {
    if (!draft.base_url) {
      toast.error('请先填写 Base URL');
      return;
    }
    if (!draft.api_key_plain) {
      toast.error('请先填写 API Key');
      return;
    }
    setTesting(true);
    setTestResult(null);
    setDetectedModels([]);
    const r = await window.electronAPI.settings.testConnection({
      base_url: draft.base_url,
      api_key_plain: draft.api_key_plain,
      type: draft.type
    });
    setTesting(false);
    if (r.ok) {
      const msg = `连通成功，延迟 ${r.data.latency_ms}ms${
        r.data.models?.length ? `，发现 ${r.data.models.length} 个模型` : ''
      }`;
      setTestResult({ ok: true, message: msg });
      // 上游返回的模型列表可能很长（比如柏拉图AI），筛掉已经映射过的，只展示候选
      const existing = new Set(Object.values(draft.model_mapping));
      setDetectedModels((r.data.models ?? []).filter((m) => !existing.has(m)));
      toast.success('测试连通成功', msg);
    } else {
      setTestResult({ ok: false, message: r.error.message });
      toast.error('测试连通失败', r.error.message);
    }
  }

  function addDetected(modelId: string): void {
    // 如果显示名已存在，加一个 "（2）" 后缀避免覆盖
    let displayName = modelId;
    let n = 2;
    while (draft.model_mapping[displayName]) {
      displayName = `${modelId} (${n++})`;
    }
    update('model_mapping', { ...draft.model_mapping, [displayName]: modelId });
    // 已加入的从候选列表里挪掉
    setDetectedModels((arr) => arr.filter((m) => m !== modelId));
  }

  function describeModel(modelId: string): string {
    const id = modelId.toLowerCase();
    if (/(image|dall|sdxl|flux|nano-banana|midjourney|sora-image|gpt-image)/.test(id)) {
      return '看起来是绘图模型';
    }
    if (/(embedding|embed)/.test(id)) {
      return 'Embedding 模型，本工具暂不直接使用';
    }
    if (/(rerank)/.test(id)) {
      return '重排序模型，本工具暂不直接使用';
    }
    if (/(audio|tts|whisper|voice|speech)/.test(id)) {
      return '语音模型，本工具暂不直接使用';
    }
    if (/(vision|vl|multimodal|4o|claude-3|gemini|nano-banana-pro)/.test(id)) {
      return '多模态对话模型（含 vision）';
    }
    if (/(coder|code|coding)/.test(id)) {
      return '代码专用模型（部分受限于 Coding Agent）';
    }
    return '通用对话/多模态模型';
  }

  async function save(): Promise<void> {
    if (!draft.provider_name.trim()) {
      toast.error('请填写中转站/官方名称');
      return;
    }
    if (!draft.base_url.trim()) {
      toast.error('请填写 Base URL');
      return;
    }
    if (!isEditing && !draft.api_key_plain.trim()) {
      toast.error('请填写 API Key');
      return;
    }
    if (Object.keys(draft.model_mapping).length === 0) {
      toast.error('请至少添加一个模型映射');
      return;
    }
    setBusy(true);
    const r = await window.electronAPI.settings.save({ configs: [draft] });
    setBusy(false);
    if (r.ok) {
      await onSaved();
      toast.success(isEditing ? '已更新' : '已保存', draft.provider_name);
    } else {
      toast.error(isEditing ? '更新失败' : '保存失败', r.error.message);
    }
  }

  return (
    <div className="mb-config-form">
      <Field label="中转站 / 官方名称">
        <input
          className="mb-input"
          value={draft.provider_name}
          onChange={(e) => update('provider_name', e.target.value)}
          placeholder="如：OpenAI 官方 / 我的 OpenAI 中转站"
        />
      </Field>

      <Field label="API 调用地址（base_url）">
        <input
          className="mb-input"
          value={draft.base_url}
          onChange={(e) => update('base_url', e.target.value)}
          onBlur={onBaseUrlBlur}
          placeholder="https://api.openai.com/v1"
        />
        <div className="mb-field-hint">
          失焦后会按域名猜协议；猜得不对手动改下方协议下拉即可。
        </div>
      </Field>

      <Field label="API Key">
        <div className="mb-key-input-wrap">
          <input
            type={showKey ? 'text' : 'password'}
            className="mb-input"
            value={draft.api_key_plain}
            onChange={(e) => update('api_key_plain', e.target.value)}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="mb-key-toggle"
            onClick={() => setShowKey((v) => !v)}
            title={showKey ? '隐藏 Key' : '显示 Key'}
            tabIndex={-1}
          >
            {showKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
        </div>
      </Field>

      {draft.type === 'text' && (
        <Field label="API 协议">
          <select
            className="mb-select"
            value={draft.official_kind ?? ''}
            onChange={(e) => update('official_kind', (e.target.value || null) as OfficialKind)}
          >
            {OFFICIAL_KINDS.map((k) => (
              <option key={k.value ?? 'none'} value={k.value ?? ''}>
                {k.label}
              </option>
            ))}
          </select>
          <div className="mb-field-hint">
            {OFFICIAL_KINDS.find((k) => k.value === (draft.official_kind ?? null))?.hint}
          </div>
        </Field>
      )}

      {draft.type === 'image' && (
        <Field label="绘图 API 协议">
          <select
            className="mb-select"
            value={draft.image_kind ?? ''}
            onChange={(e) => update('image_kind', (e.target.value || null) as ImageKind)}
          >
            {IMAGE_KINDS.map((k) => (
              <option key={k.value ?? 'openai'} value={k.value ?? ''}>
                {k.label}
              </option>
            ))}
          </select>
          <div className="mb-field-hint">
            {IMAGE_KINDS.find((k) => k.value === (draft.image_kind ?? null))?.hint}
          </div>
        </Field>
      )}

      <Field label={`模型映射（${Object.keys(draft.model_mapping).length}）`}>
        <div className="mb-mapping-list">
          {Object.entries(draft.model_mapping).map(([k, v]) => (
            <div key={k} className="mb-mapping-row">
              <code>{k}</code>
              <span className="mb-mapping-arrow">→</span>
              <code>{v}</code>
              <button
                className="mb-mapping-remove"
                onClick={() => removeMapping(k)}
                title="删除"
              >
                <TrashIcon size={13} />
              </button>
            </div>
          ))}
        </div>
        <div className="mb-mapping-add">
          <input
            className="mb-input"
            placeholder="显示名（如 GPT-4o）"
            value={mappingDraftKey}
            onChange={(e) => setMappingDraftKey(e.target.value)}
          />
          <input
            className="mb-input"
            placeholder="实际模型 ID（如 gpt-4o-mini）"
            value={mappingDraftVal}
            onChange={(e) => setMappingDraftVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMapping();
            }}
          />
          <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={addMapping}>
            <PlusIcon size={14} /> 添加
          </button>
        </div>
      </Field>

      {draft.type === 'text' && (
        <div className="mb-config-toggles">
          <Toggle
            label="支持原生联网搜索"
            value={draft.supports_web_search}
            onChange={(v) => update('supports_web_search', v)}
          />
          <Toggle
            label="支持 vision（多模态描述图片）"
            value={draft.supports_vision}
            onChange={(v) => update('supports_vision', v)}
          />
        </div>
      )}

      <div className="mb-config-form-actions">
        <button
          className="mb-btn mb-btn-secondary"
          onClick={test}
          disabled={testing || busy}
        >
          {testing ? '测试中…' : '测试连通'}
        </button>
        {testResult && (
          <span className={`mb-test-result ${testResult.ok ? 'is-ok' : 'is-fail'}`}>
            {testResult.ok ? <CheckIcon size={14} /> : null}
            {testResult.message}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button className="mb-btn mb-btn-ghost" onClick={onCancel} disabled={busy}>
          取消
        </button>
        <button className="mb-btn mb-btn-primary" onClick={save} disabled={busy}>
          {busy ? '保存中…' : '保存'}
        </button>
      </div>

      {detectedModels.length > 0 && (
        <div className="mb-detected-models">
          <div className="mb-detected-head">
            <span>
              检测到 {detectedModels.length} 个上游模型
              <span className="mb-detected-hint">点"添加"即可写入映射；判定仅按名字猜测，仅供参考</span>
            </span>
            <button
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => setDetectedModels([])}
              title="折叠列表"
            >
              收起
            </button>
          </div>
          <div className="mb-detected-list">
            {detectedModels.slice(0, 50).map((m) => (
              <div key={m} className="mb-detected-row">
                <code className="mb-detected-id">{m}</code>
                <span className="mb-detected-kind">{describeModel(m)}</span>
                <button
                  className="mb-btn mb-btn-secondary mb-btn-sm"
                  onClick={() => addDetected(m)}
                >
                  <PlusIcon size={12} /> 添加
                </button>
              </div>
            ))}
            {detectedModels.length > 50 && (
              <div className="mb-detected-hint">…还有 {detectedModels.length - 50} 个未显示</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-field">
      <label className="mb-label">{label}</label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`mb-toggle ${value ? 'is-on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className="mb-toggle-dot" />
      <span>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────
// Appearance Tab
// ─────────────────────────────────────────────────────

function AppearanceTab(): JSX.Element {
  const { atmosphere, palette, setAtmosphere, setPalette } = useThemeStore();

  return (
    <div className="mb-settings-pane">
      <header className="mb-settings-pane-header">
        <div>
          <h3>外观</h3>
          <p className="mb-settings-pane-desc">
            7 种材质氛围 × 10 种主题配色，共 70 种组合。
          </p>
        </div>
      </header>

      <Field label="材质氛围">
        <div className="mb-appearance-atmospheres">
          {ATMOSPHERES.map((a, i) => (
            <motion.button
              key={a}
              onClick={() => {
                setAtmosphere(a);
                toast.info('已切换氛围', ATMOSPHERE_LABELS[a as Atmosphere]);
              }}
              className={`mb-appearance-atmo ${atmosphere === a ? 'is-active' : ''}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {ATMOSPHERE_LABELS[a as Atmosphere]}
            </motion.button>
          ))}
        </div>
      </Field>

      <Field label="主题配色">
        <div className="mb-appearance-palettes">
          {PALETTES.map((p, i) => (
            <motion.button
              key={p}
              onClick={() => {
                setPalette(p);
                toast.info('已切换配色', PALETTE_LABELS[p as Palette]);
              }}
              className={`mb-appearance-palette ${palette === p ? 'is-active' : ''}`}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.025, type: 'spring', stiffness: 300 }}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.94 }}
            >
              <span
                className="mb-appearance-palette-dot"
                style={{ background: PALETTE_PREVIEW[p as Palette] }}
              />
              <span>{PALETTE_LABELS[p as Palette]}</span>
            </motion.button>
          ))}
        </div>
      </Field>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Storage Tab
// ─────────────────────────────────────────────────────

function StorageTab(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const [busy, setBusy] = useState(false);

  const imagePath = prefs.image_storage_path ?? '(默认应用目录 / images/)';

  async function pickFolder(): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.storage.selectFolder();
    if (!r.ok) {
      toast.error('打开对话框失败', r.error.message);
      setBusy(false);
      return;
    }
    if (!r.data) {
      setBusy(false);
      return;
    }
    const save = await window.electronAPI.settings.save({
      prefs: { image_storage_path: r.data.path }
    });
    setBusy(false);
    if (save.ok) {
      await load();
      toast.success('图片存储路径已更新', r.data.path);
    } else {
      toast.error('保存失败', save.error.message);
    }
  }

  return (
    <div className="mb-settings-pane">
      <header className="mb-settings-pane-header">
        <div>
          <h3>存储与系统</h3>
          <p className="mb-settings-pane-desc">控制图片落盘位置、备份策略与系统体验。</p>
        </div>
      </header>

      <Field label="图片存储路径">
        <div className="mb-storage-path-row">
          <div className="mb-input" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <FolderIcon size={16} />
            <span style={{ marginLeft: 10, color: 'var(--mb-text-secondary)' }}>{imagePath}</span>
          </div>
          <button className="mb-btn mb-btn-secondary" onClick={pickFolder} disabled={busy}>
            选择文件夹
          </button>
        </div>
      </Field>

      <FilenameTemplateField />

      <Field label="数据库与备份">
        <button className="mb-btn mb-btn-secondary" disabled>
          <ImageIcon size={14} /> 导出 .mengbi 包（v1.0 P2 · 未实现）
        </button>
      </Field>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 文件名模板编辑器
// ─────────────────────────────────────────────────────
function FilenameTemplateField(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const initial = parseFilenameTemplate(prefs.image_filename_template);
  const [tpl, setTpl] = useState<FilenameTemplate>(initial);
  const [busy, setBusy] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => {
    setTpl(parseFilenameTemplate(prefs.image_filename_template));
  }, [prefs.image_filename_template]);

  function moveBy(idx: number, dir: -1 | 1): void {
    const next = [...tpl.parts];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setTpl({ ...tpl, parts: next });
  }
  function removeAt(idx: number): void {
    setTpl({ ...tpl, parts: tpl.parts.filter((_, i) => i !== idx) });
  }
  function add(key: FilenameTokenKey): void {
    const newPart: FilenamePartConfig = { key };
    if (key === 'datetime') newPart.format = 'yyyymmdd-hhmmss';
    if (key === 'fixed') newPart.text = 'mengbi';
    setTpl({ ...tpl, parts: [...tpl.parts, newPart] });
  }
  function patchAt(idx: number, patch: Partial<FilenamePartConfig>): void {
    setTpl({
      ...tpl,
      parts: tpl.parts.map((p, i) => (i === idx ? { ...p, ...patch } : p))
    });
  }
  function reset(): void {
    setTpl(JSON.parse(JSON.stringify(DEFAULT_FILENAME_TEMPLATE)));
  }
  async function save(): Promise<void> {
    if (tpl.parts.length === 0) {
      toast.error('至少保留一个字段');
      return;
    }
    setBusy(true);
    const r = await window.electronAPI.settings.save({
      prefs: { image_filename_template: stringifyFilenameTemplate(tpl) }
    });
    setBusy(false);
    if (r.ok) {
      await load();
      toast.success('文件名模板已保存', preview);
    } else {
      toast.error('保存失败', r.error.message);
    }
  }

  // 拖拽排序：HTML5 drag-and-drop
  function onDragStart(idx: number): void {
    setDragIdx(idx);
  }
  function onDragOver(e: React.DragEvent, idx: number): void {
    e.preventDefault();
    if (dragIdx !== null && idx !== dragIdx) setDragOverIdx(idx);
  }
  function onDrop(targetIdx: number): void {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    const next = [...tpl.parts];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    setTpl({ ...tpl, parts: next });
    setDragIdx(null);
    setDragOverIdx(null);
  }

  const preview = applyFilenameTemplate(tpl, {
    taskId: 42,
    seq: 1,
    width: 2048,
    height: 1152,
    aspect: '16:9',
    prompt: '一只趴在窗台的橘色猫咪',
    model: 'gpt-image-2',
    planName: 'work',
    kind: 'openai',
    createdAt: new Date()
  });

  return (
    <Field label="图片文件名模板（拖动重排）">
      <div className="mb-fn-template">
        <div className="mb-fn-parts-row">
          {tpl.parts.map((part, i) => {
            const def = FILENAME_TOKENS.find((t) => t.key === part.key);
            return (
              <div
                key={`${part.key}-${i}`}
                className={`mb-fn-part ${dragOverIdx === i ? 'is-drop-target' : ''} ${dragIdx === i ? 'is-dragging' : ''}`}
                draggable
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => onDragOver(e, i)}
                onDragLeave={() => setDragOverIdx(null)}
                onDrop={() => onDrop(i)}
                onDragEnd={() => {
                  setDragIdx(null);
                  setDragOverIdx(null);
                }}
              >
                <span className="mb-fn-part-grip" title="拖动调整顺序">
                  ⋮⋮
                </span>
                <span className="mb-fn-part-label">{def?.label ?? part.key}</span>

                {/* datetime 子选项：格式 */}
                {part.key === 'datetime' && (
                  <select
                    className="mb-fn-part-select"
                    value={part.format ?? 'yyyymmdd-hhmmss'}
                    onChange={(e) =>
                      patchAt(i, { format: e.target.value as DatetimeFormat })
                    }
                    title="日期时间格式"
                  >
                    {DATETIME_FORMATS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                )}

                {/* fixed 子选项：文本 */}
                {part.key === 'fixed' && (
                  <input
                    className="mb-fn-part-input"
                    value={part.text ?? ''}
                    onChange={(e) => patchAt(i, { text: e.target.value })}
                    placeholder="固定文本"
                    maxLength={32}
                  />
                )}

                <button
                  type="button"
                  className="mb-fn-part-btn"
                  onClick={() => moveBy(i, -1)}
                  disabled={i === 0}
                  title="左移"
                >
                  ◀
                </button>
                <button
                  type="button"
                  className="mb-fn-part-btn"
                  onClick={() => moveBy(i, 1)}
                  disabled={i === tpl.parts.length - 1}
                  title="右移"
                >
                  ▶
                </button>
                <button
                  type="button"
                  className="mb-fn-part-btn mb-fn-part-btn-danger"
                  onClick={() => removeAt(i)}
                  title="移除"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <div className="mb-fn-add-row">
          <span className="mb-fn-label">添加字段：</span>
          {FILENAME_TOKENS.map((t) => (
            <button
              key={t.key}
              type="button"
              className="mb-fn-add-chip"
              onClick={() => add(t.key)}
              title={`示例：${t.example}`}
            >
              + {t.label}
            </button>
          ))}
        </div>

        <div className="mb-fn-sep-row">
          <label className="mb-fn-label">分隔符</label>
          <input
            className="mb-input mb-fn-sep-input"
            value={tpl.separator}
            maxLength={5}
            onChange={(e) => setTpl({ ...tpl, separator: e.target.value })}
            placeholder="-"
          />
          <span className="mb-fn-hint">分辨率内部固定 x，比例内部固定 :，这里只控制字段之间的连接符</span>
        </div>

        <div className="mb-fn-preview-row">
          <span className="mb-fn-label">预览</span>
          <code className="mb-fn-preview">{preview}.png</code>
        </div>

        <div className="mb-fn-actions">
          <button className="mb-btn mb-btn-ghost mb-btn-sm" onClick={reset}>
            还原默认
          </button>
          <button
            className="mb-btn mb-btn-primary mb-btn-sm"
            onClick={save}
            disabled={busy}
          >
            {busy ? '保存中…' : '保存模板'}
          </button>
        </div>
      </div>
    </Field>
  );
}

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  desc,
  inline
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  inline?: boolean;
}): JSX.Element {
  return (
    <div className={`mb-empty-state ${inline ? 'is-inline' : ''}`}>
      <div className="mb-empty-icon">{icon}</div>
      <div className="mb-empty-title">{title}</div>
      <div className="mb-empty-desc">{desc}</div>
    </div>
  );
}
