# 主题系统（THEMING）

> 梦笔的主题系统是 **二维矩阵**：10 种"材质氛围（atmosphere）" × 10 种"主题配色（palette）"。
> CSS 只需要写 **10 + 10 = 20 套 token**，运行时通过 HTML 根上的 `data-atmosphere` 与 `data-palette` 两个属性组合切换。
> 实现：氛围 / 配色 token 全部在 `src/styles/theme.css`；切换 + 持久化在 `src/store/themeStore.ts`；类型与默认值在 `src/types/theme.ts`。

---

## 1. 设计目标

- 默认深色（与设计参考图 `前端页面设计参考/*.png` 一致）；另含一套全浅色主题「暖白玉」。
- 让用户在不重启的前提下随时切换"氛围 + 配色"。
- 全局只通过 CSS 变量驱动，组件层不写死颜色（颜色字面量只允许写在 `theme.css`）。
- 用户在设置页保存的自定义组合可以入库（`themes` 表，IPC `api:theme:save` / `api:theme:list`）。

---

## 2. 二维模型

```
HTML 根节点：
<html data-atmosphere="deep-quiet" data-palette="warm-orange">
  ...
</html>
```

切换由 `themeStore`（Zustand + `persist`）维护，挂在 `document.documentElement` 上：

```ts
// src/store/themeStore.ts（已实现）
useThemeStore.getState().setAtmosphere('dream-galaxy');
useThemeStore.getState().setPalette('purple');
// 副作用：document.documentElement.dataset.atmosphere / palette 被同步更新
```

> `setAtmosphere` / `setPalette` 都会先用 `ATMOSPHERES` / `PALETTES` 白名单校验，非法值直接忽略。
> 应用启动时 `applyThemeToDocument()` 把持久化的状态写回 HTML 根属性，并套用界面缩放 / 流动色。

---

## 3. 十种材质氛围（atmosphere）

> key 必须与 `src/types/theme.ts` 的 `ATMOSPHERES` 枚举一一对应，不要中文化 key。

| key | 中文名 | 视觉描述 |
|-----|-------|---------|
| `none` | 无（关闭动效） | 干净深色，无极光渐变；关闭所有 CSS 动画 / 过渡；隐藏流星 / 星点 / 光晕背景层 |
| `deep-quiet` | 沉稳质感 | 接近纯黑 + 极细噪点，卡片有轻微高斯模糊和 1px 内描边（**默认氛围**） |
| `misty-fog` | 朦胧雾感 | 蓝灰渐变 + 强 backdrop-blur，卡片像隔着一层雾玻璃 |
| `warm-stone` | 暖石金属 | 暖灰 + 暖橘高光，质感偏哑光金属 |
| `deep-city` | 固定深城 | 深蓝紫渐变 + 远点星光斑（CSS radial-gradient） |
| `flowing-light` | 渐隐流光 | 三色渐变缓慢流动（animation linear infinite） |
| `dream-galaxy` | 幻梦星空 | 深紫蓝 + 多层星点 + 紫色光晕 |
| `wave-layer` | 浪绪图层 | 多层半透明色块叠加，类似纸艺剪贴 |
| `warm-jade` | 暖白玉 | **唯一浅色主题**：温润象牙白渐变 + 淡玉色光影；`color-scheme: light`，深色假设的 token 全部翻成浅色 |
| `glass` | 光影玻璃 | 仿苹果液态玻璃：深色基底 + 高饱和蓝 / 品 / 青三色光晕缓慢漂移 + 更通透磨砂卡片 + 更亮的玻璃边缘高光 |

> 背景动效（流星 / 星点 / 软光晕）由 `src/components/Stars.tsx` 渲染，随氛围切换：`none` 全部隐藏；`warm-jade` 切到浅底软光晕场（白色星点在浅底不可见）；`glass` 走星空 + 漂移光球。
> `none` 氛围把 `--mb-duration-*` 全部置 0ms，并对所有元素 `animation: none / transition: none`，作为「关闭一切动效」的无障碍 / 性能档。

