import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
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
import { OnnxModelsField } from './OnnxModelsField';
import { VideoProvidersCenter } from './VideoProvidersCenter';
// VecModelManager 已随矢量化功能整体移除，待重做
import {
  ProviderIcon,
  PROVIDER_PRESETS,
  guessProviderIcon
} from '@/lib/providerIcons';
import { parsePlanIcons, planIconOf } from '@/lib/planIcon';
import {
  voiceNotifyEnabled,
  parsePhrases,
  defaultPhrase,
  speakText,
  VOICE_TASK_NAMES,
  type VoiceTaskKey,
  type VoicePhrase
} from '@/lib/voiceNotify';
import { detectModelCapabilities, summarizeCapabilities } from '@/lib/modelCapabilities';
import {
  CURSOR_STYLES,
  CURSOR_OFF,
  CURSOR_SIZE_MIN,
  CURSOR_SIZE_MAX,
  CURSOR_SIZE_DEFAULT
} from '@/lib/cursorStyles';
import { protocolToOfficialKind } from '@/lib/relayProtocol';
import { ConfigAgentPanel } from './ConfigAgentPanel';
import { listMappedModels } from '@/lib/modelMapping';
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
  CopyIconShape,
  SettingsIcon
} from '@/components/Icon';
import {
  ATMOSPHERES,
  ATMOSPHERE_LABELS,
  PALETTES,
  PALETTE_LABELS,
  type Atmosphere,
  type Palette
} from '@shared/theme';
import type { ApiConfig, ApiConfigInput, ImageKind, OfficialKind, VideoKind } from '@shared/domain';
import type { McpStatus } from '@shared/ipc';
import { suggestVideoKind } from '@shared/domain';
import { detectProtocolFromUrl } from '@shared/protocolDetect';
import { parseSdkSnippet } from '@/lib/sdkSnippetParser';
import { getUpscaleModelMeta, groupModelsByCategory } from '@/lib/upscaleModelMeta';
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
import {
  SiPlans,
  SiSpark,
  SiPalette,
  SiDatabase,
  SiWrench,
  SiInfo,
  SiSearch,
  SiMonitor,
  SiGauge,
  SiCursorGlow,
  SiFolderLine,
  SiImages,
  SiArchive,
  SiGlobe,
  SiChip,
  SiRobot,
  SiUpscale,
  SiBox,
  SiKey,
  SiVideo
} from './settingsIcons';
import './Settings.css';

// ─────────────────────────────────────────────────────
// 设置分区静态索引：tab 快捷条 + 全局设置搜索共用同一张表（避免漂移）。
// 每个 SettingsSection 的 id 必须与这里一致；新增分区时同步登记。
// ─────────────────────────────────────────────────────

const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  plans: '模型方案',
  intelligent: '智能化方案',
  appearance: '外观',
  storage: '存储与系统',
  tools: '工具箱',
  about: '关于 / 许可证'
};

interface SettingsSectionMeta {
  tab: SettingsTab;
  id: string;
  title: string;
  desc?: string;
  /** 搜索关键词：把分区里的关键概念列进来（中英都可，匹配时不区分大小写） */
  keywords: string[];
}

const SETTINGS_INDEX: SettingsSectionMeta[] = [
  // ── 模型方案 ──
  {
    tab: 'plans',
    id: 'plans-manage',
    title: '方案管理',
    desc: '创建 / 切换方案，右键方案设置图标',
    keywords: ['方案', '创建方案', '切换方案', '方案图标', 'plan', '新方案']
  },
  {
    tab: 'plans',
    id: 'plans-providers',
    title: '中转站与模型',
    desc: 'API 地址 / Key / 模型映射，Key 自动加密落库',
    keywords: [
      'API Key', '密钥', 'key', '中转站', '官方直连', '第三方', '本地模型', '模型映射',
      '协议', '对话模型', '绘画模型', '视频模型', '地址', 'base url', '测试连接',
      '请求体覆盖', '自定义请求头', 'Kimi', 'DeepSeek', 'OpenAI', 'Claude', 'Ollama', 'gguf'
    ]
  },
  {
    tab: 'plans',
    id: 'plans-video-advanced',
    title: '视频供应商微调',
    desc: '高级（可选）：端点 / 能力 / 限制 / 费用阈值',
    keywords: ['视频供应商', 'Seedance', '端点', '费用', '上传端点', '轮询', '超时', '任务历史', 'kling', 'sora']
  },
  // ── 智能化方案 ──
  {
    tab: 'intelligent',
    id: 'intel-agent',
    title: '智能体',
    desc: '智能画布智能体的自动生成行为与模型指派',
    keywords: ['智能体', 'agent', '自动生成', '模型指派', '翻译', '快捷翻译', '文本模型']
  },
  {
    tab: 'intelligent',
    id: 'intel-system',
    title: '系统与体验',
    desc: '硬件加速、任务完成语音播报',
    keywords: ['GPU', '硬件加速', '语音', '播报', '话术', '试听', '花屏', '重启生效']
  },
  {
    tab: 'intelligent',
    id: 'intel-search',
    title: '联网搜索',
    desc: '对话联网后端：模型原生 / 各类代搜',
    keywords: ['联网', '搜索', '搜索后端', 'DuckDuckGo', 'Tavily', '博查', '智谱', 'Jina', 'Serper', 'SearXNG', 'web search']
  },
  {
    tab: 'intelligent',
    id: 'intel-mcp',
    title: 'MCP 服务器（智能体接入）',
    desc: '让 Hermes Studio 等智能体经 MCP 操作梦笔',
    keywords: ['MCP', 'Hermes', '智能体接入', 'agent', '服务器', '端口', 'token', '令牌', 'sse', 'streamable']
  },
  // ── 外观 ──
  {
    tab: 'appearance',
    id: 'appear-theme',
    title: '主题外观',
    desc: '10 材质氛围 × 10 主题配色',
    keywords: ['主题', '氛围', '配色', '材质', '深色', '颜色', '外观']
  },
  {
    tab: 'appearance',
    id: 'appear-zoom',
    title: '显示与缩放',
    desc: '整窗界面缩放（webFrame）',
    keywords: ['缩放', '界面缩放', '显示', '放大', '缩小', 'zoom', 'Ctrl']
  },
  {
    tab: 'appearance',
    id: 'appear-perf',
    title: '性能模式',
    desc: '动效开销控制，立即生效',
    keywords: ['性能', '低配', '动效', '掉帧', '流星', '光晕', 'GPU 占用']
  },
  {
    tab: 'appearance',
    id: 'appear-canvas',
    title: '智能画布与光标',
    desc: '连线流动色 / 鼠标光晕 / 自定义光标',
    keywords: [
      '连线', '流动色', '光晕', '鼠标', '画布', '强调色',
      '光标', '指针', 'cursor', '鼠标指针', '光标样式', '光标大小', '自定义光标'
    ]
  },
  // ── 存储与系统 ──
  {
    tab: 'storage',
    id: 'store-location',
    title: '存储位置',
    desc: '图片落盘目录与文件命名规则',
    keywords: ['存储', '路径', '落盘', '文件名', '命名', '模板', '目录', '图片存储']
  },
  {
    tab: 'storage',
    id: 'store-gallery',
    title: '资产库',
    desc: '资产库（图库）的加载与性能',
    keywords: ['资产库', '图库', '预加载', '内存', '瞬开']
  },
  {
    tab: 'storage',
    id: 'store-obsidian',
    title: 'Obsidian 资产库',
    desc: '连接本地 Obsidian 库：画布一键存入 / 调用笔记',
    keywords: ['Obsidian', '资产库', '笔记', 'vault', '库路径', '归档', '角色设定', '剧本', 'markdown', 'wikilink']
  },
  {
    tab: 'storage',
    id: 'store-backup',
    title: '配置备份',
    desc: '导出 / 导入全部方案与设置（加密）',
    keywords: ['备份', '导出', '导入', '加密', '配置文件夹', '图片导出', '图片导入', '节点模板', '恢复', '迁移']
  },
  // ── 工具箱 ──
  {
    tab: 'tools',
    id: 'tools-output',
    title: '输出与保存',
    desc: '工具箱产出目录与自动保存',
    keywords: ['工具箱', '保存路径', '自动保存', '输出目录']
  },
  {
    tab: 'tools',
    id: 'tools-realesrgan',
    title: 'Real-ESRGAN 放大引擎',
    desc: 'ncnn Vulkan 本地引擎与已装模型',
    keywords: ['放大', 'Real-ESRGAN', 'ncnn', 'Vulkan', '引擎', '超分', '卸载', '放大模型']
  },
  {
    tab: 'tools',
    id: 'tools-onnx',
    title: 'ONNX 放大模型',
    desc: 'onnxruntime-node 主进程，无 Python 依赖',
    keywords: ['ONNX', 'onnxruntime', '放大模型']
  },
  // ── 关于 ──
  {
    tab: 'about',
    id: 'about-app',
    title: '关于梦笔',
    desc: '版本 / 构建标识',
    keywords: ['版本', '构建', '关于', 'version']
  },
  {
    tab: 'about',
    id: 'about-license',
    title: '第三方许可证',
    desc: '第三方组件与模型的来源 + 许可证',
    keywords: ['许可证', '第三方', '开源', '合规', 'license']
  }
];

/** 平滑滚动到某分区并短暂高亮（1.5s）。元素不存在时安静跳过。 */
function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('mb-settings-flash');
  // 强制 reflow 以便重复点击也能重启高亮动画
  void el.offsetWidth;
  el.classList.add('mb-settings-flash');
  window.setTimeout(() => el.classList.remove('mb-settings-flash'), 1600);
}

// 对话协议（按「绝大多数选第一个」排序，名字尽量直白）。值不变（向后兼容已存配置），仅重命名/收拢展示。
const OFFICIAL_KINDS: Array<{ value: OfficialKind; label: string; hint: string }> = [
  {
    value: 'openai-compat',
    label: '通用（默认 · 绝大多数都选这个）',
    hint: '各类中转站 + Kimi / DeepSeek / 智谱 / MiniMax / 通义 等都用它。POST /v1/chat/completions'
  },
  {
    value: 'anthropic',
    label: 'Claude（Anthropic 协议）',
    hint: '仅 Claude 的 messages 协议用它。POST /v1/messages（x-api-key + anthropic-version）'
  },
  {
    value: 'gemini',
    label: 'Gemini（Google）',
    hint: '走 Gemini 的 OpenAI 兼容入口（/v1beta/openai/...，key 当 Bearer）'
  },
  {
    value: 'local',
    label: '本地模型（离线 · 无需联网）',
    hint: '选一个 .gguf 由梦笔内嵌运行；或填本地已起服务地址（Ollama / LM Studio）'
  },
  {
    value: 'openai',
    label: 'OpenAI 官方（仅 o1 / o3 思考模型需要）',
    hint: '只有 OpenAI 官方的 o1 / o3 等思考模型选它；其它一律用「通用」'
  },
  { value: null, label: '自动（= 通用）', hint: '不确定就用「通用」即可' }
];

