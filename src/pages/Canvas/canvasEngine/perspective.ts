/**
 * 四角透视扭曲渲染。
 *
 * 输入：
 *   - 原图（HTMLImageElement / ImageBitmap）
 *   - 4 个目标角点（相对原图坐标系：tl, tr, br, bl）
 *
 * 输出：
 *   - 一张 ImageBitmap（已变形）和它在原图坐标系中的 bbox
 *
 * 实现：
 *   - 求解 3×3 单应性矩阵 H：把原图四角 (0,0)/(W,0)/(W,H)/(0,H) 映射到目标四角
 *   - 把原图均匀网格化（默认 16×16），每个网格按 H 投影成目标三角形对
 *   - 用 ctx.transform() + drawImage 把每个三角形仿射粘贴到目标 canvas
 *
 * 这套办法在 viewport 缩放下肉眼看不出锯齿；有微小接缝时把 GRID_DENSITY 调高即可。
 */

const GRID_DENSITY = 16;

export interface Point {
  x: number;
  y: number;
}

export type Quad = { tl: Point; tr: Point; br: Point; bl: Point };

/** 解 8 元线性方程组，求 3×3 单应性矩阵 H（h33=1，所以是 8 个未知数） */
export function solveHomography(srcW: number, srcH: number, dst: Quad): number[] {
  const sp: Point[] = [
    { x: 0, y: 0 },
    { x: srcW, y: 0 },
    { x: srcW, y: srcH },
    { x: 0, y: srcH }
  ];
  const dp: Point[] = [dst.tl, dst.tr, dst.br, dst.bl];

  // A·h = b，其中 h = [a,b,c,d,e,f,g,h]^T （H 矩阵的前 8 项；h33 = 1）
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: sx, y: sy } = sp[i];
    const { x: dx, y: dy } = dp[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }
  const h = gaussSolve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 高斯消元解 Ax=b，A 已是方阵，就地修改 */
function gaussSolve(A: number[][], b: number[]): number[] {
  const n = A.length;
  const m = A.map((row, i) => [...row, b[i]]);

  for (let i = 0; i < n; i++) {
    // 部分主元
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(m[k][i]) > Math.abs(m[maxRow][i])) maxRow = k;
    }
    [m[i], m[maxRow]] = [m[maxRow], m[i]];
    if (Math.abs(m[i][i]) < 1e-12) {
      throw new Error('homography matrix singular');
    }
    for (let k = i + 1; k < n; k++) {
      const f = m[k][i] / m[i][i];
      for (let j = i; j <= n; j++) m[k][j] -= f * m[i][j];
    }
  }
  // 回代
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let j = i + 1; j < n; j++) s -= m[i][j] * x[j];
    x[i] = s / m[i][i];
  }
  return x;
}

/** 用 H 矩阵把单点 (x,y,1) 投影到目标坐标 */
function project(H: number[], x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w
  };
}

export interface WarpResult {
  bitmap: ImageBitmap;
  /** warp 结果 canvas 的 bbox（在原图坐标系内的偏移；用于后续渲染对齐） */
  bbox: { x: number; y: number; width: number; height: number };
}

/**
 * 把 src 图片按四角 dst 变形，输出一张恰好包住目标四边形的 ImageBitmap。
 * dst 坐标系和 src 同样以 (0,0) 为左上。
 */
