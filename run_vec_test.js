// 一次性把 mengbi.png 用 VTracer + Potrace 都跑一遍。
// 用法: node run_vec_test.js
const fs = require('fs');
const path = require('path');

const INPUT  = String.raw`C:\Users\96311\Desktop\mengbi\测试\mengbi.png`;
const OUTDIR = String.raw`C:\Users\96311\Desktop\mengbi\测试`;

async function runVTracer(preset, suffix) {
  const v = require('@neplex/vectorizer');
  const buf = fs.readFileSync(INPUT);
  const t0 = Date.now();
  // 用 enum 数字值,不用字符串
  const cfg = {
    colorMode: v.ColorMode.Color,
    hierarchical: v.Hierarchical.Stacked,
    mode: v.PathSimplifyMode.Spline,
    filterSpeckle: 4,
    colorPrecision: 8,         // 调高 → 更多颜色层(logo 用)
    layerDifference: 8,        // 调低 → 更细致颜色分层
    cornerThreshold: 60,
    lengthThreshold: 4.0,
    maxIterations: 10,
    spliceThreshold: 45,
    pathPrecision: 5
  };
  const svg = await v.vectorize(buf, cfg);
  const ms = Date.now() - t0;
  const out = path.join(OUTDIR, `mengbi_vtracer_${suffix}.svg`);
  fs.writeFileSync(out, svg);
  console.log(`[OK] VTracer ${suffix}: ${svg.length} bytes, ${ms} ms → ${out}`);
}

async function runVTracerBW() {
  const v = require('@neplex/vectorizer');
  const buf = fs.readFileSync(INPUT);
  const t0 = Date.now();
  // 用 Bw 预设
  const svg = await v.vectorize(buf, v.Preset.Bw);
  const ms = Date.now() - t0;
  const out = path.join(OUTDIR, `mengbi_vtracer_bw.svg`);
  fs.writeFileSync(out, svg);
  console.log(`[OK] VTracer BW preset: ${svg.length} bytes, ${ms} ms → ${out}`);
}

function runPotrace(threshold) {
  return new Promise((resolve, reject) => {
    const potrace = require('potrace');
    const t0 = Date.now();
    potrace.trace(INPUT, {
      threshold: threshold,
      turdSize: 2,
      optCurve: true,
      optTolerance: 0.2,
      color: 'auto',
      background: 'transparent'
    }, (err, svg) => {
      if (err) return reject(err);
      const ms = Date.now() - t0;
      const out = path.join(OUTDIR, `mengbi_potrace_t${threshold}.svg`);
      fs.writeFileSync(out, svg);
      console.log(`[OK] Potrace t=${threshold}: ${svg.length} bytes, ${ms} ms → ${out}`);
      resolve();
    });
  });
}

(async () => {
  console.log('input:', INPUT);
  console.log('out  :', OUTDIR);
  console.log('');
  // VTracer 彩色版(主推荐 — logo 常带多色)
  await runVTracer('color-detailed', 'color');
  // VTracer 黑白预设 (BW Preset)
  await runVTracerBW();
  // Potrace 默认阈值 128
  await runPotrace(128);
  // Potrace 偏暗阈值 90 (logo 主体是暗色时)
  await runPotrace(90);
  console.log('');
  console.log('done.');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
