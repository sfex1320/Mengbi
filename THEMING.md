# 主题系统（THEMING）

> 梦笔的主题系统是 **二维矩阵**：7 种"材质氛围（atmosphere）" × 10 种"主题配色（palette）" = 70 种组合。
> 但 CSS 只需要写 **7 + 10 = 17 套 token**，运行时通过 HTML 根上的 `data-atmosphere` 与 `data-palette` 两个属性组合切换。

---

## 1. 设计目标

- 默认深色（与设计参考图 `前端页面设计参考/*.png` 一致）。
- 让用户在不重启的前提下随时切换"氛围 + 配色"。
- 全局只通过 CSS 变量驱动，组件层不写死颜色。
- 用户在设置页保存的自定义组合可以入库（`themes` 表）。

---

## 2. 二维模型

```
HTML 根节点：
<html data-atmosphere="沉稳质感" data-palette="暖橘">
  ...
</html>
```

切换由 `themeStore`（Zustand）维护，挂在 `document.documentElement` 上：

```ts
// src/store/themeStore.ts（示意，本轮不实现）
useThemeStore.setAtmosphere('幻梦星空');
useThemeStore.setPalette('紫');
// 副作用：document.documentElement.dataset.atmosphere/palette 被同步更新
```

---

## 3. 七种材质氛围（atmosphere）

| key | 中文名 | 视觉描述 |
|-----|-------|---------|
| `deep-quiet` | 沉稳质感 | 接近纯黑 + 极细噪点，卡片有轻微高斯模糊和 1px 内描边 |
| `misty-fog` | 朦胧雾感 | 蓝灰渐变 + 强 backdrop-blur，卡片像隔着一层雾玻璃 |
| `warm-stone` | 暖石金属 | 暖灰 + 暖橘高光，质感偏哑光金属 |
| `deep-city` | 固定深城 | 深蓝紫渐变 + 远点星光斑（CSS radial-gradient） |
| `flowing-light` | 渐隐流光 | 三色渐变缓慢流动（animation 30s linear infinite） |
| `dream-galaxy` | 幻梦星空 | 深紫蓝 + 多层星点 + 紫色光晕 |
| `wave-layer` | 浪绪图层 | 多层半透明色块叠加，类似纸艺剪贴 |

> 上面 7 个 key 必须与代码中 `themeStore` 的枚举一一对应，不要中文化 key。

---

## 4. 十种主题配色（palette）

每个 palette 给出 50 / 200 / 500 / 700 / 900 五档，分别对应 hover 高亮 / 边框 / 主色 / 强调 / 暗角。

| key | 中文名 | 50 | 200 | 500 (主) | 700 | 900 |
|-----|-------|----|----|---------|-----|-----|
| `emerald` | 翠 | `#ECFDF5` | `#A7F3D0` | `#10B981` | `#047857` | `#064E3B` |
| `purple` | 紫 | `#FAF5FF` | `#E9D5FF` | `#A855F7` | `#7E22CE` | `#581C87` |
| `rose` | 蔷 | `#FFF1F2` | `#FECDD3` | `#F43F5E` | `#BE123C` | `#881337` |
| `ocean` | 海 | `#EFF6FF` | `#BFDBFE` | `#3B82F6` | `#1D4ED8` | `#1E3A8A` |
| `warm-orange` | 暖橘 | `#FFF7ED` | `#FED7AA` | `#FB923C` | `#C2410C` | `#7C2D12` |
| `slate` | 灰 | `#F8FAFC` | `#CBD5E1` | `#64748B` | `#334155` | `#0F172A` |
| `sunset` | 落日橙 | `#FFFBEB` | `#FDE68A` | `#F59E0B` | `#B45309` | `#78350F` |
| `wheat` | 麦黄 | `#FEFCE8` | `#FEF08A` | `#EAB308` | `#A16207` | `#713F12` |
| `coffee` | 咖啡 | `#FAF7F2` | `#E8D9C0` | `#A47551` | `#6F4E37` | `#3E2723` |
| `cyan` | 青 | `#ECFEFF` | `#A5F3FC` | `#06B6D4` | `#0E7490` | `#164E63` |