/** 视频协议变种下拉（仅 type='video' 用）。视频几乎全异步：提交→轮询→取 mp4→下载。 */
const VIDEO_KINDS: Array<{ value: VideoKind; label: string; hint: string }> = [
  {
    value: 'kling',
    label: '可灵代理型 Kling（中转站最主流）',
    hint: 'POST {base}/kling/v1/videos/{text2video|image2video} → 轮询 .../{task_id} → data.task_result.videos[0].url。字段 model_name/prompt/negative_prompt/mode(std|pro)/aspect_ratio/duration/image/image_tail。'
  },
  {
    value: 'sora',
    label: 'OpenAI Sora 原生',
    hint: 'POST {base}/v1/videos（model/prompt/size/seconds/input_reference）→ 轮询 GET /v1/videos/{id} → GET /v1/videos/{id}/content。'
  },
  {
    value: 'unified',
    label: '聚合站统一端点',
    hint: 'POST {base}/video/generations（model 区分各家）→ 轮询 → video.url / data[0].url。各站字段差异用「请求体覆盖」兜底。'
  },
  {
    value: 'seedance',
    label: 'APIMart Seedance 2.0（富能力适配器）',
    hint: '统一请求 → 适配器映射 7 模式（文/图/首尾帧/参考图·视频·音频/有声/连续）。端点 + 模型能力/限制在下方「视频模型配置中心」配置，可恢复内置 Seedance 模板。模型映射填真实 id 如 doubao-seedance-2.0-fast。'
  },
  {
    value: 'veo',
    label: 'Google Veo（中转 OpenAI 兼容，适配器）',
    hint: 'POST /v1/videos/generations（model/prompt/aspect_ratio/duration/generate_audio/first_frame/last_frame/reference_images）→ 轮询 /{id} → video.url。原生有声。模型映射填 veo-3.1 等。Google 官方直连协议不同，可在配置中心改端点或走中转。'
  },
  {
    value: 'runway',
    label: 'Runway Gen-4/Gen-3（官方/透传，适配器）',
    hint: 'POST /runwayml/v1/{text_to_video|image_to_video}（camelCase；ratio 用分辨率串；必带 X-Runway-Version 头）→ 轮询 /runwayml/v1/tasks/{id} → output[0]。官方端点用 /v1（去掉 /runwayml 前缀）。模型映射填 gen4_turbo 等。'
  },
  {
    value: 'fal',
    label: 'fal.ai 队列（适配器）',
    hint: 'POST queue.fal.run/{model_id}（鉴权 Authorization: Key；model_id 即路径，t2v/i2v 由 slug 区分）→ 轮询 status → 取结果 video.url。base_url 填 https://queue.fal.run，模型映射填完整 slug 如 fal-ai/kling-video/v2.1/master/text-to-video。'
  },
  {
    value: 'custom',
    label: '自定义中转站（适配器，基础预留）',
    hint: '通用 body（model/prompt + 各类素材），端点 + 字段在「视频模型配置中心」配置，请求体覆盖兜底。'
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
  // ComfyUI（image_kind='comfyui'）为旧路径，已由 /comfyui 工作流编排器取代，设置页不再提供其一键预设。
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

/** 模型类型的展示元数据（中转站分组卡片用）。 */
const CONFIG_TYPE_META: Record<'text' | 'image' | 'video', { icon: string; label: string }> = {
  text: { icon: '💬', label: '对话' },
  image: { icon: '🎨', label: '绘画' },
  video: { icon: '🎬', label: '视频' }
};

/** 一个「中转站」= 共享同一 base_url 的若干配置（对话/绘画/视频各一条或多条）。 */
interface ProviderGroup {
  key: string;
  name: string;
  icon: string | null;
  baseUrl: string;
  /** 解密后的明文 Key（取组内第一条）；补能力时自动带入，免重输 */
  apiKey: string;
  /** 已按 对话→绘画→视频 排序 */
  configs: ApiConfig[];
}

/** base_url 归一化：去首尾空格 + 去尾部斜杠 + 转小写（判定是否同一中转站）。 */
function normalizeBaseUrl(u: string): string {
  return (u || '').trim().replace(/\/+$/, '').toLowerCase();
}

/** 把配置按「中转站」（同 base_url）聚合。空地址（本地模型）各自独立成站。 */
function groupConfigsByProvider(configs: ApiConfig[]): ProviderGroup[] {
  const order: Record<string, number> = { text: 0, image: 1, video: 2 };
  const map = new Map<string, ApiConfig[]>();
  for (const c of configs) {
    const nb = normalizeBaseUrl(c.base_url);
    const key = nb ? `url:${nb}` : `local:${c.id}`;
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  const groups: ProviderGroup[] = [];
  for (const [key, arr] of map) {
    const sorted = arr.slice().sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
    const head = sorted[0];
    groups.push({
      key,
      name: head.provider_name || '(未命名)',
      icon: head.icon ?? guessProviderIcon({ providerName: head.provider_name, baseUrl: head.base_url }),
      baseUrl: head.base_url,
      apiKey: head.api_key_plain ?? '',
      configs: sorted
    });
  }
  return groups;
}

/** ApiConfig → ApiConfigInput（编辑预填 / 同步共享信息复用）。 */
function configToInput(cfg: ApiConfig): ApiConfigInput {
  return {
    id: cfg.id,
    plan_id: cfg.plan_id,
    type: cfg.type,
    provider_name: cfg.provider_name,
    base_url: cfg.base_url,
    api_key_plain: cfg.api_key_plain ?? '',
    model_mapping: cfg.model_mapping ?? {},
    is_official: cfg.is_official,
    supports_web_search: cfg.supports_web_search,
    supports_vision: cfg.supports_vision,
    official_kind: cfg.official_kind,
    image_kind: cfg.image_kind ?? null,
    video_kind: cfg.video_kind ?? null,
    body_overrides_json: cfg.body_overrides_json ?? null,
    header_overrides_json: cfg.header_overrides_json ?? null,
    comfyui_workflow_json: cfg.comfyui_workflow_json ?? null,
    local_model_path: cfg.local_model_path ?? null,
    supports_thinking: cfg.supports_thinking ?? false,
    thinking_effort: cfg.thinking_effort ?? null,
    icon: cfg.icon ?? null
  };
}

export default function SettingsPage(): JSX.Element {
  const ui = useUIStore();
  const tab = ui.settingsTab;
  const setTab = (t: SettingsTab): void => ui.setSettingsTab(t);

  /** 搜索命中 / 快捷条点击：必要时先切 tab，再滚动到分区并高亮。 */
  function gotoSection(meta: SettingsSectionMeta): void {
    if (tab !== meta.tab) {
      setTab(meta.tab);
      // 等目标 tab 挂载后再滚动（内容为同步渲染，一拍延迟足够）
      window.setTimeout(() => scrollToSection(meta.id), 120);
    } else {
      scrollToSection(meta.id);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      className="mb-settings-root"
    >
      <aside className="mb-settings-sidebar mb-card mb-marquee-glow">
        <h2 className="mb-settings-title">设置</h2>
        <SidebarItem
          icon={<SiPlans size={17} />}
          label="模型方案"
          active={tab === 'plans'}
          onClick={() => setTab('plans')}
        />
        <SidebarItem
          icon={<SiSpark size={17} />}
          label="智能化方案"
          active={tab === 'intelligent'}
          onClick={() => setTab('intelligent')}
        />
        <SidebarItem
          icon={<SiPalette size={17} />}
          label="外观"
          active={tab === 'appearance'}
          onClick={() => setTab('appearance')}
        />
        <SidebarItem
          icon={<SiDatabase size={17} />}
          label="存储与系统"
          active={tab === 'storage'}
          onClick={() => setTab('storage')}
        />
        <SidebarItem
          icon={<SiWrench size={17} />}
          label="工具箱"
          active={tab === 'tools'}
          onClick={() => setTab('tools')}
        />
        <SidebarItem
          icon={<SiInfo size={17} />}
          label="关于 / 许可证"
          active={tab === 'about'}
          onClick={() => setTab('about')}
        />
      </aside>

      <section className="mb-settings-content mb-card mb-marquee-glow">
        <div className="mb-settings-pane mb-settings-toparea">
          <SettingsSearch onNavigate={gotoSection} />
          <SectionQuickBar tab={tab} />
        </div>
        {tab === 'plans' && <PlansTab />}
        {tab === 'intelligent' && <IntelligentTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'storage' && <StorageTab />}
        {tab === 'tools' && <ToolsTab />}
        {tab === 'about' && <AboutSection />}
      </section>
    </motion.div>
  );
}

function SidebarItem({
  icon,
  label,
  active,
  onClick
}: {
  icon?: JSX.Element;
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`mb-settings-side-item ${active ? 'is-active' : ''}`}
    >
      {icon && <span className="mb-settings-side-ico">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}

/**
 * 全局设置搜索：输入即从 SETTINGS_INDEX 过滤（标题 / 说明 / 关键词 / 所属 tab），
 * 点击命中 → 切 tab + 滚动到分区 + 高亮。索引与分区共用同一常量表，避免漂移。
 */
function SettingsSearch({ onNavigate }: { onNavigate: (meta: SettingsSectionMeta) => void }): JSX.Element {
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return SETTINGS_INDEX.filter(
      (m) =>
        m.title.toLowerCase().includes(t) ||
        (m.desc ?? '').toLowerCase().includes(t) ||
        SETTINGS_TAB_LABELS[m.tab].toLowerCase().includes(t) ||
        m.keywords.some((k) => k.toLowerCase().includes(t))
    );
  }, [q]);

  function pick(meta: SettingsSectionMeta): void {
    onNavigate(meta);
    setQ('');
  }

  return (
    <div className="mb-settings-search">
      <span className="mb-settings-search-icon">
        <SiSearch size={15} />
      </span>
      <input
        className="mb-settings-search-input"
        placeholder="搜索设置（如 API Key / 缩放 / 语音 / GPU / 备份…）"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setQ('');
          if (e.key === 'Enter' && results.length > 0) pick(results[0]);
        }}
      />
      {q.trim() !== '' && (
        <div className="mb-settings-search-pop mb-card">
          {results.length === 0 ? (
            <div className="mb-settings-search-empty">没有匹配的设置项——换个关键词试试（如 Key / 缩放 / 备份）</div>
          ) : (
            results.map((m) => (
              <button key={m.id} type="button" className="mb-settings-search-hit" onClick={() => pick(m)}>
                <span className="mb-settings-search-hit-title">{m.title}</span>
                {m.desc && <span className="mb-settings-search-hit-desc">{m.desc}</span>}
                <span className="mb-settings-search-hit-tab">{SETTINGS_TAB_LABELS[m.tab]}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** 区域快捷条：列出当前 tab 的全部分区 chips，点击平滑滚动到对应卡片并高亮。 */
function SectionQuickBar({ tab }: { tab: SettingsTab }): JSX.Element | null {
  const sections = SETTINGS_INDEX.filter((s) => s.tab === tab);
  if (sections.length < 2) return null;
  return (
    <nav className="mb-settings-quickbar" aria-label="本页分区">
      <span className="mb-settings-quickbar-label">分区</span>
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          className="mb-settings-quickchip"
          title={s.desc}
          onClick={() => scrollToSection(s.id)}
        >
          {s.title}
        </button>
      ))}
    </nav>
  );
}

// ─────────────────────────────────────────────────────
// Plans Tab
// ─────────────────────────────────────────────────────

function PlansTab(): JSX.Element {
  const { plans, configs, prefs, activePlanId, setActivePlanId, load } = useSettingsStore();
  const [planNameDraft, setPlanNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingDraft, setEditingDraft] = useState<ApiConfigInput | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  // 「三合一」统一编辑器：null=关闭；existing=该中转站名下全部配置，focus=进入时默认启用的块，
  // officialDefault=新建时的分类默认（官方直连 true / 第三方 false）
  const [providerEditing, setProviderEditing] = useState<{
    existing: ApiConfig[];
    focus?: 'image' | 'text' | 'video';
    officialDefault?: boolean;
  } | null>(null);
  // 顶部「保存」按钮：命令式调用 ProviderEditor.save() + 跟随其 busy 禁用
  const providerEditorRef = useRef<ProviderEditorHandle>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  // 方案图标编辑：null=关闭；{planId,name}=打开编辑器
  const [iconEditing, setIconEditing] = useState<{ planId: number; name: string } | null>(null);
  const planIcons = parsePlanIcons(prefs.plan_icons_json);

  const activeConfigs = configs.filter((c) => c.plan_id === activePlanId);

  /** 保存某方案的自定义图标（空串=恢复自动首字图标）。存 prefs.plan_icons_json，零迁移。 */
  async function savePlanIcon(planId: number, value: string): Promise<void> {
    const next = { ...planIcons };
    if (value) next[String(planId)] = value;
    else delete next[String(planId)];
    const r = await window.electronAPI.settings.save({ prefs: { plan_icons_json: JSON.stringify(next) } });
    if (r.ok) {
      await load();
      toast.success('方案图标已更新');
    } else {
      toast.error('保存失败', r.error.message);
    }
  }

  function openEdit(cfg: ApiConfig): void {
    setEditingExisting(true);
    setEditingDraft(configToInput(cfg)); // 解密后的明文 Key 已含在 cfg.api_key_plain
  }

  /**
   * 打开「三合一」统一编辑器：对整个中转站（同地址的全部配置）一次编辑
   * 对话/绘画/视频三块。focus 用于从「+ 补能力」进入时默认启用并定位该块。
   * existingConfigs 为空数组 = 新建中转站。
   */
  function openProviderEditor(
    existingConfigs: ApiConfig[],
    focus?: 'image' | 'text' | 'video',
    officialDefault?: boolean
  ): void {
    if (activePlanId === null) return;
    setProviderEditing({ existing: existingConfigs, focus, officialDefault });
  }

  /** 删除整个中转站（其名下所有配置一并删）。 */
  async function deleteProvider(groupConfigs: ApiConfig[]): Promise<void> {
    if (groupConfigs.length === 0) return;
    const name = groupConfigs[0].provider_name || '(未命名)';
    const ok = await confirmDialog({
      title: '删除整个中转站',
      message: `确认删除中转站「${name}」？`,
      detail: `该站名下 ${groupConfigs.length} 个模型配置（对话/绘画/视频）都会一并删除。`,
      okText: '全部删除',
      danger: true
    });
    if (!ok) return;
    for (const c of groupConfigs) {
      const r = await window.electronAPI.plan.configDelete(c.id);
      if (!r.ok) {
        toast.error('删除失败', r.error.message);
        await load();
        return;
      }
    }
    await load();
    toast.success('已删除中转站', name);
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
      video_kind: cfg.video_kind ?? null,
      body_overrides_json: cfg.body_overrides_json ?? null,
      header_overrides_json: cfg.header_overrides_json ?? null,
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
      {/* 模型配置智能体：右下角悬浮 FAB（仅本 tab）——粘 名称/地址/Key 自动建卡/选协议/测试 */}
      <ConfigAgentPanel />
      <header className="mb-settings-pane-header">
        <div>
          <h3>模型方案</h3>
        </div>
      </header>

      <div className="mb-settings-grid">
        <SettingsSection
          id="plans-manage"
          icon={<SiPlans size={15} />}
          title="方案管理"
          desc="创建 / 切换方案，右键方案可设置图标"
          wide
        >
          <div className="mb-settings-create-row">
            <div className="mb-settings-create-input">
              <input
                className="mb-input"
                placeholder="新方案名称"
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
            {plans.length > 0 && (
              <div className="mb-settings-plan-list">
                {plans.map((p, idx) => (
                  <motion.button
                    key={p.id}
                    onClick={() => setActivePlanId(p.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          { label: '设置方案图标…', onClick: () => setIconEditing({ planId: p.id, name: p.name }) },
                          ...(planIcons[String(p.id)]
                            ? [{ label: '恢复自动图标（首字）', onClick: () => void savePlanIcon(p.id, '') }]
                            : [])
                        ]
                      });
                    }}
                    className={`mb-plan-pill ${activePlanId === p.id ? 'is-active' : ''}`}
                    title={`${p.name} · 右键设置图标`}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.04, type: 'spring', stiffness: 380 }}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                  >
                    <PlanIconBadge planId={p.id} name={p.name} icons={planIcons} />
                    {p.name}
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        </SettingsSection>

        {plans.length === 0 ? (
          <SettingsSection
            id="plans-providers"
            icon={<SiKey size={15} />}
            title="中转站与模型"
            desc="API 地址 / Key / 模型映射，Key 自动加密落库"
            wide
          >
            <EmptyState
              icon={<ZapIcon size={28} />}
              title="还没有任何方案"
              desc="先创建一个方案，再往里面添加对话或绘画模型。"
            />
          </SettingsSection>
        ) : (
          activePlanId !== null && (
            <>
              <SettingsSection
                id="plans-providers"
                icon={<SiKey size={15} />}
                title="中转站与模型"
                desc="API 地址 / Key / 模型映射，Key 自动加密落库"
                wide
              >
                <ConfigList
                  key={activePlanId}
                  planId={activePlanId}
                  configs={activeConfigs}
                  onEditProvider={openProviderEditor}
                  onEdit={openEdit}
                  onDuplicateConfig={duplicateConfig}
                  onDeleteConfig={deleteConfig}
                  onDeleteProvider={deleteProvider}
                  onDeletePlan={() => deletePlan(activePlanId)}
                />
              </SettingsSection>
              <SettingsSection
                id="plans-video-advanced"
                icon={<SiVideo size={15} />}
                title="视频供应商微调"
                desc="高级（可选）：端点 / 能力 / 限制 / 费用阈值，常规使用无需配置"
                wide
              >
                <VideoProvidersCenter />
              </SettingsSection>
            </>
          )
        )}
      </div>

      <Modal
        open={editingDraft !== null}
        onClose={() => setEditingDraft(null)}
        title={(() => {
          const t = editingDraft?.type;
          const label = t === 'text' ? '对话' : t === 'video' ? '视频' : '绘画';
          return `${editingExisting ? '编辑' : '新增'}${label}模型配置`;
        })()}
        width={580}
      >
        {editingDraft && (
          <ConfigForm
            initial={editingDraft}
            isEditing={editingExisting}
            siblings={
              editingExisting && editingDraft.id != null && normalizeBaseUrl(editingDraft.base_url)
                ? configs.filter(
                    (c) =>
                      c.id !== editingDraft.id &&
                      c.plan_id === editingDraft.plan_id &&
                      normalizeBaseUrl(c.base_url) === normalizeBaseUrl(editingDraft.base_url)
                  )
                : []
            }
            onSaved={async () => {
              setEditingDraft(null);
              await load();
            }}
            onCancel={() => setEditingDraft(null)}
          />
        )}
      </Modal>

      <Modal
        open={providerEditing !== null}
        onClose={() => setProviderEditing(null)}
        title={
          providerEditing && providerEditing.existing.length > 0
            ? '配置中转站（对话 / 绘画 / 视频 三合一）'
            : providerEditing?.officialDefault
              ? '新增官方直连（三合一）'
              : '新增第三方中转站（三合一）'
        }
        width={1080}
        headerActions={
          providerEditing ? (
            <>
              <button className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => setProviderEditing(null)} disabled={providerBusy}>
                取消
              </button>
              <button
                className="mb-btn mb-btn-primary mb-btn-sm"
                onClick={() => void providerEditorRef.current?.save()}
                disabled={providerBusy}
              >
                {providerBusy ? '保存中…' : '保存'}
              </button>
            </>
          ) : undefined
        }
      >
        {providerEditing && activePlanId !== null && (
          <ProviderEditor
            ref={providerEditorRef}
            planId={activePlanId}
            existing={providerEditing.existing}
            focus={providerEditing.focus}
            officialDefault={providerEditing.officialDefault}
            onSaved={async () => {
              setProviderEditing(null);
              await load();
            }}
            onCancel={() => setProviderEditing(null)}
            onBusyChange={setProviderBusy}
          />
        )}
      </Modal>

      <Modal
        open={iconEditing !== null}
        onClose={() => setIconEditing(null)}
        title={`设置「${iconEditing?.name ?? ''}」的图标`}
        width={420}
      >
        {iconEditing && (
          <PlanIconEditor
            planId={iconEditing.planId}
            name={iconEditing.name}
            current={planIcons[String(iconEditing.planId)] ?? ''}
            onSave={async (v) => {
              await savePlanIcon(iconEditing.planId, v);
              setIconEditing(null);
            }}
            onCancel={() => setIconEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}

/** 方案图标徽章：自定义图片/emoji/文字 优先，否则名称首字 + 名称 hash 底色。 */
function PlanIconBadge({ planId, name, icons }: { planId: number; name: string; icons: Record<string, string> }): JSX.Element {
  const spec = planIconOf(planId, name, icons);
  if (spec.image) return <img className="mb-plan-icon" src={spec.image} alt="" />;
  return (
    <span className="mb-plan-icon" style={{ background: spec.bg }}>
      {spec.text}
    </span>
  );
}

/** 方案图标编辑器：emoji / 文字（取前 2 字）或上传图片；清空=恢复自动首字图标。 */
function PlanIconEditor({
  planId,
  name,
  current,
  onSave,
  onCancel
}: {
  planId: number;
  name: string;
  current: string;
  onSave: (v: string) => Promise<void> | void;
  onCancel: () => void;
}): JSX.Element {
  const [text, setText] = useState(current.startsWith('data:image/') ? '' : current);
  const [image, setImage] = useState(current.startsWith('data:image/') ? current : '');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const preview: Record<string, string> = image ? { [String(planId)]: image } : text ? { [String(planId)]: text } : {};

  function loadFile(file?: File | null): void {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 512 * 1024) {
      toast.error('图片太大', '请选 512KB 以内的小图标（会存进设置）');
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      setImage(String(r.result));
      setText('');
    };
    r.readAsDataURL(file);
  }

  return (
    <div className="mb-plan-icon-editor">
      <div className="mb-plan-icon-preview">
        <PlanIconBadge planId={planId} name={name} icons={preview} />
        <span className="mb-field-hint">{image ? '自定义图片' : text ? '自定义文字 / emoji' : '自动：名称首字 + 按名称生成的底色'}</span>
      </div>
      <Field label="文字 / Emoji 图标（最多 2 个字符）">
        <input
          className="mb-input"
          value={text}
          maxLength={4}
          placeholder={`留空=自动用「${(name || '?').charAt(0)}」`}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) setImage('');
          }}
        />
      </Field>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="mb-btn mb-btn-sm mb-btn-secondary" onClick={() => fileRef.current?.click()}>
          选择图片…
        </button>
        {(image || text) && (
          <button
            className="mb-btn mb-btn-sm mb-btn-ghost"
            onClick={() => {
              setImage('');
              setText('');
            }}
          >
            恢复自动图标
          </button>
        )}
      </div>
      <div className="mb-settings-form-actions">
        <button className="mb-btn mb-btn-ghost" onClick={onCancel}>
          取消
        </button>
        <button className="mb-btn mb-btn-primary" onClick={() => void onSave(image || text.trim())}>
          保存
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

function ConfigList({
  planId: _planId,
  configs,
  onEditProvider,
  onEdit,
  onDuplicateConfig,
  onDeleteConfig,
  onDeleteProvider,
  onDeletePlan
}: {
  planId: number;
  configs: ApiConfig[];
  onEditProvider: (
    existingConfigs: ApiConfig[],
    focus?: 'image' | 'text' | 'video',
    officialDefault?: boolean
  ) => void;
  onEdit: (cfg: ApiConfig) => void;
  onDuplicateConfig: (cfg: ApiConfig) => void;
  onDeleteConfig: (cfg: ApiConfig) => void;
  onDeleteProvider: (groupConfigs: ApiConfig[]) => void;
  onDeletePlan: () => void;
}): JSX.Element {
  // ComfyUI（image_kind='comfyui'）为旧配置，已由 /comfyui 工作流编排器取代，这里过滤掉不再管理
  const visible = configs.filter((c) => !(c.type === 'image' && c.image_kind === 'comfyui'));
  const providers = groupConfigsByProvider(visible);
  // 按「官方直连 / 第三方中转站 / 本地」分区——同一套配置模型，仅展示分组不同
  const kindOf = (p: ProviderGroup): 'official' | 'relay' | 'local' =>
    providerKind(p.baseUrl, p.configs.some((c) => c.is_official));
  const PROVIDER_SECTIONS: Array<{ kind: 'official' | 'relay' | 'local'; label: string; desc: string }> = [
    { kind: 'official', label: '🏢 官方直连', desc: '官网直连（MiniMax / DeepSeek / OpenAI …）' },
    { kind: 'relay', label: '🔁 第三方中转站', desc: '聚合 / 代理站点' },
    { kind: 'local', label: '💻 本地模型', desc: '本机运行（Ollama / LM Studio / 内嵌 llama.cpp）' }
  ];

  return (
    <div className="mb-settings-config-list">
      <div className="mb-settings-config-bar">
        <h4>该方案下的中转站 / 模型</h4>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="mb-btn mb-btn-primary mb-btn-sm"
            onClick={() => onEditProvider([], undefined, true)}
            title="新建官方直连中转站（MiniMax / DeepSeek / OpenAI 等官网直连）"
          >
            <PlusIcon size={14} /> 官方直连
          </button>
          <button
            className="mb-btn mb-btn-secondary mb-btn-sm"
            onClick={() => onEditProvider([], undefined, false)}
            title="新建第三方中转站（聚合 / 代理站点）"
          >
            <PlusIcon size={14} /> 第三方中转站
          </button>
          <button className="mb-btn mb-btn-danger mb-btn-sm" onClick={onDeletePlan}>
            <TrashIcon size={14} /> 删除方案
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<KeyIcon size={26} />}
          title="该方案下还没有任何模型配置"
          desc="点击上方按钮添加。所有 Key 会自动加密落库。"
          inline
        />
      ) : (
        PROVIDER_SECTIONS.map((sec) => {
          const list = providers.filter((p) => kindOf(p) === sec.kind);
          if (list.length === 0) return null;
          return (
            <div key={sec.kind} className="mb-provider-section">
              <div className="mb-provider-section-head">
                <span className="mb-provider-section-title">{sec.label}</span>
                <span className="mb-provider-section-desc">{sec.desc} · {list.length}</span>
              </div>
              <div className="mb-provider-grid">
                {list.map((p, idx) => (
                  <ProviderCard
                    key={p.key}
                    provider={p}
                    index={idx}
                    onEdit={onEdit}
                    onEditProvider={onEditProvider}
                    onDuplicate={onDuplicateConfig}
                    onDelete={onDeleteConfig}
                    onDeleteProvider={onDeleteProvider}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

/** 中转站卡片：一张卡 = 一个站点，列出其 对话/绘画/视频 配置，并能一键补齐缺的能力（共享信息自动带入）。 */
function ProviderCard({
  provider,
  index,
  onEdit,
  onEditProvider,
  onDuplicate,
  onDelete,
  onDeleteProvider
}: {
  provider: ProviderGroup;
  index: number;
  onEdit: (cfg: ApiConfig) => void;
  onEditProvider: (existingConfigs: ApiConfig[], focus?: 'image' | 'text' | 'video') => void;
  onDuplicate: (cfg: ApiConfig) => void;
  onDelete: (cfg: ApiConfig) => void;
  onDeleteProvider: (groupConfigs: ApiConfig[]) => void;
}): JSX.Element {
  const isLocal = !provider.baseUrl.trim();
  // 缺失的能力（用于「+ 补能力」按钮）——本地（空地址）站不提供补能力
  const presentTypes = new Set(provider.configs.map((c) => c.type));
  const missing = (['text', 'image', 'video'] as const).filter((t) => !presentTypes.has(t));

  return (
    <motion.div
      className="mb-provider-card mb-card is-clickable"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.03 }}
      onClick={() => onEditProvider(provider.configs)}
      title="点击卡片进入三合一配置（对话 / 绘画 / 视频）"
    >
      <div className="mb-provider-head">
        <ProviderIcon value={provider.icon} name={provider.name} size={38} radius={9} />
        <div className="mb-provider-headtext">
          <div className="mb-provider-name" title={provider.name}>{provider.name}</div>
          <div className="mb-provider-url" title={provider.baseUrl || '本地（无地址）'}>
            {provider.baseUrl || '本地'}
          </div>
        </div>
        <span className="mb-provider-edit" aria-hidden title="点击卡片编辑">
          <SettingsIcon size={15} />
        </span>
        <button
          className="mb-provider-del"
          title={isLocal ? '删除此配置' : '删除整个中转站（含其下全部配置）'}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteProvider(provider.configs);
          }}
        >
          <TrashIcon size={14} />
        </button>
      </div>

      <div className="mb-provider-rows">
        {provider.configs.map((c) => {
          const meta = CONFIG_TYPE_META[c.type as 'text' | 'image' | 'video'];
          return (
            <div
              key={c.id}
              className="mb-provider-row"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  items: [
                    { label: '单项高级编辑…', onClick: () => onEdit(c) },
                    { label: '复制配置', icon: <CopyIconShape size={12} />, onClick: () => onDuplicate(c) },
                    { separator: true },
                    { label: '删除此配置', variant: 'danger', icon: <TrashIcon size={12} />, onClick: () => onDelete(c) }
                  ]
                });
              }}
              title={`${meta?.label ?? c.type} · 点击卡片编辑 · 右键单项高级/复制/删除`}
            >
              <span className="mb-provider-row-ico">{meta?.icon ?? '•'}</span>
              <span className="mb-provider-row-label">{meta?.label ?? c.type}</span>
              <span className="mb-provider-row-meta">{Object.keys(c.model_mapping ?? {}).length} 模型</span>
              <span className="mb-provider-row-tags">
                {c.supports_vision && <span title="支持视觉">👁</span>}
                {c.supports_web_search && <span title="支持联网">🌐</span>}
                {c.supports_thinking && <span title="启用思考模式">💭</span>}
              </span>
            </div>
          );
        })}
      </div>

      {!isLocal && missing.length > 0 && (
        <div className="mb-provider-add">
          <span className="mb-provider-add-label">+ 补能力</span>
          {missing.map((t) => (
            <button
              key={t}
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                onEditProvider(provider.configs, t);
              }}
              title={`为本站新增${CONFIG_TYPE_META[t].label}模型（三合一编辑器，名称/地址/Key 自动带入）`}
            >
              {CONFIG_TYPE_META[t].icon} {CONFIG_TYPE_META[t].label}
            </button>
          ))}
        </div>
      )}
    </motion.div>
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
  //   - ComfyUI 走 /comfyui 工作流编排器（侧栏「ComfyUI 工作流」）
  //   - sd-cpp 用户少且语义已被通用 OpenAI-compat 覆盖
];

function ConfigForm({
  initial,
  isEditing,
  siblings = [],
  onCancel,
  onSaved
}: {
  initial: ApiConfigInput;
  isEditing: boolean;
  /** 本站点其他配置（同 base_url，不同 id）——用于「改一处共享信息同步到全站」 */
  siblings?: ApiConfig[];
  onCancel: () => void;
  onSaved: () => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState<ApiConfigInput>(initial);
  // 同站点有其他配置时，默认勾选「同步 名称/地址/Key 到全站」——改一处即全站生效
  const [syncShared, setSyncShared] = useState(siblings.length > 0);
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

  // 自动识别能力（多模态/思考/原生联网）：先按模型映射里的真实 ID 名匹配；
  // 映射为空时，若填了 URL+Key 就探一下 /models 拿到模型 ID 再匹配（即"两者结合"）。
  const [detectingCaps, setDetectingCaps] = useState(false);
  async function detectCaps(): Promise<void> {
    let ids = Object.values(draft.model_mapping).filter(Boolean);
    let note = '按模型映射';
    if (ids.length === 0 && draft.base_url.trim() && draft.api_key_plain.trim()) {
      setDetectingCaps(true);
      const r = await window.electronAPI.settings.testConnection({
        base_url: draft.base_url,
        api_key_plain: draft.api_key_plain,
        type: draft.type
      });
      setDetectingCaps(false);
      if (r.ok) {
        ids = r.data.models ?? [];
        note = '按探测到的模型';
      }
    }
    if (ids.length === 0) {
      toast.error('先在「模型映射」加实际模型 ID，或填好 Base URL/Key', '识别需要知道真实模型 ID');
      return;
    }
    const caps = detectModelCapabilities(ids);
    setDraft((d) => ({
      ...d,
      supports_vision: caps.vision,
      supports_thinking: caps.thinking,
      // 联网偏向"只开不关"——名匹配难全覆盖，避免误关用户手动开的
      supports_web_search: caps.webSearch || d.supports_web_search,
      thinking_effort: caps.thinking ? (d.thinking_effort ?? caps.thinkingEffort ?? 'high') : d.thinking_effort
    }));
    setTestResult(null);
    toast.success('已识别能力', `${summarizeCapabilities(caps)}（${note}，可手动微调）`);
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
    if (busy) return; // 防重入：异步保存期间忽略再次触发（狂按 Enter）
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
    // 同步共享信息：把本配置的 名称/地址/Key/图标 一并写到本站其他配置（一次保存多条）。
    // Key 仅在非空时同步——避免本配置 Key 解密失败（空串）误把其他配置的 Key 清掉。
    const configsToSave: ApiConfigInput[] = [draft];
    if (syncShared && siblings.length > 0) {
      const keyToSync = draft.api_key_plain.trim();
      for (const s of siblings) {
        const sInput = configToInput(s);
        configsToSave.push({
          ...sInput,
          provider_name: draft.provider_name,
          base_url: draft.base_url,
          api_key_plain: keyToSync ? draft.api_key_plain : sInput.api_key_plain,
          icon: draft.icon
        });
      }
    }
    setBusy(true);
    const r = await window.electronAPI.settings.save({ configs: configsToSave });
    setBusy(false);
    if (r.ok) {
      await onSaved();
      const extra = configsToSave.length > 1 ? `（同步到本站 ${configsToSave.length - 1} 个配置）` : '';
      toast.success(isEditing ? '已更新' : '已保存', `${draft.provider_name}${extra}`);
    } else {
      toast.error(isEditing ? '更新失败' : '保存失败', r.error.message);
    }
  }

  const applicablePresets = CONFIG_PRESETS.filter((p) => p.for === draft.type);

  function onEditorKeyDown(e: React.KeyboardEvent): void {
    // 按 Enter 自动保存（纯 Enter；IME 组字 / Shift+Enter 不触发）
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    if (el instanceof HTMLTextAreaElement) return; // 多行框（SDK 片段 / JSON 覆盖）= 换行
    if (el instanceof HTMLSelectElement) return; // 下拉框 Enter = 选中菜单项，保持原生行为
    if (el.closest('.mb-mapping-add, .mb-mapping-list, .mb-mapping-row')) return; // 模型映射输入自有 Enter 语义
    if (el.tagName === 'BUTTON') return; // 按钮上的 Enter = 点击它
    e.preventDefault();
    void save();
  }

  return (
    <div className="mb-config-form" onKeyDown={onEditorKeyDown}>
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

      {/* ComfyUI workflow 由 /comfyui 工作流编排器管理，此处不再渲染 */}

      {draft.type === 'video' && (
        <Field label="视频 API 协议（拿不准就不用管——运行时会按地址/模型自动匹配）">
          <select
            className="mb-select"
            style={{ width: '100%' }}
            value={draft.video_kind ?? 'kling'}
            onChange={(e) => update('video_kind', e.target.value as VideoKind)}
          >
            {VIDEO_KINDS.map((k) => (
              <option key={k.value ?? 'kling'} value={k.value ?? 'kling'}>
                {k.label}
              </option>
            ))}
          </select>
          {(() => {
            // 按 地址/模型 自动建议协议（与运行时自动纠偏同一套规则）——选错也能跑，但配置一致更清晰
            const firstActual = Object.values(draft.model_mapping ?? {})[0];
            const sug = suggestVideoKind(draft.base_url ?? '', firstActual);
            const cur = draft.video_kind ?? 'kling';
            if (!sug || sug === cur) return null;
            return (
              <div className="mb-field-hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>
                  检测到该 地址/模型 更像 <b>{VIDEO_KINDS.find((k) => k.value === sug)?.label ?? sug}</b>（运行时会自动按它处理）
                </span>
                <button className="mb-btn mb-btn-sm" onClick={() => update('video_kind', sug)}>
                  一键采用
                </button>
              </div>
            );
          })()}
          <div className="mb-field-hint">
            {VIDEO_KINDS.find((k) => k.value === (draft.video_kind ?? 'kling'))?.hint}
          </div>
          <div className="mb-field-hint">
            常规使用只需三样：<b>API 地址 + API Key + 模型映射</b>，协议选不对会自动纠偏。视频均为<b>异步</b>：提交任务 → 轮询 →
            下载 mp4 落盘（自动入资产库）。模型映射里填真实模型 ID（如
            <code> kling-v2-1-master</code> / <code>doubao-seedance-2.0</code> / <code>sora-2</code>）。各站字段差异用下方「请求体覆盖」兜底。
          </div>
        </Field>
      )}

      {(draft.type === 'image' && draft.image_kind !== 'comfyui') || draft.type === 'video' ? (
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
      ) : null}

      <Field label={`模型映射（${Object.keys(draft.model_mapping).length}）`}>
        <div className="mb-mapping-head">
          <span>显示名（应用内可见，自动带「{draft.provider_name || '中转站'} / 」前缀区分来源）</span>
          <span>实际模型 ID（发给接口）</span>
        </div>
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
        <div className="mb-config-capsbar">
          <button
            className="mb-btn mb-btn-secondary mb-btn-sm"
            onClick={() => void detectCaps()}
            disabled={detectingCaps}
            title="按真实模型 ID 自动判断：多模态 / 思考 / 原生联网，并填好下面的开关"
          >
            {detectingCaps ? '识别中…' : '✨ 自动识别能力'}
          </button>
          <span className="mb-config-capsbar-hint">按模型 ID 智能判断多模态/思考/联网</span>
        </div>
      )}

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

      {siblings.length > 0 && (
        <label className="mb-sync-shared" title="本中转站还有其他配置（对话/绘画/视频）共用同一地址与 Key">
          <input type="checkbox" checked={syncShared} onChange={(e) => setSyncShared(e.target.checked)} />
          同步 名称 / 地址 / API Key 到本站其他 {siblings.length} 个配置（改一处，全站生效）
        </label>
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

// ─────────────────────────────────────────────────────
// 中转站「三合一」统一编辑器
//   一个站点只录一次 名称/地址/Key/图标；下面分 对话 / 绘画 / 视频 三块，
//   各自配 协议 + 模型映射 + 能力。「测试连接 + 拉取模型」拉到的上游模型
//   可一键指派到任意块。保存时按启用的块写多条 api_configs（一次保存），
//   原本存在但被关掉的块则删除其配置。免去对同一中转站的重复录入。
//   （同类型重复配置不在此合并——请用行内单项编辑器管理，避免误合并丢数据。）
// ─────────────────────────────────────────────────────

type ConfigType = 'text' | 'image' | 'video';
const BLOCK_ORDER: ConfigType[] = ['text', 'image', 'video'];

interface ModelBlockState {
  enabled: boolean;
  /** 该类已有配置的 id（编辑则 UPDATE，缺省则 INSERT）；关掉时据此删除 */
  existingId?: number;
  /** 该类原配置的明文 Key——共享 Key 留空（解密失败）时回退用，避免误清 */
  existingKey?: string;
  model_mapping: Record<string, string>;
  official_kind: OfficialKind;
  image_kind: ImageKind;
  video_kind: VideoKind;
  supports_web_search: boolean;
  supports_vision: boolean;
  supports_thinking: boolean;
  thinking_effort: 'low' | 'medium' | 'high' | 'max' | null;
  body_overrides_json: string | null;
  local_model_path: string | null;
  comfyui_workflow_json: string | null;
  is_official: boolean;
}

function emptyBlock(): ModelBlockState {
  return {
    enabled: false,
    model_mapping: {},
    official_kind: null,
    image_kind: null,
    video_kind: 'seedance',
    supports_web_search: false,
    supports_vision: false,
    supports_thinking: false,
    thinking_effort: null,
    body_overrides_json: null,
    local_model_path: null,
    comfyui_workflow_json: null,
    is_official: false
  };
}

function blockFromConfig(cfg: ApiConfig): ModelBlockState {
  return {
    enabled: true,
    existingId: cfg.id,
    existingKey: cfg.api_key_plain ?? '',
    model_mapping: { ...(cfg.model_mapping ?? {}) },
    official_kind: cfg.official_kind,
    image_kind: cfg.image_kind ?? null,
    video_kind: (cfg.video_kind ?? 'seedance') as VideoKind,
    supports_web_search: cfg.supports_web_search,
    supports_vision: cfg.supports_vision,
    supports_thinking: cfg.supports_thinking ?? false,
    thinking_effort: cfg.thinking_effort ?? null,
    body_overrides_json: cfg.body_overrides_json ?? null,
    local_model_path: cfg.local_model_path ?? null,
    comfyui_workflow_json: cfg.comfyui_workflow_json ?? null,
    is_official: cfg.is_official
  };
}

/** 上游模型 ID 的一句话猜测（仅供指派参考）。与 ConfigForm 内的同名逻辑等价。 */
function describeUpstreamModel(modelId: string): string {
  const id = modelId.toLowerCase();
  if (/(image|dall|sdxl|flux|nano-banana|midjourney|sora-image|gpt-image)/.test(id)) return '看起来是绘图模型';
  if (/(embedding|embed)/.test(id)) return 'Embedding 模型';
  if (/(rerank)/.test(id)) return '重排序模型';
  if (/(audio|tts|whisper|voice|speech)/.test(id)) return '语音模型';
  if (/(video|kling|seedance|veo|runway|hailuo|wan)/.test(id)) return '看起来是视频模型';
  if (/(vision|vl|multimodal|4o|claude-3|gemini|nano-banana-pro)/.test(id)) return '多模态对话模型（含 vision）';
  if (/(coder|code|coding)/.test(id)) return '代码专用模型';
  return '通用对话/多模态模型';
}

/** 通用滑块开关（左关 / 右开）。用于三合一编辑器各能力块、GPU 加速、语音播报等。 */
function SwitchControl({
  checked,
  onChange,
  disabled,
  title
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`mb-switch ${checked ? 'is-on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={title}
    >
      <span className="mb-switch-knob" />
    </button>
  );
}

/**
 * 中转站归类：official（官方直连）/ relay（第三方中转站）/ local（本地无地址）。
 * 完全以 is_official 标志为准（用户在新建时用两个按钮选定、编辑里可随时切换），不再按域名猜，
 * 这样「官方 ↔ 第三方」两个方向都能手动调整且稳定不被自动判定覆盖。
 */
function providerKind(baseUrl: string, isOfficialFlag?: boolean): 'official' | 'relay' | 'local' {
  if (!baseUrl.trim()) return 'local';
  return isOfficialFlag ? 'official' : 'relay';
}

/** 官方直连一键预设（新建中转站时用）：勾上对应能力块并预填 地址/协议/能力。 */
interface OfficialPreset {
  key: string;
  label: string;
  name: string;
  baseUrl: string;
  official_kind: OfficialKind;
  supports_vision?: boolean;
  supports_web_search?: boolean;
  hint: string;
}
const OFFICIAL_PRESETS: OfficialPreset[] = [
  { key: 'deepseek', label: 'DeepSeek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', official_kind: 'openai-compat', hint: 'platform.deepseek.com 拿 key' },
  { key: 'minimax', label: 'MiniMax', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', official_kind: 'openai', supports_vision: true, supports_web_search: true, hint: 'platform.minimaxi.com 拿 key（M 系多模态 + 原生联网）' },
  { key: 'kimi', label: 'Kimi（Moonshot）', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', official_kind: 'openai-compat', supports_vision: true, supports_web_search: true, hint: 'platform.moonshot.cn 拿 key' },
  { key: 'zhipu', label: '智谱 GLM', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', official_kind: 'openai-compat', supports_vision: true, supports_web_search: true, hint: 'bigmodel.cn 拿 key' },
  { key: 'qwen', label: '通义千问', name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', official_kind: 'openai-compat', supports_vision: true, hint: 'dashscope 兼容模式' },
  { key: 'openai', label: 'OpenAI', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', official_kind: 'openai', supports_vision: true, hint: 'platform.openai.com 拿 key' },
  { key: 'anthropic', label: 'Anthropic Claude', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', official_kind: 'anthropic', supports_vision: true, hint: 'console.anthropic.com 拿 key' },
  { key: 'gemini', label: 'Google Gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', official_kind: 'gemini', supports_vision: true, hint: 'aistudio.google.com 拿 key' }
];

/** 暴露给父级（弹窗顶部「保存」按钮）的命令式句柄。 */
export interface ProviderEditorHandle {
  save: () => Promise<void>;
}

const ProviderEditor = forwardRef<
  ProviderEditorHandle,
  {
    planId: number;
    /** 该中转站名下已有配置（按 base_url 聚合），新建中转站时为空 */
    existing: ApiConfig[];
    /** 初始展开/启用哪一类块（从「+ 补能力」进入时） */
    focus?: ConfigType;
    /** 新建时的分类默认（官方直连 true / 第三方 false）；编辑已有站则按现状判定 */
    officialDefault?: boolean;
    onSaved: () => Promise<void>;
    onCancel: () => void;
    /** busy 变化上报给父级（顶部保存按钮据此禁用 / 显示「保存中…」） */
    onBusyChange?: (busy: boolean) => void;
  }
>(function ProviderEditor({ planId, existing, focus, officialDefault, onSaved, onBusyChange }, ref): JSX.Element {
  const head = existing[0];
  const [name, setName] = useState(head?.provider_name ?? '');
  const [baseUrl, setBaseUrl] = useState(head?.base_url ?? '');
  const [apiKey, setApiKey] = useState(head?.api_key_plain ?? '');
  const [icon, setIcon] = useState<string | null>(head?.icon ?? null);
  const [showKey, setShowKey] = useState(true);
  // 官方直连标记：编辑已有站按域名/标志判定；新建用传入的分类默认（两个新建按钮分别 true/false）
  const [official, setOfficial] = useState<boolean>(
    head ? providerKind(head.base_url, head.is_official) === 'official' : (officialDefault ?? false)
  );
  // 自定义请求头（整站共用，写到该站每条配置）：JSON 文本 + 折叠 + 本地校验
  const [headerOverrides, setHeaderOverrides] = useState<string>(head?.header_overrides_json ?? '');
  const [headerErr, setHeaderErr] = useState<string | null>(null);
  const [headerOpen, setHeaderOpen] = useState<boolean>(!!(head?.header_overrides_json ?? '').trim());
  const [blocks, setBlocks] = useState<Record<ConfigType, ModelBlockState>>(() => {
    const init = {} as Record<ConfigType, ModelBlockState>;
    for (const t of BLOCK_ORDER) {
      const cfg = existing.find((c) => c.type === t);
      init[t] = cfg ? blockFromConfig(cfg) : emptyBlock();
      if (focus === t) init[t].enabled = true;
    }
    return init;
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [detected, setDetected] = useState<string[]>([]);
  // 「按模型原生协议路由」的中转返回的「实际模型 ID → 协议数组」，用于指派模型时自动判定对话协议
  const [detectedProtocols, setDetectedProtocols] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  // 官方直连一键预设：默认收起（平时缩进去，需要才展开）
  const [presetsOpen, setPresetsOpen] = useState(false);

  // 跨块去重：已指派到任一块的上游模型 ID，不再出现在其它块的「+ 指派」候选里
  // （用户期望「已添加的在下一个块就不显示」，避免同一上游模型误指派到多个块）。
  const assignedAll = useMemo(() => {
    const s = new Set<string>();
    for (const t of BLOCK_ORDER) for (const v of Object.values(blocks[t].model_mapping)) if (v) s.add(v);
    return s;
  }, [blocks]);

  // 同类型重复配置（每类多于一条，如截图里「视频」出现两行）：保留第一条编辑，
  // 其余在保存时一并删除（合并为每类一条），杜绝三合一编辑器静默只改第一条、留孤儿。
  const dupExtraIds = useMemo(() => {
    const ids: number[] = [];
    for (const t of BLOCK_ORDER) {
      const ofType = existing.filter((c) => c.type === t);
      for (let i = 1; i < ofType.length; i++) ids.push(ofType[i].id);
    }
    return ids;
  }, [existing]);

  // 把「保存」暴露给父级（弹窗顶部按钮调用）+ 上报 busy 供其禁用/显示「保存中…」
  useImperativeHandle(ref, () => ({ save }));
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  function patchBlock(t: ConfigType, patch: Partial<ModelBlockState>): void {
    setBlocks((b) => ({ ...b, [t]: { ...b[t], ...patch } }));
  }

  /** 一键套用官方直连预设：填 名称/地址 + 启用对话块并预置协议/能力（key 仍需自己填）。 */
  function applyOfficialPreset(p: OfficialPreset): void {
    setName(p.name);
    setBaseUrl(p.baseUrl);
    setOfficial(true);
    setBlocks((b) => ({
      ...b,
      text: {
        ...b.text,
        enabled: true,
        official_kind: p.official_kind,
        supports_vision: !!p.supports_vision,
        supports_web_search: !!p.supports_web_search
      }
    }));
    toast.info('已套用官方预设', `${p.label}：${p.hint}，填上 Key 即可`);
  }

  async function test(): Promise<void> {
    if (!baseUrl.trim()) {
      toast.error('请先填写 Base URL');
      return;
    }
    if (!apiKey.trim()) {
      toast.error('请先填写 API Key');
      return;
    }
    setTesting(true);
    setTestResult(null);
    const firstEnabled = BLOCK_ORDER.find((t) => blocks[t].enabled) ?? 'text';
    const r = await window.electronAPI.settings.testConnection({
      base_url: baseUrl,
      api_key_plain: apiKey,
      type: firstEnabled,
      header_overrides_json: headerOverrides.trim() ? headerOverrides : null
    });
    setTesting(false);
    if (r.ok) {
      const msg = `连通成功，延迟 ${r.data.latency_ms}ms${
        r.data.models?.length ? `，发现 ${r.data.models.length} 个模型` : ''
      }`;
      setTestResult({ ok: true, message: msg });
      setDetected(r.data.models ?? []);
      setDetectedProtocols(r.data.model_protocols ?? {});
      toast.success('测试连通成功', msg);
    } else {
      setTestResult({ ok: false, message: r.error.message });
      toast.error('测试连通失败', r.error.message);
    }
  }

  async function save(): Promise<void> {
    if (busy) return; // 防重入：异步保存期间忽略再次触发（狂按 Enter）
    if (!name.trim()) {
      toast.error('请填写中转站/官方名称');
      return;
    }
    const enabledTypes = BLOCK_ORDER.filter((t) => blocks[t].enabled);
    if (enabledTypes.length === 0) {
      toast.error('请至少启用一类模型', '点对话/绘画/视频块的标题即可启用');
      return;
    }
    // 本地内嵌模型（仅对话 + local 协议）不需要 base_url / 在线 Key
    const localOnly =
      enabledTypes.length === 1 && enabledTypes[0] === 'text' && blocks.text.official_kind === 'local';
    if (!baseUrl.trim() && !localOnly) {
      toast.error('请填写 Base URL');
      return;
    }
    for (const t of enabledTypes) {
      if (Object.keys(blocks[t].model_mapping).length === 0) {
        toast.error(`「${CONFIG_TYPE_META[t].label}」还没有模型映射`, '请添加至少一个模型，或关闭该类');
        return;
      }
    }
    const sharedKey = apiKey.trim() || (localOnly ? 'local' : '');
    const hasNewBlock = enabledTypes.some((t) => blocks[t].existingId == null);
    if (hasNewBlock && !sharedKey) {
      toast.error('请填写 API Key');
      return;
    }
    const configs: ApiConfigInput[] = enabledTypes.map((t) => {
      const b = blocks[t];
      // 共享 Key 非空就用它（一并写到三块）；编辑且解密失败留空时回退该块原 Key，避免误清
      const keyForBlock = sharedKey || b.existingKey || '';
      return {
        id: b.existingId,
        plan_id: planId,
        type: t,
        provider_name: name.trim(),
        base_url: baseUrl.trim(),
        api_key_plain: keyForBlock,
        model_mapping: b.model_mapping,
        is_official: official,
        supports_web_search: t === 'text' ? b.supports_web_search : false,
        supports_vision: t === 'text' ? b.supports_vision : false,
        official_kind: t === 'text' ? b.official_kind : null,
        image_kind: t === 'image' ? b.image_kind : null,
        video_kind: t === 'video' ? b.video_kind : null,
        body_overrides_json: t === 'image' || t === 'video' ? b.body_overrides_json : null,
        header_overrides_json: headerOverrides.trim() ? headerOverrides : null,
        comfyui_workflow_json: t === 'image' ? b.comfyui_workflow_json : null,
        local_model_path: t === 'text' ? b.local_model_path : null,
        supports_thinking: t === 'text' ? b.supports_thinking : false,
        thinking_effort: t === 'text' ? b.thinking_effort : null,
        icon
      };
    });
    // 原本存在但现在关掉的块 → 删除其配置；同类型重复配置的多余条 → 一并删除（合并为每类一条）
    const toDelete: number[] = [];
    for (const t of BLOCK_ORDER) {
      if (!blocks[t].enabled && blocks[t].existingId != null) toDelete.push(blocks[t].existingId as number);
    }
    for (const id of dupExtraIds) if (!toDelete.includes(id)) toDelete.push(id);
    setBusy(true);
    const r = await window.electronAPI.settings.save({ configs });
    if (r.ok) {
      for (const id of toDelete) {
        const dr = await window.electronAPI.plan.configDelete(id);
        if (!dr.ok) {
          toast.error('删除失败', dr.error.message);
          break;
        }
      }
    }
    setBusy(false);
    if (r.ok) {
      await onSaved();
      toast.success(existing.length ? '已更新中转站' : '已保存中转站', `${name.trim()} · ${enabledTypes.length} 类模型`);
    } else {
      toast.error('保存失败', r.error.message);
    }
  }

  function onEditorKeyDown(e: React.KeyboardEvent): void {
    // 按 Enter 自动保存（纯 Enter；IME 组字 / Shift+Enter 不触发）
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    if (el instanceof HTMLTextAreaElement) return; // 多行框（JSON 覆盖 / 请求头）= 换行
    if (el instanceof HTMLSelectElement) return; // 下拉框 Enter = 选中菜单项，保持原生行为
    if (el.closest('.mb-mapping-add, .mb-mapping-list, .mb-mapping-row')) return; // 模型映射输入自有 Enter 语义
    if (el.tagName === 'BUTTON') return; // 按钮上的 Enter = 点击它
    e.preventDefault();
    void save();
  }

  return (
    <div className="mb-config-form mb-provider-editor" onKeyDown={onEditorKeyDown}>
      {existing.length === 0 && (
        <div className="mb-pe-presets-wrap">
          <button type="button" className="mb-pe-presets-toggle" onClick={() => setPresetsOpen((v) => !v)}>
            <span>🏢 官方直连一键预设（点一下自动填地址/协议/能力，只补 Key）</span>
            <span className="mb-snippet-paste-chevron">{presetsOpen ? '▲' : '▼'}</span>
          </button>
          {presetsOpen && (
            <div className="mb-pe-presets">
              {OFFICIAL_PRESETS.map((p) => (
                <button key={p.key} type="button" className="mb-pe-preset-chip" title={p.hint} onClick={() => applyOfficialPreset(p)}>
                  {p.label}
                </button>
              ))}
              <span className="mb-field-hint" style={{ flexBasis: '100%', marginTop: 2 }}>
                点一下自动填 地址 + 协议 + 能力，你只要补 Key；也可手填任意第三方中转站。
              </span>
            </div>
          )}
        </div>
      )}

      <Field label="中转站 / 官方名称（右侧选择分类，可随时改）">
        <div className="mb-icon-and-name-row">
          <IconPickerButton value={icon} fallbackHint={{ providerName: name, baseUrl }} onChange={setIcon} />
          <input
            className="mb-input mb-pe-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：OpenAI 官方 / 我的中转站"
          />
          <div className="mb-pe-cat" role="group" aria-label="分类">
            <button
              type="button"
              className={`mb-pe-cat-btn ${official ? 'is-active' : ''}`}
              onClick={() => setOfficial(true)}
              title="归到「官方直连」区（官网直连：MiniMax / DeepSeek / OpenAI …）"
            >
              🏢 官方直连
            </button>
            <button
              type="button"
              className={`mb-pe-cat-btn ${!official ? 'is-active' : ''}`}
              onClick={() => setOfficial(false)}
              title="归到「第三方中转站」区（聚合 / 代理站点）"
            >
              🔁 第三方
            </button>
          </div>
        </div>
      </Field>

      <div className="mb-pe-shared-row">
        <Field label="API 调用地址（base_url）">
          <input
            className="mb-input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </Field>
        <Field label="API Key（对话/绘画/视频共用）">
          <div className="mb-key-input-wrap">
            <input
              type={showKey ? 'text' : 'password'}
              className="mb-input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
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
        {/* 测试连接 + 拉取模型 紧跟在 地址 / Key 之后（与输入框底对齐） */}
        <div className="mb-pe-testcol">
          <button className="mb-btn mb-btn-secondary" onClick={test} disabled={testing || busy}>
            {testing ? '测试中…' : '🔍 测试连接 + 拉取模型'}
          </button>
        </div>
      </div>

      {(testResult || detected.length > 0) && (
        <div className="mb-pe-testresult">
          {testResult && (
            <span className={`mb-test-result ${testResult.ok ? 'is-ok' : 'is-fail'}`}>
              {testResult.ok ? <CheckIcon size={14} /> : null}
              {testResult.message}
            </span>
          )}
          {detected.length > 0 && (
            <span className="mb-field-hint">已拉到 {detected.length} 个上游模型——下面各块点「+ 模型」即可指派（已指派的不再重复出现）</span>
          )}
        </div>
      )}

      {dupExtraIds.length > 0 && (
        <div className="mb-field-hint" style={{ color: 'var(--mb-warning, #b8860b)', marginBottom: 8 }}>
          ⚠ 检测到 {dupExtraIds.length} 条同类型重复配置（如「视频」出现多条）。保存后将自动合并为每类一条，多余的会被删除。
        </div>
      )}

      <div className="mb-pe-advanced" style={{ marginBottom: 10 }}>
        <button type="button" className="mb-snippet-paste-toggle" onClick={() => setHeaderOpen((v) => !v)}>
          高级：自定义请求头 / 鉴权（绝大多数中转站无需设置，看不懂可跳过）
          <span className="mb-snippet-paste-chevron">{headerOpen ? '▲' : '▼'}</span>
        </button>
        {headerOpen && (
          <>
            <textarea
              className="mb-textarea"
              rows={4}
              spellCheck={false}
              placeholder={'{\n  "Authorization": "Token ${key}"\n}'}
              value={headerOverrides}
              onChange={(e) => {
                setHeaderOverrides(e.target.value);
                setHeaderErr(null);
              }}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (!v) {
                  setHeaderErr(null);
                  return;
                }
                try {
                  const p = JSON.parse(v) as unknown;
                  if (typeof p !== 'object' || p === null || Array.isArray(p)) setHeaderErr('必须是 JSON 对象（header 名 → 值）');
                  else setHeaderErr(null);
                } catch (err) {
                  setHeaderErr(`JSON 解析失败：${(err as Error).message}`);
                }
              }}
            />
            {headerErr && (
              <div className="mb-field-hint" style={{ color: 'var(--mb-danger, #d44)' }}>
                {headerErr}
              </div>
            )}
            <div className="mb-field-hint">
              自定义 HTTP 请求头，合并进默认头（对话 / 绘画 / 视频 都生效，整站共用）。值里 <code>{'${key}'}</code> = 本站 Key、
              <code>{'${model}'}</code> = 实际模型 ID；值写 <code>null</code> 可删掉默认头（如默认的 <code>Authorization</code> 换成别的鉴权方式）。
              常见：<code>{'{"Authorization":"Token ${key}"}'}</code>、<code>{'{"x-api-key":"${key}","Authorization":null}'}</code>。
            </div>
          </>
        )}
      </div>

      <div className="mb-pe-blocks">
        {BLOCK_ORDER.map((t) => (
          <ModelBlock
            key={t}
            type={t}
            block={blocks[t]}
            detected={detected}
            detectedProtocols={detectedProtocols}
            assignedAll={assignedAll}
            onPatch={(p) => patchBlock(t, p)}
            baseUrl={baseUrl}
            apiKey={apiKey}
            headerOverrides={headerOverrides}
            providerName={name}
          />
        ))}
      </div>
      {/* 保存 / 取消 已移到弹窗标题栏右侧（✕ 左边），此处不再重复 */}
    </div>
  );
});

/** 统一编辑器里的一个能力块（对话/绘画/视频）：协议 + 模型映射 + 能力。 */
function ModelBlock({
  type,
  block,
  detected,
  detectedProtocols,
  assignedAll,
  onPatch,
  baseUrl,
  apiKey,
  headerOverrides,
  providerName
}: {
  type: ConfigType;
  block: ModelBlockState;
  detected: string[];
  /** 实际模型 ID → 协议数组（中转声明的 supported_protocols）；用于指派时自动判定对话协议 */
  detectedProtocols: Record<string, string[]>;
  /** 已指派到任一块的上游模型 ID（跨块去重用） */
  assignedAll: Set<string>;
  onPatch: (patch: Partial<ModelBlockState>) => void;
  baseUrl: string;
  apiKey: string;
  headerOverrides: string;
  providerName: string;
}): JSX.Element {
  const meta = CONFIG_TYPE_META[type];
  const [draftKey, setDraftKey] = useState('');
  const [draftVal, setDraftVal] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [bodyErr, setBodyErr] = useState<string | null>(null);
  const [detectingCaps, setDetectingCaps] = useState(false);
  const [testingProto, setTestingProto] = useState(false);
  const [protoResult, setProtoResult] = useState<{ ok: boolean; skipped?: boolean; message: string; detail?: string } | null>(null);
  // 折叠态（独立于启用态）：已配置过的块（从中转站载入）默认折叠成一条，保持启用；
  // 新启用的块默认展开。用户可手动折叠/展开而不改启用状态。
  const [collapsed, setCollapsed] = useState<boolean>(!!block.existingId);

  function toggleEnabled(): void {
    const next = !block.enabled;
    onPatch({ enabled: next });
    if (next) setCollapsed(false); // 刚启用 → 自动展开方便填写
  }

  const mapping = block.model_mapping;
  const mappingCount = Object.keys(mapping).length;
  const setMapping = (next: Record<string, string>): void => onPatch({ model_mapping: next });

  function addMapping(): void {
    if (!draftKey.trim() || !draftVal.trim()) {
      toast.error('显示名和实际模型 ID 都不能为空');
      return;
    }
    setMapping({ ...mapping, [draftKey.trim()]: draftVal.trim() });
    setDraftKey('');
    setDraftVal('');
  }
  function removeMapping(k: string): void {
    const n = { ...mapping };
    delete n[k];
    setMapping(n);
  }
  function renameMapping(oldKey: string, newKey: string, newVal: string): boolean {
    const tk = newKey.trim();
    const tv = newVal.trim();
    if (!tk) {
      toast.error('显示名不能为空');
      return false;
    }
    if (!tv) {
      toast.error('实际模型 ID 不能为空');
      return false;
    }
    if (tk !== oldKey && mapping[tk] !== undefined) {
      toast.error('显示名已存在', `已有「${tk}」，请换一个`);
      return false;
    }
    const n: Record<string, string> = {};
    for (const [k, v] of Object.entries(mapping)) {
      if (k === oldKey) n[tk] = tv;
      else n[k] = v;
    }
    setMapping(n);
    return true;
  }
  function addDetected(id: string): void {
    let dn = id;
    let k = 2;
    while (mapping[dn]) dn = `${id} (${k++})`;
    setMapping({ ...mapping, [dn]: id });
    // 按模型原生协议自动回填「对话 API 协议」（仅对话块）：messages→Anthropic 可用；gemini/responses 明确警告不支持
    if (type === 'text') {
      const protos = detectedProtocols[id];
      if (protos && protos.length) {
        const m = protocolToOfficialKind(protos);
        if (m.supported) {
          if (m.kind !== block.official_kind) {
            onPatch({ official_kind: m.kind });
            const label = OFFICIAL_KINDS.find((x) => x.value === m.kind)?.label ?? String(m.kind);
            toast.success('已自动匹配对话协议', `「${id}」走 ${m.badge ?? '原生'} 协议，已切到「${label}」`);
          }
        } else {
          toast.error('该模型暂不能在梦笔对话里使用', m.reason ?? `协议 ${protos.join('/')} 未支持`);
        }
      }
    }
  }

  async function detectCaps(): Promise<void> {
    let ids = Object.values(mapping).filter(Boolean);
    if (ids.length === 0 && baseUrl.trim() && apiKey.trim()) {
      setDetectingCaps(true);
      const r = await window.electronAPI.settings.testConnection({
        base_url: baseUrl,
        api_key_plain: apiKey,
        type: 'text',
        header_overrides_json: headerOverrides.trim() ? headerOverrides : null
      });
      setDetectingCaps(false);
      if (r.ok) ids = r.data.models ?? [];
    }
    if (ids.length === 0) {
      toast.error('先加模型映射，或在上方填好地址/Key 测试连接');
      return;
    }
    const caps = detectModelCapabilities(ids);
    onPatch({
      supports_vision: caps.vision,
      supports_thinking: caps.thinking,
      supports_web_search: caps.webSearch || block.supports_web_search,
      thinking_effort: caps.thinking ? block.thinking_effort ?? caps.thinkingEffort ?? 'high' : block.thinking_effort
    });
    toast.success('已识别能力', `${summarizeCapabilities(caps)}（可手动微调）`);
  }

  // 候选：上游模型里去掉「已指派到任一块」的实际 ID（跨块去重——已添加的不再出现在下一个块）
  const blockDetected = detected.filter((m) => !assignedAll.has(m));

  async function testProtocol(): Promise<void> {
    const firstModel = Object.values(mapping)[0];
    if (!firstModel) {
      toast.error('先在本块加一个模型映射', '协议测试需要一个实际模型 ID');
      return;
    }
    if (!baseUrl.trim() || !apiKey.trim()) {
      toast.error('请先填好 地址 与 API Key');
      return;
    }
    setTestingProto(true);
    setProtoResult(null);
    const r = await window.electronAPI.settings.testProtocol({
      base_url: baseUrl,
      api_key_plain: apiKey,
      type,
      model_id: firstModel,
      official_kind: type === 'text' ? block.official_kind : null,
      image_kind: type === 'image' ? block.image_kind : null,
      body_overrides_json: type === 'image' || type === 'video' ? block.body_overrides_json : null,
      header_overrides_json: headerOverrides.trim() ? headerOverrides : null
    });
    setTestingProto(false);
    if (r.ok) {
      setProtoResult(r.data);
      if (r.data.ok) toast.success('协议测试通过', r.data.message);
      else if (r.data.skipped) toast.info('未做协议测试', r.data.message);
      else toast.error('协议测试失败', r.data.message);
    } else {
      setProtoResult({ ok: false, message: r.error.message });
      toast.error('协议测试失败', r.error.message);
    }
  }

  return (
    <div className={`mb-pe-block ${block.enabled ? 'is-on' : ''}`}>
      <div className="mb-pe-block-head">
        <button
          type="button"
          className="mb-pe-block-headmain"
          onClick={() => (block.enabled ? setCollapsed((c) => !c) : toggleEnabled())}
          title={block.enabled ? (collapsed ? '展开本类设置' : '折叠本类设置（仍保持启用）') : '点此启用本类'}
        >
          <span className="mb-pe-block-ico">{meta.icon}</span>
          <span className="mb-pe-block-title">{meta.label}模型</span>
          {block.enabled && mappingCount > 0 && <span className="mb-pe-block-count">{mappingCount} 模型</span>}
          {block.enabled && collapsed && <span className="mb-pe-block-state">已启用 · 已折叠</span>}
        </button>
        <div className="mb-pe-block-ctl">
          {block.enabled && (
            <button
              type="button"
              className="mb-pe-collapse"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? '展开' : '折叠'}
            >
              {collapsed ? '▸' : '▾'}
            </button>
          )}
          <SwitchControl
            checked={block.enabled}
            onChange={() => toggleEnabled()}
            title={block.enabled ? '关闭本类（保存时会删除该类配置）' : '启用本类'}
          />
        </div>
      </div>

      {block.enabled && !collapsed && (
        <div className="mb-pe-block-body">
          {type === 'text' && (
            <Field label="对话 API 协议">
              <select
                className="mb-select"
                value={block.official_kind ?? ''}
                onChange={(e) => onPatch({ official_kind: (e.target.value || null) as OfficialKind })}
              >
                {OFFICIAL_KINDS.map((k) => (
                  <option key={k.value ?? 'none'} value={k.value ?? ''}>
                    {k.label}
                  </option>
                ))}
              </select>
              <div className="mb-field-hint">
                {OFFICIAL_KINDS.find((k) => k.value === (block.official_kind ?? null))?.hint}
              </div>
            </Field>
          )}
          {type === 'image' && (
            <Field label="绘图 API 协议">
              <select
                className="mb-select"
                value={block.image_kind ?? ''}
                onChange={(e) => onPatch({ image_kind: (e.target.value || null) as ImageKind })}
              >
                {IMAGE_KINDS.map((k) => (
                  <option key={k.value ?? 'openai'} value={k.value ?? ''}>
                    {k.label}
                  </option>
                ))}
              </select>
              <div className="mb-field-hint">
                {IMAGE_KINDS.find((k) => k.value === (block.image_kind ?? null))?.hint}
              </div>
            </Field>
          )}
          {type === 'video' && (
            <Field label="视频 API 协议（拿不准就先默认，运行时会按地址/模型自动匹配）">
              <select
                className="mb-select"
                value={block.video_kind ?? 'kling'}
                onChange={(e) => onPatch({ video_kind: e.target.value as VideoKind })}
              >
                {VIDEO_KINDS.map((k) => (
                  <option key={k.value ?? 'kling'} value={k.value ?? 'kling'}>
                    {k.label}
                  </option>
                ))}
              </select>
              {(() => {
                const firstActual = Object.values(mapping)[0];
                const sug = suggestVideoKind(baseUrl ?? '', firstActual);
                const cur = block.video_kind ?? 'kling';
                if (!sug || sug === cur) return null;
                return (
                  <div className="mb-field-hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>
                      该 地址/模型 更像 <b>{VIDEO_KINDS.find((k) => k.value === sug)?.label ?? sug}</b>
                    </span>
                    <button className="mb-btn mb-btn-sm" onClick={() => onPatch({ video_kind: sug })}>
                      一键采用
                    </button>
                  </div>
                );
              })()}
              <div className="mb-field-hint">
                {VIDEO_KINDS.find((k) => k.value === (block.video_kind ?? 'kling'))?.hint}
              </div>
            </Field>
          )}

          {type === 'text' && block.official_kind === 'local' && (
            <Field label="本地模型文件（.gguf）">
              <input
                className="mb-input"
                value={block.local_model_path ?? ''}
                onChange={(e) => onPatch({ local_model_path: e.target.value || null })}
                placeholder="C:\\models\\xxx.gguf"
              />
              <div className="mb-field-hint">本地协议需 .gguf 路径；要选择文件请用行内单项编辑器。</div>
            </Field>
          )}

          <Field label={`模型映射（${mappingCount}）`}>
            <div className="mb-mapping-head">
              <span>显示名（带「{providerName || '中转站'} / 」前缀）</span>
              <span>实际模型 ID</span>
            </div>
            <div className="mb-mapping-list">
              {Object.entries(mapping).map(([k, v]) => (
                <MappingRow
                  key={k}
                  displayName={k}
                  actualId={v}
                  onRename={(nk, nv) => renameMapping(k, nk, nv)}
                  onRemove={() => removeMapping(k)}
                />
              ))}
            </div>
            <div className="mb-mapping-add">
              <input
                className="mb-input"
                placeholder="显示名"
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
              />
              <input
                className="mb-input"
                placeholder="实际模型 ID"
                value={draftVal}
                onChange={(e) => setDraftVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addMapping();
                }}
              />
              <button className="mb-btn mb-btn-secondary mb-btn-sm" onClick={addMapping}>
                <PlusIcon size={14} /> 添加
              </button>
            </div>
            {blockDetected.length > 0 && (
              <div className="mb-pe-detected">
                <span className="mb-field-hint">从上游模型指派（{blockDetected.length}，全部可选，多了可滚动）：</span>
                <div className="mb-pe-detected-chips">
                  {/* 全部展示（不再截断 40 个），容器可滚动 */}
                  {blockDetected.map((m) => {
                    const protos = detectedProtocols[m];
                    const badge = protos?.length ? protocolToOfficialKind(protos).badge : undefined;
                    const titleProto = protos?.length ? `（协议：${protos.join('/')}）` : '';
                    return (
                      <button
                        key={m}
                        className="mb-pe-chip"
                        title={`${describeUpstreamModel(m)}${titleProto}`}
                        onClick={() => addDetected(m)}
                      >
                        + {m}
                        {badge && <span style={{ marginLeft: 6, fontSize: '10px', opacity: 0.6 }}>{badge}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </Field>

          <div className="mb-config-capsbar">
            <button
              className="mb-btn mb-btn-secondary mb-btn-sm"
              onClick={() => void testProtocol()}
              disabled={testingProto}
              title={
                type === 'text'
                  ? '真实发一次最小对话调用（max_tokens:1，近乎免费），验证协议/请求头/模型是否能跑'
                  : type === 'image'
                    ? '真实生成一张 1024 测试图（绘画模型可能产生少量费用），捕获 response_format 等字段被拒'
                    : '视频为异步按量计费，不做一键测试（点击会给出说明）'
              }
            >
              {testingProto ? '测试中…' : '🧪 测试协议（真实调用一次）'}
            </button>
            <span className="mb-config-capsbar-hint">
              {type === 'image' ? '会真实出 1 张图，可能产生少量费用' : type === 'text' ? '近乎免费' : '视频不做真实调用'}
            </span>
          </div>
          {protoResult && (
            <div
              className="mb-field-hint"
              style={{ color: protoResult.ok ? 'var(--mb-success, #2a8)' : protoResult.skipped ? undefined : 'var(--mb-danger, #d44)' }}
            >
              {protoResult.ok ? '✓ ' : protoResult.skipped ? 'ℹ ' : '✗ '}
              {protoResult.message}
              {protoResult.detail && (
                <pre
                  style={{
                    marginTop: 6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: 140,
                    overflow: 'auto',
                    fontSize: 11,
                    opacity: 0.8
                  }}
                >
                  {protoResult.detail}
                </pre>
              )}
            </div>
          )}

          {type === 'text' && (
            <>
              <div className="mb-config-capsbar">
                <button
                  className="mb-btn mb-btn-secondary mb-btn-sm"
                  onClick={() => void detectCaps()}
                  disabled={detectingCaps}
                  title="按真实模型 ID 自动判断：多模态 / 思考 / 原生联网"
                >
                  {detectingCaps ? '识别中…' : '✨ 自动识别能力'}
                </button>
                <span className="mb-config-capsbar-hint">按模型 ID 判断 多模态/思考/联网</span>
              </div>
              <div className="mb-config-toggles">
                <Toggle
                  label="原生联网搜索"
                  value={block.supports_web_search}
                  onChange={(v) => onPatch({ supports_web_search: v })}
                />
                <Toggle label="vision 多模态" value={block.supports_vision} onChange={(v) => onPatch({ supports_vision: v })} />
                <Toggle label="思考模式" value={block.supports_thinking} onChange={(v) => onPatch({ supports_thinking: v })} />
              </div>
              {block.supports_thinking && (
                <Field label="思考强度">
                  <select
                    className="mb-select"
                    value={block.thinking_effort ?? ''}
                    onChange={(e) =>
                      onPatch({ thinking_effort: (e.target.value || null) as 'low' | 'medium' | 'high' | 'max' | null })
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
            </>
          )}

          {(type === 'image' || type === 'video') && (
            <div className="mb-pe-advanced">
              <button type="button" className="mb-snippet-paste-toggle" onClick={() => setAdvancedOpen((v) => !v)}>
                高级：请求体覆盖（绝大多数中转站无需设置，看不懂可跳过）
                <span className="mb-snippet-paste-chevron">{advancedOpen ? '▲' : '▼'}</span>
              </button>
              {advancedOpen && (
                <>
                  <textarea
                    className="mb-textarea"
                    rows={4}
                    spellCheck={false}
                    placeholder={'{\n  "response_format": null\n}'}
                    value={block.body_overrides_json ?? ''}
                    onChange={(e) => {
                      onPatch({ body_overrides_json: e.target.value === '' ? null : e.target.value });
                      setBodyErr(null);
                    }}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (!v) {
                        setBodyErr(null);
                        return;
                      }
                      try {
                        const p = JSON.parse(v) as unknown;
                        if (typeof p !== 'object' || p === null || Array.isArray(p)) setBodyErr('必须是 JSON 对象');
                        else setBodyErr(null);
                      } catch (err) {
                        setBodyErr(`JSON 解析失败：${(err as Error).message}`);
                      }
                    }}
                  />
                  {bodyErr && (
                    <div className="mb-field-hint" style={{ color: 'var(--mb-danger, #d44)' }}>
                      {bodyErr}
                    </div>
                  )}
                  <div className="mb-field-hint">
                    与默认请求体顶层合并发出，<code>null</code> 值表示删除该字段。
                    {type === 'video' ? '各站视频字段差异用它兜底。' : ''}
                  </div>
                  <button
                    type="button"
                    className="mb-btn mb-btn-secondary mb-btn-sm"
                    style={{ marginTop: 6 }}
                    onClick={() => {
                      onPatch({ body_overrides_json: '{\n  "response_format": null\n}' });
                      setBodyErr(null);
                    }}
                    title="部分中转站（如 LiteLLM 代理）不支持 response_format，会报 400 UnsupportedParamsError——一键屏蔽它"
                  >
                    一键填：屏蔽 response_format（修复部分中转站 400/500）
                  </button>
                </>
              )}
            </div>
          )}
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
 * 设置分区卡片：图标 + 标题 + 说明 + 内容，给各设置页清晰的区域划分。
 * - id：与 SETTINGS_INDEX 登记一致，供快捷条 / 搜索 scrollIntoView 定位
 * - icon：标题左侧小线条图标（settingsIcons.tsx）
 * - wide：内容天然很宽的分区占满整行（grid-column: 1/-1）
 */
function SettingsSection({
  id,
  icon,
  title,
  desc,
  wide,
  children
}: {
  id?: string;
  icon?: JSX.Element;
  title: string;
  desc?: string;
  wide?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section id={id} className={`mb-settings-card mb-card ${wide ? 'is-wide' : ''}`}>
      <div className="mb-settings-card-head">
        {icon && <span className="mb-settings-card-icon">{icon}</span>}
        <div className="mb-settings-card-titles">
          <span className="mb-settings-card-title">{title}</span>
          {desc && <span className="mb-settings-card-desc">{desc}</span>}
        </div>
      </div>
      <div className="mb-settings-card-body">{children}</div>
    </section>
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
        <ProviderIcon value={effective} name={fallbackHint.providerName} size={36} radius={9} />
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
                <ProviderIcon value={null} name={fallbackHint.providerName} size={36} radius={9} title="自动" />
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
      {!usingExternal && <LocalLlmGpuLayersField running={status.running} onStop={stopServer} />}
    </>
  );
}

/** 本地模型 GPU 层数（全局 pref `local_llm_gpu_layers`）：层数越高推理越快、但越挤占界面 GPU。 */
function LocalLlmGpuLayersField({ running, onStop }: { running: boolean; onStop: () => Promise<void> }): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const [draftVal, setDraftVal] = useState(prefs.local_llm_gpu_layers ?? '');
  useEffect(() => {
    setDraftVal(prefs.local_llm_gpu_layers ?? '');
  }, [prefs.local_llm_gpu_layers]);

  async function commit(): Promise<void> {
    const t = draftVal.trim();
    // 空 = 自动；否则 clamp [0, 999]
    const v = t === '' ? '' : String(Math.max(0, Math.min(999, Math.trunc(Number(t) || 0))));
    setDraftVal(v);
    const r = await window.electronAPI.settings.save({ prefs: { local_llm_gpu_layers: v } });
    if (r.ok) {
      await load();
      toast.success('已保存 GPU 层数', running ? '先「停止当前内嵌服务」，下次对话重新加载后生效' : '下次加载模型时生效');
    } else toast.error('保存失败', r.error.message);
  }

  return (
    <Field label="GPU 层数（显卡占用控制）">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          className="mb-input"
          style={{ width: 120 }}
          value={draftVal}
          placeholder="自动"
          onChange={(e) => setDraftVal(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        {running && (
          <button type="button" className="mb-btn mb-btn-ghost mb-btn-sm" onClick={() => void onStop()}>
            停止以应用新值
          </button>
        )}
      </div>
      <div className="mb-field-hint">
        放到显卡的模型层数：留空 = 自动（最快，但推理时界面可能变卡）；<b>0 = 纯 CPU</b>（最慢，完全不抢界面显卡）；
        填小一点的正整数（如 20）= 推理与界面分摊显卡。换值需重新加载模型（停止服务后下次对话生效）。
      </div>
    </Field>
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
  const {
    atmosphere, palette, setAtmosphere, setPalette, flowColor, setFlowColor, appZoom, setAppZoom,
    perfMode, setPerfMode, cursorStyle, setCursorStyle, cursorSize, setCursorSize
  } = useThemeStore();
  const haloStyle = useCursorHaloStore((s) => s.style);
  const setHaloStyle = useCursorHaloStore((s) => s.setStyle);
  // 光标样式预览图（固定 26px 预览，与实际光标 SVG 同源；只算一次）
  const cursorPreviews = useMemo(
    () => CURSOR_STYLES.map((c) => ({ id: c.id, arrow: c.arrow(26).uri, pointer: c.pointer(26).uri })),
    []
  );

  return (
    <div className="mb-settings-pane">
      <header className="mb-settings-pane-header">
        <div>
          <h3>外观</h3>
          <p className="mb-settings-pane-desc">
            10 种材质氛围 × 10 种主题配色，共 100 种组合。
          </p>
        </div>
      </header>

      <div className="mb-settings-grid">
      <SettingsSection
        id="appear-theme"
        icon={<SiPalette size={15} />}
        title="主题外观"
        desc="10 材质氛围 × 10 主题配色，共 100 组合"
        wide
      >
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

      </SettingsSection>

      <SettingsSection
        id="appear-zoom"
        icon={<SiMonitor size={15} />}
        title="显示与缩放"
        desc="整窗界面缩放（webFrame）"
      >
      <Field label="界面缩放">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="mb-btn mb-btn-sm mb-btn-ghost"
            onClick={() => setAppZoom(appZoom - 0.1)}
            title="缩小界面（Ctrl −）"
          >
            −
          </button>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={appZoom}
            onChange={(e) => setAppZoom(Number(e.target.value))}
            style={{ flex: 1, minWidth: 160, maxWidth: 260 }}
            title="整窗界面缩放"
          />
          <button
            type="button"
            className="mb-btn mb-btn-sm mb-btn-ghost"
            onClick={() => setAppZoom(appZoom + 0.1)}
            title="放大界面（Ctrl +）"
          >
            +
          </button>
          <span style={{ fontWeight: 700, minWidth: 48, textAlign: 'center' }}>
            {Math.round(appZoom * 100)}%
          </span>
          <button
            type="button"
            className={`mb-btn mb-btn-sm ${appZoom === 1 ? 'is-active' : 'mb-btn-ghost'}`}
            onClick={() => setAppZoom(1)}
            title="复位 100%（Ctrl 0）"
          >
            复位
          </button>
        </div>
        <span className="mb-appearance-flow-hint">
          整窗界面缩放（webFrame）。快捷键：Ctrl + 放大 / Ctrl − 缩小 / Ctrl 0 复位（画板页这些键用于缩放画布）。
        </span>
      </Field>

      </SettingsSection>

      <SettingsSection
        id="appear-perf"
        icon={<SiGauge size={15} />}
        title="性能模式"
        desc="动效开销控制，立即生效"
      >
      <Field label="性能模式">
        <div className="mb-appearance-halos">
          <motion.button
            type="button"
            onClick={() => setPerfMode('normal')}
            className={`mb-appearance-halo ${perfMode === 'normal' ? 'is-active' : ''}`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="mb-appearance-halo-label">完整动效</span>
            <span className="mb-appearance-halo-desc">星辰 / 流星 / 光晕 / 页面过渡 / 连线流动全开，视觉效果最佳</span>
          </motion.button>
          <motion.button
            type="button"
            onClick={() => {
              setPerfMode('low');
              toast.info('已开启低配模式', '装饰动画与页面过渡已停（进度条/加载指示不受影响），立即生效');
            }}
            className={`mb-appearance-halo ${perfMode === 'low' ? 'is-active' : ''}`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span className="mb-appearance-halo-label">低配模式</span>
            <span className="mb-appearance-halo-desc">停 装饰动画（流星/星辰/光晕）+ 页面切换过渡 + 智能画布连线流动 → 降 GPU 占用、改善掉帧</span>
          </motion.button>
        </div>
        <div className="mb-field-hint">
          影响范围：装饰动画、页面切换过渡、智能画布连线流动动画。进度条与加载指示永远保留。无需重启，立即生效；本地大模型推理时会自动临时降效（推理完恢复）。
        </div>
      </Field>

      </SettingsSection>

      <SettingsSection
        id="appear-canvas"
        icon={<SiCursorGlow size={15} />}
        title="智能画布与光标"
        desc="连线流动色 / 鼠标光晕 / 自定义光标"
        wide
      >
      <Field label="智能画布连线流动色">
        <div className="mb-appearance-flow">
          <input
            type="color"
            className="mb-appearance-flow-input"
            value={flowColor || '#7c8cff'}
            onChange={(e) => setFlowColor(e.target.value)}
            title="智能画布里彩色流动连线的颜色"
          />
          <button
            type="button"
            className={`mb-btn mb-btn-sm ${flowColor ? 'mb-btn-ghost' : 'is-active'}`}
            onClick={() => setFlowColor('')}
          >
            跟随主题强调色
          </button>
          <span className="mb-appearance-flow-hint">智能画布（Ctrl+7）里连线像河流一样流动的颜色</span>
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
          代替原来的「卡片旋转光」——整个 app 共用 1 个跟随鼠标的光晕，多模块同屏时 GPU 占用大幅下降。
          想完全关闭选「关闭」即可。
        </div>
      </Field>

      <Field label="鼠标光标样式">
        <div className="mb-appearance-halos">
          <motion.button
            type="button"
            onClick={() => {
              setCursorStyle(CURSOR_OFF);
              toast.info('已恢复系统光标', '自定义光标已关闭');
            }}
            className={`mb-appearance-halo ${cursorStyle === CURSOR_OFF ? 'is-active' : ''}`}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, fontSize: 18 }}>🖱️</span>
            <span className="mb-appearance-halo-label">系统默认（关闭）</span>
            <span className="mb-appearance-halo-desc">使用操作系统自带的鼠标指针</span>
          </motion.button>
          {CURSOR_STYLES.map((c, i) => {
            const pv = cursorPreviews.find((x) => x.id === c.id);
            return (
              <motion.button
                key={c.id}
                type="button"
                onClick={() => {
                  setCursorStyle(c.id);
                  toast.info('已切换光标', c.label);
                }}
                className={`mb-appearance-halo ${cursorStyle === c.id ? 'is-active' : ''}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28 }}>
                  {pv ? (
                    <>
                      <img src={pv.arrow} width={26} height={26} alt="" draggable={false} />
                      <img src={pv.pointer} width={26} height={26} alt="" draggable={false} />
                    </>
                  ) : null}
                </span>
                <span className="mb-appearance-halo-label">{c.label}</span>
                <span className="mb-appearance-halo-desc">{c.desc}</span>
              </motion.button>
            );
          })}
        </div>
        <div className="mb-field-hint">
          原生 CSS 光标，零延迟跟手，仅在本应用窗口内生效；左图为箭头、右图为点击（手型）指针。
          文本输入框保持系统 I 形光标，画布抓手 / 缩放等功能光标不受影响。
        </div>
      </Field>

      <Field label="光标大小">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="range"
            min={CURSOR_SIZE_MIN}
            max={CURSOR_SIZE_MAX}
            step={1}
            value={cursorSize}
            onChange={(e) => setCursorSize(Number(e.target.value))}
            disabled={cursorStyle === CURSOR_OFF}
            style={{ flex: 1, minWidth: 160, maxWidth: 260 }}
            title="自定义光标大小（箭头与手型一起缩放）"
          />
          <span style={{ fontWeight: 700, minWidth: 48, textAlign: 'center' }}>{cursorSize}px</span>
          <button
            type="button"
            className={`mb-btn mb-btn-sm ${cursorSize === CURSOR_SIZE_DEFAULT ? 'is-active' : 'mb-btn-ghost'}`}
            onClick={() => setCursorSize(CURSOR_SIZE_DEFAULT)}
            disabled={cursorStyle === CURSOR_OFF}
          >
            复位
          </button>
        </div>
        <span className="mb-appearance-flow-hint">
          {CURSOR_SIZE_MIN}–{CURSOR_SIZE_MAX}px，箭头与手型指针一起缩放，实时生效；选「系统默认（关闭）」时此项无效。
        </span>
      </Field>
      </SettingsSection>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// Storage Tab
// ─────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────
// 工具箱 tab：保存路径 + 引擎状态（Real-ESRGAN ncnn）
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

  const toolsPath = prefs.tools_storage_path ?? '(沿用图片存储路径)';
  const autoSave = prefs.tools_auto_save === 'true';

  async function refreshEngineStatus(): Promise<void> {
    const r = await window.electronAPI.upscale.status();
    if (r.ok) {
      setEngineStatus({
        installed: r.data.installed,
        version: r.data.version,
        models: r.data.models,
        enginePath: r.data.enginePath,
        platform: r.data.platform
      });
    }
  }

  useEffect(() => {
    void refreshEngineStatus();
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
      detail: '会删除引擎二进制 + 所有已装模型；矢量化不受影响。',
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
            保真放大（Real-ESRGAN ncnn）+ 矢量化的本地化处理偏好与引擎管理。
          </p>
        </div>
      </header>

      <div className="mb-settings-grid">
      <SettingsSection
        id="tools-output"
        icon={<SiFolderLine size={15} />}
        title="输出与保存"
        desc="工具箱产出目录与自动保存"
      >
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

      </SettingsSection>

      <SettingsSection
        id="tools-realesrgan"
        icon={<SiUpscale size={15} />}
        title="Real-ESRGAN 放大引擎"
        desc="ncnn Vulkan 本地引擎与已装模型"
        wide
      >
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 6,
            flexWrap: 'wrap'
          }}
        >
          <button
            className="mb-btn mb-btn-ghost mb-btn-sm"
            onClick={() => void refreshEngineStatus()}
            title="重新扫描 models 目录(手动放进去新模型后点这个)"
          >
            刷新列表
          </button>
          {engineStatus?.enginePath && (
            <button
              className="mb-btn mb-btn-ghost mb-btn-sm"
              onClick={() =>
                void window.electronAPI.storage.openPath({
                  targetPath: `${engineStatus.enginePath}\\models`,
                  ensureDir: true
                })
              }
              title="打开模型目录,可直接拖入 .bin / .param 文件"
            >
              <FolderIcon size={12} /> 打开 models 目录
            </button>
          )}
          <span className="mb-field-hint" style={{ marginLeft: 'auto', fontSize: 11 }}>
            ncnn 引擎仅识别 .bin + .param 同名成对。.onnx 模型在下方「ONNX 放大模型」分组管理。
          </span>
        </div>
        {(engineStatus?.models.length ?? 0) === 0 ? (
          <div className="mb-field-hint">
            尚未安装引擎或模型。引擎安装时会内置 4 个默认模型,可在工具箱面板单独下载额外模型。
          </div>
        ) : (
          <div className="mb-mapping-list">
            {groupModelsByCategory(engineStatus!.models).map((g) => (
              <div key={g.category} style={{ marginBottom: 6 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--mb-color-text-muted, #888)',
                    padding: '4px 0 2px',
                    letterSpacing: '0.5px'
                  }}
                >
                  【{g.label}】 ({g.items.length})
                </div>
                {g.items.map((m) => {
                  const meta = getUpscaleModelMeta(m.name);
                  return (
                    <div
                      key={m.name}
                      className="mb-mapping-row"
                      title={meta.description}
                    >
                      <code style={{ flex: 1 }}>{m.name}</code>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: 'var(--mb-color-surface-3, rgba(255,255,255,0.06))',
                          color: 'var(--mb-color-text-muted, #888)'
                        }}
                      >
                        {meta.label}
                      </span>
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
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Field>

      </SettingsSection>

      <SettingsSection
        id="tools-onnx"
        icon={<SiBox size={15} />}
        title="ONNX 放大模型"
        desc="onnxruntime-node 主进程，无 Python 依赖"
        wide
      >
      <Field label="ONNX 放大模型(走 onnxruntime-node 主进程,无 Python 依赖)">
        <OnnxModelsField />
      </Field>
      </SettingsSection>
      </div>

      {/* AI 矢量化(StarVector / 实验精修)已于 2026-05-28 整体砍除；HYPIR AI 修复 + ai-platform 底座已于 2026-06-18 整体砍除 */}
    </div>
  );
}

/** Obsidian 资产库：选库文件夹（本地 vault 目录）。画布「存入 Obsidian / Obsidian 库」与 MCP vault_* 工具共用。 */
function ObsidianVaultField(): JSX.Element {
  const [status, setStatus] = useState<{ vaultPath: string; exists: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.electronAPI.vault
      .status()
      .then((r) => {
        if (r.ok) setStatus(r.data);
      })
      .catch(() => undefined);
  }, []);

  async function applyPath(vaultPath: string): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.vault.setConfig({ vaultPath });
    setBusy(false);
    if (r.ok) {
      setStatus(r.data);
      toast.success(vaultPath ? 'Obsidian 库已连接' : '已清除库路径', vaultPath || undefined);
    } else {
      toast.error('设置失败', `${r.error.message}${r.error.hint ? `——${r.error.hint}` : ''}`);
    }
  }

  async function pick(): Promise<void> {
    const r = await window.electronAPI.storage.selectFolder();
    if (!r.ok) {
      toast.error('打开对话框失败', r.error.message);
      return;
    }
    if (!r.data) return;
    await applyPath(r.data.path);
  }

  const pathText = status?.vaultPath || '（未设置）';
  const stateText = !status?.vaultPath
    ? '未连接：选择你的 Obsidian 库（vault）文件夹后，画布节点可一键存入 / 调用库内笔记'
    : status.exists
      ? '已连接：智能画布右上角「Obsidian」可检索笔记；节点右键「存入 Obsidian 库」可归档角色设定 / 剧本'
      : '路径不可访问：确认盘符已挂载（如 S: 盘）后重新选择';

  return (
    <>
      <Field label="Obsidian 库文件夹（vault 根目录）">
        <div className="mb-storage-path-row">
          <div className="mb-input" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <FolderIcon size={16} />
            <span style={{ marginLeft: 10, color: 'var(--mb-text-secondary)' }}>{pathText}</span>
          </div>
          <button className="mb-btn mb-btn-secondary" onClick={() => void pick()} disabled={busy}>
            选择文件夹
          </button>
          {status?.vaultPath ? (
            <button className="mb-btn mb-btn-ghost" onClick={() => void applyPath('')} disabled={busy}>
              清除
            </button>
          ) : null}
        </div>
      </Field>
      <p className="mb-settings-hint">{stateText}</p>
    </>
  );
}

/** MCP 服务器：开关 + 端口 + 可选 token + 两种接入地址（Hermes Studio 等智能体客户端用）。 */
function McpServerField(): JSX.Element {
  const [st, setSt] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [portDraft, setPortDraft] = useState('');
  const [tokenDraft, setTokenDraft] = useState('');

  useEffect(() => {
    window.electronAPI.mcp
      .status()
      .then((r) => {
        if (r.ok) {
          setSt(r.data);
          setPortDraft(String(r.data.port));
        }
      })
      .catch(() => undefined);
  }, []);

  async function save(input: { enabled?: boolean; port?: number; token?: string }): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.mcp.setConfig(input);
    setBusy(false);
    if (r.ok) {
      setSt(r.data);
      setPortDraft(String(r.data.port));
    } else {
      toast.error('MCP 配置失败', `${r.error.message}${r.error.hint ? `——${r.error.hint}` : ''}`);
      const again = await window.electronAPI.mcp.status();
      if (again.ok) {
        setSt(again.data);
        setPortDraft(String(again.data.port));
      }
    }
  }

  // 端口输入遵守数字输入框规范（铁律 19）：编辑期自由输入，失焦 / 回车才 clamp 提交
  function commitPort(): void {
    const n = Number(portDraft);
    const port = Number.isInteger(n) ? Math.min(Math.max(n, 1024), 65535) : (st?.port ?? 7642);
    setPortDraft(String(port));
    if (st && port !== st.port) void save({ port });
  }

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制', text);
    } catch {
      toast.error('复制失败');
    }
  }

  return (
    <>
      <Field label="MCP 服务器（默认关闭）">
        <div className="mb-switch-row">
          <SwitchControl
            checked={st?.enabled ?? false}
            disabled={busy || !st}
            onChange={(v) => void save({ enabled: v })}
          />
          <span className="mb-settings-hint" style={{ margin: 0 }}>
            {st?.running ? `运行中 · 127.0.0.1:${st.port} · ${st.toolCount} 个工具` : '未运行'}
          </span>
        </div>
      </Field>
      <Field label="端口">
        <input
          className="mb-input"
          style={{ width: 120 }}
          value={portDraft}
          disabled={busy || !st}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setPortDraft(e.target.value)}
          onBlur={commitPort}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </Field>
      <Field label="访问令牌（可选，留空 = 本机免鉴权）">
        <input
          className="mb-input"
          type="password"
          placeholder={st?.hasToken ? '已设置（输入新值覆盖，清空则移除）' : '留空 = 不需要 Authorization 头'}
          value={tokenDraft}
          disabled={busy || !st}
          onChange={(e) => setTokenDraft(e.target.value)}
          onBlur={() => {
            void save({ token: tokenDraft });
            setTokenDraft('');
          }}
        />
      </Field>
      {st?.enabled ? (
        <>
          <Field label="接入地址（在 Hermes Studio 的 MCP 管理里添加其一）">
            <div className="mb-storage-path-row">
              <div className="mb-input" style={{ flex: 1 }}>
                <span style={{ color: 'var(--mb-text-secondary)' }}>{st.urls.streamableHttp}</span>
              </div>
              <button className="mb-btn mb-btn-secondary" onClick={() => void copy(st.urls.streamableHttp)}>
                复制
              </button>
            </div>
          </Field>
          <div className="mb-storage-path-row">
            <div className="mb-input" style={{ flex: 1 }}>
              <span style={{ color: 'var(--mb-text-secondary)' }}>{st.urls.sse}（旧版 SSE 传输，客户端不支持上面那条时用）</span>
            </div>
            <button className="mb-btn mb-btn-secondary" onClick={() => void copy(st.urls.sse)}>
              复制
            </button>
          </div>
        </>
      ) : null}
      <p className="mb-settings-hint">
        开启后，Hermes Studio 等支持 MCP 的智能体可远程操作梦笔：读写智能画布（建节点 / 连线 / 运行 / 取结果）、
        检索资产库、读写 Obsidian 库。仅监听本机 127.0.0.1，不对外网开放。
      </p>
    </>
  );
}

function StorageTab(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const [busy, setBusy] = useState(false);

  const imagePath = prefs.image_storage_path ?? '(默认应用目录 / images/)';

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

  return (
    <div className="mb-settings-pane">
      <header className="mb-settings-pane-header">
        <div>
          <h3>存储与系统</h3>
          <p className="mb-settings-pane-desc">控制图片落盘位置、资产库性能与配置备份。</p>
        </div>
      </header>

      <div className="mb-settings-grid">
      <SettingsSection
        id="store-location"
        icon={<SiFolderLine size={15} />}
        title="存储位置"
        desc="图片落盘目录与文件命名规则"
        wide
      >
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
        <FilenameTemplateField />
      </SettingsSection>

      <SettingsSection
        id="store-gallery"
        icon={<SiImages size={15} />}
        title="资产库"
        desc="资产库（图库）的加载与性能"
      >
        <GalleryPrefsField />
      </SettingsSection>

      <SettingsSection
        id="store-obsidian"
        icon={<SiDatabase size={15} />}
        title="Obsidian 资产库"
        desc="连接本地 Obsidian 库：画布一键存入 / 调用笔记"
      >
        <ObsidianVaultField />
      </SettingsSection>

      <SettingsSection
        id="store-backup"
        icon={<SiArchive size={15} />}
        title="配置备份"
        desc="导出 / 导入全部方案与设置（加密）"
      >
        <ConfigIOSection />
      </SettingsSection>
      </div>
    </div>
  );
}

/**
 * 智能化方案 Tab：把「智能体（自动生成 + 模型指派）」「系统与体验」「联网搜索」集中到一处。
 * 原先散落在「存储与系统 → 系统与体验 / 联网搜索」，这里独立成顶级菜单，便于统一管理 AI 行为与系统体验。
 * 纯界面归位：复用同样的字段组件、prefs 键与处理逻辑，不改任何行为。
 */
function IntelligentTab(): JSX.Element {
  return (
    <div className="mb-settings-pane">
      <header className="mb-settings-pane-header">
        <div>
          <h3>智能化方案</h3>
          <p className="mb-settings-pane-desc">智能画布 AI 智能体、系统体验与对话联网搜索的集中配置。</p>
        </div>
      </header>

      <div className="mb-settings-grid">
      <SettingsSection
        id="intel-agent"
        icon={<SiRobot size={15} />}
        title="智能体"
        desc="智能画布「🤖 智能体」的自动生成行为与模型指派"
      >
        <AgentAutoRunField />
        <AgentModelsField />
      </SettingsSection>

      <SettingsSection
        id="intel-system"
        icon={<SiChip size={15} />}
        title="系统与体验"
        desc="硬件加速、任务完成语音播报"
      >
        <GpuAccelField />
        <VoiceNotifyField />
      </SettingsSection>

      <SettingsSection
        id="intel-search"
        icon={<SiGlobe size={15} />}
        title="联网搜索"
        desc="对话联网后端：模型原生 / 各类代搜"
      >
        <SearchBackendField />
      </SettingsSection>

      <SettingsSection
        id="intel-mcp"
        icon={<SiBox size={15} />}
        title="MCP 服务器（智能体接入）"
        desc="让 Hermes Studio 等智能体经 MCP 操作梦笔"
      >
        <McpServerField />
      </SettingsSection>
      </div>
    </div>
  );
}

/** 任务完成语音播报：开关（缺省 = 开）+ 试听 + 按任务类型自定义话术（prefs.voice_phrases_json）。 */
function VoiceNotifyField(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const enabled = voiceNotifyEnabled(prefs);
  const [busy, setBusy] = useState(false);
  const [showPhrases, setShowPhrases] = useState(false);
  // 本地草稿：失焦才保存（避免每键 IPC）
  const [draft, setDraft] = useState<Partial<Record<VoiceTaskKey, VoicePhrase>>>(() => parsePhrases(prefs.voice_phrases_json));

  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.settings.save({ prefs: { voice_notify: next ? '1' : '0' } });
    setBusy(false);
    if (r.ok) {
      await load();
      if (next) speakText('语音播报已开启');
    } else {
      toast.error('保存失败', r.error.message);
    }
  }

  async function savePhrases(next: Partial<Record<VoiceTaskKey, VoicePhrase>>): Promise<void> {
    // 清掉全空项再落库
    const cleaned: Partial<Record<VoiceTaskKey, VoicePhrase>> = {};
    for (const k of Object.keys(next) as VoiceTaskKey[]) {
      const v = next[k];
      const ok = v?.ok?.trim();
      const fail = v?.fail?.trim();
      if (ok || fail) cleaned[k] = { ...(ok ? { ok } : {}), ...(fail ? { fail } : {}) };
    }
    const r = await window.electronAPI.settings.save({
      prefs: { voice_phrases_json: Object.keys(cleaned).length ? JSON.stringify(cleaned) : '' }
    });
    if (r.ok) await load();
    else toast.error('保存失败', r.error.message);
  }

  const keys = Object.keys(VOICE_TASK_NAMES) as VoiceTaskKey[];

  return (
    <Field label="任务完成语音播报">
      <div className="mb-switch-row" style={{ flexWrap: 'wrap' }}>
        <SwitchControl checked={enabled} disabled={busy} onChange={(v) => void toggle(v)} />
        <span className="mb-switch-state">{enabled ? '已开启（默认）' : '已关闭'}</span>
        <button type="button" className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => speakText(defaultPhrase('image', 'ok'))}>
          🔊 试听
        </button>
        <button type="button" className="mb-btn mb-btn-sm mb-btn-ghost" onClick={() => setShowPhrases((v) => !v)}>
          {showPhrases ? '收起自定义话术' : '自定义话术…'}
        </button>
      </div>
      {showPhrases && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {keys.map((k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ minWidth: 110, color: 'var(--mb-text-secondary)', fontSize: 13 }}>{VOICE_TASK_NAMES[k]}</span>
              <input
                className="mb-input"
                style={{ flex: 1, minWidth: 150 }}
                placeholder={defaultPhrase(k, 'ok')}
                value={draft[k]?.ok ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: { ...d[k], ok: e.target.value } }))}
                onBlur={() => void savePhrases(draft)}
              />
              <input
                className="mb-input"
                style={{ flex: 1, minWidth: 150 }}
                placeholder={defaultPhrase(k, 'fail')}
                value={draft[k]?.fail ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: { ...d[k], fail: e.target.value } }))}
                onBlur={() => void savePhrases(draft)}
              />
              <button
                type="button"
                className="mb-btn mb-btn-sm mb-btn-ghost"
                title="试听当前成功话术"
                onClick={() => speakText(draft[k]?.ok?.trim() || defaultPhrase(k, 'ok'))}
              >
                🔊
              </button>
            </div>
          ))}
          <span className="mb-appearance-flow-hint">左 = 成功话术、右 = 失败话术；留空即用默认。失焦自动保存。</span>
        </div>
      )}
      <span className="mb-appearance-flow-hint">
        生图 / 视频 / ComfyUI / 矢量化 / 放大 / 插帧 等耗时任务完成或失败时用系统语音播报（对话回复不播报）。
        没有声音时请检查 Windows 是否安装了中文语音（设置 → 时间和语言 → 语音）。
      </span>
    </Field>
  );
}

