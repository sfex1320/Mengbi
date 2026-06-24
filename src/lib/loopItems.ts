/**
 * 循环节点（loop）的「项」解析（纯函数 + vitest）：
 * 图片批次 / 提示词列表 / 文件夹图片 / 尺寸列表 / 数值范围 / 固定次数 → 统一 LoopItem[]。
 * 图片来源（images / folder）按 batchSize 切批：每项 = 一批 N 张图（batchSize≤1 时每项 1 张）。
 */
import type { LoopNodeData, SizeSpec } from '@/types/smartCanvas';

export interface LoopItem {
  /** 节点卡「当前值」展示 */
  label: string;
  prompt?: string;
  size?: SizeSpec;
  /** 一批图（图片批次 / 文件夹来源）；batchSize≤1 时长度为 1 */
  images?: string[];
}

/** 循环上限（防失控烧钱 / 卡死）。 */
export const MAX_LOOP_ITEMS = 1000;

/** 把数组按 size 切成若干批（size≤1 → 每批 1 个）。批数钳到 MAX_LOOP_ITEMS。 */
export function chunkImages(arr: string[], size: number): string[][] {
  const n = Math.max(1, Math.trunc(size || 1));
  const out: string[][] = [];
  for (let i = 0; i < arr.length; i += n) {
    out.push(arr.slice(i, i + n));
    if (out.length >= MAX_LOOP_ITEMS) break;
  }
  return out;
}

/** 多行文本 → 每行一条提示词（去空行 / 首尾空白）。 */
export function parsePromptLines(text: string): string[] {
  return (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LOOP_ITEMS);
}

/** 由宽高推最近常用比例字符串（尺寸列表项的 aspect 展示）。 */
const RATIO_CANDIDATES: Array<[string, number]> = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['21:9', 21 / 9]
];
function nearestAspect(w: number, h: number): string {
  const r = w / h;
  let best = RATIO_CANDIDATES[0];
  for (const c of RATIO_CANDIDATES) if (Math.abs(c[1] - r) < Math.abs(best[1] - r)) best = c;
  return best[0];
}

/**
 * 尺寸列表解析：每行一组宽高，支持 "1024x768" / "1024X768" / "1024×768" / "1024,768" / "1024 768"。
 * 非法行 / 超界（<16 或 >16384）跳过。
 */
export function parseSizeLines(text: string): SizeSpec[] {
  const out: SizeSpec[] = [];
  for (const line of (text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*[xX×,，\s]\s*(\d+)$/);
    if (!m) continue;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 16 || h < 16 || w > 16384 || h > 16384) continue;
    out.push({ aspect: nearestAspect(w, h), width: w, height: h });
    if (out.length >= MAX_LOOP_ITEMS) break;
  }
  return out;
}

/** 数值范围 → 值列表。step≤0 或方向不符 → []；总数钳到 MAX_LOOP_ITEMS。支持小数步长（按精度归整）。 */
export function rangeValues(from: number, to: number, step: number): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step) || step === 0) return [];
  const dir = to >= from ? 1 : -1;
  if (Math.sign(step) !== dir) return [];
  const out: number[] = [];
  // 浮点误差：按 step 的小数位数归整
  const decimals = (String(step).split('.')[1] ?? '').length;
  for (let v = from; dir > 0 ? v <= to + 1e-9 : v >= to - 1e-9; v += step) {
    out.push(Number(v.toFixed(decimals)));
    if (out.length >= MAX_LOOP_ITEMS) break;
  }
  return out;
}

/**
 * 由节点数据构建循环项列表（folder 模式的文件清单由调用方先扫描传入）。
 */
export function buildLoopItems(d: LoopNodeData, folderFiles?: string[]): LoopItem[] {
  switch (d.sourceType) {
    case 'count': {
      const n = Math.max(1, Math.min(MAX_LOOP_ITEMS, Math.trunc(d.count || 1)));
      return Array.from({ length: n }, (_, i) => ({ label: `第 ${i + 1} 次`, prompt: undefined }));
    }
    case 'range': {
      const vals = rangeValues(d.rangeFrom, d.rangeTo, d.rangeStep);
      if (d.rangeAs === 'text') return vals.map((v) => ({ label: String(v), prompt: String(v) }));
      const other = Math.max(16, Math.trunc(d.rangeOtherEdge || 1024));
      return vals.map((v) => {
        const w = d.rangeAs === 'size-width' ? Math.trunc(v) : other;
        const h = d.rangeAs === 'size-height' ? Math.trunc(v) : other;
        return { label: `${w}×${h}`, size: { aspect: nearestAspect(w, h), width: w, height: h } };
      });
    }
    case 'prompts':
      return parsePromptLines(d.promptLines).map((p, i) => ({ label: `第 ${i + 1} 条：${p.slice(0, 24)}`, prompt: p }));
    case 'sizes':
      return parseSizeLines(d.sizeLines).map((s) => ({ label: `${s.width}×${s.height}`, size: s }));
    case 'images':
      return imageBatchItems(d.images ?? [], d.batchSize ?? 1);
    case 'folder':
      return imageBatchItems(folderFiles ?? [], d.batchSize ?? 1);
    default:
      return [];
  }
}

/** 一组图片 → 按批次切分的 LoopItem[]（每项一批；batchSize≤1 时每项 1 张，label=文件名）。 */
function imageBatchItems(files: string[], batchSize: number): LoopItem[] {
  const valid = files.filter(Boolean);
  if (!valid.length) return [];
  const size = Math.max(1, Math.trunc(batchSize || 1));
  if (size <= 1) {
    return valid.slice(0, MAX_LOOP_ITEMS).map((f) => ({ label: fileLabel(f), images: [f] }));
  }
  return chunkImages(valid, size).map((batch, i) => ({
    label: `第 ${i + 1} 批 · ${batch.length} 张`,
    images: batch
  }));
}

function fileLabel(f: string): string {
  if (f.startsWith('data:')) return '内嵌图片';
  return f.split(/[\\/]/).pop() ?? f;
}