> 设计参考图 `可调风格页面.png` 中默认选中的是 `warm-orange`（暖橘）。

---

## 5. CSS 变量命名规则

所有变量统一前缀 `--mb-`（mengbi）。共 4 组：

```css
:root {
  /* 1. 语义色（由 atmosphere + palette 派生） */
  --mb-bg-base:   /* 整页背景 */;
  --mb-bg-card:   /* 卡片背景 */;
  --mb-bg-hover:  /* hover 态背景 */;
  --mb-text-primary:   /* 主文字 */;
  --mb-text-secondary: /* 次级文字 */;
  --mb-text-muted:     /* 占位 / 禁用 */;
  --mb-border:     /* 主边框 */;
  --mb-border-soft:/* 弱边框（卡片描边） */;
  --mb-accent:     /* 当前 palette 的 500 色 */;
  --mb-accent-hover:/* palette 的 700 */;
  --mb-shadow-card:/* 卡片阴影 */;

  /* 2. 形状 token（与主题无关，全局共享） */
  --mb-radius-card:   20px;
  --mb-radius-button: 16px;
  --mb-radius-input:  12px;

  /* 3. 字体 token */
  --mb-font-display: 'Inter', 'SF Pro Display', system-ui;
  --mb-font-mono:    'JetBrains Mono', 'SF Mono', Consolas, monospace;
  --mb-text-h1: 24px;
  --mb-text-body: 16px;
  --mb-text-aux: 13px;

  /* 4. 动效 token */
  --mb-ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --mb-duration-fast:   150ms;
  --mb-duration-normal: 250ms;
  --mb-duration-slow:   400ms;
}
```

---

## 6. 切换实现（仅设计契约，不写代码）

```css
/* theme.css 大纲 */

/* (1) 7 套 atmosphere：决定 bg-* / border-* / shadow-* / text-* */
[data-atmosphere="deep-quiet"]  { --mb-bg-base: #0B0C10; ... }
[data-atmosphere="misty-fog"]   { --mb-bg-base: #1A2332; ... }
[data-atmosphere="warm-stone"]  { --mb-bg-base: #1C1612; ... }
[data-atmosphere="deep-city"]   { --mb-bg-base: #0E0E2A; ... }
[data-atmosphere="flowing-light"] { --mb-bg-base: linear-gradient(...); ... }
[data-atmosphere="dream-galaxy"]  { --mb-bg-base: #14092B; ... }
[data-atmosphere="wave-layer"]  { --mb-bg-base: #161824; ... }

/* (2) 10 套 palette：决定 accent / accent-hover */
[data-palette="warm-orange"] { --mb-accent: #FB923C; --mb-accent-hover: #C2410C; }
[data-palette="purple"]      { --mb-accent: #A855F7; --mb-accent-hover: #7E22CE; }
/* ... 其他 8 套同理 */
```

组件只用变量，不写颜色字面量：

```tsx
// 反例 ❌
<button style={{ background: '#FB923C' }}>生成</button>

// 正例 ✅
<button className="primary-btn">生成</button>
// .primary-btn { background: var(--mb-accent); }
```

---

## 6.5 对比度自检规则（WCAG AA）

> 70 种主题组合不可能全部人工目检。下面给出**机器自检**与**人工抽检**两条路径。

### 机器自检

每次修改 `theme.css` 后，跑一次对比度脚本（Phase 1 内置，本轮不实现）：

```bash
npm run theme:contrast-check
```

脚本逻辑：

