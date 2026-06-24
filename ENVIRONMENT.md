# 运行 / 开发环境

## 一、开发机要求

| 项 | 要求 |
|----|------|
| 操作系统 | Windows 10 / 11、macOS 12+、Linux（Ubuntu 20.04+） |
| Node.js | 18.x ~ 20.x（推荐 18.17+） |
| 包管理器 | npm 9+ 或 pnpm 8+（项目用 npm 锁版本） |
| Git | 2.30+ |
| Python | 3.x（仅在 Windows 用 `node-gyp` 编译时需要） |
| 磁盘空间 | 仓库 + node_modules + 调试缓存 ≥ 5 GB |

### 1.1 原生编译工具链（必装）

`better-sqlite3` 需要在本地编译原生模块。各平台一次性装好：

#### Windows

安装 **Visual Studio 2022 Build Tools**（不要用 `windows-build-tools` npm 包，该包已在 2020 年废弃）：

1. 下载安装器：<https://visualstudio.microsoft.com/zh-hans/visual-cpp-build-tools/>
2. 勾选工作负载「使用 C++ 的桌面开发」（Desktop development with C++）
3. 完成后在 PowerShell 设置 npm 编译变量：

```powershell
npm config set msvs_version 2022
```

#### macOS

```bash
xcode-select --install
```

#### Linux (Debian / Ubuntu)

```bash
sudo apt-get install -y build-essential libgtk-3-dev libnss3 libxss1 libasound2
```

### 1.2 Electron 原生模块重建

每次升级 Electron 或 better-sqlite3 后必须执行：

```bash
npx electron-rebuild
```

`package.json` 的 `postinstall` 脚本会自动跑，正常情况下用户不需要手动执行。

---

## 二、最终用户机要求

| 项 | 要求 |
|----|------|
| 操作系统 | Windows 10+、macOS 11+、主流 Linux 发行版（需 GTK3） |
| 安装包大小 | Windows ≈ 200 MB（NSIS）/ macOS ≈ 250 MB（DMG）/ Linux ≈ 220 MB（AppImage） |
| 用户数据空间 | 至少预留 2 GB（图片、缓存、数据库另计） |
| 内存 | ≥ 4 GB |
| 网络 | 调用云端 AI 模型 API 需联网；纯本地工具箱处理（放大 / 矢量化 / 抠图）可离线 |
| 显示器 | 最低 1280×720，推荐 1440×900 及以上 |

> **可选本地引擎的额外要求**（不用则无需关心）：工具箱 Real-ESRGAN 保真放大走 ncnn Vulkan，需支持 Vulkan 的显卡；智能画布「插帧」节点走 rife-ncnn-vulkan（同样需 Vulkan 显卡，引擎按需下载 ~40MB 到 `userData/engines/rife/`，处理时拆帧临时目录需充足磁盘空间）；ComfyUI 编排器需用户本机已装并能启动 ComfyUI；内嵌本地 LLM（`node-llama-cpp`，开发中）按所选模型吃内存 / 显存。

---

## 三、API 服务依赖

梦笔本身不内置任何 API Key，全部由用户在设置页填入。下面列出协议层面的依赖。

### 3.1 对话模型（OpenAI 兼容协议）

| 类型 | 端点形式 | 说明 |
|------|---------|------|
| OpenAI 官方 | `https://api.openai.com/v1/chat/completions` | 标准 SSE 流式 |
| 中转站（OpenAI 兼容） | 用户填写自定义 `base_url` | 需返回 OpenAI 兼容的 `chat.completion.chunk` |

### 3.2 国产对话模型（独立协议，需适配器 normalize）

| 厂家 | base_url 模板 | 备注 |
|------|--------------|------|
| Kimi（Moonshot） | `https://api.moonshot.cn/v1` | OpenAI 兼容 |
| MiniMax | `https://api.minimax.chat/v1` | 自有 SSE，需 normalize |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | 自有 SSE，需 normalize |
| DeepSeek | `https://api.deepseek.com` | OpenAI 兼容 |

> 所有 base_url 由用户自填，本表只用于本地测试与文档参考。

### 3.3 多模态（vision）模型

参考图描述、图片反推、AI 自动标签都需要支持 vision 的对话模型：

- 用户在"对话模型配置"中勾选 `supports_vision = true` 后，前端才会启用相关功能；
- 不支持 vision 的模型在 UI 上以"功能不可用"提示，**不会**报错。

### 3.4 绘画模型