---

## 4. 十种主题配色（palette）

> key 必须与 `src/types/theme.ts` 的 `PALETTES` 枚举一一对应。每个 palette 给出源色 50 / 200 / 500 / 700 / 900 五档作设计参考；**实际 CSS 只消费 500（主）与 700（hover）两档**——`--mb-accent` 取 500、`--mb-accent-hover` 取 500↔700 之间的实现值，并据此派生 `--mb-accent-soft` / `--mb-accent-glow` / `--mb-accent-gradient`（见第 5 节）。

| key | 中文名 | 50 | 200 | 500 (主) | 700 | 900 |
|-----|-------|----|----|---------|-----|-----|
| `emerald` | 翠 | `#ECFDF5` | `#A7F3D0` | `#10B981` | `#047857` | `#064E3B` |
| `purple` | 紫 | `#FAF5FF` | `#E9D5FF` | `#A855F7` | `#7E22CE` | `#581C87` |
| `rose` | 蔷 | `#FFF1F2` | `#FECDD3` | `#F43F5E` | `#BE123C` | `#881337` |
| `ocean` | 海 | `#EFF6FF` | `#BFDBFE` | `#3B82F6` | `#1D4ED8` | `#1E3A8A` |
| `warm-orange` | 暖橘 | `#FFF7ED` | `#FED7AA` | `#FB923C` | `#C2410C` | `#7C2D12` |
| `slate` | 灰 | `#F8FAFC` | `#CBD5E1` | `#94A3B8` | `#475569` | `#0F172A` |
| `sunset` | 落日橙 | `#FFFBEB` | `#FDE68A` | `#F59E0B` | `#B45309` | `#78350F` |
| `wheat` | 麦黄 | `#FEFCE8` | `#FEF08A` | `#EAB308` | `#A16207` | `#713F12` |
| `coffee` | 咖啡 | `#FAF7F2` | `#E8D9C0` | `#A47551` | `#6F4E37` | `#3E2723` |
| `cyan` | 青 | `#ECFEFF` | `#A5F3FC` | `#06B6D4` | `#0E7490` | `#164E63` |

> 默认配色为 `warm-orange`（暖橘）。设计参考图 `可调风格页面.png` 中默认选中的也是暖橘。

---

## 5. CSS 变量命名规则

所有变量统一前缀 `--mb-`（mengbi）。`:root` 给一份默认深色 + `warm-orange` 兜底；`[data-atmosphere='x']` 覆盖背景 / 文字 / 边框 / 阴影一组，`[data-palette='y']` 覆盖强调色一组。主要分组（以 `theme.css` 实现为准）：