export async function renderPerspectiveWarp(
  src: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  srcW: number,
  srcH: number,
  dst: Quad
): Promise<WarpResult> {
  // bbox = 四个目标点的最大外接矩形
  const xs = [dst.tl.x, dst.tr.x, dst.br.x, dst.bl.x];
  const ys = [dst.tl.y, dst.tr.y, dst.br.y, dst.bl.y];
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const W = Math.max(1, Math.ceil(maxX - minX));
  const H = Math.max(1, Math.ceil(maxY - minY));

  // dst 移到 bbox 内部坐标
  const localDst: Quad = {
    tl: { x: dst.tl.x - minX, y: dst.tl.y - minY },
    tr: { x: dst.tr.x - minX, y: dst.tr.y - minY },
    br: { x: dst.br.x - minX, y: dst.br.y - minY },
    bl: { x: dst.bl.x - minX, y: dst.bl.y - minY }
  };

  const HMat = solveHomography(srcW, srcH, localDst);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;

  // 网格化 + 三角化渲染：把原图划成 GRID_DENSITY × GRID_DENSITY 的小格，
  // 每个小格 2 个三角形，用单应性投影后用仿射 drawImage 模拟。
  const cellW = srcW / GRID_DENSITY;
  const cellH = srcH / GRID_DENSITY;

  for (let gy = 0; gy < GRID_DENSITY; gy++) {
    for (let gx = 0; gx < GRID_DENSITY; gx++) {
      const sx0 = gx * cellW;
      const sy0 = gy * cellH;
      const sx1 = sx0 + cellW;
      const sy1 = sy0 + cellH;
      const p00 = project(HMat, sx0, sy0);
      const p10 = project(HMat, sx1, sy0);
      const p11 = project(HMat, sx1, sy1);
      const p01 = project(HMat, sx0, sy1);

      // 三角形 1: (sx0,sy0)-(sx1,sy0)-(sx0,sy1) → p00-p10-p01
      drawTriangle(
        ctx,
        src,
        sx0, sy0, sx1, sy0, sx0, sy1,
        p00.x, p00.y, p10.x, p10.y, p01.x, p01.y
      );
      // 三角形 2: (sx1,sy0)-(sx1,sy1)-(sx0,sy1) → p10-p11-p01
      drawTriangle(
        ctx,
        src,
        sx1, sy0, sx1, sy1, sx0, sy1,
        p10.x, p10.y, p11.x, p11.y, p01.x, p01.y
      );
    }
  }

  const bitmap = await createImageBitmap(out);
  return { bitmap, bbox: { x: minX, y: minY, width: W, height: H } };
}

/**
 * 将 src 三角形 (sx0,sy0)-(sx1,sy1)-(sx2,sy2) 仿射映射到目标三角形 (dx0,dy0)-(dx1,dy1)-(dx2,dy2)。
 * 通过求解 2×3 仿射矩阵后 setTransform + drawImage + clip 实现。
 */
function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sx0: number, sy0: number,
  sx1: number, sy1: number,
  sx2: number, sy2: number,
  dx0: number, dy0: number,
  dx1: number, dy1: number,
  dx2: number, dy2: number
): void {
  // 仿射变换 [a c e; b d f] 满足：
  //   a*sx + c*sy + e = dx
  //   b*sx + d*sy + f = dy
  // 用三对点解出 6 元方程组 → 闭式：
  const denom = sx0 * (sy2 - sy1) + sx1 * (sy0 - sy2) + sx2 * (sy1 - sy0);
  if (Math.abs(denom) < 1e-9) return; // 退化三角形

  const a = (dx0 * (sy2 - sy1) + dx1 * (sy0 - sy2) + dx2 * (sy1 - sy0)) / denom;
  const c = (dx0 * (sx1 - sx2) + dx1 * (sx2 - sx0) + dx2 * (sx0 - sx1)) / denom;
  const e =
    (dx0 * (sx2 * sy1 - sx1 * sy2) +
      dx1 * (sx0 * sy2 - sx2 * sy0) +
      dx2 * (sx1 * sy0 - sx0 * sy1)) /
    denom;
  const b = (dy0 * (sy2 - sy1) + dy1 * (sy0 - sy2) + dy2 * (sy1 - sy0)) / denom;
  const d = (dy0 * (sx1 - sx2) + dy1 * (sx2 - sx0) + dy2 * (sx0 - sx1)) / denom;
  const f =
    (dy0 * (sx2 * sy1 - sx1 * sy2) +
      dy1 * (sx0 * sy2 - sx2 * sy0) +
      dy2 * (sx1 * sy0 - sx0 * sy1)) /
    denom;

  ctx.save();
  // 用目标三角形作 clip，避免相邻三角形溢出
  ctx.beginPath();
  ctx.moveTo(dx0, dy0);
  ctx.lineTo(dx1, dy1);
  ctx.lineTo(dx2, dy2);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