绘画模型配置走 `api_configs.type='image'`，`image_kind` 指定协议：

| `image_kind` | 端点形式 | 说明 |
|------|---------|------|
| `openai` | `POST {base_url}/images/generations` | 标准 OpenAI 图片接口（DALL·E 3 / GPT-Image 风格） |
| `openai-compat` | 用户自填 | OpenAI 兼容中转站 |
| `grsai` | 自有异步轮询协议 | 提交 → 轮询 → 取回（如 nano-banana 系列） |
| `gemini` | Google 协议 | — |
| `comfyui` | 内联 ComfyUI workflow | 把 API Format workflow 当占位符替换后直跑（`comfyui_workflow_json`） |

> 图像模型「系列（family）」机制（`src/types/imageModelFamilies.ts`）按真实 model ID 嗅探 5 个 family（`gpt-image-2` / `nano-banana-pro` / `nano-banana-flash` / `nano-banana-2` / `default`），`buildBody` 只发该 family 真正识别的字段（解决"选 4K 实际出 1K"）；之后 `applyBodyOverrides`（`electron/ipc/imageBody.ts`）按方案 `body_overrides_json` 顶层合并（占位符整串替换 + `null` 删字段）。

### 3.4a 视频模型（2026-06-07 接入）

视频生成走异步范式「提交任务 → 轮询状态 → 下载 mp4 落盘 → 入图库」。配置走 `api_configs.type='video'`，`video_kind` 指定协议：

| `video_kind` | 引擎 | 说明 |
|------|------|------|
| `kling` / `sora` / `unified` | `electron/ipc/video.ts` 内置 legacy 引擎 | 三套提交/轮询/取 URL 协议（kling 代理型 / sora 原生 / unified 聚合） |
| `seedance` / `custom` / `veo` / `runway` / `fal` | `electron/services/video/` 适配器（`VideoProviderAdapter` 接口 + registry） | 统一请求 + 供应商适配器 + 富配置 |

> 视频凭证存 `api_configs(type='video')`；端点能力/限制/默认参数/费用阈值等富配置存 `settings.video_providers_json`。视频提示词的"纯文本管理"仍在图库/管家内保留。

### 3.5 联网搜索（可选）

> 由设置项 `search_backend` 选择，取值：`native` / `ddg` / `tavily` / `searxng` / `bocha` / `zhipu` / `jina` / `serper` / `off`。

| 后端（`search_backend`） | 是否需要 Key | 备注 |
|------|------------|------|
| `native` 模型原生联网 | ❌ | 在"对话模型配置"中标记 `supports_web_search = true`，用模型自带 web_search tool |
| `ddg` DuckDuckGo | ❌ | 走 `duck-duck-scrape`，无 Key 兜底，可能被风控 |
| `tavily` | ✅ | `search_tavily_key`，推荐，免费额度足够个人使用 |
| `searxng` | ❌ | 自建实例，配 `search_searxng_url` |
| `bocha` 博查 | ✅ | `search_bocha_key` |
| `zhipu` 智谱 | ✅ | `search_zhipu_key` |
| `jina` | ✅ | `search_jina_key`（s.jina.ai） |
| `serper` Google | ✅ | `search_serper_key`，Google Search API，速度快 |
| `off` | — | 关闭联网搜索 |

> 命中外部搜索后端（非 `native`/`off`）且方案勾了 `supports_web_search` 时，主进程在 stream 启动前推一条 `chat:sources`，前端把参考来源挂到该轮回答。

---

## 四、本地数据存放