/** GPU 加速开关：写 prefs.boot_disable_gpu（settings.ts 同步落 boot-flags.json），重启梦笔生效。 */
function GpuAccelField(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const disabled = prefs.boot_disable_gpu === '1';
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.settings.save({ prefs: { boot_disable_gpu: next ? '0' : '1' } });
    setBusy(false);
    if (r.ok) {
      await load();
      toast.info(next ? '已开启 GPU 加速' : '已关闭 GPU 加速', '重启梦笔后生效');
    } else {
      toast.error('保存失败', r.error.message);
    }
  }

  return (
    <Field label="GPU 加速">
      <div className="mb-switch-row">
        <SwitchControl checked={!disabled} disabled={busy} onChange={(v) => void toggle(v)} />
        <span className="mb-switch-state">{!disabled ? '已开启（默认）' : '已关闭'}</span>
      </div>
      <span className="mb-appearance-flow-hint">
        硬件加速渲染（画布动画 / 预览切换更流畅）。若开启后出现花屏 / 黑块等兼容性问题，可关闭后重启梦笔；
        切换需要重启才生效。
      </span>
    </Field>
  );
}

/** 资产库常驻预加载（写 prefs.gallery_preload，缺省=开）：软件未关期间保持图库已加载，切回瞬开不空等。 */
function GalleryPrefsField(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const on = prefs.gallery_preload !== '0';
  const [busy, setBusy] = useState(false);
  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.settings.save({ prefs: { gallery_preload: next ? '1' : '0' } });
    setBusy(false);
    if (r.ok) await load();
    else toast.error('保存失败', r.error.message);
  }
  return (
    <Field label="资产库常驻预加载">
      <div className="mb-switch-row">
        <SwitchControl checked={on} disabled={busy} onChange={(v) => void toggle(v)} />
        <span className="mb-switch-state">{on ? '已开启（默认）' : '已关闭'}</span>
      </div>
      <span className="mb-appearance-flow-hint">
        软件未关闭期间保持资产库内容已加载在内存里：从别的功能切回资产库时瞬间打开、不再每次重新拉取空等 2-3 秒。
        新产出 / 删除会自动后台同步。关闭则每次进资产库都重新加载（更省内存）。
      </span>
    </Field>
  );
}