```css
:root {
  /* 1. 形状 token（与主题无关，全局共享） */
  --mb-radius-card:    22px;
  --mb-radius-card-lg: 28px;
  --mb-radius-button:  14px;
  --mb-radius-input:   12px;
  --mb-radius-pill:    999px;

  /* 2. 字体 token */
  --mb-font-display:     'Inter', 'PingFang SC', 'SF Pro Display', system-ui, ...;
  --mb-font-mono:        'JetBrains Mono', 'SF Mono', Consolas, monospace;
  --mb-font-weight-base: 500;       /* UI 默认中粗 */
  --mb-faux-bold-width:  0.014em;   /* 中文字体只有 400/700 时的描边「假性加粗」 */
  --mb-text-h1:   26px;
  --mb-text-h2:   18px;
  --mb-text-body: 15px;
  --mb-text-aux:  13px;
  --mb-text-tiny: 11px;
  --mb-letter-spacing-h1: -0.02em;

  /* 3. 动效 token（"弹"的曲线 + 多档时长） */
  --mb-ease:         cubic-bezier(0.22, 1, 0.36, 1);
  --mb-ease-snap:    cubic-bezier(0.34, 1.56, 0.64, 1);
  --mb-ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --mb-duration-fast:   160ms;
  --mb-duration-normal: 280ms;
  --mb-duration-slow:   440ms;

  /* 4. 语义色（由 atmosphere 覆盖；下为深色兜底） */
  --mb-bg-base:        #0a0b10;   /* 整页背景 */
  --mb-bg-base-aurora: radial-gradient(...);  /* 整页背景的极光渐变层 */
  --mb-bg-card:        rgba(28, 28, 36, 0.55);  /* 卡片背景（半透明 + backdrop-blur） */
  --mb-bg-card-solid:  #181820;   /* 不透明卡片底色：密集卡片 + 动画背景场景，避免每帧重采样闪烁 */
  --mb-bg-card-hover:  rgba(40, 40, 50, 0.65);
  --mb-bg-hover:       rgba(255, 255, 255, 0.05);
  --mb-bg-active:      rgba(255, 255, 255, 0.08);
  --mb-text-primary:   #f5f5f7;   /* 主文字 */
  --mb-text-secondary: ...;        /* 次级文字（见下「对比增强」） */
  --mb-text-muted:     ...;        /* 占位 / 弱化 */
  --mb-text-on-accent: #ffffff;    /* 强调色上的文字 */
  --mb-border:         rgba(255, 255, 255, 0.08);   /* 主边框 */
  --mb-border-soft:    rgba(255, 255, 255, 0.04);   /* 弱边框 */
  --mb-border-strong:  rgba(255, 255, 255, 0.16);
  --mb-shadow-card:    ...;
  --mb-shadow-card-lg: ...;
  --mb-shadow-glow:    ...;

  /* 5. 强调色（由 palette 覆盖；下为 warm-orange 兜底） */
  --mb-accent:               #fb923c;  /* palette 的 500 主色 */
  --mb-accent-hover:         #f97316;  /* hover 态主色 */
  --mb-accent-soft:          rgba(251, 146, 60, 0.14);   /* 弱化底/选中态 */
  --mb-accent-glow:          0 8px 24px rgba(...);        /* 主按钮辉光阴影 */
  --mb-accent-gradient:      linear-gradient(135deg, ...);/* 主色渐变（按钮/标题用渐变而非 flat） */
  --mb-accent-gradient-soft: linear-gradient(135deg, ...);
}
```

> **对比增强**：次级 / 弱化文字不再写死低透明度，而由 `html[data-atmosphere]` 规则按各主题 primary 用 `color-mix` 推算——深色主题 primary 偏白 → 次级更白；浅色主题（暖白玉）primary 接近纯黑 → 次级更深，满足「黑底更白、白底更深」。
> 浅色主题 `warm-jade` 还额外补一套 `--mb-color-*` 别名（CustomSelect / 工具箱 / 矢量化面板那套带深色硬编码兜底的命名空间），并把若干写死的浅彩「危险 / 成功 / 状态」文字在浅卡片上换深一档。

组件只用变量，不写颜色字面量：

```tsx
// 反例 ❌
<button style={{ background: '#FB923C' }}>生成</button>

// 正例 ✅  .primary-btn { background: var(--mb-accent); }
<button className="primary-btn">生成</button>
```

---

## 6. 切换实现

```css
/* theme.css 大纲 */

/* (1) 10 套 atmosphere：覆盖 bg-* / border-* / shadow-* / text-* */
[data-atmosphere='deep-quiet']    { --mb-bg-base: #...; ... }
[data-atmosphere='misty-fog']     { ... }
[data-atmosphere='warm-stone']    { ... }
[data-atmosphere='deep-city']     { ... }
[data-atmosphere='flowing-light'] { ... }
[data-atmosphere='dream-galaxy']  { ... }
[data-atmosphere='wave-layer']    { ... }
[data-atmosphere='none']          { /* 关闭动效 + 隐藏背景层 */ }
[data-atmosphere='warm-jade']     { color-scheme: light; /* 全浅色 */ }
[data-atmosphere='glass']         { /* 液态玻璃 */ }

/* (2) 10 套 palette：覆盖 accent / accent-hover / accent-soft / accent-glow / accent-gradient */
[data-palette='warm-orange'] { --mb-accent: #fb923c; --mb-accent-hover: #f97316; ... }
[data-palette='purple']      { --mb-accent: #a855f7; --mb-accent-hover: #9333ea; ... }
/* ... 其他 8 套同理 */
```