| 类型 | Windows | macOS | Linux |
|------|---------|-------|-------|
| 数据库 | `%APPDATA%\mengbi\database.sqlite` | `~/Library/Application Support/mengbi/database.sqlite` | `~/.config/mengbi/database.sqlite` |
| 图片 | 默认 `应用根目录\images\`，可在设置页改 | 同 | 同 |
| 加密 Key | 通过 Electron `safeStorage` 加密后存入数据库 | 同 | 同 |
| 自动更新缓存 | `%APPDATA%\mengbi\updater\` | `~/Library/Application Support/mengbi/updater/` | `~/.config/mengbi/updater/` |

> 数据库为 `better-sqlite3`（同步 API），结构版本 `CURRENT_SCHEMA_VERSION = 15`（`electron/services/db.ts`）。里程碑：v14 加 ComfyUI 编排器表（`comfyui_workflow_templates` / `comfyui_runs`）；v15 加 `api_configs.video_kind` 列。`prompts` / `images` 删除走软删除（置 `deleted_at`，列表带 `WHERE deleted_at IS NULL`，30 天后物理清理）。图片落盘命名 `{date:YYYY-MM-DD}/{taskId}-{seq:02d}.png`，缩略图 `{date}/.thumbs/{taskId}-{seq:02d}.webp`。

> Dev 模式下 `safeStorage` 在某些 Linux 发行版无 backend 时会退化为明文。开发阶段可设置环境变量 `MENGBI_DEV_KEY=<32 位十六进制>` 走 dev 兜底，正式打包后强制走 `safeStorage`。

---

## 五、日志策略

> 主进程日志由 `electron-log` 管理；渲染进程日志通过 IPC 转发到主进程统一落盘。

### 5.1 日志路径

| 平台 | 日志目录 |
|------|---------|
| Windows | `%APPDATA%\mengbi\logs\` |
| macOS | `~/Library/Logs/mengbi/` |
| Linux | `~/.config/mengbi/logs/` |

文件命名：`main.log`（最新）+ `main.old.log`（轮转后），单文件上限 5MB，保留最近 3 个。

### 5.2 日志级别

| 级别 | 用途 | 默认开启 |
|------|------|---------|
| `error` | 异常、API 失败、数据库错误 | ✅ 始终 |
| `warn` | 配置缺失、降级行为（如 vision 不支持） | ✅ 始终 |
| `info` | 任务提交 / 完成、设置保存 | ✅ 始终 |
| `debug` | IPC 入参出参、SSE 分块详情 | dev 默认开，prod 默认关 |
| `trace` | 完整 HTTP 请求体（含敏感信息） | 默认关，只在排查时手动开 |

控制方式：

```bash
# 临时开启 debug
MENGBI_LOG_LEVEL=debug npm run dev

