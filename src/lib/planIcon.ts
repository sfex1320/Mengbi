/**
 * 方案图标（纯函数）：设置页「模型方案」的图标展示。
 * - 自定义：prefs 键 `plan_icons_json`（{[planId]: string}，值=emoji/单字/图片 dataURI）
 * - 无自定义：自动用「方案名首字 + 名称 hash 决定的 HSL 底色」生成圆形图标（稳定可辨识）
 */

export interface PlanIconSpec {
  /** 图片 dataURI（自定义上传时） */
  image?: string;
  /** 文字图标（emoji / 首字） */
  text?: string;
  /** 底色（自动生成时按名称 hash；自定义文字也用它兜底） */
  bg: string;
}

/** 名称 → 稳定 HSL 底色（同名恒同色）。 */
export function planIconColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 52%, 46%)`;
}

/** 解析 prefs.plan_icons_json（坏 JSON 容错为空表）。 */
export function parsePlanIcons(json: string | undefined | null): Record<string, string> {
  if (!json) return {};
  try {
    const o = JSON.parse(json) as unknown;
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (typeof v === 'string' && v) out[k] = v;
      return out;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** 取某方案的图标 spec：自定义（图片/emoji/文字）优先，否则名称首字 + 自动底色。 */
export function planIconOf(planId: number, name: string, icons: Record<string, string>): PlanIconSpec {
  const custom = icons[String(planId)];
  const bg = planIconColor(name || String(planId));
  if (custom) {
    if (custom.startsWith('data:image/')) return { image: custom, bg };
    return { text: custom.slice(0, 2), bg };
  }
  const first = (name || '?').trim().charAt(0) || '?';
  return { text: first, bg };
}
