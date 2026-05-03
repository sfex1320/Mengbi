# CLAUDE.md — 梦笔（mengbi）项目 AI 开发规范

> 这是 Claude Code 在本仓库进行代码生成时的**最权威**指令。任何与本文件冲突的描述，都以本文件为准。
> 当本文件与实现冲突时，**先改实现**；当本文件本身需要修订时，先讨论后修订，不要在代码里偷偷漂移。

---

## 0. 项目身份

| 项 | 值 |
|----|----|
| 名称 | 梦笔（mengbi）绘画工具箱 |
| 类型 | Electron 跨平台桌面应用 |
| Slogan | **梦中之笔，绘未来之画 —— 一个不断进化的 AI 绘画工具箱** |
| 默认主题 | `atmosphere=deep-quiet`（沉稳质感）× `palette=warm-orange`（暖橘） |
| 仓库根目录 | `c:\Users\96311\Desktop\梦笔（mengbi）绘画工具箱\` |

> **注意**：右下角彩蛋"带你吃火锅儿"已**取消**，不要在任何 UI 中再现。Slogan 仅用上方那一句。

---

## 1. 技术栈（严格遵循）

| 层级 | 技术 |
|------|------|
| 桌面容器 | Electron 28+ |
| 前端框架 | React 18 + TypeScript + Vite 5 |
| 状态管理 | Zustand 4 |
| 动效 | Framer Motion 11 |
| 主进程 | Node.js（Electron Main） + Express 风格 IPC 路由 |
| 数据库 | better-sqlite3 11（同步 API） |
| 安全 | Electron `safeStorage` 加密 API Key |
| 打包 | electron-builder 24 |
| 更新 | electron-updater 6 |
| 校验 | zod（IPC 入参校验） |

详细版本锁定与原因见 [`ENVIRONMENT.md`](./ENVIRONMENT.md) 第六节。

---

## 2. 项目目录结构（必须遵守）

```
mengbi/
├── electron/
│   ├── main.ts             # 主进程入口：创建窗口、注册 IPC、托盘
│   ├── preload.ts          # contextBridge 仅暴露白名单 IPC API
│   └── ipc/
│       ├── index.ts        # 注册所有 IPC handler
│       ├── chat.ts         # api:chat:* 对话与流式
│       ├── generate.ts     # api:image:* 绘图与任务队列
│       ├── gallery.ts      # api:gallery:* / api:prompt:* 提示词管家
│       ├── settings.ts     # api:settings:* 方案与模型配置
│       └── lab.ts          # api:lab:* 实验室
├── src/
│   ├── assets/             # 静态资源、图标
│   ├── components/         # 通用组件（Button、Card、ChatBubble 等）
│   ├── pages/
│   │   ├── Create/         # 生图模块（路由 `/`）
│   │   ├── Manager/        # 提示词管家 + 图库（路由 `/manager`）
│   │   └── Laboratory/     # 实验室（路由 `/lab`）
│   ├── store/              # Zustand stores（themeStore / conversationStore / ...）
│   ├── hooks/              # 通用 hooks
│   ├── types/              # 跨进程共享 TS 类型（IPC 入参/响应、AppError、各 ParamSchema）
│   ├── styles/
│   │   └── theme.css       # 7 + 10 套主题 token，全局样式
│   └── App.tsx
├── resources/              # 应用图标、托盘图、安装器图
├── 前端页面设计参考/        # 设计稿（不要修改）
├── package.json
├── electron-builder.yml
├── tsconfig.json
└── vite.config.ts
```

**禁止**新增顶级目录除非本文件先更新。

---

## 3. 前端路由

| 路径 | 模块 | 入口文件 |
|------|------|---------|
| `/` | 生图（对话 + 绘图） | `src/pages/Create/index.tsx` |
| `/manager` | 提示词管家（含图库） | `src/pages/Manager/index.tsx` |
| `/lab` | 提示词实验室 | `src/pages/Laboratory/index.tsx` |

> **路由只有这 3 个顶级入口**，与设计图的 3 个左侧主图标一一对应。
> 历史文档中的"图库（`/gallery`）"已并入 `/manager`，不再独立存在。

---

## 4. IPC 通道命名规范

> 命名前缀：`api:<domain>:<action>`。所有 handler 在 `electron/ipc/` 中注册，前端通过 `window.electronAPI.<domain>.<action>(...)` 调用。

### 4.1 对话（chat.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:chat:send` | renderer→main | 发送消息（流式回包通过 `webContents.send` 推 `chat:chunk` / `chat:done`） |
| `api:chat:cancel` | renderer→main | **取消当前流式响应**（用户按 Esc 触发，详见 `ARCHITECTURE.md` §5.3） |
| `api:chat:create` | renderer→main | 创建新对话 |
| `api:chat:list` | renderer→main | 获取对话列表 |
| `api:chat:history` | renderer→main | 获取某对话的历史消息 |
| `api:chat:rename` | renderer→main | 重命名对话 |
| `api:chat:delete` | renderer→main | 删除对话 |

