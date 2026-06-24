/**
 * 绘图任务失败 → 「一键修复」建议（纯函数，可单测）。
 *
 * 思路：很多失败本质是「中转站对某字段/协议不兼容」，修法就是给该绘画模型的「请求体覆盖」补一段
 * （如 `{"stream": false}` / `{"response_format": null}`）。这里按错误信息模式给出建议，前端通知中心
 * 据此显示「一键修复」按钮，用户点一下就把覆盖写进该模型配置（api:settings:apply-overrides）。
 *
 * 新增一类可一键修复的错误：在 RULES 里加一条规则即可（不动其它逻辑）。
 */
import type { NotificationRemedy } from '@shared/ipc';

interface RemedyRule {
  test: RegExp;
  build: (modelId: string) => NotificationRemedy;
}

const RULES: RemedyRule[] = [
  // ① SSE 图像流格式不被识别 / 终态图取不到 → 改用非流式返回
  {
    test: /没识别出终态图|图像流格式不被识别|没收到任何终态图|格式不明（既无/,
    build: (modelId) => ({
      label: '改用非流式返回',
      detail: '给该绘画模型加 {"stream": false}：关掉流式、改用普通 JSON 返回（中转站 SSE 格式不被识别时用）',
      modelId,
      bodyMerge: { stream: false }
    })
  },
  // ② response_format 被中转站拒（Unknown parameter / UnsupportedParamsError / new-api 衍生站 500）
  {
    test: /response_format|UnsupportedParamsError|new_api_error/i,
    build: (modelId) => ({
      label: '屏蔽 response_format',
      detail: '给该绘画模型加 {"response_format": null}：删掉该字段，绕过部分中转站对它的不兼容',
      modelId,
      bodyMerge: { response_format: null }
    })
  },
  // ③ gpt-image 系列 quality 枚举被拒（只认 auto/low/medium/high）→ 删掉 quality 用默认
  {
    test: /quality.*(auto|low|medium|high)|invalid.*quality/i,
    build: (modelId) => ({
      label: '去掉 quality 字段',
      detail: '给该绘画模型加 {"quality": null}：删掉质量参数、用上游默认（该模型不接受当前质量档时用）',
      modelId,
      bodyMerge: { quality: null }
    })
  }
];

/** 按失败信息推断「一键修复」建议；命不中返回 undefined。 */
export function computeImageRemedy(msg: string, modelId: string): NotificationRemedy | undefined {
  if (!msg || !modelId) return undefined;
  for (const r of RULES) {
    if (r.test.test(msg)) return r.build(modelId);
  }
  return undefined;
}