/** 智能画布 AI 智能体：建图后是否直接生成（写 prefs.agent_auto_run）。默认关=先确认（省钱防错）。 */
function AgentAutoRunField(): JSX.Element {
  const { prefs, load } = useSettingsStore();
  const auto = prefs.agent_auto_run === '1';
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.settings.save({ prefs: { agent_auto_run: next ? '1' : '0' } });
    setBusy(false);
    if (r.ok) {
      await load();
      toast.info(next ? '已开启智能体自动生成' : '已关闭（建图后先确认）');
    } else {
      toast.error('保存失败', r.error.message);
    }
  }

  return (
    <Field label="智能体自动生成">
      <div className="mb-switch-row">
        <SwitchControl checked={auto} disabled={busy} onChange={(v) => void toggle(v)} />
        <span className="mb-switch-state">{auto ? '建好图直接生成' : '建图后先确认（默认）'}</span>
      </div>
      <span className="mb-appearance-flow-hint">
        智能画布「🤖 智能体」根据你的一句话自动搭好节点图后：默认停下来让你确认，点「确认生成」才调用绘画模型（省钱防错）；
        开启后建好图直接开始生成。
      </span>
    </Field>
  );
}

/**
 * 智能体使用的模型（文本 / 绘画 / 视频）。写 prefs.agent_{text,image,video}_model（显示名，空 = 自动用首个可用）。
 * 智能体建图时按此把模型指派到对应节点：生图→绘画、视频→视频，LLM / 角色设计 / 智能分镜 / 图像反推→文本。
 * 解决「智能体接了功能但没地方设模型、跑起来报错」——在这里显式指定即可。
 */
