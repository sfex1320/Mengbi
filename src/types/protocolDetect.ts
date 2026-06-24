/**
 * 根据 base_url 猜测协议类型。仅靠主机名 / 路径片段做启发式，不发请求。
 * 对话和绘画两边各有不同的常见特征域名。
 */

import type { OfficialKind, ImageKind } from './domain';

interface Match {
  test: (host: string, path: string) => boolean;
  kind: OfficialKind;
  imageKind: ImageKind;
  /** 给前端做一句话提示用 */
  label: string;
}

const MATCHERS: Match[] = [
  {
    test: (h) => h.endsWith('api.anthropic.com') || h.includes('anthropic'),
    kind: 'anthropic',
    imageKind: null,
    label: 'Anthropic（Claude messages 协议）'
  },
  {
    test: (h) =>
      h.includes('generativelanguage.googleapis.com') ||
      h.includes('aistudio') ||
      h === 'gemini.google.com' ||
      h.endsWith('googleapis.com'),
    kind: 'gemini',
    imageKind: 'gemini',
    label: 'Google Gemini（用 /v1beta/openai 兼容入口）'
  },
  {
    test: (h, p) => h === 'api.openai.com' || (h.endsWith('openai.com') && p.includes('/v1')),
    kind: 'openai',
    imageKind: 'openai',
    label: 'OpenAI 官方'
  },
  {
    test: (h) => h.includes('grsai') || h.endsWith('grsaiapi.com') || h.includes('dakka'),
    kind: 'openai-compat', // grsai 的对话也是 OpenAI 兼容
    imageKind: 'grsai',
    label: 'GRSAI（绘画用自有协议）'
  },
  {
    test: (h) => h.includes('apimart'),
    kind: 'openai-compat', // apimart 的对话是 OpenAI 兼容；绘画/视频走它自有协议
    imageKind: 'apimart',
    label: 'APImart（绘画/视频自有协议）'
  },
  {
    // 本地 Ollama / vLLM / LM Studio 等
    test: (h) =>
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h.startsWith('192.168.') ||
      h.startsWith('10.') ||
      h.endsWith('.local'),
    kind: 'openai-compat',
    imageKind: 'openai-compat',
    label: '本地 OpenAI 兼容（Ollama / vLLM / LM Studio 等）'
  },
  {
    // 中转站常见词
    test: (h) =>
      h.includes('apifox') ||
      h.includes('bltcy') ||
      h.includes('proxy') ||
      h.includes('relay') ||
      h.includes('zhutie') ||
      h.includes('agi'),
    kind: 'openai-compat',
    imageKind: 'openai-compat',
    label: 'OpenAI 兼容中转站'
  }
];

export interface DetectResult {
  kind: OfficialKind;
  imageKind: ImageKind;
  label: string;
}

export function detectProtocolFromUrl(baseUrl: string): DetectResult | null {
  if (!baseUrl) return null;
  let host = '';
  let path = '';
  try {
    const u = new URL(baseUrl);
    host = u.host.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }
  for (const m of MATCHERS) {
    if (m.test(host, path)) {
      return { kind: m.kind, imageKind: m.imageKind, label: m.label };
    }
  }
  return null;
}