---

## 6.5 对比度自检规则（WCAG AA）

> 100 种主题组合不可能全部人工目检。下面给出**机器自检**与**人工抽检**两条路径（脚本为规划项）。

### 机器自检

每次修改 `theme.css` 后，跑一次对比度脚本（规划项，尚未内置）：

```bash
npm run theme:contrast-check
```

脚本逻辑：

1. 遍历 10 × 10 = 100 种 `data-atmosphere × data-palette` 组合；
2. 用 `wcag-contrast` 计算 6 对关键色对的对比度：
   - `--mb-text-primary` vs `--mb-bg-base`（正文）
   - `--mb-text-secondary` vs `--mb-bg-base`（次级文字）
   - `--mb-text-primary` vs `--mb-bg-card`（卡片内文字）
   - `--mb-accent` vs `--mb-bg-base`（按钮主色）
   - `--mb-text-on-accent` vs `--mb-accent`（按钮上的文字）
   - `--mb-border` vs `--mb-bg-base`（边框可见度）
3. 验收线：
   - 正文与按钮文字 ≥ **4.5:1**（WCAG AA）
   - 大字（≥18.66px / ≥14px+粗体）≥ **3:1**
   - 边框 ≥ **3:1**（非文字 UI 元素）

不达标的组合写入报告，按"氛围 × 配色"矩阵给红 / 黄 / 绿三色标记，必须全绿才能合并。

### 人工抽检

每次新增 atmosphere 或 palette 后，必须人工核 9 个采样点：

| 氛围 → / 配色 ↓ | 第一个氛围 | 中间氛围 | 最后一个氛围 |
|---|---|---|---|
| 第一个配色 | ✓ | ✓ | ✓ |
| 中间配色 | ✓ | ✓ | ✓ |
| 最后一个配色 | ✓ | ✓ | ✓ |

抽检内容：实际打开三个主页面（`/` 生图、`/manager` 图库、`/smart-canvas` 智能画布），看长文本、表单、按钮、节点卡片是否都清晰可读。浅色主题 `warm-jade` 必须单独全量抽检（深色假设最容易在它上翻车）。

### 不达标的处理

不要降低对比度要求。改 token：

1. 优先调暗背景或调亮文字（覆盖 `--mb-text-primary` 在该氛围下的值）；
2. 若整套配色都过不了，说明这个 palette 与该 atmosphere 不兼容，加入"禁用组合"列表（`themeStore` 切换时跳过）。

> 默认组合 `deep-quiet × warm-orange` 必须满足全部 6 对 ≥ 4.5:1，作为基准锚点。

---

## 7. 浅 / 深主题与反色规则

7 套深色氛围 + `glass`（深色基底）+ `none`（深色）都偏暗，因此**不需要**为每个 palette 单独写"亮色版"。浅色主题只有 **`warm-jade`** 一套，它把深色假设的 token 整体翻成浅色（`color-scheme: light`、暖墨文字、暖墨低透明边框 / 悬停叠层而非白叠层、写实柔和投影 + 顶部白高光内描边），并补 `--mb-color-*` 别名让自定义下拉 / 工具面板也翻浅。

| 氛围 | 反色 / 特调要点 |
|------|----------------|
| `warm-jade` | 全套浅色翻转 + `--mb-color-*` 别名 + 浅卡片上的危险 / 成功 / 状态彩字换深一档 |
| `glass` | 深色基底 + 更亮的玻璃边缘高光 + 更通透磨砂卡片 |
| `none` | `--mb-duration-*` 置 0ms + 关闭全部动画 / 过渡 + 隐藏背景动效层 |

