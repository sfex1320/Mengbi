/**
 * 全局任务完成语音播报（系统 TTS，speechSynthesis）。
 *
 * 挂点：App.tsx 的 notification:append 全局监听（任务完成通知的统一汇集点）。
 * 白名单：只认「真正的完成事件」通道——register() 包装层对 WRITE_CHANNELS 的「提交成功」
 * 也会 append（如 api:image:generate 返回 taskId 即记 success），这些不在表里、不会被念。
 * 对话（chat:done）按用户决策不播报（秒回且高频，会吵）。
 *
 * 话术：默认「{任务名}任务完成 / 失败」；设置页可按任务类型自定义
 * （prefs.voice_phrases_json = {[taskKey]: {ok?, fail?}}，留空用默认）。
 * 开关：prefs.voice_notify（缺省 = 开，'0' = 关）。
 */
import { useSettingsStore } from '@/store/settingsStore';
import type { NotificationAppendPayload } from '@shared/ipc';

/** 任务键（话术自定义按它存取；多个 channel 可归并到同一个任务键）。 */
export type VoiceTaskKey = 'image' | 'video' | 'comfyui' | 'vec' | 'upscale' | 'interp';

/** 完成事件通道 → 任务键（兼作语音白名单）。 */
const CHANNEL_TASK: Record<string, VoiceTaskKey> = {
  'image:done': 'image',
  'video:done': 'video',
  'comfyui:run-done': 'comfyui',
  'vec:batch-done': 'vec',
  'api:vec:run-vtracer': 'vec',
  'api:vec:run-potrace': 'vec',
  'api:upscale:run-single': 'upscale',
  'api:upscale:run-batch': 'upscale',
  'api:interp:run': 'interp'
};

/** 任务键 → 中文任务名（默认话术 = 「{名}任务完成/失败」）。 */
export const VOICE_TASK_NAMES: Record<VoiceTaskKey, string> = {
  image: '生图',
  video: '视频生成',
  comfyui: 'ComfyUI 工作流',
  vec: '矢量化',
  upscale: '放大',
  interp: '插帧'
};

export interface VoicePhrase {
  ok?: string;
  fail?: string;
}

export function defaultPhrase(key: VoiceTaskKey, kind: 'ok' | 'fail'): string {
  return kind === 'ok' ? `${VOICE_TASK_NAMES[key]}任务完成` : `${VOICE_TASK_NAMES[key]}任务失败`;
}

/** 解析用户自定义话术表（坏 JSON 静默回退默认）。 */
export function parsePhrases(raw: string | undefined): Partial<Record<VoiceTaskKey, VoicePhrase>> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as unknown;
    return j && typeof j === 'object' ? (j as Partial<Record<VoiceTaskKey, VoicePhrase>>) : {};
  } catch {
    return {};
  }
}

export function voiceNotifyEnabled(prefs: Record<string, string>): boolean {
  return prefs.voice_notify !== '0'; // 缺省 = 开（用户主动要的功能）
}

/**
 * 该通知是否属于「真正的任务完成 / 失败」事件（用于任务栏闪烁提醒，与语音播报共用白名单）。
 * 复用 CHANNEL_TASK 完成通道表 + 仅 success/failure（info/取消不算完成）。与语音开关无关。
 */
export function isTaskCompletion(entry: NotificationAppendPayload): boolean {
  return !!CHANNEL_TASK[entry.channel] && (entry.kind === 'success' || entry.kind === 'failure');
}

// ── TTS 内核 ──────────────────────────────────────────────

let zhVoice: SpeechSynthesisVoice | null = null;
let voicesHooked = false;

function pickZhVoice(): SpeechSynthesisVoice | null {
  if (zhVoice) return zhVoice;
  if (!('speechSynthesis' in window)) return null;
  const all = window.speechSynthesis.getVoices();
  zhVoice = all.find((v) => v.lang.toLowerCase().startsWith('zh')) ?? null;
  if (!voicesHooked) {
    voicesHooked = true;
    // 首次 getVoices() 可能为空（Chromium 异步加载语音表）——voiceschanged 后重选
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      const vs = window.speechSynthesis.getVoices();
      zhVoice = vs.find((v) => v.lang.toLowerCase().startsWith('zh')) ?? zhVoice;
    });
  }
  return zhVoice;
}

/** 直接念一段话（设置页「试听」也用它）。无 zh 语音时只设 lang 让系统兜底发声。 */
export function speakText(text: string): void {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  try {
    const synth = window.speechSynthesis;
    // 防积压：批量任务连环完成时，队列超过 2 条就清掉旧队列（最新的事件最重要）
    if (synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1;
    const v = pickZhVoice();
    if (v) u.voice = v;
    synth.speak(u);
  } catch {
    // TTS 是锦上添花：任何异常都不打扰主流程
  }
}

// ── 播报入口 ──────────────────────────────────────────────

/** 同文案 3s 去重：批量任务逐张完成只念第一声，防刷屏。 */
const recentSpoken = new Map<string, number>();
const DEDUPE_MS = 3000;

/** notification:append 旁路：按白名单 + 开关 + 话术表播报任务完成/失败。 */
export function speakNotification(entry: NotificationAppendPayload): void {
  const prefs = useSettingsStore.getState().prefs;
  if (!voiceNotifyEnabled(prefs)) return;
  const key = CHANNEL_TASK[entry.channel];
  if (!key) return;
  if (entry.kind !== 'success' && entry.kind !== 'failure') return; // info（取消等）不念
  const custom = parsePhrases(prefs.voice_phrases_json)[key];
  const text =
    entry.kind === 'success'
      ? (custom?.ok?.trim() || defaultPhrase(key, 'ok'))
      : (custom?.fail?.trim() || defaultPhrase(key, 'fail'));
  const now = Date.now();
  const last = recentSpoken.get(text);
  if (last != null && now - last < DEDUPE_MS) return;
  recentSpoken.set(text, now);
  // 防 Map 无限涨：顺手清掉过期项
  if (recentSpoken.size > 32) {
    for (const [k, t] of recentSpoken) {
      if (now - t > DEDUPE_MS) recentSpoken.delete(k);
    }
  }
  speakText(text);
}