### 4.2 绘图（generate.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:image:generate` | renderer→main | 提交绘图任务（返回 taskId） |
| `api:image:status` | renderer→main | 查询任务状态 |
| `api:image:cancel` | renderer→main | 取消任务 |
| `api:image:queue` | renderer→main | 获取当前任务队列 |
| `api:image:reorder` | renderer→main | 重排队列 |

### 4.3 提示词管家与图库（gallery.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:gallery:list` | renderer→main | 图片列表（支持分类、标签、搜索过滤） |
| `api:gallery:detail` | renderer→main | 图片详情 |
| `api:gallery:update` | renderer→main | 更新图片元数据（标签、评分、备注、相册） |
| `api:prompt:list` | renderer→main | 提示词卡片列表（按 category 过滤） |
| `api:prompt:upsert` | renderer→main | 新增 / 更新提示词卡片 |
| `api:prompt:delete` | renderer→main | 删除提示词卡片 |
| `api:prompt:category:list` | renderer→main | 提示词分类列表 |
| `api:album:list` | renderer→main | 相册列表 |
| `api:album:upsert` | renderer→main | 新增 / 更新相册（含智能相册规则） |

### 4.4 实验室（lab.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:lab:reverse` | renderer→main | 单图 / 多图反推 |
| `api:lab:split` | renderer→main | 提示词拆解六要素 |
| `api:lab:compare` | renderer→main | 同提示词多模型对比测试 |
| `api:lab:translate` | renderer→main | 中英互译 |
| `api:lab:fuse` | renderer→main | 双提示词按比例融合 |
| `api:lab:history` | renderer→main | 实验室历史记录查询 |

### 4.5 设置与系统（settings.ts + main.ts）

| 通道 | 方向 | 功能 |
|------|------|------|
| `api:settings:get` | renderer→main | 读取所有设置（含方案列表） |
| `api:settings:save` | renderer→main | 保存设置（API Key 自动加密） |
| `api:settings:test-connection` | renderer→main | 测试模型配置连通性 |
| `api:plan:list` | renderer→main | 方案列表 |
| `api:plan:upsert` | renderer→main | 新增 / 更新方案 |
| `api:plan:delete` | renderer→main | 删除方案 |
| `api:storage:select` | renderer→main | 打开文件夹选择对话框 |
| `api:export:card` | renderer→main | 导出作品卡片 PNG |
| `api:theme:save` | renderer→main | 保存自定义主题（写入 `themes` 表） |
| `api:theme:list` | renderer→main | 自定义主题列表 |

> 主进程主动推送的频道（renderer 通过 `on` 监听）：`chat:chunk` / `chat:done` / `image:done` / `image:progress` / `update:available` / `update:downloaded`。

---

## 5. 核心数据模型（SQLite 表）

> 表名小写下划线；JSON 字段用 `TEXT` 存储字符串化 JSON；时间字段统一 `TEXT` ISO 8601。

### 5.1 `api_plans`（方案）

