/**
 * 提示词商城缩略图打包预处理：把 `提示词商城图片/<分类>/<cardId>.png` 批量压成 ≤512px 的小 WebP，
 * 平铺输出到 `mall-thumbs-bundled/<cardId>.webp`（cardId 全局唯一，铺平后商城一次扫描即可命中）。
 * 增量：输出已存在且不旧于源文件则跳过（重复运行很快、可安全进打包链）。
 * electron-builder.yml 把 `mall-thumbs-bundled` 作 extraResources 收进安装包 → 商城默认自动读取。
 *
 * 用法：node scripts/build-mall-thumbs.cjs
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '提示词商城图片');
const OUT = path.join(ROOT, 'mall-thumbs-bundled');
const MAX_EDGE = 512;
const QUALITY = 72;
const IMG_RE = /\.(png|jpe?g|webp)$/i;

function walk(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (IMG_RE.test(e.name)) acc.push(p);
  }
}

async function main() {
  // 先确保输出目录存在（哪怕源缺失也建空目录）：electron-builder 的 extraResources `from` 指向它，
  // 目录不存在会让打包报错；空目录则正常（只是没内置缩略图）。
  fs.mkdirSync(OUT, { recursive: true });
  if (!fs.existsSync(SRC)) {
    console.log(`[mall-thumbs] 源文件夹不存在，跳过（输出空目录）：${SRC}`);
    return;
  }
  const files = [];
  walk(SRC, files);
  console.log(`[mall-thumbs] 源图 ${files.length} 张 → ${OUT}`);

  let done = 0;
  let skip = 0;
  let fail = 0;
  for (const f of files) {
    // cardId = 文件名去掉最后一段扩展名（cardId 本身含点号，与渲染端 cardIdFromFile 一致）
    const cardId = path.basename(f).replace(/\.[^.]+$/, '');
    const out = path.join(OUT, `${cardId}.webp`);
    try {
      if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(f).mtimeMs) {
        skip++;
      } else {
        await sharp(f, { failOn: 'none', limitInputPixels: false })
          .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toFile(out);
        done++;
      }
    } catch (e) {
      fail++;
      if (fail <= 10) console.warn(`[mall-thumbs] 失败 ${f}: ${e.message}`);
    }
    if ((done + skip + fail) % 500 === 0) console.log(`[mall-thumbs] ...${done + skip + fail}/${files.length}`);
  }

  // 体积汇总
  let bytes = 0;
  for (const n of fs.readdirSync(OUT)) {
    try {
      bytes += fs.statSync(path.join(OUT, n)).size;
    } catch {
      /* ignore */
    }
  }
  console.log(
    `[mall-thumbs] 完成：转换 ${done} · 跳过 ${skip} · 失败 ${fail} · 输出 ${fs.readdirSync(OUT).length} 张 · 总体积 ${(bytes / 1048576).toFixed(1)} MB`
  );
}

main().catch((e) => {
  console.error('[mall-thumbs] 出错：', e);
  process.exit(1);
});