1. 遍历 7 × 10 = 70 种 `data-atmosphere × data-palette` 组合；
2. 用 `wcag-contrast` 计算 6 对关键色对的对比度：
   - `--mb-text-primary` vs `--mb-bg-base`（正文）
   - `--mb-text-secondary` vs `--mb-bg-base`（次级文字）
   - `--mb-text-primary` vs `--mb-bg-card`（卡片内文字）
   - `--mb-accent` vs `--mb-bg-base`（按钮主色）
   - `--mb-text-primary` vs `--mb-accent`（按钮上的文字）
   - `--mb-border` vs `--mb-bg-base`（边框可见度）
3. 验收线：
   - 正文与按钮文字 ≥ **4.5:1**（WCAG AA）
   - 大字（≥18.66px / ≥14px+粗体）≥ **3:1**
   - 边框 ≥ **3:1**（非文字 UI 元素）

不达标的组合写入 `dist/theme-contrast-report.html`，按"氛围 × 配色"矩阵给红 / 黄 / 绿三色标记，必须全绿才能合并。

### 人工抽检

每次新增 atmosphere 或 palette 后，必须人工核 9 个采样点：

| 氛围 → / 配色 ↓ | 第一个氛围 | 中间氛围 | 最后一个氛围 |
|---|---|---|---|
| 第一个配色 | ✓ | ✓ | ✓ |
| 中间配色 | ✓ | ✓ | ✓ |
| 最后一个配色 | ✓ | ✓ | ✓ |

抽检内容：实际打开三个主页面（`/`、`/manager`、`/lab`），看长文本、表单、按钮、提示词卡片是否都清晰可读。

### 不达标的处理

不要降低对比度要求。改 token：

1. 优先调暗背景或调亮文字（覆盖 `--mb-text-primary` 在该氛围下的值）；
2. 若整套配色都过不了，说明这个 palette 与该 atmosphere 不兼容，加入"禁用组合"列表（`themeStore` 切换时跳过）。

> 默认组合 `deep-quiet × warm-orange` 必须满足全部 6 对 ≥ 4.5:1，作为基准锚点。

---

## 7. 暗黑反色规则

7 种氛围全部偏暗，因此**不需要**为每个 palette 单独写"亮色版"。但下列 token 在某些氛围下需要反色：

| 氛围 | 需要反色的 token | 原因 |
|------|----------------|------|
| `flowing-light` | `--mb-text-primary` 微调到 `#F5F5F7` | 渐变背景在某些瞬间会变浅 |
| `warm-stone` | `--mb-border-soft` 提高对比 | 暖灰 vs 卡片底色差异小 |

> 后续做"浅色氛围"（如果用户要）时，再补一份 `light-paper` 等，并把反色规则补在这里。本期不做。

---

## 8. 用户自定义主题（数据库侧）

`themes` 表（详细见 `CLAUDE.md` 数据模型）允许用户保存：

```
{
  id, name,
  atmosphere: 'misty-fog',
  palette: 'warm-orange',
  overrides: { '--mb-radius-card': '24px', ... }  // 可选，覆盖个别 token
}
```

应用启动时读取 `last_used_theme` 设置项，若为 null 则默认 `atmosphere=deep-quiet, palette=warm-orange`。

---

## 9. 与设计参考图的对应

| 设计图 | 推测组合 |
|--------|---------|
| `绘图前端页面.png` | `deep-quiet` × `purple`（左侧导航激活态是紫色） |
| `图库前端页面.png` | `deep-quiet` × `purple` |
| `可调风格页面.png` | `warm-stone` × `warm-orange`（整体偏暖橘） |

---

## 10. 待办（实现阶段，**不在本轮文档范围**）

- [ ] 在 `src/styles/theme.css` 写出 7 + 10 套 token
- [ ] 在 `src/store/themeStore.ts` 实现切换 + 持久化
- [ ] 在设置页"配置外观"面板复刻 `可调风格页面.png` 的氛围/配色选择 UI
- [ ] 在 `themes` 表实现自定义主题增删改查