# 临时开启 trace（注意 API Key 会进入日志，自查后再分享）
MENGBI_LOG_LEVEL=trace npm run dev
```

### 5.3 用户报 bug 时该交什么

让用户在设置页点"导出诊断日志"——主进程会把 `logs/` 目录最近 3 个文件 + `database.sqlite` 的 schema 信息（**不含具体内容、不含 Key**）打成一个 zip。

### 5.4 隐私红线

- API Key 在任何级别都**不**写入日志（即使 `trace` 级别也只写脱敏后的 `sk-***...***`）；
- 用户图片不写入日志；
- 提示词内容仅在 `trace` 级别才记录（用于排查模型适配问题），`info`/`debug` 仅记录长度。

---

## 六、开发期 Mock 模式

> AI 辅助开发会反复跑 API，真实调用既慢又烧钱。Mock 模式让所有外部请求走本地夹具，不消耗真 Key。

### 6.1 启用方式

```bash
MENGBI_MOCK=1 npm run dev
```

启用后：

- 所有 `StreamAdapter` / `VisionAdapter` / `ImageAdapter` / `SearchAdapter` 改走 `electron/ipc/mocks/` 下的本地夹具；
- 设置页的"测试连通性"按钮永远返回成功；
- 流式对话从 `mocks/chat-stream.json` 按预设节奏吐 chunk；
- 绘图任务从 `mocks/images/*.png` 随机挑一张返回。

### 6.2 夹具目录约定

```
electron/ipc/mocks/
├── chat-stream.json        # SSE chunk 序列
├── chat-vision.json        # 含图片输入的对话样例
├── images/                 # 模拟生图结果（PNG）
├── reverse-result.json     # 反推样例输出
└── search-tavily.json      # 联网搜索样例
```

### 6.3 Phase 1 准入条件

Mock 模式必须在 Phase 1 完成时就可用——否则 Phase 2~5 的代码会反复消耗真 API。`DEVELOPMENT.md` Phase 1 子任务 1.10 加了这一项。

### 6.4 真实 API 兜底

某些场景必须用真 API（如最终联调、release 候选自测），用：

```bash
MENGBI_MOCK=0 npm run dev
```

或留空 `MENGBI_MOCK` 即默认走真实 API。

---

## 七、网络出站策略

为保护用户隐私，应用只会向以下地址发出请求：

1. 用户在设置页配置的 API base_url（对话 / 绘画 / 多模态 / 视频 / 搜索）；
2. GitHub Releases（`electron-updater` 检查更新，可在设置中关闭）；
3. 工具箱放大引擎下载（用户在工具箱面板主动触发 `api:upscale:install-engine` / `install-model`，源可选 GitHub / 国内镜像）；
4. 用户本机的本地服务（用户主动配置 / 启动后才连）：ComfyUI（`/comfyui` 连本地 ComfyUI host）、内嵌本地 LLM（`node-llama-cpp`，无外网）。

> 不会主动上传任何用户图片、提示词或使用记录到任何第三方分析服务。视频上传素材（`api:video:upload-asset`）仅在用户主动使用视频参考素材且供应商配了 `uploadEndpoint` 时发往该供应商。

---

## 八、版本锁（关键依赖）

### 8.1 核心栈

| 包 | 锁定版本 | 原因 / 用途 |
|----|---------|------|
| `electron` | `^28.x` | 配套 Node 18 ABI |
| `better-sqlite3` | `11.3.0` | 同步 API；与 Electron 28 ABI 匹配（native，须 electron-rebuild） |
| `electron-builder` | `^24.x` | 稳定多平台打包 |
| `electron-updater` | `^6.x` | 配套 builder，GitHub Releases 检查更新 |
| `@electron/rebuild` | `^3.x` | postinstall 触发原生模块重建 |
| `react` / `react-dom` | `^18.x` | hooks + concurrent |
| `react-router-dom` | `^6.x` | 前端路由 |
| `vite` | `^5.x` | 现代构建（配 `electron-vite`） |
| `electron-vite` | `^2.x` | Electron + Vite 一体化构建 |
| `typescript` | `^5.x` | 严格模式 |
| `zustand` | `^4.x` | 轻量状态 |
| `framer-motion` | `^11.x` | 动效 |
| `zod` | `^3.x` | IPC 入参校验 |
| `electron-log` | `^5.x` | 主进程日志 |

### 8.2 功能模块依赖

| 包 | 锁定版本 | 用途 |
|----|---------|------|
| `@xyflow/react` | `^12.x` | 智能画布（`/smart-canvas`）React Flow v12 节点图（17 类节点 + MiniMap + NodeResizer） |
| `ws` | `^8.x` | ComfyUI 编排器实时进度（`ws://host/ws`，2s 起不来回退 `/history` 轮询） |
| `expr-eval` | `^2.x` | ComfyUI 批量循环的安全公式求值（禁 `eval`） |
| `ffmpeg-static` | `^5.x` | 智能画布缩放节点的视频重编码（`api:video:scale`，libx264/aac）；electron-builder `asarUnpack` 解包 |
| `@imgly/background-removal` | `^1.x` | 画板 / 工具箱抠图（去背景） |
| `onnxruntime-web` | `^1.x` | 抠图模型在渲染端推理（WASM） |
| `onnxruntime-node` | `^1.x` | onnx 主进程推理；含侧载 DLL，须 `asarUnpack` |
| `sharp` | `^0.33.x` | 缩略图生成（webp）；native，prebuilt 二进制须 `asarUnpack`（`@img/sharp-*`） |
| `@neplex/vectorizer` | `^0.0.x` | 图像转矢量 Fast 模式（VTracer，Rust，彩色） |
| `potrace` | `^2.x` | 图像转矢量 Crisp 模式（纯 JS，单色线稿） |
| `konva` / `react-konva` | `^9.x` / `^18.x` | 画板（`/canvas`）画布渲染 |
| `node-llama-cpp` | `^3.x` | 内嵌本地 LLM 推理服务（`localLlm.ts`，开发中） |
| `duck-duck-scrape` | `^2.x` | 联网搜索 `ddg` 后端 |
| `gpt-tokenizer` | `^2.x` | token 计数（上下文压缩） |

### 8.3 测试

| 包 | 锁定版本 | 用途 |
|----|---------|------|
| `vitest` | `^4.x` | 单元测试（`npm test` = `vitest run`），只覆盖参数流纯函数（`imageModelFamilies` / `imageBody` / `videoProviders` / video adapter，当前约 94 例），不依赖 electron / better-sqlite3 |

具体版本以 `package.json` 为准，本表用于解释为什么这样锁。

> **asarUnpack 解包**：native 模块（`sharp` / `@img/*` / `onnxruntime-node`）与 `ffmpeg-static` 在 asar 内无法 `dlopen` / 找到可执行二进制，须在 `electron-builder.yml` 的 `asarUnpack` 列出（路径会从 `app.asar` 重映射到 `app.asar.unpacked`）。