```sql
CREATE TABLE api_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

### 5.2 `api_configs`（模型配置，绘画 / 对话各一类）

```sql
CREATE TABLE api_configs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id              INTEGER NOT NULL REFERENCES api_plans(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL,          -- 'image' | 'text'
  provider_name        TEXT NOT NULL,          -- 中转站或官方名（用户填写）
  base_url             TEXT NOT NULL,
  api_key_encrypted    TEXT NOT NULL,          -- safeStorage 加密
  model_mapping        TEXT NOT NULL,          -- JSON: {"GPT-4o": "gpt-4o-custom"}
  is_official          INTEGER NOT NULL DEFAULT 0,
  supports_web_search  INTEGER NOT NULL DEFAULT 0,
  supports_vision      INTEGER NOT NULL DEFAULT 0,
  official_kind        TEXT,                   -- NULLABLE: 'kimi' | 'minimax' | 'glm' | 'deepseek' | NULL
  created_at           TEXT NOT NULL
);
```

### 5.3 `conversations` / `messages`

```sql
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,                -- UUID
  title       TEXT NOT NULL,
  model_id    TEXT NOT NULL,                   -- 显示名（与 model_mapping key 对应）
  plan_id     INTEGER NOT NULL REFERENCES api_plans(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,               -- 'user' | 'assistant' | 'system'
  content         TEXT NOT NULL,
  timestamp       TEXT NOT NULL
);
```

### 5.4 `generation_tasks`

```sql
CREATE TABLE generation_tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   TEXT REFERENCES conversations(id),  -- NULLABLE
  model_id          TEXT NOT NULL,
  positive_prompt   TEXT NOT NULL,
  negative_prompt   TEXT,
  params            TEXT NOT NULL,             -- JSON
  reference_images  TEXT,                      -- JSON: 引用图本地路径数组
  status            TEXT NOT NULL,             -- 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  result_paths      TEXT,                      -- JSON
  error_message     TEXT,
  created_at        TEXT NOT NULL
);
```

### 5.5 `images`（图库）

```sql
CREATE TABLE images (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER REFERENCES generation_tasks(id),  -- NULLABLE，导入图无 task
  file_path         TEXT NOT NULL,
  thumbnail_path    TEXT,
  prompt_positive   TEXT,
  prompt_negative   TEXT,
  model_used        TEXT,
  params_json       TEXT,
  tags              TEXT,                      -- JSON 数组
  rating            INTEGER NOT NULL DEFAULT 0,-- 0~5
  notes             TEXT,
  album_ids         TEXT,                      -- JSON 数组
  deleted_at        TEXT,                      -- 软删除时间戳，NULL = 未删除（C3）
  created_at        TEXT NOT NULL
);
```

> `file_path` 必须遵循 `{date:YYYY-MM-DD}/{taskId}-{seq:02d}.png` 模板（详见 `ARCHITECTURE.md` §9.1）。
> `thumbnail_path` 必须为 `{date:YYYY-MM-DD}/.thumbs/{taskId}-{seq:02d}.webp`。
> 所有列表查询默认带 `WHERE deleted_at IS NULL`，回收站视图反转此条件。

### 5.6 `albums`

```sql
CREATE TABLE albums (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,               -- 'manual' | 'smart'
  smart_rules     TEXT,                        -- JSON，仅 smart 类型有效
  cover_image_id  INTEGER REFERENCES images(id),
  created_at      TEXT NOT NULL
);
```

### 5.7 `presets`（绘图参数预设）

```sql
CREATE TABLE presets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  description   TEXT,
  params_full   TEXT NOT NULL,                 -- JSON：完整绘图参数
  is_builtin    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
