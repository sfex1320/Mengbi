/**
 * 结果节点的「合集」分组（纯函数，配 resultGroups.test.ts）。
 *
 * 规则（结果收集规范）：
 *  - 单图结果（一次任务 1 张）→ 平铺单卡（保持原排布）。
 *  - 多图结果（一次任务 ≥2 张）→ 一个合集卡（封面 + 张数角标，点开看批次详情）。
 *  - 同 batchId 的多条结果（多提示词逐条生图）→ 合并成一个合集卡；
 *    同 batchId + 同 shotIndex 的多条（单条重试）→ 只保留最新一条（状态翻新）。
 */
import type { WorkResult } from '@shared/smartCanvas';

export interface SingleDisplay {
  kind: 'single';
  src: string;
  result: WorkResult;
}

export interface BatchDisplay {
  kind: 'batch';
  /** 封面图（批次内第一张成功图；全失败时为 undefined） */
  cover?: string;
  /** 批次内全部图片数 */
  count: number;
  okCount: number;
  failCount: number;
  /** 批次内每条结果（按 shotIndex / push 顺序） */
  items: WorkResult[];
  batchId?: string;
}

export type DisplayGroup = SingleDisplay | BatchDisplay;

/** 把结果节点累积的 WorkResult[] 分组为展示单元（单卡平铺 / 合集卡）。只看 images，文本/视频由调用方另行展示。 */
export function groupResults(results: WorkResult[]): DisplayGroup[] {
  const out: DisplayGroup[] = [];
  const batchIndex = new Map<string, number>(); // batchId → out 下标

  for (const r of results) {
    if (r.batchId) {
      const at = batchIndex.get(r.batchId);
      if (at == null) {
        batchIndex.set(r.batchId, out.length);
        out.push(makeBatch([r], r.batchId));
      } else {
        const g = out[at] as BatchDisplay;
        out[at] = makeBatch(mergeRetry(g.items, r), r.batchId);
      }
      continue;
    }
    const imgs = r.images ?? [];
    if (imgs.length > 1) {
      // 单条结果带多张图（batch/loop 模式）→ 也按合集卡展示
      out.push(makeBatch([r]));
    } else if (imgs.length === 1) {
      out.push({ kind: 'single', src: imgs[0], result: r });
    } else if (r.ok === false && r.error) {
      // 无图的失败条（不属于任何批次）→ 包一张空合集卡占位，让失败可见
      out.push(makeBatch([r]));
    }
    // 纯文本/视频结果（无图且无错误）不进图片分组
  }
  return out;
}

/** 同 batchId + 同 shotIndex 的重试结果替换旧条；其余按 shotIndex 排序插入。 */
function mergeRetry(items: WorkResult[], next: WorkResult): WorkResult[] {
  if (next.shotIndex != null) {
    const i = items.findIndex((x) => x.shotIndex === next.shotIndex);
    if (i >= 0) {
      const copy = [...items];
      copy[i] = next;
      return copy;
    }
  }
  const merged = [...items, next];
  merged.sort((a, b) => (a.shotIndex ?? 0) - (b.shotIndex ?? 0));
  return merged;
}

function makeBatch(items: WorkResult[], batchId?: string): BatchDisplay {
  let count = 0;
  let okCount = 0;
  let failCount = 0;
  let cover: string | undefined;
  for (const r of items) {
    const n = r.images?.length ?? 0;
    count += n;
    if (r.ok && n > 0) {
      okCount += 1;
      if (!cover) cover = r.images[0];
    } else if (!r.ok) {
      failCount += 1;
    }
  }
  return { kind: 'batch', cover, count, okCount, failCount, items, batchId };
}
