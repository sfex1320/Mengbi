# 技术架构

## 一、整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      渲染进程 (Renderer)                      │
│   React 18 + TypeScript + Vite                              │
│   ┌────────────┬──────────────────┬────────────────────┐   │
│   │  Pages     │  Components      │  Stores (Zustand)  │   │
│   │  /         │  ChatPanel       │  themeStore        │   │
│   │  /manager  │  GeneratorForm   │  conversationStore │   │
│   │  /lab      │  GalleryGrid     │  taskQueueStore    │   │
│   │            │  PromptCard      │  settingsStore     │   │
│   └────────────┴──────────────────┴────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │ window.electronAPI (contextBridge)
                           │ 仅暴露白名单 IPC 通道
┌──────────────────────────▼──────────────────────────────────┐
│                       Preload (沙箱桥)                        │
│   electron/preload.ts                                       │
│   把 ipcRenderer.invoke / on 包装为类型化 API               │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC（chat:* / image:* / gallery:* …）
┌──────────────────────────▼──────────────────────────────────┐
│                      主进程 (Main)                           │
│   electron/main.ts + electron/ipc/**                        │
│  ┌────────────────┬───────────────┬──────────────────────┐ │
│  │ IPC Routers    │ Services      │ Adapters             │ │
│  │ chat.ts        │ DB (sqlite)   │ StreamAdapter (聊天)  │ │
│  │ generate.ts    │ FileStorage   │ VisionAdapter        │ │
│  │ gallery.ts     │ TaskQueue     │ ImageAdapter (绘图)   │ │
│  │ settings.ts    │ SafeStorage   │ SearchAdapter (联网) │ │
│  │ lab.ts         │ Tray / Mini   │                      │ │
│  └────────────────┴───────────────┴──────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS（用户配置的 base_url）
                           ▼
                  ┌──────────────────────┐
                  │  外部 AI 服务         │
                  │  对话 / 多模态 / 绘画  │
                  │  搜索 / 自动更新      │
                  └──────────────────────┘
```

---

## 二、模块依赖图

```
┌─ src/pages/Create ───────────┐    ┌─ electron/ipc/chat.ts ────┐
│  ChatPanel ───── invoke ──── │ ─► │  api:chat:send / list ... │
│  GeneratorForm ─ invoke ──── │    │                           │
└──────────────────────────────┘    │  ┌──> StreamAdapter        │
                                    │  ├──> SearchAdapter        │
                                    │  └──> DB Service           │
                                    └────────────────────────────┘

┌─ src/pages/Manager ──────────┐    ┌─ electron/ipc/gallery.ts ─┐
│  GalleryGrid ─── invoke ──── │ ─► │  api:gallery:* /          │
│  PromptCard ──── invoke ──── │    │  api:prompt:* /           │
│                              │    │  api:prompt:category:*    │
└──────────────────────────────┘    │  └──> DB Service           │
                                    └────────────────────────────┘

┌─ src/pages/Laboratory ───────┐    ┌─ electron/ipc/lab.ts ──────┐
│  ReverseTool ─── invoke ──── │ ─► │  api:lab:reverse / split / │
│  TranslateTool ─ invoke ──── │    │  compare / translate /     │
│  CompareTool ─── invoke ──── │    │  fuse                      │
└──────────────────────────────┘    │  └──> VisionAdapter / ...  │
                                    └────────────────────────────┘
```

---

## 三、数据流（典型路径）

### 3.1 一次普通对话发送

```
1. 用户在 ChatPanel 输入 → conversationStore.appendUserMsg()
2. ChatPanel 调 window.electronAPI.chat.send({conversationId, content})
3. preload 把 invoke 转给主进程 IPC chat.ts
4. chat.ts 从 DB 读 plan + model 配置（SafeStorage 解密 Key）
5. chat.ts 走 StreamAdapter[provider]，发起上游 SSE
6. 每收到一块 chunk → webContents.send('chat:chunk', { id, delta })
7. 渲染进程监听到 → conversationStore.appendAssistantDelta()
8. 完整结束 → webContents.send('chat:done', { id })
9. chat.ts 把整段消息写入 messages 表
```

### 3.2 一次绘图任务

```
1. GeneratorForm 提交 → window.electronAPI.image.generate({prompt, params, refs})
2. generate.ts 把任务插入 generation_tasks 表（status=pending）
3. TaskQueue Service 按并发上限取出任务（status=running）
4. 调 ImageAdapter[provider] 发请求（含 base64 参考图）
5. 拿到图 URL / base64 → FileStorage 保存到用户配置的 images 目录
6. 写入 images 表（关联 task_id）
7. webContents.send('image:done', { taskId, paths })
8. 渲染进程刷新历史图片栏
```

---

## 四、流式对话时序图

```
Renderer (ChatPanel)        Main (chat.ts + StreamAdapter)        外部 LLM
        │                            │                                  │
        │ invoke api:chat:send       │                                  │
        ├───────────────────────────►│                                  │
        │                            │ 解密 Key + 选 provider            │
        │                            │ POST /chat/completions stream=true│
        │                            ├─────────────────────────────────►│
        │                            │                                  │
        │                            │            data: {delta:"H"}      │
        │                            │◄─────────────────────────────────┤
        │ webContents.send chat:chunk│                                  │
        │◄───────────────────────────┤                                  │
        │                            │            data: {delta:"i"}      │
        │                            │◄─────────────────────────────────┤
        │ webContents.send chat:chunk│                                  │
        │◄───────────────────────────┤                                  │
        │                            │            data: [DONE]           │
        │                            │◄─────────────────────────────────┤
        │                            │ INSERT messages 表                │
        │ webContents.send chat:done │                                  │
        │◄───────────────────────────┤                                  │
        │                            │                                  │
```

> 各家厂商的 SSE 格式不同（OpenAI / Kimi / GLM / MiniMax / DeepSeek），由 `StreamAdapter` 各自的 `normalizeChunk()` 函数转成统一的 `{ delta, finishReason }`。

---

## 五、模型适配器分层

```
StreamAdapter（对话流式）
├─ openai-compat       // OpenAI / Kimi / DeepSeek / 中转站
├─ minimax             // 自有 SSE
├─ glm                 // 自有 SSE
└─ adapter.normalize() // 统一返回 {delta, finishReason, toolCalls?}

VisionAdapter（多模态）
├─ openai-vision       // 图片以 image_url / base64 形式
├─ claude-vision
├─ gemini-vision
└─ adapter.describe(image, prompt) → string

ImageAdapter（绘图）
├─ openai-image        // /images/generations
├─ midjourney-relay    // 部分中转站
├─ custom-relay        // 用户自填的兼容协议
└─ adapter.generate(params) → resultPaths[]

SearchAdapter（联网）
├─ tavily              // 推荐
├─ serper
├─ bing
└─ ddg-fallback        // 无 Key 兜底
```

每个 Adapter 都暴露 `supports(provider): boolean` 与 `transform(input)` / `normalize(output)`，主进程根据用户配置动态选用。

### 5.1 绘图参数模型按 ImageAdapter 派生（A5）

不同绘画 API 支持的参数集差异很大：OpenAI 类只接受 `size` / `quality` / `n`；SD 兼容类接受 `steps` / `cfg_scale` / `sampler` / `scheduler` / `seed` / `denoise`。前端不能写死一个"通用表单"。

每个 `ImageAdapter` 必须额外暴露：

```ts
interface ImageAdapter {
  generate(params): Promise<ResultPaths>;
  // 新增：声明此适配器支持的参数 schema（zod）
  paramSchema: z.ZodObject<...>;
  // 新增：UI 渲染所需的字段元信息
  paramsUI: Array<{
    key: string;            // 'steps' / 'cfg_scale' / ...
    label: string;          // '采样步数'
    type: 'number' | 'select' | 'slider';
    min?: number; max?: number; step?: number;
    options?: Array<{ value: string; label: string }>;
    default: unknown;
  }>;
}
```

前端 `GeneratorForm` 在用户切换模型时：

1. 读取当前 `ImageAdapter.paramsUI`；
2. 用 `react-hook-form` 动态渲染表单字段；
3. 提交时用 `paramSchema.parse(formData)` 校验；
4. 失败字段在前端就回显，**不**走到主进程。

固定字段（所有适配器都有）：`positive_prompt` / `negative_prompt` / `width` / `height`，写在 `BaseImageParams`。

### 5.2 上下文窗口管理（B4）

长对话最终会超过模型 context 上限（4k / 8k / 32k / 200k 各不同）。`StreamAdapter` 负责在发出请求前压缩消息列表：

| 策略 | 触发条件 | 行为 |
|------|---------|------|
| `keep-all` | tokens 估算 ≤ context × 0.7 | 不压缩，全量发出 |
| `truncate-head` | tokens 估算 > context × 0.7 | 保留最近 N 条 + system prompt，丢弃最早的 |
| `summarize-head` | tokens 估算 > context × 0.9 | 把最早段落用同一模型摘要为一条 system 注入，再发出 |

实现要点：

- token 估算用 `gpt-tokenizer`（统一 BPE，足够近似国产模型）；
- `summarize-head` 是异步前置请求，会增加一次 API 调用（**Mock 模式下** 同样需要夹具）；
- 用户可在设置页选默认策略，但每个对话也可单独覆盖。

### 5.3 流式取消机制（B5）

```
用户 ──Esc──► ChatPanel.onCancel()
              │
              ├─ AbortController.abort() 取消渲染端 Promise
              └─ window.electronAPI.chat.cancel(messageId)
                 │
                 ▼ IPC `api:chat:cancel`
              chat.ts handler:
                 ├─ 找到对应的上游 fetch AbortController
                 ├─ controller.abort()  ← 切断 SSE 连接
                 ├─ 把已收到的部分内容写入 messages 表（带 [中断] 标记）
                 └─ webContents.send('chat:done', { id, cancelled: true })
```

要点：

- AbortController 必须由 chat.ts 在发起 fetch 时**立即**创建并存到 Map<messageId, AbortController>；
- 取消后已落库的部分文本仍保留，方便用户复制；
- 取消事件不算错误，不出红 toast，仅在消息底部显示"·已取消"。

---

## 六、安全模型

| 关注点 | 措施 |
|--------|------|
| API Key 持久化 | `electron.safeStorage.encryptString()` 后写入 `api_configs.api_key_encrypted` |
| Key 不暴露前端 | preload 仅暴露 `api:settings:save` 等接口，**不**返回明文 Key |
| 渲染进程隔离 | `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true` |
| CSP | `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: https:; ...` |
| 外网请求收拢 | 所有 fetch 由主进程发起；preload 不暴露 `fetch` 给渲染进程 |
| 输入校验 | IPC handler 全部走 zod schema 校验入参 |
| 文件路径校验 | 用户自选图片目录前用 `path.normalize` + 白名单校验，防止路径穿越 |

---

## 七、错误处理与展示（A2）

> 错误从后端到 UI 的呈现规则。**所有错误必须遵守这个矩阵**——不要随机用 alert / window.alert / console.log 打发。

### 7.1 错误层级矩阵

| 严重度 | 例子 | 展示方式 | 是否打日志 | 是否阻塞 |
|--------|------|---------|-----------|---------|
| **fatal** | 数据库无法打开、preload 脚本崩溃 | 全屏报错页 + "导出诊断"按钮 | error 级 | 是，无法继续使用 |
| **modal** | API Key 无效、配置错误 | 居中模态框 + "去设置"按钮 | warn 级 | 操作级阻塞 |
| **toast** | 单次 API 调用失败、保存成功 | 右上角 toast，3 秒自动消失 | info / warn 级 | 否 |
| **inline** | 表单字段校验失败、单条对话发送失败 | 字段下方 / 消息气泡内的红字 | debug 级 | 仅本字段 |
| **silent** | 后台轮询失败、图片预加载失败 | 不打扰用户 | info 级 | 否 |

### 7.2 IPC 错误返回约定

主进程 IPC handler 永远返回 `Result<T, E>`：

```ts
type Result<T, E = AppError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

type AppError = {
  code: 'API_FAILED' | 'CONFIG_INVALID' | 'DB_ERROR' | 'NETWORK_TIMEOUT' | ...;
  severity: 'fatal' | 'modal' | 'toast' | 'inline' | 'silent';
  message: string;        // 可直接展示给用户的中文文案
  details?: unknown;      // 仅 dev 模式下展开
  hint?: string;          // 操作建议，例如"请检查 API Key 是否过期"
};
```

不要 `throw`——前端无法序列化 Error 对象的栈信息。

### 7.3 用户文案准则

- 永远写"做什么"+"怎么办"，不要只说"出错了"；
  - ❌ "请求失败"
  - ✅ "调用 OpenAI 接口失败（401 未授权），请检查 API Key 是否正确并未过期"
- 不暴露 stack trace 给用户（dev 模式可在控制台展开）；
- 涉及 Key 的错误**只**提示"Key 可能无效"，不回显 Key 本身。

---

## 八、崩溃恢复（C4）

> Electron 进程崩溃 / 用户强杀 / 断电后再次启动的恢复策略。

### 8.1 任务队列恢复

启动时执行：

```sql
-- 把上次未完成的任务标为失败
UPDATE generation_tasks
   SET status = 'failed',
       error_message = 'app-restart-cleanup'
 WHERE status IN ('pending', 'running');
```

UI 在 `/` 顶部显示一条"上次有 N 个任务未完成，已标记为失败，需要时可重新提交"的 toast，5 秒消失。

### 8.2 流式消息恢复

`chat:chunk` 在每收到一段时都立即 `UPDATE messages SET content = content || ?`，**不**等流结束才落库。这样断电时已渲染过的文字也已落库，重启后用户能看到部分内容。

### 8.3 数据库写中断

`better-sqlite3` 默认 WAL 模式，崩溃时自动回滚到上一次 commit 边界。所有多步写入都用 `db.transaction(() => { ... })()` 包裹，避免出现"图片落盘但 images 表没记录"这类不一致。

### 8.4 自动更新失败

`electron-updater` 下载失败不阻塞应用启动：

- 失败信息写入 `logs/main.log`；
- 设置页"关于"段显示"上次更新失败，将在下次启动重试"；
- 用户可手动点"立即重试"。

---

## 九、持久化

| 类型 | 存储位置 |
|------|---------|
| 应用数据库 | `userData/database.sqlite`（better-sqlite3 同步操作） |
| 用户图片 | 默认 `应用根目录/images/`，可通过设置改到任意路径 |
| 主题偏好 | `settings` 表的 `last_used_atmosphere` / `last_used_palette` 键 |
| 加密 Key | `api_configs.api_key_encrypted` 字段（safeStorage） |
| 自动更新缓存 | `userData/updater/` |

数据库连接由主进程单例持有，渲染进程**永远**不直接读写文件。

### 9.1 图片落盘规格（A4）

| 属性 | 规格 |
|------|------|
| 主图格式 | **PNG**（保留 alpha 通道与最高质量） |
| 缩略图格式 | **WebP**，质量 80，最长边 320px |
| 原图压缩 | **不压缩**（用户出图后续可能还要后期处理） |
| 文件名模板 | `{date:YYYY-MM-DD}/{taskId}-{seq:02d}.png`，例如 `2026-05-03/00417-01.png` |
| 缩略图模板 | `{date:YYYY-MM-DD}/.thumbs/{taskId}-{seq:02d}.webp` |
| 缩略图生成时机 | 主图落盘后**主进程同步生成**，使用 `sharp` 库；失败时静默跳过，下次打开图库时按需重生 |
| 元数据 | EXIF 不写入（避免泄露本地路径），提示词 / 参数全部走 `images` 表 |

文件名设计原因：

- 按日分目录避免单目录文件数过万；
- `taskId` + `seq` 保证同一批次的图相邻，便于人工浏览；
- `.thumbs/` 隐藏目录避免与原图混淆。

### 9.2 软删除与版本历史（C2 + C3）

#### 软删除字段

`images` 与 `prompts` 表均加 `deleted_at TEXT` 字段（`NULL` = 未删除）。所有列表查询默认带 `WHERE deleted_at IS NULL`。

回收站视图反转条件：`WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`。

物理清理由后台任务每 24 小时执行一次：

```sql
DELETE FROM images
 WHERE deleted_at IS NOT NULL
   AND julianday('now') - julianday(deleted_at) >= 30;
```

物理删除的同时清掉对应文件（含缩略图）。

#### 版本历史表

```sql
CREATE TABLE image_versions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      TEXT NOT NULL,                 -- 同一 prompt + 模型 + 参数指纹聚合
  image_id      INTEGER NOT NULL REFERENCES images(id),
  version_no    INTEGER NOT NULL,              -- 1, 2, 3, ...
  is_current    INTEGER NOT NULL DEFAULT 1,    -- 同 group 仅一条为 1
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_image_versions_group ON image_versions(group_id, version_no);
```

`group_id` = `sha1(positive_prompt + negative_prompt + model_id + params_fingerprint)`。

详情面板可展示同 group 下的版本切换条；删除某个版本不会影响其他版本。

### 9.3 备份与可移植格式（A8）

`.mengbi` 包是一个标准 zip，结构如下：

```
my-export.mengbi（zip 重命名）
├── manifest.json            # 元信息（schema 版本、导出时间、内容清单）
├── database.sqlite          # 完整 DB 拷贝（API Key 字段已剔除）
├── images/                  # 选中的图片文件
│   └── {date}/{filename}
└── thumbs/                  # 对应缩略图
```

`manifest.json` 示例：

```json
{
  "schema_version": 1,
  "exported_at": "2026-05-03T10:00:00+08:00",
  "app_version": "1.0.0",
  "include": {
    "images": true,
    "prompts": true,
    "presets": true,
    "themes": true,
    "albums": true,
    "api_configs": false
  },
  "image_count": 218,
  "prompt_count": 64
}
```

导入时主进程：

1. 校验 `schema_version` 与当前应用兼容；
2. 备份当前 DB 后再开始 merge；
3. 跳过 `api_configs`（永远不导出 / 不导入 Key，防误传）；
4. `images.file_path` 在导入时按目标安装的图片目录重写。

> 用户也可单导 SQLite（无 zip 套层），用于纯数据备份。

---

## 十、构建与发布

```
本地 dev：   vite dev (5173)  ──►  electron main 加载 http://localhost:5173
本地 build： vite build → dist/   electron-builder 打包为 NSIS / DMG / AppImage
更新通道：   electron-updater 走 GitHub Releases（默认）或自建 OSS
```

详细发版流程见 `DEVELOPMENT.md` 的 Phase 7。