```

### 5.8 `prompts`（提示词卡片）

```sql
CREATE TABLE prompts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  text              TEXT NOT NULL,
  negative_text     TEXT,
  kind              TEXT NOT NULL DEFAULT 'image',
                                              -- 'image' | 'video' | 'qa' | 'doc' | 'favorite'
  category_id       INTEGER REFERENCES prompt_categories(id),
  tags              TEXT,                      -- JSON
  notes             TEXT,
  related_image_ids TEXT,                      -- JSON
  deleted_at        TEXT,                      -- 软删除时间戳，NULL = 未删除（C3）
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
```

### 5.9 `prompt_categories`（提示词管家侧栏分类）

```sql
CREATE TABLE prompt_categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,                   -- '图片提示词' / '视频提示词' / ...
  slug        TEXT NOT NULL UNIQUE,            -- 'image' / 'video' / 'qa' / 'doc' / 'favorite' / 自定义
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
```

> 内置 5 条种子记录：`image / video / qa / doc / favorite`，启动时若不存在则插入。
> 视频提示词**仅文本管理**，不接入任何视频生成 API。

### 5.10 `reverse_tasks` / `prompt_lab_history`

```sql
CREATE TABLE reverse_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  image_paths  TEXT NOT NULL,                  -- JSON
  model_id     TEXT NOT NULL,
  result_type  TEXT NOT NULL,                  -- 'description' | 'tags' | 'style'
  result_text  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE prompt_lab_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_type  TEXT NOT NULL,               -- 'reverse' | 'split' | 'compare' | 'translate' | 'fuse'
  input_data      TEXT NOT NULL,               -- JSON
  output_data     TEXT,                        -- JSON
  created_at      TEXT NOT NULL
);
```

### 5.11 `themes`（用户自定义主题）

```sql
CREATE TABLE themes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  atmosphere  TEXT NOT NULL,                   -- 'deep-quiet' | 'misty-fog' | ... 共 7 种
  palette     TEXT NOT NULL,                   -- 'warm-orange' | 'purple' | ... 共 10 种
  overrides   TEXT,                            -- JSON：可选 token 覆盖
  is_builtin  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
