# 技术架构

## 一、整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      渲染进程 (Renderer)                      │
│   React 18 + TypeScript + Vite 5                            │
│   ┌────────────┬──────────────────┬────────────────────┐   │
│   │  Pages     │  Components      │  Stores (Zustand)  │   │
│   │  /         │  ChatPanel       │  themeStore        │   │
│   │  /canvas   │  GeneratorForm   │  conversationStore │   │
│   │  /manager  │  GalleryGrid     │  settingsStore     │   │
│   │  /comfyui  │  SmartCanvas     │  smartCanvasStore  │   │
│   │  /tools    │  (React Flow)    │  videoProviders... │   │
│   │  /smart-canvas                │  ...               │   │
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
│   electron/main.ts + electron/ipc/** + electron/services/** │
│  ┌────────────────┬───────────────┬──────────────────────┐ │
│  │ IPC Routers    │ Services      │ Adapters / 引擎       │ │
│  │ chat / generate│ DB (sqlite)   │ StreamAdapter (聊天)  │ │
│  │ gallery / ...  │ httpClient    │ ImageAdapter (绘图)   │ │
│  │ video / comfyui│ comfyui 引擎  │ VideoProviderAdapter │ │
│  │ ps / upscale   │ SafeStorage   │ Real-ESRGAN          │ │
│  │ vec / interp   │ ffmpeg / RIFE │ VTracer / Potrace    │ │
│  └────────────────┴───────────────┴──────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS（用户配置的 base_url） / 本地引擎
                           ▼
        ┌──────────────────────┬───────────────────────────┐
        │  外部 AI 服务         │  本地处理                  │
        │  对话 / 多模态 / 绘画  │  Real-ESRGAN ncnn Vulkan   │
        │  视频 / 搜索 / 更新    │  RIFE ncnn Vulkan（插帧）  │
        │  本地 ComfyUI         │  ffmpeg-static / sharp     │
        └──────────────────────┴───────────────────────────┘
```

> 上图 Pages / Services 列只是示意。**当前顶级路由（自上而下，与侧栏一致；共 6 个顶级入口 + 设置）**：
> `/` 生图(Ctrl+1) · `/canvas` 画板(Ctrl+2) · `/manager` 图库(Ctrl+3) ·
> `/comfyui` ComfyUI 工作流编排器(Ctrl+4) · `/tools` 工具箱(Ctrl+5) · `/smart-canvas` 智能画布(Ctrl+6) · `/settings` 设置。
> **已移除 / 休眠**：`/lab` 提示词实验室页面（2026-06-05 整页下线，但 `lab.ts` 的 `api:lab:reverse`/`translate` 后端保留给智能画布 LLM/反推节点复用）；提示词管家 UI（2026-06-05 下线，`/manager` 固定图库视图）；历史 `/local-model`（本地大模型）页。ComfyUI 统一走 `/comfyui` 编排器；工具箱里 SUPIR（2026-05-29）、OmniSVG（2026-05-27）已分别砍除。

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

┌─ src/pages/Manager（图库）───┐    ┌─ electron/ipc/gallery.ts ─┐
│  GalleryGrid ─── invoke ──── │ ─► │  api:gallery:* /          │
│  AlbumSidebar ── invoke ──── │    │  api:album:* /            │
│                              │    │  api:prompt:*（休眠）     │
└──────────────────────────────┘    │  └──> DB Service           │
                                    └────────────────────────────┘

┌─ src/pages/SmartCanvas ──────┐    ┌─ 复用既有 IPC（零新通道）──┐
│  React Flow 节点图（17 类节点）│ ─► │  api:image:generate        │
│  smartCanvasRunner.ts        │    │  api:chat:optimize-prompt  │
│  （拓扑执行 / 跨文档回灌）    │    │  api:lab:reverse           │
│                              │    │  api:comfyui:run-single    │
│                              │    │  api:video:generate / scale │
└──────────────────────────────┘    │  api:upscale:run-single    │
                                    └────────────────────────────┘

┌─ src/pages/Tools（工具箱）───┐    ┌─ upscale.ts / vec.ts ──────┐
│  RealESRGANPanel ─ invoke ── │ ─► │  api:upscale:*（保真放大） │
│  VectorizePanel ─ invoke ─── │    │  api:vec:*（图像转矢量）   │
└──────────────────────────────┘    └────────────────────────────┘
```

> `electron/ipc/lab.ts` 的 `api:lab:reverse` / `translate` 后端**保留为共享服务**——智能画布的 LLM 节点、图像反推、视频反推都复用它（须选支持识图的多模态 text 模型）。原 `split` / `compare` / `fuse` 桩已于 2026-06-05 前移除，不要复活。

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
4. 调 ImageAdapter[provider] 构造默认 body
   4a. 应用 api_configs.body_overrides_json：顶层合并用户 JSON 模板，
       null 值剥字段，${var} 占位替换为真实类型（详见 CLAUDE.md §13）
5. 发 HTTP 请求（含 base64 参考图）
6. 拿到图 URL / base64 → 解码（含 data URL 前缀剥离）→ FileStorage 保存
7. 写入 images 表（关联 task_id）
8. webContents.send('image:done', { taskId, paths })
9. 渲染进程刷新历史图片栏
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

ImageAdapter（绘图，按 api_configs.image_kind 分流）
├─ openai          // /images/generations（runOpenAIImage，JSON body）
├─ openai-edit     // /images/edits（runOpenAIImageEdit，FormData）
├─ grsai           // 自有异步轮询协议（runGrsaiImage，nano-banana 等）
├─ gemini / openai-compat
├─ comfyui         // 把整段 API Format workflow 当占位符替换后直跑（§13）
└─ 字段集由 family.buildBody 决定（§5.4），再过 applyBodyOverrides

VideoProviderAdapter（视频，按 api_configs.video_kind 分流）
├─ kling / sora / unified  // electron/ipc/video.ts 内置 legacy 引擎
├─ seedance / custom       // electron/services/video/ 适配器 + registry
├─ veo / runway / fal      // electron/services/video/moreAdapters.ts
└─ 统一「提交 → 轮询 → 下载 mp4 落盘 → 入图库」（§九.D）

SearchAdapter（联网，settings.search_backend，electron/services/searchBackends.ts）
├─ native              // 模型自带 web_search tool
├─ ddg / tavily / searxng
├─ bocha（博查）/ zhipu（智谱）/ jina / serper（Google）
└─ off                 // 关闭联网
```

主进程根据用户配置（`official_kind` / `image_kind` / `video_kind` / `search_backend`）动态选用对应实现。

> **实现说明**：所有外网请求统一走 `electron/services/httpClient.ts` 的 `chromiumFetch`（用 Electron net 模块绕过部分中转站的 TLS/UA 限制，并支持 FormData/Blob multipart）。图片落盘统一走 `electron/services/imageStore.ts:saveImage`。

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

### 5.4 图像模型「系列（family）」一等公民

不同图像模型对参数解释根本不同（典型坑："选 4K 实际只出 1K"）。`src/types/imageModelFamilies.ts` 用 manifest 把每个 family 声明清楚：识别的 aspect 列表、分辨率档位、是否支持 quality/negative、maxN、像素预算，以及一个 `buildBody(input)` —— **只发该 family 真正识别的字段**。

内置 5 个 family：`gpt-image-2` / `nano-banana-pro` / `nano-banana-flash` / `nano-banana-2` / `default`（兜底，同时发 size + aspect_ratio + image_size 让上游挑）。

- 默认按真实 model ID 走 `detectFamily(...)` 嗅探；用户可在生图面板「系列覆盖」下拉手动指定（`imageParamsStore.familyOverride`）。
- `family.buildBody(...)` 跑完后，`electron/ipc/imageBody.ts:applyBodyOverrides` 再按方案的 `body_overrides_json` 做顶层合并：占位符（形如 `${var}` 整串）替换为真实类型 + `null` 值删字段（§13）。
- 这两条参数流纯函数有单测锁死（`npm test`），见 §十.A。

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
| 应用数据库 | `userData/database.sqlite`（better-sqlite3 11 同步操作） |
| 用户图片 / 视频 | 默认 `应用根目录/images/`，可通过设置改到任意路径（视频 mp4 也落此） |
| 主题偏好 | `settings` 表的 `last_used_atmosphere` / `last_used_palette` 键；界面缩放 `appZoom`、智能画布连线流动色 `flowColor` 存渲染端 localStorage `mengbi-theme` |
| 智能画布文档 | 渲染端 localStorage（文档元数据 `mengbi.smartCanvas.docs.v1` + 每文档内容 `mengbi.smartCanvas.doc.<id>`），不进 DB |
| 视频供应商配置中心 | `settings` 表 `video_providers_json`（端点 / 能力 / 限制 / 默认参数 / 费用阈值） |
| 加密 Key | `api_configs.api_key_encrypted` 字段（safeStorage） |
| 自动更新缓存 | `userData/updater/` |

数据库连接由主进程单例持有，渲染进程**永远**不直接读写文件。

> **DB schema 版本**：当前 `CURRENT_SCHEMA_VERSION = 15`（`electron/services/db.ts`），迁移段在主进程启动时按 `settings.schema_version` 逐版升级。里程碑：v14 加 ComfyUI 编排器（`comfyui_workflow_templates` / `comfyui_runs`），v15 加 `api_configs.video_kind` 列。**表清单**：`api_plans` / `api_configs` / `conversations` / `messages` / `generation_tasks` / `images`（软删除 `deleted_at` + `album_ids`）/ `albums`（manual\|smart）/ `presets` / `prompts`（软删除，休眠）/ `prompt_categories`（休眠）/ `reverse_tasks` / `prompt_lab_history` / `themes` / `image_versions` / `settings`（k/v）/ `comfyui_workflow_templates` / `comfyui_runs` / `vectorize_history`。

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

## 九 .B 画板渲染管线

画板（`/canvas`）是少数**完全跑在渲染进程**的模块，不走 IPC。整个数据流是单向的：

```
用户拖图 / 文件选择
        │
        ▼
window.electronAPI.storage.pickImages   ─►  Layer { sourcePath, dataUri }
        │
        ▼  push 到
useCanvasStore.project.layers (Zustand + persist)
        │
        ▼
CanvasStage (react-konva)
        │  ├─ Konva.Group(x,y,scaleX,scaleY,rotation,skewX,skewY,opacity,blendMode)
        │  │     └─ Konva.Image(image, crop?)
        │  └─ Konva.Transformer (8 anchors，仅选中图层挂)
        │
        ▼  退出"普通模式"进入：
        ├─ 透视模式：PerspectiveOverlay
        │       │ 4 角控制点 + 实时 renderPerspectiveWarp
        │       │   homography (8 元高斯消元) + 16×16 三角剖分 drawImage
        │       │ 提交 → cookedDataUri = canvas.toDataURL('image/png')
        │       │       layer.{width,height,x,y} 同步偏移以保持视觉位置
        │       └ perspective 字段清零
        ├─ 裁切模式：CropOverlay
        │       └ 写 layer.crop {x,y,width,height}（Konva 原生消费）
        └─ 抠图：BgRemoveDialog
                └ 动态 import('@imgly/background-removal')
                  Blob → onnxruntime (wasm/webgpu) → Blob → dataUri
                  写入 layer.cookedDataUri
```

**关键设计**：

| 字段 | 用途 | 持久化？ |
|------|------|---------|
| `Layer.sourcePath` | 原图（`mengbi-image://`） | ✅ |
| `Layer.cookedDataUri` | 抠图 / 透视烘焙后的中间图（dataUri，可能 MB 级） | ❌（铁律 14） |
| `Layer.{x,y,scaleX,scaleY,rotation,skewX,skewY}` | 仿射变换 | ✅ |
| `Layer.crop` | 裁切矩形 | ✅ |
| `Layer.perspective` | 编辑中的透视角点；commit 后清零 | ✅ |
| `Layer.{visible,locked,opacity,blendMode}` | 显示属性 | ✅ |

**导出**：`exportProjectAsPNG(project) → Blob`：离屏 canvas（project.width × height），按图层顺序遍历，应用每层 transform / blend / opacity / crop，`canvas.toBlob('image/png')`。

**送入生图页**：导出 Blob → dataUri → `useImageParamsStore.addRefs([{ path: 伪 path, dataUri, width, height }])` → `navigate('/')`。

**撤销栈**：内存 `useRef<CanvasProject[]>` 保留 50 步；`stripCooked` 在入栈前剔除 `cookedDataUri`，避免内存爆。撤销后烘焙图丢失，回退到 sourcePath 是默认行为，提示用户。

> **画板 Photoshop 联动（`api:ps:*`）是画板唯一的主进程 IPC 子系统**：`api:ps:send` 把画布 PNG 写临时文件并用 PS 打开 → `fs.watchFile` 监听 mtime 前进（用户在 PS 里 Ctrl+S）→ 推 `ps:file-changed` → 前端按偏好 `api:ps:read-back` 导回（新图层 / 替换当前 / 新画布）。`read-back` 只允许读本桥跟踪过的路径，防任意文件读。其余画板能力（图层 / 蒙版 / 透视 / 裁切 / 调色 / 扩图 / 工程文件）仍全部在渲染进程内。

---

## 九.C 智能画布渲染管线（React Flow 节点图）

智能画布（`/smart-canvas`）基于 `@xyflow/react`（React Flow v12），是独立的 AI 创作工作流节点编排器。**零新 IPC**——所有节点运行复用既有通道。

### 节点种类（17 类，`src/types/smartCanvas.ts:SmartNodeKind`）

| 产出类 | 处理类 | 容器 / 视图类 |
|--------|--------|--------------|
| `image` 图片 / `prompt` 提示词 / `text` 文字 / `video-source` 视频上传 | `llm` LLM / `image-reverse` 图像反推 / `video-reverse` 视频反推 / `angle-prompt` 视角 / `light` 光源 / `scale` 缩放 / `ratio` 尺寸分析 / `work` 生图 / `comfy` ComfyUI / `video` 视频 | `result` 结果 / `compare` 对比 / `group` 分组 |

### 数据流

```
工具坞落位 / 拖入 / 跨模块「发送到智能画布」
        │
        ▼
useSmartCanvasStore（当前文档工作缓冲，不持久化）
   ├─ nodes / edges（自定义节点 + NodeShell + NodeResizer）
   └─ computeUpstream(node) → { images, prompts, refs, videos }（沿连线收集上游产出）
        │
        ▼ 运行（单节点 / 运行全部=拓扑串行）
src/lib/smartCanvasRunner.ts（runOne 分发）
   ├─ work   → api:image:generate / api:upscale:run-single（provider: mengbi | mock）
   ├─ llm    → api:chat:optimize-prompt + api:lab:reverse
   ├─ comfy  → api:comfyui:run-single + template:get（整工作流当黑盒，只拆输入/输出）
   ├─ video  → api:video:generate（真实生成，7 模式按能力自适应）
   ├─ scale  → 接图走 canvas / 接视频走 api:video:scale（ffmpeg）
   └─ reverse→ api:lab:reverse（图像 / 视频抽帧后多图反推）
        │
        ▼ 结果回灌
useSmartResultStore（内存累积集合，每节点上限 100 FIFO，不进文档）
   + 在途任务记 docId：结果回来若已切走画布则 patchDocNodes 回灌该文档存储
```

### 多文档与持久化

- **launcher-first**：进入先到「选择画布」启动页（`CanvasLauncher`），新建 / 打开 / 重命名 / 复制 / 删除多张画布。
- 文档元数据存 localStorage `mengbi.smartCanvas.docs.v1`（`useSmartDocsStore`），每张画布内容单独存 `mengbi.smartCanvas.doc.<id>`（`lib/smartDocStorage.ts`，挂载 load、改动 500ms 去抖写回）；旧单文档首次进入自动迁移。
- 在途 work/comfy/video 任务跨文档不丢（记 docId + 回灌）；localStorage 写入配额超限有 toast 预警。

### 交互能力

撤销 / 重做（Ctrl+Z / Shift+Z，上限 50）· 复制 / 粘贴 / 再制（Ctrl+C/V/D，跨文档剪贴板 + 重映射内部连线）· 节点搜索（Ctrl+F，setCenter 居中高亮）· 运行全部（拓扑串行，进度 N/total + 软停）· 连线流动着色（按上游运行状态 idle/running/success/error）· 网格吸附 + 对齐参考线 · 智能排布（最长路径分层、上游左→下游右、barycenter 减交叉）· 分组容器（拖入自动归 parentId）· MiniMap 按类型上色 · 跨模块「发送到智能画布」（图库 / 生图 / 工具箱 / ComfyUI / 画板五个来源）。

### 连线校验

`canConnectKinds(sourceKind, targetKind)` 纯类型版校验：结果节点只接 work/comfy/video 等产出；视频类（video-reverse / scale / result）只接视频源；非法连线落节点时 toast 具体原因。

---

## 九.D 视频生成引擎（异步提交 → 轮询 → 落盘）

视频生成于 2026-06-07 接入（解除「v1.0 不做视频」旧铁律）。配置：`api_configs.type='video'` + `video_kind ∈ kling | sora | unified | seedance | custom | veo | runway | fal`。

### 引擎分流

| 路径 | video_kind | 实现 |
|------|-----------|------|
| legacy 内置引擎 | `kling` / `sora` / `unified` | `electron/ipc/video.ts`（三套协议模板 + 跨站字段容错 `extractTaskId`/`extractStatus`/`extractVideoUrl`） |
| 适配器 registry | `seedance` / `custom` | `electron/services/video/`（`VideoProviderAdapter` 接口 + `seedanceAdapter.ts` + `registry.ts`） |
| 更多适配器 | `veo` / `runway` / `fal` | `electron/services/video/moreAdapters.ts` |

### 数据流

```
VideoNode / 设置页 → api:video:generate（立即返回 taskId，异步跑）
        │
        ▼ 主进程按 video_kind 选引擎/适配器：构 request → 强校验（validateVideoRequest）
        │  → 并发闸门 maxConcurrentTasks → 友好错误 + API Key 脱敏（scrubKey）
        ▼ POST 提交 → 轮询状态（video:progress 推送）
        ▼ 下载 mp4 → 落盘 image_storage_path/<date>/video-*.mp4 → INSERT INTO images
        ▼ video:done 推送 → 渲染端抓首帧 webp（lib/videoPoster.ts，免 ffmpeg）
          → api:video:save-thumbnail 写 thumbnail_path（仅对新生成且抓帧成功者）
```

### 配置中心与共享层

- **共享层** `@shared/video`（`VideoGenerationRequest` / `VideoTask` / 7 种模式 + 纯函数 `validateVideoRequest` / `estimateVideoCost`）+ `@shared/videoProviders`（capabilities / limits / defaultParams + 内置模板 + `mergeVideoProvidersConfig` / `findVideoModel`）。
- **渲染端**：`videoProvidersStore`（配置中心，存 `video_providers_json`）+ `videoHistoryStore`（localStorage 任务历史，上限 100）+ 设置页 `VideoProvidersCenter`（能力 / 限制 / 默认参数可视化编辑 + 本地连接检查不烧钱 + 费用阈值 + 历史）。
- **IPC**：`api:video:generate` / `cancel` / `upload-asset`（本地视频/音频经供应商 uploadEndpoint 上传成公网 URL）/ `save-thumbnail` / `scale`（ffmpeg-static 重编码）。

> 视频提示词的「纯文本管理」仍保留（图库 / 管家不变）；智能画布「视频」节点是真实生成（非 mock），支持 7 模式按能力自适应显隐 + 费用预估 + dry-run 校验 + 高费用二次确认 + 批量 + 连续生成（末帧→下一段首帧）。

---

## 九.E ComfyUI 工作流编排器服务（comfyui）

独立顶级模块（`/comfyui`，Ctrl+4），连接本地 ComfyUI、导入 API Format workflow、可视化绑定、批量循环。与生图页 `image_kind='comfyui'` 的内联「一键直跑」是**有意保留的双轨**（深度编排 vs 一键），不要合并。

| 文件（`electron/services/comfyui/`） | 职责 |
|------|------|
| `client.ts` | HTTP 客户端（探活 GET /system_stats、提交 /prompt、读 /history） |
| `launcher.ts` / `launchScanner.ts` | 按用户命令在用户目录 spawn 启动；选 ComfyUI 文件夹自动识别启动方式（纯读目录 + .bat 文本，不执行） |
| `parser.ts` / `bindings.ts` | 解析 API 格式 workflow + 参数绑定（不写死 node_id / 不限工作流类型） |
| `wsTracker.ts` | `ws://host/ws?clientId=` 实时 per-node 进度 + 队列（2s 开不起回退 /history 轮询） |
| `outputReader.ts` / `gallerySync.ts` | 取回输出（不写死 SaveImage）+ 落盘入图库（含 ensureThumbnail） |
| `runEngine.ts` / `queue.ts` / `loopEngine.ts` / `store.ts` | 运行引擎（每次 structuredClone 原始 workflow 防污染）+ 串行队列（concurrency=1）+ 公式循环（expr-eval 安全无 eval）+ 模板 CRUD |

- IPC：`api:comfyui:*`（get-config / set-config / scan-launch / detect / status / start / stop / import / template:list·get·upsert·delete / run-single / cancel / run-status / results:get）。
- push 频道：`comfyui:status` / `comfyui:run-progress` / `comfyui:run-done` / `comfyui:queue`。
- 复用 `electron/services/httpClient.ts`（chromiumFetch）与 `imageStore.ts`（saveImage，带 ext 参数）。

---

## 九.F IPC 域与推送频道全集

> 命名前缀 `api:<domain>:<action>`，handler 全在 `electron/ipc/`，入参经 zod 校验，返回 `Result<T, AppError>`（不 throw）。详细动作清单见 `CLAUDE.md` §4。

| 域 | 文件 | 简述 |
|----|------|------|
| `chat` | chat.ts | 对话与流式（send / cancel / create / list / history / rename / delete） |
| `image` | generate.ts | 绘图任务队列（generate / status / cancel / queue） |
| `gallery` · `prompt`（休眠）· `album` | gallery.ts | 图库 / 提示词卡片（休眠）/ 相册（manual + smart） |
| `lab`（后端保留） | lab.ts | reverse / translate / history（智能画布 LLM·反推复用 reverse） |
| `settings` · `plan` · `storage` · `export` · `theme` | settings.ts + main.ts | 设置 / 方案 / 文件对话框 / 卡片导出 / 自定义主题 |
| `tools` · `upscale` · `vec` · `interp` | 工具箱 | 落盘入库 / Real-ESRGAN 保真放大 / 图像转矢量 / RIFE 视频插帧 |
| `ps` | ps.ts | 画板 Photoshop 联动（send / read-back / watch / status …） |
| `comfyui` | comfyui*.ts | ComfyUI 工作流编排器 |
| `video` | video.ts + services/video | 视频生成（generate / cancel / upload-asset / save-thumbnail / scale） |
| `llm`（开发中） | localLlm.ts | 内嵌本地 LLM（node-llama-cpp）状态 / 停止（不暴露 start） |

**主进程主动推送频道（renderer 用 `on` 监听）**：
`chat:chunk` / `chat:done` / `chat:sources` / `image:done` / `image:progress` / `notification:append` / `upscale:progress` / `upscale:done` / `upscale:install-progress` / `ps:file-changed` / `comfyui:status` / `comfyui:run-progress` / `comfyui:run-done` / `comfyui:queue` / `video:progress` / `video:done`。

> `chat:sources`：仅当 `search_backend` 为外部搜索后端（`ddg` / `tavily` / `searxng` / `bocha` / `zhipu` / `jina` / `serper`）且方案勾了 `supports_web_search` 时，stream 启动前推一条 `{ id, backend, hits[] }`，前端挂到该轮 assistant 消息的「参考来源」卡片。

---

## 十、构建与发布

```
本地 dev：   vite dev (5400)  ──►  electron main 加载 http://127.0.0.1:5400
本地 build： vite build → dist/   electron-builder 24 打包为 NSIS / DMG / AppImage
更新通道：   electron-updater 6 走 GitHub Releases（默认）或自建 OSS
```

> **打包注意**：`sharp`（缩略图，native）、`ffmpeg-static`（视频缩放 `api:video:scale`）、`onnxruntime`（抠图）等含原生二进制 / 外部 exe 的依赖需在 `electron-builder.yml` 的 `asarUnpack` 解包，否则运行时找不到（adapter 内已做 asar→asar.unpacked 路径重映射）。

### 十.A 单元测试（vitest）

`npm test`（= `vitest run`）当前覆盖**参数流纯函数**，约 94 例，只跑纯函数、不依赖 electron / better-sqlite3：

- `src/types/imageModelFamilies.ts`：family 识别 + buildBody（锁「选 4K 实际出 1K」）；
- `electron/ipc/imageBody.ts`：resolveSize / applyBodyOverrides（占位替换 / null 删字段 / 像素换算）；
- `@shared/videoProviders`（videoProviders.test.ts）：合并 / 查找 / 校验 / 费用 / 模式归一；
- `electron/services/video/adapter.test.ts`：joinUrl 去重 / extractTaskId / extractVideoUrl / 状态归一。

新增涉及尺寸 / 请求体 / 参数映射的纯函数请同步补 `*.test.ts`。

详细发版流程见 `DEVELOPMENT.md` 的 Phase 7。
