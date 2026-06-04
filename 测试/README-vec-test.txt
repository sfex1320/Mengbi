mengbi.png logo 矢量化 — 三种模式对比
=========================================
输入:    mengbi.png (4000x4000, RGB, 17.9 MB)
用途:    logo / 文化墙美陈
测试时间: 2026-05-27

输出文件清单 (按推荐优先级):
─────────────────────────────────────────────────────────
推荐 1: mengbi_vtracer_color.svg (1.37 MB,30 秒)
   ★★★★★ 高保真彩色矢量化
   适合 logo 完整还原 + 文化墙美陈
   缺点:文件大(1.37 MB),路径多
   引擎:VTracer @neplex/vectorizer, colorPrecision=8

推荐 2: mengbi_potrace_t128.svg (99 KB,1 秒)
   ★★★★ 单色阈值 128 (默认中点)
   适合 logo 主体提取(非彩色)
   阈值越低 = 越多内容变黑;越高 = 越多变白
   引擎:Potrace, threshold=128, optCurve=true

推荐 3: mengbi_potrace_t90.svg (42 KB,1 秒)
   ★★★★ 单色阈值 90 (偏暗,适合 logo 主体是深色)
   如果 t=128 版本提取出来主体太"瘦"或缺细节,试试 t=90

推荐 4: mengbi_vtracer_bw.svg (43 KB,0.4 秒)
   ★★★ VTracer 黑白预设
   类似 Potrace 但用 VTracer 引擎,边缘风格不同

下下策: mengbi_omnisvg_ai.svg (25 KB,6 分钟)
   ★ OmniSVG 4B AI 语义矢量化
   注意:这个 4B 模型主要训练于「拟物图标」(< 30 path 的简单图)
   对 4000x4000 真实 logo 大概率会输出 hallucination(看上去像 SVG 但内容跟原图无关)
   建议先看上面几个,这个仅供对比

如何打开:
  - 浏览器(Chrome/Edge): 直接拖文件就渲染
  - Inkscape / Illustrator / Sketch / Figma: 任何向量编辑器都能开

如何修改:
  - VTracer 输出层次多 → 在 Illustrator 用 Direct Selection (A) 删多余路径
  - Potrace 输出干净 → 适合直接做 logo 替换
  - 想要颜色更多/更细 → 改 run_vec_test.js 里 colorPrecision (默认 8,可调 4-10)
  - 想要 path 更少 → 改 filterSpeckle (默认 4,可调 1-20)