```

### 5.12 `image_versions`（图片版本历史，C2）

```sql
CREATE TABLE image_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      TEXT NOT NULL,                 -- sha1(prompt + model + params 指纹)
  image_id      INTEGER NOT NULL REFERENCES images(id),
  version_no    INTEGER NOT NULL,              -- 1, 2, 3, ...
  is_current    INTEGER NOT NULL DEFAULT 1,    -- 同 group 仅一条为 1
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_image_versions_group ON image_versions(group_id, version_no);
```

> v1.5+ 启用。详见 `ARCHITECTURE.md` §9.2。

### 5.13 `settings`（键值存储）

```sql
CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);
```

内置 key（启动时若不存在则按默认值插入）：

| key | 默认值 | 说明 |
|-----|-------|------|
| `last_used_atmosphere` | `deep-quiet` | 上次使用的材质氛围 |
| `last_used_palette` | `warm-orange` | 上次使用的主题配色 |
| `image_storage_path` | `应用根目录/images/` | 图片存放目录 |
| `usage_tracking_enabled` | `false` | 是否记录 token / 成本（C1，v1.5+ 启用） |
| `keybindings_json` | （内置默认表的 JSON） | 自定义快捷键覆盖 |
| `default_context_strategy` | `truncate-head` | 上下文压缩策略（B4） |
| `auto_update_channel` | `stable` | 更新通道（C5） |
| `schema_version` | `1` | 数据库结构版本，迁移用 |

---

## 6. 设置页面要求

### 6.1 模型方案

每个"方案"下可分别配置多个**绘画模型**与**对话/多模态模型**，每条配置含：

- 中转站 / 官方名称
- API 调用地址（base_url）
- API Key（密码框输入，保存时自动加密）
- 模型映射（键值对列表，显示名 → 实际模型 ID）
- 是否支持原生联网（仅对话模型）
- 是否支持 vision（仅对话模型）
- 官方模型类型（可选下拉：Kimi / MiniMax / GLM / DeepSeek）
- 一键测试连通（`api:settings:test-connection`）

### 6.2 外观

- 材质氛围切换（7 种）
- 主题配色切换（10 种）
- 自定义主题保存（写入 `themes` 表）

### 6.3 存储 / 系统

- 自定义图片存储路径
- 数据库导出 / 备份
- 自定义快捷键（v1.1）
- 自动更新开关

详见 [`FEATURES.md`](./FEATURES.md) 第四节。

---

## 7. 设计规范

### 7.1 主题（材质氛围 × 主题配色）

详见 [`THEMING.md`](./THEMING.md)。要点回顾：

- HTML 根：`<html data-atmosphere="deep-quiet" data-palette="warm-orange">`
- 7 种 atmosphere（deep-quiet / misty-fog / warm-stone / deep-city / flowing-light / dream-galaxy / wave-layer）
- 10 种 palette（emerald / purple / rose / ocean / warm-orange / slate / sunset / wheat / coffee / cyan）
- CSS 变量统一前缀 `--mb-`
- 默认值：`deep-quiet × warm-orange`

### 7.2 形状

| 元素 | 圆角 |
|------|------|
| 卡片 | `var(--mb-radius-card)` = 20px |
| 按钮 | `var(--mb-radius-button)` = 16px |
| 输入框 | `var(--mb-radius-input)` = 12px |

### 7.3 字号

| 用途 | 大小 |
|------|------|
| 标题 H1 | 24px |
| 正文 | 16px |
| 辅助 | 13px |

### 7.4 字体

```
'Inter', 'SF Pro Display', system-ui, -apple-system, BlinkMacSystemFont, sans-serif
```

### 7.5 动效

| 场景 | 时长 / 缓动 |
|------|------------|
| 页面切换 | 250ms / 淡入 + 上移 10px |
| 悬停 | 150ms / scale(1.02) + 阴影 |
| 列表交错入场 | 每项延迟 30ms |
| 通用过渡 | `var(--mb-ease-default)` |

---

## 8. AI 开发工作流

收到一个开发指令后，按以下顺序产出代码：

1. **确认阶段**：属于 `DEVELOPMENT.md` 的哪个 Phase？涉及哪些模块？是否有依赖未完成？
2. **数据变更**：需要新表 / 新字段？给出 DDL，并写入 `electron/ipc/index.ts` 的迁移段。
3. **IPC 层**：在 `electron/ipc/<domain>.ts` 中添加 / 修改 handler，IPC 入参用 zod 校验。
4. **前端页面**：在 `src/pages/<Page>/` 或 `src/components/` 中实现组件。
5. **状态层**：在 `src/store/` 中新增 / 扩展 Zustand store；流式数据走主进程 push。
6. **样式层**：使用 CSS 变量；只在 `theme.css` 写颜色字面量；组件层只引用 `var(--mb-*)`。
7. **自检**：写完一段后用本文件第 10 节"绝不生成的内容"逐条检查一遍。

### 8.1 验收清单（每段代码提交前）

- [ ] TypeScript 严格模式可编译（`tsc --noEmit` 通过）
- [ ] 无 `any` 类型（除非有明确的类型边界注释解释）
- [ ] 所有 Promise 都有 `.catch` 或 `try/catch`
- [ ] 涉及外部 API 的代码全部在主进程
- [ ] 涉及 API Key 的字段经过 `safeStorage`
- [ ] IPC handler 入参经过 zod 校验
- [ ] 组件不写颜色字面量，仅用 `var(--mb-*)`

---

## 9. 关键铁律

1. **前端绝不直接调用外部 API**——所有外网请求由主进程发出，渲染进程通过 IPC 代理。
2. **API Key 永不暴露在前端**——任何 IPC 响应都不能携带明文 Key。
3. **使用同步的 `better-sqlite3` 方法**——不要 `async`/`await` 包同步方法。
4. **流式对话用 `webContents.send` 推送**——不要把整段消息攒齐再返回。
5. **优先使用函数式组件 + Hooks**——不要写 class 组件。
6. **跨文档术语一致**——路由（`/` `/manager` `/lab`）、IPC 命名、表名、主题术语在所有文档与代码中保持一致。
7. **优先级优先 P0**——`FEATURES.md` 标 P2 的功能默认不实现，除非该阶段所有 P0/P1 已完成。
8. **设计稿是参考不是真理**——`前端页面设计参考/*.png` 用于对齐风格意图，具体细节以本文件为准。
9. **错误展示规则（A2）**——所有 IPC handler 返回 `Result<T, AppError>`（**不**用 throw）；`AppError` 携带 `severity: 'fatal' | 'modal' | 'toast' | 'inline' | 'silent'`，前端按此分发到对应 UI（详见 `ARCHITECTURE.md` §7）。文案永远写"做什么 + 怎么办"，不要只说"出错了"。
10. **开发期不要无谓真调用（A7）**——AI 辅助开发期间默认走 `MENGBI_MOCK=1` 的 Mock 模式，所有 Adapter 走 `electron/ipc/mocks/` 夹具。只有最终联调与 release 候选自测才用真实 API。
11. **v1.0 不引入 i18n 框架（B2）**——UI 文案直接中文硬编码。i18n 是 v1.5+ Roadmap，本阶段写代码**不要**预先封装 `t()` 函数。术语见 `WHITEPAPER.md` 第十节术语表，编码时一致使用即可。
12. **图片落盘命名严格统一（A4）**——`{date:YYYY-MM-DD}/{taskId}-{seq:02d}.png`；缩略图 `{date:YYYY-MM-DD}/.thumbs/{taskId}-{seq:02d}.webp`。任何写入 `images.file_path` 字段的代码都必须遵守，详见 `ARCHITECTURE.md` §9.1。
13. **软删除是默认（C3）**——`prompts` / `images` 的"删除"操作只设 `deleted_at = NOW()`，不立即清理。后台任务 30 天后才物理删除。所有列表查询都要 `WHERE deleted_at IS NULL`。

---

## 10. 绝不生成的内容

- 占位 TODO（`// TODO: implement later`）——除非配套了 GitHub issue 编号
- `any` 类型（包括 `as any`、`Function`、隐式 any）
- 未处理的 Promise（无 `.catch` / 不在 `try/catch` 中）
- 渲染进程直接 `fetch` 外部 API
- 把 API Key 写入前端代码、注入到 webContents、或通过 IPC 明文返回
- class 组件、装饰器、`var` 声明
- 中文 key（数据库列、JSON key、CSS 变量、TS 接口字段一律英文）
- 写死的颜色字面量（除 `theme.css` 内部）
- Slogan / 彩蛋 "带你吃火锅儿"
- 视频生成 API 调用代码（v1.0 不做）
- 任何让前端获得 Node.js / fs / path 直接访问能力的 preload 暴露

---

## 11. 开发阶段全览

详见 [`DEVELOPMENT.md`](./DEVELOPMENT.md)。当前阶段：

> **Phase 0（文档完善）已完成。** 下一阶段 **Phase 1（骨架与配置）** 等用户复核 8 份文档后启动。

| Phase | 内容 |
|-------|------|
| 0 | 文档完善（本轮） |
| 1 | 项目骨架、主题、路由、设置页、数据库初始化 |
| 2 | 对话系统、流式聊天、模型适配器、联网搜索 |
| 3 | 绘图模块、参考图、批量生成、任务队列 |
| 4 | 提示词管家（含图库）、标签评分、相册、分类 |
| 5 | 提示词实验室：反推、拆解、对比、翻译、融合 |
| 6 | 全局体验：快捷键、托盘、迷你窗、卡片导出 |
| 7 | 打包、更新、测试 |

当用户说"开始"或"继续"时，从当前阶段的下一个未完成子任务开始生成。

---

## 12. 文档地图（不要自己造文档）

| 文档 | 用途 |
|------|------|
| `README.md` | 项目门面、快速开始 |
| `WHITEPAPER.md` | 产品视角说明书 |
| `FEATURES.md` | P0 / P1 / P2 功能清单 |
| `ARCHITECTURE.md` | 技术架构、模块依赖、流式时序图 |
| `DEVELOPMENT.md` | 7 Phase 开发节奏 |
| `ENVIRONMENT.md` | 环境要求 |
| `THEMING.md` | 主题矩阵 / CSS 变量 |
| `CLAUDE.md` | 本文件，最权威 |

> 不要新增 `IPC_CONTRACT.md` / `SECURITY.md` / `TESTING.md` 等，除非本文件先列入。