> 后续若再加浅色氛围，把它的反色规则补在这里。

---

## 8. 界面缩放与智能画布连线流动色（themeStore 扩展）

`themeStore`（持久化到 localStorage `mengbi-theme`）除 `atmosphere` / `palette` 外还维护两项偏好：

| 字段 | 作用 | 范围 / 默认 |
|------|------|------------|
| `appZoom` | 整窗界面缩放系数（经 preload 暴露的 `window.electronAPI.window.setZoom` 套用到 webFrame） | clamp `[0.5, 2]`，默认 `1`（100%）。`clampAppZoom` 取两位小数避免浮点漂移 |
| `flowColor` | 智能画布连线流动色（写入 CSS 变量 `--mb-sc-flow`） | 默认 `''` = 跟随主题强调色 `var(--mb-accent)`；非空时覆盖 |

- **界面缩放**：设置页「外观」有「界面缩放」滑块（− / 滑块 / + / 百分比 / 复位）；快捷键 `Ctrl +` 放大 / `Ctrl −` 缩小 / `Ctrl 0` 复位（在 `App.tsx` 全局接管 → `setAppZoom`，键盘改动也持久化、与滑块同步）。**画板页 `/canvas` 放行这三个键**（用于缩放画布而非整窗）。
- **连线流动色**：设置页「外观」有取色器 + 「跟随主题」复位；为空则 `applyFlowColor` 移除 `--mb-sc-flow`，CSS 回退到 `var(--mb-accent)`。
- 启动时 `applyThemeToDocument()` / Zustand `onRehydrateStorage` 会把 `appZoom` 套到 webFrame、把 `flowColor` 写进 `--mb-sc-flow`。

---

## 9. 用户自定义主题（数据库侧）

`themes` 表（详见 `CLAUDE.md` §5.11）允许用户保存命名主题：

```
{
  id, name,
  atmosphere: 'misty-fog',
  palette: 'warm-orange',
  overrides: { '--mb-radius-card': '24px', ... },  // 可选，覆盖个别 token
  is_builtin
}
```

读写走 IPC `api:theme:save` / `api:theme:list`。

**持久化分两处**：
- 运行期氛围 / 配色 / 界面缩放 / 流动色由 `themeStore` 持久化到 localStorage `mengbi-theme`（启动时 `applyThemeToDocument()` 写回 HTML 根属性）。
- `settings` 表另有种子键 `last_used_atmosphere`（默认 `deep-quiet`）/ `last_used_palette`（默认 `warm-orange`），并被配置导出 / 导入（`electron/ipc/configIO.ts`）带上，用于跨设备迁移整体配置。

---

## 10. 与设计参考图的对应

| 设计图 | 推测组合 |
|--------|---------|
| `绘图前端页面.png` | `deep-quiet` × `purple`（左侧导航激活态是紫色） |
| `图库前端页面.png` | `deep-quiet` × `purple` |
| `可调风格页面.png` | `warm-stone` × `warm-orange`（整体偏暖橘） |

---

## 11. 实现位置一览

| 关注点 | 文件 |
|--------|------|
| 氛围 / 配色枚举 + 标签 + 默认值 | `src/types/theme.ts` |
| token 定义（20 套 + 全局兜底 + 对比增强） | `src/styles/theme.css` |
| 切换 + 持久化 + 界面缩放 + 流动色 | `src/store/themeStore.ts` |
| 背景动效（流星 / 星点 / 光球，随氛围切换） | `src/components/Stars.tsx` / `Stars.css` |
| 外观设置 UI（氛围 / 配色 / 缩放 / 流动色 / 自定义主题） | `src/pages/Settings/index.tsx`、`src/components/ThemePicker.tsx` |
| 主题 IPC | `api:theme:save` / `api:theme:list`（`electron/ipc/misc.ts`） |