function AgentModelsField(): JSX.Element {
  const { configs, activePlanId, prefs, load } = useSettingsStore();
  const [busy, setBusy] = useState(false);
  const textModels = listMappedModels(configs, activePlanId, 'text').filter((m) => m.usable);
  const imageModels = listMappedModels(configs, activePlanId, 'image').filter((m) => m.usable);
  const videoModels = listMappedModels(configs, activePlanId, 'video').filter((m) => m.usable);

  async function setModel(key: string, value: string): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.settings.save({ prefs: { [key]: value } });
    setBusy(false);
    if (r.ok) await load();
    else toast.error('保存失败', r.error.message);
  }

  function row(label: string, key: string, models: ReturnType<typeof listMappedModels>, emptyHint: string, autoLabel = '自动（用首个可用）'): JSX.Element {
    return (
      <Field label={label}>
        <select
          className="mb-select"
          disabled={busy || models.length === 0}
          value={prefs[key] ?? ''}
          onChange={(e) => void setModel(key, e.target.value)}
        >
          <option value="">{autoLabel}</option>
          {models.map((m) => (
            <option key={m.name} value={m.name}>
              {m.label}
            </option>
          ))}
        </select>
        {models.length === 0 && <span className="mb-field-hint">{emptyHint}</span>}
      </Field>
    );
  }

  return (
    <>
      {row('智能体 · 文本模型', 'agent_text_model', textModels, '当前方案没有可用对话模型（规划 / LLM / 角色 / 分镜 / 图像反推 都用它）')}
      {row('智能体 · 绘画模型', 'agent_image_model', imageModels, '当前方案没有可用绘画模型（生图节点用它）', '自动（跟随最近在生图里选用的模型）')}
      {row('智能体 · 视频模型', 'agent_video_model', videoModels, '当前方案没有可用视频模型（视频节点用它）', '自动（跟随最近在视频里选用的模型）')}
      <span className="mb-appearance-flow-hint">
        智能体建图时按这里指派模型：生图节点用「绘画模型」、视频节点用「视频模型」，LLM / 角色设计 / 智能分镜 / 图像反推用「文本模型」。
        绘画 / 视频留「自动」时优先沿用你最近在生图 / 视频里选用的模型，没有再用首个可用。配好后，智能画布右下角「🤖 智能体」面板不再单独选模型。
      </span>

      <div style={{ marginTop: 16, marginBottom: 4, fontSize: 13, fontWeight: 600, color: 'var(--mb-text-secondary)' }}>快捷翻译（智能画布「🌐 翻译」框）</div>
      {row('快捷翻译模型', 'quick_translate_model', textModels, '当前方案没有可用对话模型')}
      <Field label="翻译输出">
        <div className="mb-switch-row">
          <SwitchControl
            checked={prefs.quick_translate_output === 'translated'}
            onChange={(v) => void setModel('quick_translate_output', v ? 'translated' : 'both')}
          />
          <span className="mb-switch-state">{prefs.quick_translate_output === 'translated' ? '仅译文' : '原文 + 译文'}</span>
        </div>
      </Field>
      <span className="mb-appearance-flow-hint">
        智能画布的「🌐 翻译」框默认用这里的模型与输出格式，不必每次在画布里二次设置（仍可在翻译框临时切换）。
      </span>
    </>
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
    prompts: true,
    nodeTemplates: true
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
      nodeTemplates: number;
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
    prompts: true,
    nodeTemplates: true
  });

  function resetExport(): void {
    setPwd1('');
    setPwd2('');
    setExportSections({ plans: true, appearance: true, prompts: true, nodeTemplates: true });
  }
  function resetImport(): void {
    setImportFilePath(null);
    setImportPwd('');
    setImportPreview(null);
    setImportMergeStrategy('merge');
    setImportSections({ plans: true, appearance: true, prompts: true, nodeTemplates: true });
  }

  // 打开软件配置文件夹（含数据库 / 节点模板 / 临时文件）
  async function openConfigFolder(): Promise<void> {
    const r = await window.electronAPI.storage.openConfigFolder();
    if (!r.ok) toast.error('打开失败', r.error.message);
  }

  // —— 图片导出 / 导入（文件夹 + 清单，不加密、与配置分开）——
  async function exportImages(): Promise<void> {
    const pick = await window.electronAPI.storage.selectFolder();
    if (!pick.ok || !pick.data) return;
    setBusy(true);
    const r = await window.electronAPI.config.exportImages({ dir: pick.data.path });
    setBusy(false);
    if (!r.ok) {
      toast.error('图片导出失败', r.error.message);
      return;
    }
    toast.success(
      '图片导出完成',
      `已导出 ${r.data.copied} 张${r.data.missing ? `（${r.data.missing} 张源文件缺失已跳过）` : ''} → ${r.data.dir}`
    );
  }

  async function importImages(): Promise<void> {
    const pick = await window.electronAPI.storage.selectFolder();
    if (!pick.ok || !pick.data) return;
    const dir = pick.data.path;
    setBusy(true);
    const scan = await window.electronAPI.config.scanImageDir({ dir });
    if (!scan.ok) {
      setBusy(false);
      toast.error('不是有效的图片导出文件夹', scan.error.message);
      return;
    }
    const go = await confirmDialog({
      title: '导入图片到资产库',
      message: `该文件夹含 ${scan.data.count} 张图片（导出于 ${scan.data.exportedAt.slice(0, 10) || '未知'}）。导入为追加方式（自动跳过重复），确定导入吗？`,
      okText: '导入'
    });
    if (!go) {
      setBusy(false);
      return;
    }
    const r = await window.electronAPI.config.importImages({ dir });
    setBusy(false);
    if (!r.ok) {
      toast.error('图片导入失败', r.error.message);
      return;
    }
    toast.success('图片导入完成', `新增 ${r.data.imported} 张 · 跳过 ${r.data.skipped} 张（重复 / 缺文件）`);
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
    if (
      !exportSections.plans &&
      !exportSections.appearance &&
      !exportSections.prompts &&
      !exportSections.nodeTemplates
    ) {
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
      `方案 ${s.plansImported} · 配置 ${s.configsImported} · 主题 ${s.themesImported} · 提示词 ${s.promptsImported} · 相册 ${s.albumsImported} · 设置 ${s.settingsImported} · 节点模板 ${s.nodeTemplatesImported}`
    );
    // 刷新前端缓存的设置（自定义主题列表 / 提示词列表会在各自页面进入时再读）
    await load();
    setImportOpen(false);
    resetImport();
  }

  return (
    <Field label="配置导入 / 导出">
      <div className="mb-storage-path-row" style={{ marginBottom: 10 }}>
        <button className="mb-btn mb-btn-secondary" onClick={() => void openConfigFolder()}>
          <FolderIcon size={14} /> 打开配置文件夹
        </button>
      </div>
      <div className="mb-field-hint" style={{ marginBottom: 14 }}>
        配置文件夹存放数据库、节点模板（node-templates）与临时文件，可在此查看 / 备份 / 分享单个模板文件。
      </div>

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
        可选择性导出：模型方案 + API Key（密码加密）、外观 + 系统设置、提示词库、节点模板。
        不含对话历史与图片本身（图片单独导出，见下方）。
      </div>

      <div className="mb-storage-path-row" style={{ marginTop: 16 }}>
        <button
          className="mb-btn mb-btn-secondary"
          onClick={() => void exportImages()}
          disabled={busy}
        >
          <ImageIcon size={14} /> 导出图片到文件夹
        </button>
        <button
          className="mb-btn mb-btn-secondary"
          onClick={() => void importImages()}
          disabled={busy}
        >
          <FolderIcon size={14} /> 从文件夹导入图片
        </button>
      </div>
      <div className="mb-field-hint">
        资产库图片单独导出到一个文件夹（复制图片 + 生成清单，不加密）。导入为追加方式、自动跳过重复。
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
              <span>资产库（提示词 + 分类 + 相册元数据）</span>
            </label>
            <label className="mb-tools-switch-row">
              <input
                type="checkbox"
                checked={exportSections.nodeTemplates}
                onChange={(e) =>
                  setExportSections((s) => ({ ...s, nodeTemplates: e.target.checked }))
                }
              />
              <span>智能画布节点模板</span>
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
                {importPreview.counts.albums} · 设置 {importPreview.counts.settings} ·
                节点模板 {importPreview.counts.nodeTemplates}
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
                  <span>资产库</span>
                </label>
                <label className="mb-tools-switch-row">
                  <input
                    type="checkbox"
                    checked={importSections.nodeTemplates}
                    onChange={(e) =>
                      setImportSections((s) => ({ ...s, nodeTemplates: e.target.checked }))
                    }
                  />
                  <span>智能画布节点模板</span>
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
  const [bochaKey, setBochaKey] = useState<string>(prefs.search_bocha_key ?? '');
  const [zhipuKey, setZhipuKey] = useState<string>(prefs.search_zhipu_key ?? '');
  const [jinaKey, setJinaKey] = useState<string>(prefs.search_jina_key ?? '');
  const [serperKey, setSerperKey] = useState<string>(prefs.search_serper_key ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBackend(prefs.search_backend ?? 'native');
    setTavilyKey(prefs.search_tavily_key ?? '');
    setSearxngUrl(prefs.search_searxng_url ?? '');
    setBochaKey(prefs.search_bocha_key ?? '');
    setZhipuKey(prefs.search_zhipu_key ?? '');
    setJinaKey(prefs.search_jina_key ?? '');
    setSerperKey(prefs.search_serper_key ?? '');
  }, [
    prefs.search_backend,
    prefs.search_tavily_key,
    prefs.search_searxng_url,
    prefs.search_bocha_key,
    prefs.search_zhipu_key,
    prefs.search_jina_key,
    prefs.search_serper_key
  ]);

  async function save(): Promise<void> {
    setBusy(true);
    const r = await window.electronAPI.settings.save({
      prefs: {
        search_backend: backend,
        search_tavily_key: tavilyKey,
        search_searxng_url: searxngUrl,
        search_bocha_key: bochaKey,
        search_zhipu_key: zhipuKey,
        search_jina_key: jinaKey,
        search_serper_key: serperKey
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

  // 各「代搜」后端的 key 输入配置（native/ddg/off 不需要 key）
  const keyFields: Record<string, { value: string; set: (v: string) => void; placeholder: string; type?: string }> = {
    tavily: { value: tavilyKey, set: setTavilyKey, placeholder: 'Tavily API Key（tvly-...）', type: 'password' },
    searxng: { value: searxngUrl, set: setSearxngUrl, placeholder: 'https://searx.example.com' },
    bocha: { value: bochaKey, set: setBochaKey, placeholder: '博查 Bocha API Key（sk-...）', type: 'password' },
    zhipu: { value: zhipuKey, set: setZhipuKey, placeholder: '智谱开放平台 API Key', type: 'password' },
    jina: { value: jinaKey, set: setJinaKey, placeholder: 'Jina API Key（jina_...）', type: 'password' },
    serper: { value: serperKey, set: setSerperKey, placeholder: 'Serper API Key', type: 'password' }
  };
  const activeKey = keyFields[backend];

  return (
    <Field label="联网搜索后端">
      <select
        className="mb-select"
        value={backend}
        onChange={(e) => setBackend(e.target.value)}
      >
        <option value="native">原生（用模型自带的 web_search 工具）</option>
        <option value="ddg">DuckDuckGo（无 key，推荐）</option>
        <option value="bocha">博查 Bocha（国内 AI 搜索，单 key）</option>
        <option value="zhipu">智谱 Zhipu（开放平台，单 key，国内直连）</option>
        <option value="jina">Jina（s.jina.ai，单 key，有免费额度）</option>
        <option value="tavily">Tavily（需 key，质量更高）</option>
        <option value="serper">Serper（Google 结果，需海外网络）</option>
        <option value="searxng">SearXNG（自己的实例）</option>
        <option value="off">关闭（即使方案勾了 supports_web_search 也不搜）</option>
      </select>
      <div className="mb-field-hint">
        <strong>两种触发方式</strong>(任一满足就走代搜):
        <br />① 在 方案 → 对话模型 上勾选「支持联网搜索」(每条都搜)
        <br />② 聊天框里点 <code>🌐 联网</code> 按钮(本会话临时强制搜,推荐)
        <br />
        DDG / 博查 / 智谱 / Jina / Tavily / Serper / SearXNG 都是「代搜」—— 梦笔先搜结果,作为系统消息注入对话。
        额度用完时换一个后端即可。选 <code>native</code> 表示用模型自带的 web_search 工具(不走代搜)。
        当 backend 是 <code>native</code> 或 <code>off</code> 时 🌐 按钮也不会触发代搜。
      </div>
      {activeKey && (
        <div style={{ marginTop: 6 }}>
          <input
            className="mb-input"
            type={activeKey.type ?? 'text'}
            placeholder={activeKey.placeholder}
            value={activeKey.value}
            onChange={(e) => activeKey.set(e.target.value)}
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
