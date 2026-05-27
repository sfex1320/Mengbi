import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useThemeStore } from '@/store/themeStore';
import {
  useCursorHaloStore,
  HALO_STYLES,
  HALO_LABELS,
  HALO_DESCRIPTIONS,
  type HaloStyle
} from '@/store/cursorHaloStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUIStore, type SettingsTab } from '@/store/uiStore';
import { toast } from '@/store/toastStore';
import { Modal } from '@/components/Modal';
import { openContextMenu } from '@/components/ContextMenu';
import { AboutSection } from './AboutSection';
// VecModelManager 已随矢量化功能整体移除，待重做
import {
  ProviderIcon,
  PROVIDER_PRESETS,
  guessProviderIcon
} from '@/lib/providerIcons';
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
  EyeOffIcon,
  CopyIconShape
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
import { parseSdkSnippet } from '@/lib/sdkSnippetParser';
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
  },
  {
    value: 'local',
    label: '本地（llama.cpp / Ollama / LM Studio）',
    hint:
      '选一个 .gguf 文件由梦笔内嵌 llama-cpp 启动；或填外部已运行服务 URL 直接连。'
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
    label: 'GRSAI 自有协议（异步）',
    hint:
      'host：grsaiapi.com / grsai.dakka.com.cn。' +
      'POST /v1/api/generate (replyType=async) → GET /v1/api/result?id=xxx 轮询。'
  },
  {
    value: 'apimart',
    label: 'apimart 异步协议',
    hint:
      'host：api.apimart.ai。POST /v1/images/generations 返 task_id → GET /v1/tasks/{id} 轮询。' +
      '支持文生图 + 图生图（image_urls，最多 16 张）。不支持负向提示词与 quality。'
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
  },
  {
    value: 'openai-responses',
    label: 'OpenAI Responses API（穿透 60s 超时）',
    hint:
      'POST /v1/responses + tools.image_generation。走 SSE 流式 + partial_images 心跳，' +
      '专门用于穿透中转站 60s 边缘代理超时（Nginx/Cloudflare 类）。' +
      '前提：中转必须实现 /v1/responses 端点（Now Coding/OneAPI 新版、官方 OpenAI 均支持）。'
  }
  // ComfyUI（image_kind='comfyui'）从设置页移出，统一在「本地大模型」页（侧栏第 6 项）配置。
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
        <SidebarItem
          label="工具箱"
          active={tab === 'tools'}
          onClick={() => setTab('tools')}
        />
        <SidebarItem
          label="关于 / 许可证"
          active={tab === 'about'}
          onClick={() => setTab('about')}
        />
      </aside>

      <section className="mb-settings-content mb-card mb-marquee-glow">
        {tab === 'plans' && <PlansTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'storage' && <StorageTab />}
        {tab === 'tools' && <ToolsTab />}
        {tab === 'about' && <AboutSection />}
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
      image_kind: cfg.image_kind ?? null,
      body_overrides_json: cfg.body_overrides_json ?? null,
      comfyui_workflow_json: cfg.comfyui_workflow_json ?? null,
      local_model_path: cfg.local_model_path ?? null,
      supports_thinking: cfg.supports_thinking ?? false,
      thinking_effort: cfg.thinking_effort ?? null,
      icon: cfg.icon ?? null
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
      image_kind: null,
      body_overrides_json: null,
      comfyui_workflow_json: null,
      local_model_path: null,
      supports_thinking: false,
      thinking_effort: null,
      icon: null
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

  async function duplicateConfig(cfg: ApiConfig): Promise<void> {
    // 关键约束：upsertConfig 在 INSERT 分支强制 api_key_plain 非空。
    // 若 safeStorage 解密失败（跨机器迁库等场景）会拿到空串，提前拦下并给出可执行提示。
    if (!cfg.api_key_plain) {
      toast.error(
        '无法复制',
        'API Key 解密失败——请先在原配置上重填 Key 后再复制，或新建一份配置'
      );
      return;
    }
    const copyName = `${cfg.provider_name || '(未命名)'} (副本)`;
    const draft: ApiConfigInput = {
      // 不带 id → IPC 走 INSERT，自动 AUTOINCREMENT 出新行
      plan_id: cfg.plan_id,
      type: cfg.type,
      provider_name: copyName,
      base_url: cfg.base_url,
      api_key_plain: cfg.api_key_plain,
      model_mapping: { ...(cfg.model_mapping ?? {}) },
      is_official: cfg.is_official,
      supports_web_search: cfg.supports_web_search,
      supports_vision: cfg.supports_vision,
      official_kind: cfg.official_kind,
      image_kind: cfg.image_kind ?? null,
      body_overrides_json: cfg.body_overrides_json ?? null,
      comfyui_workflow_json: cfg.comfyui_workflow_json ?? null,
      local_model_path: cfg.local_model_path ?? null,
      supports_thinking: cfg.supports_thinking ?? false,
      thinking_effort: cfg.thinking_effort ?? null,
      icon: cfg.icon ?? null
    };
    const r = await window.electronAPI.settings.save({ configs: [draft] });
    if (r.ok) {
      await load();
      toast.success('已复制', copyName);
    } else {
      toast.error('复制失败', r.error.message);
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
              onDuplicateConfig={duplicateConfig}
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
  onDuplicateConfig,
  onDeleteConfig,
  onDeletePlan
}: {
  planId: number;
  configs: ApiConfig[];
  onAdd: (type: 'image' | 'text') => void;
  onEdit: (cfg: ApiConfig) => void;
  onDuplicateConfig: (cfg: ApiConfig) => void;
  onDeleteConfig: (cfg: ApiConfig) => void;
  onDeletePlan: () => void;
}): JSX.Element {
  const textConfigs = configs.filter((c) => c.type === 'text');
  // ComfyUI（image_kind='comfyui'）只在「本地大模型」页展示，这里过滤掉避免重复管理
  const imageConfigs = configs.filter(
    (c) => c.type === 'image' && c.image_kind !== 'comfyui'
  );

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
            onDuplicate={onDuplicateConfig}
            onDelete={onDeleteConfig}
          />
          <ConfigGroup
            label="绘画"
            configs={imageConfigs}
            onEdit={onEdit}
            onDuplicate={onDuplicateConfig}
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
  onDuplicate,
  onDelete
}: {
  label: string;
  configs: ApiConfig[];
  onEdit: (cfg: ApiConfig) => void;
  onDuplicate: (cfg: ApiConfig) => void;
  onDelete: (cfg: ApiConfig) => void;
}): JSX.Element | null {
  if (configs.length === 0) return null;
  return (
    <div className="mb-config-group">
      <div className="mb-config-group-label">{label}</div>
      <div className="mb-config-card-grid">
        {configs.map((c, idx) => {
          // icon 优先取配置自身的，否则按 provider_name / base_url 猜
          const iconValue = c.icon ?? guessProviderIcon({
            providerName: c.provider_name,
            baseUrl: c.base_url
          });
          return (
            <motion.div
              key={c.id}
              className="mb-config-card mb-card"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.03 }}
              onClick={() => onEdit(c)}
              onContextMenu={(e) => {
                e.preventDefault();
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: '编辑', onClick: () => onEdit(c) },
                    {
                      label: '复制配置',
                      icon: <CopyIconShape size={12} />,
                      onClick: () => onDuplicate(c)
                    },
                    { separator: true },
                    {
                      label: '删除',
                      variant: 'danger',
                      icon: <TrashIcon size={12} />,
                      onClick: () => onDelete(c)
                    }
                  ]
                });
              }}
              title={`${c.provider_name || '(未命名)'}\n${c.base_url}\n${Object.keys(c.model_mapping ?? {}).length} 个映射模型\n右键有更多操作`}
            >
              <ProviderIcon value={iconValue} size={42} radius={10} />
              <div className="mb-config-card-name">{c.provider_name || '(未命名)'}</div>
              <div className="mb-config-card-meta">
                {Object.keys(c.model_mapping ?? {}).length} 模型
              </div>
              <div className="mb-config-card-tags">
                {c.supports_vision && <span className="mb-config-card-tag" title="支持视觉">👁</span>}
                {c.supports_web_search && <span className="mb-config-card-tag" title="支持联网">🌐</span>}
                {c.supports_thinking && <span className="mb-config-card-tag" title="启用思考模式">💭</span>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 一键预设：把表单一次性填成 MiniMax / Ollama / LM Studio 等的常见配置。
 * 本地服务统一用 dummy key（'local' / 'lm-studio' / 'ollama'）；
 * 联网服务的真 key 由用户自己粘贴，预设里不放。
 *
 * 各预设的来源（保留作 reference，避免下次接入时再翻文档）：
 * - MiniMax 文本/视觉/搜索：https://platform.minimaxi.com/docs/api-reference/chat
 * - Ollama OpenAI 兼容入口：http://localhost:11434/v1，docs:
 *   https://github.com/ollama/ollama/blob/main/docs/openai.md
 * - LM Studio 本地服务器：默认 http://localhost:1234/v1
 * - llama.cpp server：./server -m model.gguf 默认 http://localhost:8080/v1
 * - stable-diffusion.cpp server：默认 http://localhost:8080/v1（OpenAI 兼容图像）
 */
interface ConfigPreset {
  /** 仅 'text' 或 'image'；UI 上根据当前 cfg.type 过滤显示哪些可用 */
  for: 'text' | 'image';
  key: string;
  label: string;
  hint: string;
  provider_name: string;
  base_url: string;
  api_key_plain?: string;
  official_kind?: OfficialKind;
  image_kind?: ImageKind;
  supports_vision?: boolean;
  supports_web_search?: boolean;
  /** 默认模型映射；用户在测试连通后可一键拉取真实列表 */
  model_mapping?: Record<string, string>;
}

const CONFIG_PRESETS: ConfigPreset[] = [
  {
    for: 'text',
    key: 'minimax',
    label: 'MiniMax',
    hint: '文本+视觉+原生联网搜索（需在 platform.minimaxi.com 拿 key）',
    provider_name: 'MiniMax',
    base_url: 'https://api.minimaxi.com/v1',
    official_kind: 'openai',
    supports_vision: true,
    supports_web_search: true,
    model_mapping: {
      'MiniMax-M2.7': 'MiniMax-M2.7',
      'MiniMax-M2.5': 'MiniMax-M2.5',
      'MiniMax-M2.1': 'MiniMax-M2.1'
    }
  },
  {
    for: 'text',
    key: 'ollama',
    label: 'Ollama（本地已运行）',
    hint: '127.0.0.1:11434/v1 → 当 OpenAI 兼容站调用；先用 `ollama pull` 装好模型，常见的会自动列出',
    provider_name: 'Ollama',
    base_url: 'http://127.0.0.1:11434/v1',
    api_key_plain: 'ollama',
    official_kind: 'openai-compat',
    supports_vision: false,
    supports_web_search: false,
    model_mapping: {
      'Llama 3.1 8B': 'llama3.1:8b',
      'Qwen2.5 7B': 'qwen2.5:7b',
      'Gemma 3 4B': 'gemma3:4b'
    }
  },
  {
    for: 'text',
    key: 'lm-studio',
    label: 'LM Studio（本地已运行）',
    hint: '127.0.0.1:1234/v1 → 在 LM Studio 里 Start Server 即开',
    provider_name: 'LM Studio',
    base_url: 'http://127.0.0.1:1234/v1',
    api_key_plain: 'lm-studio',
    official_kind: 'openai-compat',
    supports_vision: false,
    supports_web_search: false
  },
  {
    for: 'text',
    key: 'local-llm',
    label: '本地内嵌 llama.cpp（选 .gguf）',
    hint: '梦笔自带 llama-cpp，选一个 .gguf 文件即可；不依赖任何外部进程',
    provider_name: '本地大模型',
    base_url: '',
    api_key_plain: 'local',
    official_kind: 'local',
    supports_vision: false,
    supports_web_search: false
  }
  // 旧的 sd-cpp / comfyui 绘画一键预设已移除：
  //   - ComfyUI 走「本地大模型」页（左侧栏第 6 项）
  //   - sd-cpp 用户少且语义已被通用 OpenAI-compat 覆盖
];

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
  // 请求体覆盖 JSON 的本地解析错误；非 null 时在 textarea 下方红字提示
  const [bodyOverridesError, setBodyOverridesError] = useState<string | null>(null);

  // 「粘贴 SDK 示例自动填充」折叠区状态
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [snippetText, setSnippetText] = useState('');
  const [snippetError, setSnippetError] = useState<string | null>(null);

  function update<K extends keyof ApiConfigInput>(key: K, value: ApiConfigInput[K]): void {
    setDraft((d) => ({ ...d, [key]: value }));
    setTestResult(null);
  }

  /**
   * 一键预设：把表单填成"某来源的常用配置"。本地服务的 key 用 dummy 字符串，
   * 用户拿到 key 再回来改即可。详见下方 PRESETS 数组。
   */
  function applyPreset(p: ConfigPreset): void {
    setDraft((d) => ({
      ...d,
      provider_name: p.provider_name,
      base_url: p.base_url,
      api_key_plain: p.api_key_plain ?? d.api_key_plain ?? 'local',
      official_kind: p.official_kind ?? d.official_kind,
      image_kind: p.image_kind ?? d.image_kind,
      supports_vision: p.supports_vision ?? d.supports_vision,
      supports_web_search: p.supports_web_search ?? d.supports_web_search,
      model_mapping: p.model_mapping ? { ...p.model_mapping } : d.model_mapping
    }));
    setTestResult(null);
    toast.success('已套用预设', `${p.label}：测试连通后可一键拉取已装模型`);
  }

  /**
   * 解析粘贴的 SDK 代码片段，把其中的 base_url / api_key / model 填到表单。
   * 三件至少要识别出一件才算成功；都识别不到则提示用户手填。
   */
  function applySnippet(): void {
    const parsed = parseSdkSnippet(snippetText);
    const hits = [parsed.baseUrl, parsed.apiKey, parsed.model].filter(Boolean).length;
    if (hits === 0) {
      setSnippetError('无法识别格式，请确认是 OpenAI Python / TypeScript SDK 或 curl 示例，或手动填写下方表单');
      return;
    }
    setSnippetError(null);
    setDraft((d) => {
      const next = { ...d };
      if (parsed.baseUrl) next.base_url = parsed.baseUrl;
      if (parsed.apiKey) next.api_key_plain = parsed.apiKey;
      if (parsed.model) {
        // 把识别出的模型加进映射；若已存在 key 则跳过
        if (!next.model_mapping[parsed.model]) {
          next.model_mapping = { ...next.model_mapping, [parsed.model]: parsed.model };
        }
      }
      return next;
    });
    setTestResult(null);
    const filled = [
      parsed.baseUrl && 'base_url',
      parsed.apiKey && 'api_key',
      parsed.model && '模型映射'
    ]
      .filter(Boolean)
      .join('、');
    toast.success('已识别并填入', `${filled}（${parsed.language ?? '未知'}）`);
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

  /**
   * 重命名映射条目：可改 key（显示名）或 value（实际模型 ID）。
   * Object 的插入顺序在 JS 中是稳定的（string key），所以重建时按原顺序遍历即可保持 UI 不跳。
   * key 冲突 / 空值都直接拒并 toast。
   */
  function renameMapping(oldKey: string, newKey: string, newVal: string): boolean {
    const trimmedKey = newKey.trim();
    const trimmedVal = newVal.trim();
    if (!trimmedKey) {
      toast.error('显示名不能为空');
      return false;
    }
    if (!trimmedVal) {
      toast.error('实际模型 ID 不能为空');
      return false;
    }
    if (trimmedKey !== oldKey && draft.model_mapping[trimmedKey] !== undefined) {
      toast.error('显示名已存在', `已有「${trimmedKey}」，请换一个`);
      return false;
    }
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft.model_mapping)) {
      if (k === oldKey) next[trimmedKey] = trimmedVal;
      else next[k] = v;
    }
    update('model_mapping', next);
    return true;
  }

  // 「识别协议」按钮：URL hint + 真实探测两路合并
  //   1. URL hint 给优先（更具体：能区分 anthropic / gemini / openai / openai-compat）
  //   2. URL 没线索时 → 用 testConnection 探一下 /models；探得通就当 openai-compat
  //   3. 都失败 → 弹错保留 null，让用户手选
  const [detectingKind, setDetectingKind] = useState(false);
  async function detectKind(): Promise<void> {
    if (!draft.base_url.trim()) {
      toast.error('请先填写 Base URL');
      return;
    }
    setDetectingKind(true);
    const hint = detectProtocolFromUrl(draft.base_url);
    // anthropic 不暴露 /v1/models 端点 → URL hint 命中时直接采纳，跳过探测
    if (hint?.kind === 'anthropic') {
      setDraft((d) => ({ ...d, official_kind: 'anthropic' }));
      toast.success('已识别协议', `${hint.label}（按 URL 域名判定，Anthropic 没有 /models 端点可探）`);
      setDetectingKind(false);
      return;
    }
    let probeOk = false;
    let probeMsg = '';
    if (draft.api_key_plain.trim()) {
      const r = await window.electronAPI.settings.testConnection({
        base_url: draft.base_url,
        api_key_plain: draft.api_key_plain,
        type: draft.type
      });
      probeOk = r.ok;
      probeMsg = r.ok ? `延迟 ${r.data.latency_ms}ms` : r.error.message;
    } else {
      probeMsg = '未填 API Key，只按 URL 判定';
    }
    let finalKind: OfficialKind | null = null;
    let finalImageKind: ImageKind | null = null;
    let label = '';
    if (hint) {
      finalKind = hint.kind;
      finalImageKind = hint.imageKind;
      label = hint.label;
    } else if (probeOk) {
      finalKind = 'openai-compat';
      finalImageKind = 'openai-compat';
      label = 'OpenAI 兼容（由 /models 探测得出）';
    }
    if (finalKind == null && finalImageKind == null) {
      setDetectingKind(false);
      toast.error('无法识别协议', `URL 域名无线索且 /models 探测失败：${probeMsg}。请手动选择`);
      return;
    }
    setDraft((d) => ({
      ...d,
      ...(d.type === 'text' ? { official_kind: finalKind } : {}),
      ...(d.type === 'image' ? { image_kind: finalImageKind } : {})
    }));
    setDetectingKind(false);
    toast.success('已识别协议', `${label}（${probeMsg}）`);
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

  function addAllDetected(): void {
    if (detectedModels.length === 0) return;
    const next = { ...draft.model_mapping };
    for (const modelId of detectedModels) {
      let displayName = modelId;
      let n = 2;
      while (next[displayName]) {
        displayName = `${modelId} (${n++})`;
      }
      next[displayName] = modelId;
    }
    update('model_mapping', next);
    setDetectedModels([]);
    toast.success('已全部添加', `共 ${detectedModels.length} 个模型`);
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

  const applicablePresets = CONFIG_PRESETS.filter((p) => p.for === draft.type);

  return (
    <div className="mb-config-form">
      {applicablePresets.length > 0 && (
        <div className="mb-presets-bar">
          <span className="mb-presets-label">🔌 一键预设：</span>
          {applicablePresets.map((p) => (
            <button
              key={p.key}
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => applyPreset(p)}
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      <div className="mb-snippet-paste">
        <button
          type="button"
          className="mb-snippet-paste-toggle"
          onClick={() => setSnippetOpen((v) => !v)}
        >
          📋 粘贴 SDK 示例自动填充
          <span className="mb-snippet-paste-chevron">{snippetOpen ? '▲' : '▼'}</span>
        </button>
        {snippetOpen && (
          <div className="mb-snippet-paste-body">
            <textarea
              className="mb-textarea"
              rows={6}
              spellCheck={false}
              placeholder={`# 粘贴中转站给的 OpenAI Python / TypeScript / curl 代码示例\n# 自动抽取 base_url / api_key / model\n\nfrom openai import OpenAI\nclient = OpenAI(\n    api_key="sk-xxxx",\n    base_url="https://example.com/v1"\n)\nresponse = client.chat.completions.create(model="gpt-4o", ...)`}
              value={snippetText}
              onChange={(e) => {
                setSnippetText(e.target.value);
                setSnippetError(null);
              }}
            />
            {snippetError && (
              <div className="mb-field-hint" style={{ color: 'var(--mb-danger, #d44)' }}>
                {snippetError}
              </div>
            )}
            <div className="mb-snippet-paste-actions">
              <button
                type="button"
                className="mb-btn mb-btn-secondary mb-btn-sm"
                onClick={applySnippet}
                disabled={snippetText.trim().length === 0}
              >
                解析并填入
              </button>
              <button
                type="button"
                className="mb-btn mb-btn-ghost mb-btn-sm"
                onClick={() => {
                  setSnippetText('');
                  setSnippetError(null);
                }}
                disabled={snippetText.length === 0}
              >
                清空
              </button>
              <span className="mb-field-hint" style={{ flex: 1 }}>
                解析后仍可在下方手动修正。占位 key（含 your / xxx 等）会被跳过。
              </span>
            </div>
          </div>
        )}
      </div>

      <Field label="中转站 / 官方名称">
        <div className="mb-icon-and-name-row">
          <IconPickerButton
            value={draft.icon}
            fallbackHint={{ providerName: draft.provider_name, baseUrl: draft.base_url }}
            onChange={(v) => update('icon', v)}
          />
          <input
            className="mb-input"
            style={{ flex: 1 }}
            value={draft.provider_name}
            onChange={(e) => update('provider_name', e.target.value)}
            placeholder="如：OpenAI 官方 / 我的 OpenAI 中转站"
          />
        </div>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="mb-select"
              style={{ flex: 1 }}
              value={draft.official_kind ?? ''}
              onChange={(e) => update('official_kind', (e.target.value || null) as OfficialKind)}
            >
              {OFFICIAL_KINDS.map((k) => (
                <option key={k.value ?? 'none'} value={k.value ?? ''}>
                  {k.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={detectKind}
              disabled={detectingKind}
              title="按 URL 域名 + 真实 /models 探测，自动选择协议"
            >
              {detectingKind ? '识别中…' : '🔍 识别协议'}
            </button>
          </div>
          <div className="mb-field-hint">
            {OFFICIAL_KINDS.find((k) => k.value === (draft.official_kind ?? null))?.hint}
          </div>
        </Field>
      )}

      {draft.type === 'text' && draft.official_kind === 'local' && (
        <LocalLlmFields draft={draft} onUpdate={update} />
      )}

      {draft.type === 'image' && (
        <Field label="绘图 API 协议">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select
              className="mb-select"
              style={{ flex: 1 }}
              value={draft.image_kind ?? ''}
              onChange={(e) => update('image_kind', (e.target.value || null) as ImageKind)}
            >
              {IMAGE_KINDS.map((k) => (
                <option key={k.value ?? 'openai'} value={k.value ?? ''}>
                  {k.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={detectKind}
              disabled={detectingKind}
              title="按 URL 域名 + 真实 /models 探测，自动选择协议"
            >
              {detectingKind ? '识别中…' : '🔍 识别协议'}
            </button>
          </div>
          <div className="mb-field-hint">
            {IMAGE_KINDS.find((k) => k.value === (draft.image_kind ?? null))?.hint}
          </div>
        </Field>
      )}

      {/* ComfyUI workflow 已移到「本地大模型」页面单独管理，此处不再渲染 */}

      {draft.type === 'image' && draft.image_kind !== 'comfyui' && (
        <Field label="请求体覆盖（高级）">
          <textarea
            className="mb-textarea"
            rows={6}
            spellCheck={false}
            placeholder={'{\n  "response_format": null\n}'}
            value={draft.body_overrides_json ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              update('body_overrides_json', v === '' ? null : v);
              setBodyOverridesError(null);
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v === '') {
                setBodyOverridesError(null);
                return;
              }
              try {
                const parsed = JSON.parse(v) as unknown;
                if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                  setBodyOverridesError('必须是 JSON 对象（不能是数组或基本值）');
                } else {
                  setBodyOverridesError(null);
                }
              } catch (err) {
                setBodyOverridesError(`JSON 解析失败：${(err as Error).message}`);
              }
            }}
          />
          {bodyOverridesError && (
            <div className="mb-field-hint" style={{ color: 'var(--mb-danger, #d44)' }}>
              {bodyOverridesError}
            </div>
          )}
          <div className="mb-field-hint">
            填写后会与默认请求体顶层合并发出，<code>null</code> 值表示删除该字段。变量：
            <code>{'${model}'}</code> <code>{'${prompt}'}</code> <code>{'${size}'}</code>{' '}
            <code>{'${n}'}</code> <code>{'${quality}'}</code> <code>{'${aspect}'}</code>{' '}
            <code>{'${image_size}'}</code>。
          </div>
          <button
            type="button"
            className="mb-btn mb-btn-secondary mb-btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => {
              update('body_overrides_json', '{\n  "response_format": null\n}');
              setBodyOverridesError(null);
            }}
          >
            示例：屏蔽 response_format
          </button>
        </Field>
      )}

      <Field label={`模型映射（${Object.keys(draft.model_mapping).length}）`}>
        <div className="mb-mapping-list">
          {Object.entries(draft.model_mapping).map(([k, v]) => (
            <MappingRow
              key={k}
              displayName={k}
              actualId={v}
              onRename={(newKey, newVal) => renameMapping(k, newKey, newVal)}
              onRemove={() => removeMapping(k)}
            />
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
          <Toggle
            label="启用思考模式（reasoning_content）"
            value={draft.supports_thinking}
            onChange={(v) => update('supports_thinking', v)}
          />
        </div>
      )}

      {draft.type === 'text' && draft.supports_thinking && (
        <Field
          label="思考强度"
          hint={
            draft.official_kind === 'anthropic'
              ? '映射到 thinking.budget_tokens（low≈1024 / medium≈2048 / high≈4096 / max≈8192）'
              : draft.official_kind === 'openai'
                ? '直接发到 reasoning_effort（仅 o1/o3/o4 系列识别）'
                : '直接发到 thinking.reasoning_effort（Deepseek V4 / Kimi K1.5 / GLM-Z1 等识别）'
          }
        >
          <select
            className="mb-select"
            value={draft.thinking_effort ?? ''}
            onChange={(e) =>
              update('thinking_effort', (e.target.value || null) as
                | 'low' | 'medium' | 'high' | 'max' | null)
            }
          >
            <option value="">（默认）</option>
            <option value="low">low（最少思考）</option>
            <option value="medium">medium</option>
            <option value="high">high（推荐）</option>
            <option value="max">max（最深思考）</option>
          </select>
        </Field>
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
              <span className="mb-detected-hint">点「添加」即可写入映射；判定仅按名字猜测，仅供参考</span>
            </span>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <button
                className="mb-btn mb-btn-secondary mb-btn-sm"
                onClick={addAllDetected}
                title="把检测到的全部模型一次性写入映射表"
              >
                <PlusIcon size={12} /> 全部添加
              </button>
              <button
                className="mb-btn mb-btn-ghost mb-btn-sm"
                onClick={() => setDetectedModels([])}
                title="折叠列表"
              >
                收起
              </button>
            </div>
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

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="mb-field">
      <label className="mb-label">{label}</label>
      {children}
      {hint && <div className="mb-field-hint">{hint}</div>}
    </div>
  );
}

/**
 * 模型映射行：显示名 / 实际 ID 都允许就地编辑。
 * 改动在 input 失焦或回车时一并提交；提交失败（空 / 冲突）会回退到旧值。
 */
function MappingRow({
  displayName,
  actualId,
  onRename,
  onRemove
}: {
  displayName: string;
  actualId: string;
  onRename: (newKey: string, newVal: string) => boolean;
  onRemove: () => void;
}): JSX.Element {
  const [keyDraft, setKeyDraft] = useState(displayName);
  const [valDraft, setValDraft] = useState(actualId);

  // 父组件传来的值（比如其他行也改了导致整体重排）应该刷新本地草稿
  useEffect(() => {
    setKeyDraft(displayName);
  }, [displayName]);
  useEffect(() => {
    setValDraft(actualId);
  }, [actualId]);

  function commit(): void {
    if (keyDraft === displayName && valDraft === actualId) return;
    const ok = onRename(keyDraft, valDraft);
    if (!ok) {
      setKeyDraft(displayName);
      setValDraft(actualId);
    }
  }

  return (
    <div className="mb-mapping-row">
      <input
        className="mb-input mb-mapping-input"
        value={keyDraft}
        onChange={(e) => setKeyDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          if (e.key === 'Escape') setKeyDraft(displayName);
        }}
        title="显示名（梦笔界面里看到的名字）"
      />
      <span className="mb-mapping-arrow">→</span>
      <input
        className="mb-input mb-mapping-input"
        value={valDraft}
        onChange={(e) => setValDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          if (e.key === 'Escape') setValDraft(actualId);
        }}
        title="实际模型 ID（发到上游 API 的字段）"
      />
      <button className="mb-mapping-remove" onClick={onRemove} title="删除">
        <TrashIcon size={13} />
      </button>
    </div>
  );
}

/**
 * 厂商图标选择按钮：点开后弹出 popover，里面有：
 *   - 「跟随名称自动猜」（清空，UI 仍会按 provider_name/base_url 猜一个回退）
 *   - 预设网格（40+ 个 lobehub slug，带搜索）
 *   - 上传自定义（PNG/JPG/SVG，转 dataURI 落库）
 */
function IconPickerButton({
  value,
  fallbackHint,
  onChange
}: {
  value: string | null | undefined;
  fallbackHint: { providerName?: string; baseUrl?: string };
  onChange: (next: string | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // 当前要显示的 icon：用户显式选了就用；没选则按 name/url 猜（仅用于按钮预览，不写回 draft）
  const effective = value ?? guessProviderIcon(fallbackHint);

  const filtered = useMemo<typeof PROVIDER_PRESETS>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PROVIDER_PRESETS;
    return PROVIDER_PRESETS.filter(
      (p) => p.id.includes(q) || p.label.toLowerCase().includes(q)
    );
  }, [search]);

  async function handleFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    // 限 1MB 防 DB 膨胀；用户图大概是 PNG 32x32 应该够
    if (file.size > 1024 * 1024) {
      toast.error('图片过大', '请压到 1MB 以内');
      return;
    }
    const dataUri = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(typeof r.result === 'string' ? r.result : '');
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
    if (!dataUri) {
      toast.error('读取失败');
      return;
    }
    onChange(dataUri);
    setOpen(false);
    toast.success('已设置自定义图标');
  }

  return (
    <div className="mb-icon-picker" style={{ position: 'relative' }}>
      <button
        type="button"
        className="mb-icon-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        title="点击选择厂商图标"
      >
        <ProviderIcon value={effective} size={36} radius={9} />
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 850
            }}
          />
          <div className="mb-icon-picker-popover">
            <div className="mb-icon-picker-head">
              <input
                className="mb-input"
                placeholder="搜索厂商…（openai / 千问 / ollama）"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="mb-icon-picker-grid">
              <button
                type="button"
                className={`mb-icon-picker-tile ${value == null ? 'is-active' : ''}`}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                  toast.info('已清空，自动跟随厂商名 / URL 猜一个');
                }}
                title="自动跟随"
              >
                <ProviderIcon value={null} size={36} radius={9} title="自动" />
                <span>自动</span>
              </button>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`mb-icon-picker-tile ${value === p.id ? 'is-active' : ''}`}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  title={p.label}
                >
                  <ProviderIcon value={p.id} size={36} radius={9} />
                  <span>{p.label}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="mb-icon-picker-empty">没匹配到，试试上传自定义图标 →</div>
              )}
            </div>
            <div className="mb-icon-picker-foot">
              <button
                type="button"
                className="mb-btn mb-btn-secondary mb-btn-sm"
                onClick={() => fileRef.current?.click()}
              >
                上传自定义图标（≤ 1 MB）
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 本地大模型（official_kind='local'）字段：GGUF 文件选择 + 服务状态
// ─────────────────────────────────────────────────────
function LocalLlmFields({
  draft,
  onUpdate
}: {
  draft: ApiConfigInput;
  onUpdate: <K extends keyof ApiConfigInput>(k: K, v: ApiConfigInput[K]) => void;
}): JSX.Element {
  const [status, setStatus] = useState<{
    running: boolean;
    loading: boolean;
    modelPath: string | null;
  }>({ running: false, loading: false, modelPath: null });

  // 每 5s 拉一次状态
  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      const r = await window.electronAPI.llm.status();
      if (!cancelled && r.ok) {
        setStatus({
          running: r.data.running,
          loading: r.data.loading,
          modelPath: r.data.modelPath
        });
      }
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  async function pickGguf(): Promise<void> {
    const r = await window.electronAPI.storage.pickFile({
      title: '选择 GGUF 模型文件',
      filters: [
        { name: 'GGUF 模型', extensions: ['gguf'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (!r.ok) {
      toast.error('打开对话框失败', r.error.message);
      return;
    }
    if (!r.data.filePath) return; // 用户取消
    onUpdate('local_model_path', r.data.filePath);
  }

  async function stopServer(): Promise<void> {
    const r = await window.electronAPI.llm.stop();
    if (!r.ok) {
      toast.error('停止失败', r.error.message);
      return;
    }
    toast.success('已停止本地服务');
  }

  const path = draft.local_model_path ?? '';
  const externalUrl = draft.base_url?.trim() ?? '';
  const usingExternal = externalUrl !== '';

  let badge: { label: string; cls: string };
  if (usingExternal) {
    badge = { label: '使用外部服务（不启动嵌入式）', cls: 'mb-llm-badge-external' };
  } else if (status.loading) {
    badge = { label: '加载中…', cls: 'mb-llm-badge-loading' };
  } else if (status.running && status.modelPath === path && path) {
    badge = { label: '运行中', cls: 'mb-llm-badge-running' };
  } else {
    badge = { label: '未启动（首次对话时按需加载）', cls: 'mb-llm-badge-idle' };
  }

  return (
    <>
      <Field label="本地模型文件（.gguf）">
        <div className="mb-llm-file-row">
          <button
            type="button"
            className="mb-btn mb-btn-secondary"
            onClick={() => void pickGguf()}
          >
            <FolderIcon size={14} /> {path ? '更换 .gguf' : '选择 .gguf 文件'}
          </button>
          {path && (
            <button
              type="button"
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() => onUpdate('local_model_path', null)}
              title="清除"
            >
              清除
            </button>
          )}
          <span className={`mb-llm-badge ${badge.cls}`}>{badge.label}</span>
        </div>
        <div className="mb-input mb-llm-path-display" title={path}>
          {path || '尚未选择文件'}
        </div>
        <div className="mb-field-hint">
          梦笔在你首次发消息时启动内嵌 llama-cpp 服务并加载该模型。
          若你已经在外部跑 Ollama / LM Studio / llama-server，
          直接在上面「base URL」填本地地址（如 <code>http://127.0.0.1:11434/v1</code>），梦笔会优先用外部服务。
        </div>
      </Field>
      {status.running && (
        <Field label="本地服务">
          <button
            type="button"
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => void stopServer()}
          >
            停止当前内嵌服务
          </button>
          <div className="mb-field-hint">
            正在跑：<code>{status.modelPath ?? ''}</code>
          </div>
        </Field>
      )}
    </>
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
  const haloStyle = useCursorHaloStore((s) => s.style);
  const setHaloStyle = useCursorHaloStore((s) => s.setStyle);

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

      <Field label="鼠标光晕">
        <div className="mb-appearance-halos">
          {HALO_STYLES.map((s, i) => (
            <motion.button
              key={s}
              type="button"
              onClick={() => {
                setHaloStyle(s as HaloStyle);
                toast.info('已切换光晕', HALO_LABELS[s as HaloStyle]);
              }}
              className={`mb-appearance-halo ${haloStyle === s ? 'is-active' : ''}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <span className="mb-appearance-halo-label">{HALO_LABELS[s as HaloStyle]}</span>
              <span className="mb-appearance-halo-desc">{HALO_DESCRIPTIONS[s as HaloStyle]}</span>
            </motion.button>
          ))}
        </div>
        <div className="mb-field-hint">
          代替原来的"卡片旋转光"——整个 app 共用 1 个跟随鼠标的光晕，多模块同屏时 GPU 占用大幅下降。
          想完全关闭选「关闭」即可。
        </div>
      </Field>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Storage Tab
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
// 工具箱 tab：保存路径 + 引擎状态（Real-ESRGAN ncnn + HYPIR 占位）
// 真正的放大引擎参数（模型 / 倍率 / 后端）在工具箱面板里按单次任务设置
// ─────────────────────────────────────────────────────
function ToolsTab(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const [busy, setBusy] = useState(false);
  const [engineStatus, setEngineStatus] = useState<{
    installed: boolean;
    version: string;
    models: Array<{ name: string; sizeBytes: number }>;
    enginePath: string;
    platform: string;
  } | null>(null);
  const [hypirReady, setHypirReady] = useState<boolean | null>(null);

  const toolsPath = prefs.tools_storage_path ?? '(沿用图片存储路径)';
  const autoSave = prefs.tools_auto_save === 'true';

  useEffect(() => {
    void window.electronAPI.upscale.status().then((r) => {
      if (r.ok) {
        setEngineStatus({
          installed: r.data.installed,
          version: r.data.version,
          models: r.data.models,
          enginePath: r.data.enginePath,
          platform: r.data.platform
        });
      }
    });
    void window.electronAPI.hypir.check({}).then((r) => {
      if (r.ok) setHypirReady(r.data.ready);
    });
  }, []);

  async function pickPath(): Promise<void> {
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
      prefs: { tools_storage_path: r.data.path }
    });
    setBusy(false);
    if (save.ok) {
      await load();
      toast.success('工具箱保存路径已更新', r.data.path);
    } else {
      toast.error('保存失败', save.error.message);
    }
  }

  async function clearPath(): Promise<void> {
    setBusy(true);
    const save = await window.electronAPI.settings.save({
      prefs: { tools_storage_path: '' }
    });
    setBusy(false);
    if (save.ok) {
      await load();
      toast.success('已恢复为沿用图片存储路径');
    } else {
      toast.error('保存失败', save.error.message);
    }
  }

  async function setAutoSave(v: boolean): Promise<void> {
    const save = await window.electronAPI.settings.save({
      prefs: { tools_auto_save: v ? 'true' : 'false' }
    });
    if (save.ok) await load();
  }

  async function deleteModel(name: string): Promise<void> {
    const ok = await confirmDialog({
      title: '删除放大模型',
      message: `确定删除模型 ${name} 吗？`,
      detail: '会同时删除 .bin 和 .param 两个文件；后续需要可再次导入或下载。',
      okText: '删除',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.upscale.removeModel({ modelName: name });
    if (!r.ok) {
      toast.error('删除失败', r.error.message);
      return;
    }
    toast.success('已删除', name);
    const r2 = await window.electronAPI.upscale.status();
    if (r2.ok) {
      setEngineStatus({
        installed: r2.data.installed,
        version: r2.data.version,
        models: r2.data.models,
        enginePath: r2.data.enginePath,
        platform: r2.data.platform
      });
    }
  }

  async function uninstallEngine(): Promise<void> {
    const ok = await confirmDialog({
      title: '卸载放大引擎',
      message: '确定卸载 Real-ESRGAN ncnn Vulkan 引擎吗？',
      detail: '会删除引擎二进制 + 所有已装模型；HYPIR / 矢量化不受影响。',
      okText: '卸载',
      danger: true
    });
    if (!ok) return;
    const r = await window.electronAPI.upscale.removeEngine();
    if (!r.ok) {
      toast.error('卸载失败', r.error.message);
      return;
    }
    toast.success('引擎已卸载');
    const r2 = await window.electronAPI.upscale.status();
    if (r2.ok) {
      setEngineStatus({
        installed: r2.data.installed,
        version: r2.data.version,
        models: r2.data.models,
        enginePath: r2.data.enginePath,
        platform: r2.data.platform
      });
    }
  }

  return (
    <div className="mb-settings-pane">
      <header className="mb-settings-pane-header">
        <div>
          <h3>工具箱</h3>
          <p className="mb-settings-pane-desc">
            保真放大（Real-ESRGAN ncnn）+ AI 修复（HYPIR 占位）+ 矢量化的本地化处理偏好与引擎管理。
          </p>
        </div>
      </header>

      <Field label="工具箱保存路径">
        <div className="mb-storage-path-row">
          <div
            className="mb-input"
            style={{ flex: 1, display: 'flex', alignItems: 'center' }}
          >
            <FolderIcon size={16} />
            <span style={{ marginLeft: 10, color: 'var(--mb-text-secondary)' }}>{toolsPath}</span>
          </div>
          <button className="mb-btn mb-btn-secondary" onClick={pickPath} disabled={busy}>
            选择文件夹
          </button>
          <button
            className="mb-btn mb-btn-ghost"
            onClick={clearPath}
            disabled={busy || !prefs.tools_storage_path}
          >
            清除
          </button>
        </div>
        <div className="mb-field-hint" style={{ marginTop: 4 }}>
          留空时沿用图片存储路径。仅工具箱产出（放大 / 矢量化）使用此路径。
        </div>
      </Field>

      <Field label="自动保存">
        <Toggle
          label="处理完成后自动保存到上述目录"
          value={autoSave}
          onChange={(v) => void setAutoSave(v)}
        />
      </Field>

      <Field label="Real-ESRGAN ncnn 引擎">
        {engineStatus ? (
          <div className="mb-field-hint" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div>
              {engineStatus.installed ? '✓ 已就绪' : '✗ 未安装'}
              {engineStatus.installed && ` · v${engineStatus.version} · ${engineStatus.platform}`}
            </div>
            <div>引擎目录：<code>{engineStatus.enginePath}</code></div>
            {engineStatus.installed && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() =>
                    void window.electronAPI.storage.showInFolder(engineStatus.enginePath)
                  }
                >
                  打开目录
                </button>
                <button
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() => void uninstallEngine()}
                >
                  卸载
                </button>
              </div>
            )}
            {!engineStatus.installed && (
              <div>到工具箱 → 保真放大 面板点「安装引擎」即可（支持 GitHub / 国内镜像）。</div>
            )}
          </div>
        ) : (
          <div className="mb-field-hint">读取引擎状态中…</div>
        )}
      </Field>

      <Field label={`已装放大模型（${engineStatus?.models.length ?? 0}）`}>
        {(engineStatus?.models.length ?? 0) === 0 ? (
          <div className="mb-field-hint">
            尚未安装引擎或模型。引擎安装时会内置 4 个默认模型，可在工具箱面板单独下载额外模型。
          </div>
        ) : (
          <div className="mb-mapping-list">
            {engineStatus!.models.map((m) => (
              <div key={m.name} className="mb-mapping-row">
                <code style={{ flex: 1 }}>{m.name}</code>
                <span className="mb-mapping-arrow">·</span>
                <code>{(m.sizeBytes / 1024 / 1024).toFixed(1)} MB</code>
                <button
                  className="mb-mapping-remove"
                  onClick={() => void deleteModel(m.name)}
                  title="删除"
                >
                  <TrashIcon size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Field>

      <Field label="HYPIR（AI 高质量修复，需 Python+CUDA）">
        <div className="mb-field-hint" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {hypirReady === null ? (
            <div>读取依赖状态中…</div>
          ) : hypirReady ? (
            <div>✓ 依赖全部就绪 —— 推理后端将在后续版本启用</div>
          ) : (
            <div>✗ 部分依赖未就绪 —— 到工具箱 → AI 修复 查看详细清单</div>
          )}
          <div>引擎与权重均独立管理，不会被打入主程序安装包。</div>
        </div>
      </Field>

      <Field label="StarVector 模型路径(AI · 精准矢量化)">
        <div className="mb-storage-path-row">
          <div
            className="mb-input"
            style={{ flex: 1, display: 'flex', alignItems: 'center' }}
          >
            <FolderIcon size={16} />
            <span
              style={{
                marginLeft: 8,
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {prefs.vec_starvector_path || '(未设置 — AI 模式按钮置灰)'}
            </span>
          </div>
          <button
            className="mb-btn mb-btn-ghost"
            onClick={async () => {
              const r = await window.electronAPI.storage.selectFolder();
              if (!r.ok || !r.data) return;
              const save = await window.electronAPI.settings.save({
                prefs: { vec_starvector_path: r.data.path }
              });
              if (save.ok) {
                await load();
                toast.success('StarVector 模型路径已更新', r.data.path);
              } else {
                toast.error('保存失败', save.error.message);
              }
            }}
            disabled={busy}
          >
            选择
          </button>
          <button
            className="mb-btn mb-btn-ghost"
            onClick={async () => {
              const save = await window.electronAPI.settings.save({
                prefs: { vec_starvector_path: '' }
              });
              if (save.ok) await load();
            }}
            disabled={busy || !prefs.vec_starvector_path}
          >
            清除
          </button>
        </div>
        <div className="mb-field-hint" style={{ marginTop: 4 }}>
          指向 starvector-1b-im2svg 模型目录(含 config.json + 权重)。
          模型 ~4 GB,可从 huggingface.co/starvector/starvector-1b-im2svg 或 hf-mirror 下载。
        </div>
      </Field>

      <Field label="实验功能">
        <Toggle
          label="显示「Lab · 实验精修」矢量化模式(默认隐藏)"
          value={prefs.vec_show_experimental === 'true'}
          onChange={async (v) => {
            const save = await window.electronAPI.settings.save({
              prefs: { vec_show_experimental: v ? 'true' : 'false' }
            });
            if (save.ok) await load();
          }}
        />
      </Field>
    </div>
  );
}

function StorageTab(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const [busy, setBusy] = useState(false);

  const imagePath = prefs.image_storage_path ?? '(默认应用目录 / images/)';
  const loraPath = prefs.lora_folder_path ?? '(未设置 —— LoRA 选择器禁用)';

  async function pickFolder(prefKey: string, label: string): Promise<void> {
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
      prefs: { [prefKey]: r.data.path }
    });
    setBusy(false);
    if (save.ok) {
      await load();
      toast.success(`${label}已更新`, r.data.path);
    } else {
      toast.error('保存失败', save.error.message);
    }
  }

  async function clearLoraPath(): Promise<void> {
    setBusy(true);
    const save = await window.electronAPI.settings.save({
      prefs: { lora_folder_path: '' }
    });
    setBusy(false);
    if (save.ok) {
      await load();
      toast.success('已清除 LoRA 目录');
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
          <button
            className="mb-btn mb-btn-secondary"
            onClick={() => void pickFolder('image_storage_path', '图片存储路径')}
            disabled={busy}
          >
            选择文件夹
          </button>
        </div>
      </Field>

      <Field label="LoRA 文件夹路径（可选）">
        <div className="mb-storage-path-row">
          <div className="mb-input" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <FolderIcon size={16} />
            <span style={{ marginLeft: 10, color: 'var(--mb-text-secondary)' }}>{loraPath}</span>
          </div>
          <button
            className="mb-btn mb-btn-secondary"
            onClick={() => void pickFolder('lora_folder_path', 'LoRA 目录')}
            disabled={busy}
          >
            选择文件夹
          </button>
          {prefs.lora_folder_path && (
            <button
              className="mb-btn mb-btn-ghost"
              onClick={() => void clearLoraPath()}
              disabled={busy}
            >
              清除
            </button>
          )}
        </div>
        <div className="mb-field-hint">
          指向你的 LoRA 库（递归扫描 .safetensors / .pt / .ckpt）；设了之后右侧绘图面板会出现「LoRA」选择器。
          注入到 prompt 末尾的格式：<code>{'<lora:name:weight>'}</code>。
          ComfyUI workflow 内可用 <code>{'{{lora}}'}</code> 占位符接收。
        </div>
      </Field>

      <FilenameTemplateField />

      <SearchBackendField />

      <ConfigIOSection />
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 配置导入 / 导出（密码加密 .mengbi-config 文件）
// ─────────────────────────────────────────────────────
function ConfigIOSection(): JSX.Element {
  const { load } = useSettingsStore();
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // 导出 modal 状态
  const [pwd1, setPwd1] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [exportSections, setExportSections] = useState({
    plans: true,
    appearance: true,
    prompts: true
  });

  // 导入 modal 状态
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [importPwd, setImportPwd] = useState('');
  const [importPreview, setImportPreview] = useState<{
    counts: {
      plans: number;
      configs: number;
      themes: number;
      promptCategories: number;
      prompts: number;
      albums: number;
      settings: number;
    };
    exportedAt: string;
    appVersion: string;
  } | null>(null);
  const [importMergeStrategy, setImportMergeStrategy] = useState<
    'merge' | 'overwrite'
  >('merge');
  const [importSections, setImportSections] = useState({
    plans: true,
    appearance: true,
    prompts: true
  });

  function resetExport(): void {
    setPwd1('');
    setPwd2('');
    setExportSections({ plans: true, appearance: true, prompts: true });
  }
  function resetImport(): void {
    setImportFilePath(null);
    setImportPwd('');
    setImportPreview(null);
    setImportMergeStrategy('merge');
    setImportSections({ plans: true, appearance: true, prompts: true });
  }

  async function doExport(): Promise<void> {
    if (pwd1.length < 8) {
      toast.error('密码至少 8 位');
      return;
    }
    if (pwd1 !== pwd2) {
      toast.error('两次密码不一致');
      return;
    }
    if (!exportSections.plans && !exportSections.appearance && !exportSections.prompts) {
      toast.error('请至少勾选一项导出范围');
      return;
    }
    setBusy(true);
    const r = await window.electronAPI.config.export({
      password: pwd1,
      sections: exportSections
    });
    setBusy(false);
    if (!r.ok) {
      toast.error('导出失败', r.error.message);
      return;
    }
    if (r.data.cancelled) {
      return;
    }
    toast.success(
      '导出成功',
      `${r.data.savedPath} · ${(r.data.byteSize / 1024).toFixed(1)} KB`
    );
    setExportOpen(false);
    resetExport();
  }

  async function pickImportFile(): Promise<void> {
    const r = await window.electronAPI.config.pickImportFile();
    if (!r.ok) {
      toast.error('选择文件失败', r.error.message);
      return;
    }
    if (!r.data.filePath) return;
    setImportFilePath(r.data.filePath);
    setImportPreview(null);
  }

  async function doPreview(): Promise<void> {
    if (!importFilePath) {
      toast.error('请先选择文件');
      return;
    }
    if (!importPwd) {
      toast.error('请输入密码');
      return;
    }
    setBusy(true);
    const r = await window.electronAPI.config.preview({
      filePath: importFilePath,
      password: importPwd
    });
    setBusy(false);
    if (!r.ok) {
      toast.error('校验失败', r.error.message);
      return;
    }
    setImportPreview({
      counts: r.data.counts,
      exportedAt: r.data.exportedAt,
      appVersion: r.data.appVersion
    });
  }

  async function doImport(): Promise<void> {
    if (!importFilePath || !importPwd || !importPreview) {
      toast.error('请先选择文件、输入密码并校验');
      return;
    }
    if (importMergeStrategy === 'overwrite') {
      const ok = await confirmDialog({
        title: '覆盖模式将清空原有同类数据',
        message:
          '当前选择「覆盖」模式：导入会先删除选中范围内的现有方案 / 配置 / 主题 / 相册。确定要继续吗？',
        okText: '继续覆盖',
        danger: true
      });
      if (!ok) return;
    }
    setBusy(true);
    const r = await window.electronAPI.config.import({
      filePath: importFilePath,
      password: importPwd,
      mergeStrategy: importMergeStrategy,
      sections: importSections
    });
    setBusy(false);
    if (!r.ok) {
      toast.error('导入失败', r.error.message);
      return;
    }
    const s = r.data.stats;
    toast.success(
      '导入完成',
      `方案 ${s.plansImported} · 配置 ${s.configsImported} · 主题 ${s.themesImported} · 提示词 ${s.promptsImported} · 相册 ${s.albumsImported} · 设置 ${s.settingsImported}`
    );
    // 刷新前端缓存的设置（自定义主题列表 / 提示词列表会在各自页面进入时再读）
    await load();
    setImportOpen(false);
    resetImport();
  }

  return (
    <Field label="配置导入 / 导出">
      <div className="mb-storage-path-row">
        <button
          className="mb-btn mb-btn-secondary"
          onClick={() => {
            resetExport();
            setExportOpen(true);
          }}
        >
          <ImageIcon size={14} /> 导出配置（加密 .mengbi-config）
        </button>
        <button
          className="mb-btn mb-btn-secondary"
          onClick={() => {
            resetImport();
            setImportOpen(true);
          }}
        >
          <FolderIcon size={14} /> 导入配置
        </button>
      </div>
      <div className="mb-field-hint">
        包含模型方案 + API Key（密码加密）、外观、系统设置、提示词管家。
        不含对话历史与图片本身。
      </div>

      {/* —— 导出 modal —— */}
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="导出配置"
        width={520}
        footer={
          <>
            <button className="mb-btn mb-btn-ghost" onClick={() => setExportOpen(false)}>
              取消
            </button>
            <button
              className="mb-btn mb-btn-primary"
              onClick={() => void doExport()}
              disabled={busy}
            >
              {busy ? '导出中…' : '导出'}
            </button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="mb-field-label">范围</div>
            <label className="mb-tools-switch-row">
              <input
                type="checkbox"
                checked={exportSections.plans}
                onChange={(e) =>
                  setExportSections((s) => ({ ...s, plans: e.target.checked }))
                }
              />
              <span>模型方案 + 配置（含 API Key，受密码加密）</span>
            </label>
            <label className="mb-tools-switch-row">
              <input
                type="checkbox"
                checked={exportSections.appearance}
                onChange={(e) =>
                  setExportSections((s) => ({
                    ...s,
                    appearance: e.target.checked
                  }))
                }
              />
              <span>外观 + 系统设置（自定义主题、路径、文件名模板等）</span>
            </label>
            <label className="mb-tools-switch-row">
              <input
                type="checkbox"
                checked={exportSections.prompts}
                onChange={(e) =>
                  setExportSections((s) => ({ ...s, prompts: e.target.checked }))
                }
              />
              <span>提示词管家（提示词 + 分类 + 相册元数据）</span>
            </label>
          </div>
          <div>
            <div className="mb-field-label">设置加密密码（≥ 8 位）</div>
            <input
              className="mb-input"
              type="password"
              value={pwd1}
              onChange={(e) => setPwd1(e.target.value)}
              placeholder="导入时需要相同密码才能解密"
            />
            <input
              className="mb-input"
              type="password"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
              placeholder="再次确认密码"
              style={{ marginTop: 8 }}
            />
            <div className="mb-field-hint">
              密码不会上传也不会存储，请自行妥善保管。忘记将无法解密。
            </div>
          </div>
        </div>
      </Modal>

      {/* —— 导入 modal —— */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="导入配置"
        width={560}
        footer={
          <>
            <button className="mb-btn mb-btn-ghost" onClick={() => setImportOpen(false)}>
              取消
            </button>
            {!importPreview ? (
              <button
                className="mb-btn mb-btn-primary"
                onClick={() => void doPreview()}
                disabled={busy || !importFilePath || !importPwd}
              >
                {busy ? '校验中…' : '校验密码 + 预览'}
              </button>
            ) : (
              <button
                className="mb-btn mb-btn-primary"
                onClick={() => void doImport()}
                disabled={busy}
              >
                {busy ? '导入中…' : '执行导入'}
              </button>
            )}
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="mb-field-label">配置文件</div>
            <div className="mb-storage-path-row">
              <div
                className="mb-input"
                style={{ flex: 1, color: 'var(--mb-text-secondary)' }}
              >
                {importFilePath ?? '未选择'}
              </div>
              <button
                className="mb-btn mb-btn-secondary"
                onClick={() => void pickImportFile()}
                disabled={busy}
              >
                选择文件
              </button>
            </div>
          </div>
          <div>
            <div className="mb-field-label">密码</div>
            <input
              className="mb-input"
              type="password"
              value={importPwd}
              onChange={(e) => {
                setImportPwd(e.target.value);
                setImportPreview(null);
              }}
              placeholder="导出时设置的密码"
            />
          </div>
          {importPreview && (
            <div
              className="mb-field-hint"
              style={{ background: 'var(--mb-bg-hover)', padding: 10, borderRadius: 8 }}
            >
              <div>
                来源：{importPreview.appVersion} · {importPreview.exportedAt}
              </div>
              <div>
                预览：方案 {importPreview.counts.plans} · 配置{' '}
                {importPreview.counts.configs} · 主题 {importPreview.counts.themes} ·
                提示词 {importPreview.counts.prompts} · 相册{' '}
                {importPreview.counts.albums} · 设置 {importPreview.counts.settings}
              </div>
            </div>
          )}
          {importPreview && (
            <>
              <div>
                <div className="mb-field-label">导入范围</div>
                <label className="mb-tools-switch-row">
                  <input
                    type="checkbox"
                    checked={importSections.plans}
                    onChange={(e) =>
                      setImportSections((s) => ({ ...s, plans: e.target.checked }))
                    }
                  />
                  <span>模型方案 + 配置</span>
                </label>
                <label className="mb-tools-switch-row">
                  <input
                    type="checkbox"
                    checked={importSections.appearance}
                    onChange={(e) =>
                      setImportSections((s) => ({
                        ...s,
                        appearance: e.target.checked
                      }))
                    }
                  />
                  <span>外观 + 系统设置</span>
                </label>
                <label className="mb-tools-switch-row">
                  <input
                    type="checkbox"
                    checked={importSections.prompts}
                    onChange={(e) =>
                      setImportSections((s) => ({ ...s, prompts: e.target.checked }))
                    }
                  />
                  <span>提示词管家</span>
                </label>
              </div>
              <div>
                <div className="mb-field-label">合并策略</div>
                <label className="mb-tools-switch-row">
                  <input
                    type="radio"
                    checked={importMergeStrategy === 'merge'}
                    onChange={() => setImportMergeStrategy('merge')}
                  />
                  <span>合并（按名字 / slug 去重，保留现有数据）</span>
                </label>
                <label className="mb-tools-switch-row">
                  <input
                    type="radio"
                    checked={importMergeStrategy === 'overwrite'}
                    onChange={() => setImportMergeStrategy('overwrite')}
                  />
                  <span>覆盖（先清空选中范围的现有数据再写入）</span>
                </label>
              </div>
              <div className="mb-field-hint">
                导入完成后建议重启应用，以确保所有页面读到最新设置。
              </div>
            </>
          )}
        </div>
      </Modal>
    </Field>
  );
}

// ─────────────────────────────────────────────────────
// 联网搜索后端选择（chat 时谁来代搜）
// ─────────────────────────────────────────────────────
function SearchBackendField(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const [backend, setBackend] = useState<string>(prefs.search_backend ?? 'native');
  const [tavilyKey, setTavilyKey] = useState<string>(prefs.search_tavily_key ?? '');
  const [searxngUrl, setSearxngUrl] = useState<string>(prefs.search_searxng_url ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBackend(prefs.search_backend ?? 'native');
    setTavilyKey(prefs.search_tavily_key ?? '');
    setSearxngUrl(prefs.search_searxng_url ?? '');
  }, [prefs.search_backend, prefs.search_tavily_key, prefs.search_searxng_url]);

  async function save(): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.settings.save({
      prefs: {
        search_backend: backend,
        search_tavily_key: tavilyKey,
        search_searxng_url: searxngUrl
      }
    });
    setBusy(false);
    if (r.ok) {
      await load();
      toast.success('联网搜索设置已更新');
    } else {
      toast.error('保存失败', r.error.message);
    }
  }

  return (
    <Field label="联网搜索后端">
      <select
        className="mb-select"
        value={backend}
        onChange={(e) => setBackend(e.target.value)}
      >
        <option value="native">原生（用模型自带的 web_search 工具）</option>
        <option value="ddg">DuckDuckGo（无 key，推荐）</option>
        <option value="tavily">Tavily（需 key，质量更高）</option>
        <option value="searxng">SearXNG（自己的实例）</option>
        <option value="off">关闭（即使方案勾了 supports_web_search 也不搜）</option>
      </select>
      <div className="mb-field-hint">
        仅在方案配置勾选了「支持联网搜索」的对话模型生效。
        DDG / Tavily / SearXNG 是「代搜」——梦笔先搜结果，作为系统消息注入对话。
      </div>
      {backend === 'tavily' && (
        <div style={{ marginTop: 6 }}>
          <input
            className="mb-input"
            type="password"
            placeholder="Tavily API Key（tvly-...）"
            value={tavilyKey}
            onChange={(e) => setTavilyKey(e.target.value)}
          />
        </div>
      )}
      {backend === 'searxng' && (
        <div style={{ marginTop: 6 }}>
          <input
            className="mb-input"
            placeholder="https://searx.example.com"
            value={searxngUrl}
            onChange={(e) => setSearxngUrl(e.target.value)}
          />
        </div>
      )}
      <button
        className="mb-btn mb-btn-secondary mb-btn-sm"
        style={{ marginTop: 8 }}
        onClick={() => void save()}
        disabled={busy}
      >
        保存
      </button>
    </Field>
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
